"""Shared state + pure logic for the AMC assistant. Used by app.py (web) and assistant.py (cron)."""

import copy
import datetime as dt
import json
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import amc

STATE = Path("state.json")
DROP_AFTER_DAYS = 7
FEEDS = ("now-playing", "coming-soon", "advance")

DEFAULT_STATE = {
    "onboarded": False,
    "theatres": [2253],  # ordered; theatre 1 is your primary
    "theatre_names": {},  # id -> name (cache)
    "formats": [],  # accepted formats e.g. ["IMAX","DOLBY"]; [] = any
    "earliest_hour": 18,  # only showtimes at/after this local hour
    "weekends_only": False,
    "party_size": 2,
    "lookahead_days": 7,
    "movies": {},  # id -> {name, release, poster, last_seen, watch}
    "notified": {},  # "movieId:theatreId" -> [showtime ids already alerted]
}


def load_state():
    state = copy.deepcopy(DEFAULT_STATE)
    if STATE.exists():
        state.update(json.loads(STATE.read_text(encoding="utf-8")))
    return state


def save_state(state):
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


# --- sent-alert log (append-only, one JSON object per line) ------------------

ALERTS = Path("alerts.jsonl")


def log_alert(record):
    """Append one alert record. A timestamp is added automatically."""
    record = {"ts": dt.datetime.now().isoformat(timespec="seconds"), **record}
    with ALERTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def read_alerts(limit=100):
    """Return the most recent alert records, newest first."""
    if not ALERTS.exists():
        return []
    out = []
    for line in ALERTS.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:  # nosec B110 - skip an unparseable log line, keep the rest
            pass
    return list(reversed(out))


# --- showtime helpers -------------------------------------------------------


def fmt(s):
    codes = " ".join(a.get("code", "") for a in s.get("attributes", []))
    if "IMAX" in codes:
        return "IMAX"
    if "DOLBYCINEMA" in codes:
        return "DOLBY"
    if "XL" in codes:
        return "XL"
    if "LASERATAMC" in codes:
        return "LASER"
    return "STANDARD"


def matches(s, st):
    if s.get("isCanceled"):
        return False
    if st["formats"] and fmt(s) not in st["formats"]:
        return False
    local = s.get("showDateTimeLocal", "")
    if len(local) < 16 or int(local[11:13]) < st["earliest_hour"]:
        return False
    if st["weekends_only"] and dt.date.fromisoformat(local[:10]).weekday() < 5:
        return False
    return True


def clock(local):
    h, m = int(local[11:13]), local[14:16]
    return f"{h % 12 or 12}:{m} {'AM' if h < 12 else 'PM'}"


def pretty(local, with_date=False):
    if not with_date:
        return clock(local)
    d = dt.date.fromisoformat(local[:10])
    return f"{d:%a %b} {d.day} · {clock(local)}"


def poster(movie):
    media = movie.get("media") or {}
    return media.get("posterDynamic") or media.get("heroDesktopDynamic") or ""


CLOUDINARY = "amc-theatres-res.cloudinary.com/"


def poster_url(url, width):
    """AMC serves ~5MB posters. Inject a Cloudinary resize so we fetch ~tens of KB instead."""
    if not url or CLOUDINARY not in url:
        return url or ""
    return url.replace(CLOUDINARY, f"{CLOUDINARY}w_{width},f_auto,q_auto/", 1)


def show_row(s, with_date=False, now=None):
    local = s.get("showDateTimeLocal", "")
    return {
        "when": pretty(local, with_date),
        "fmt": fmt(s),
        "aud": s.get("auditorium", "?"),
        "sold": bool(s.get("isSoldOut")),
        "url": s.get("purchaseUrl") or "",
        "passed": bool(now and local and local < now),
    }


# --- movie cache + lifecycle ------------------------------------------------


def _safe(fetch, *args):
    try:
        return fetch(*args)
    except Exception as e:
        print(f"AMC fetch failed ({getattr(fetch, '__name__', fetch)} {args}): {e}")
        return []


def refresh_movies(state):
    """Pull every AMC feed (in parallel), cache name/release/poster, stamp last_seen=today."""
    today = dt.date.today().isoformat()
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as ex:
        feeds = list(ex.map(lambda v: _safe(amc.movies, v), FEEDS))
    for feed in feeds:
        for m in feed:
            codes = {a.get("code") for a in m.get("attributes", [])}
            entry = state["movies"].get(str(m["id"]), {"watch": False})
            entry.update(
                {
                    "name": m.get("name"),
                    "release": (m.get("releaseDateUtc") or "")[:10],
                    "poster": poster(m) or entry.get("poster", ""),
                    "playing": bool(m.get("hasScheduledShowtimes")),
                    "score": m.get("score") or 0,  # AMC popularity (0–~0.12)
                    "intl": "INTFILMS" in codes,  # international film -> less relevant
                    "fanfave": "FANFAVES"
                    in codes,  # fan-favorite re-release -> more relevant
                    "last_seen": today,
                }
            )
            entry.setdefault("watch", False)
            state["movies"][str(m["id"])] = entry


def gc(state):
    """Drop movies not seen in any feed for DROP_AFTER_DAYS; clean their notify memory."""
    cutoff = (dt.date.today() - dt.timedelta(days=DROP_AFTER_DAYS)).isoformat()
    dropped = [
        mid for mid, m in state["movies"].items() if m.get("last_seen", "") < cutoff
    ]
    for mid in dropped:
        del state["movies"][mid]
        for key in [k for k in state["notified"] if k.startswith(mid + ":")]:
            del state["notified"][key]
    return dropped


def set_watch(state, movie_id, on):
    mid = str(movie_id)
    entry = state["movies"].get(mid) or {"last_seen": dt.date.today().isoformat()}
    entry["watch"] = on
    state["movies"][mid] = entry


def watchlist(state):
    return [int(mid) for mid, m in state["movies"].items() if m.get("watch")]


def movie_poster(state, movie_id):
    return (state["movies"].get(str(movie_id)) or {}).get("poster", "")


def relevance(m, local_ids):
    """Rank: at your theatre first, then by popularity — boosted for fan-favorite
    re-releases, penalized for international films."""
    score = m.get("score") or 0
    if m.get("fanfave"):
        score += 0.15  # notable re-releases (CMBYN, Paddington) rise to the top
    if m.get("intl"):
        score -= 0.15  # international one-offs (Bollywood, etc.) sink
    return (m["id"] in local_ids, score)


def movie_grid(state, local_ids=frozenset()):
    """Cached movies split into (now playing, coming soon), each ranked by relevance."""
    items = [dict(id=int(mid), **m) for mid, m in state["movies"].items()]
    for m in items:
        m["local"] = m["id"] in local_ids

    def key(m):
        return relevance(m, local_ids)

    now = sorted((m for m in items if m.get("playing")), key=key, reverse=True)
    soon = sorted((m for m in items if not m.get("playing")), key=key, reverse=True)
    return now, soon


# --- data + views -----------------------------------------------------------


def _day_showtimes(tid, day):
    try:
        return amc.showtimes(tid, day)
    except urllib.error.HTTPError as e:
        if e.code != 404:  # 404 just means no showtimes that day — that's normal
            print(f"showtimes {tid} {day} failed: {e}")
    except Exception as e:
        print(f"showtimes {tid} {day} failed: {e}")
    return []


def fetch_showtimes(state, days=None, dates=None):
    """{theatre_id: [showtimes]} fetched in parallel.

    Pass explicit `dates` (list of YYYY-MM-DD), or `days` for that many days from today
    (defaults to lookahead_days)."""
    if dates is not None:
        daylist = dates
    else:
        span = days if days is not None else state["lookahead_days"]
        daylist = [(dt.date.today() + dt.timedelta(n)).isoformat() for n in range(span)]
    for tid in state["theatres"]:
        if str(tid) not in state["theatre_names"]:
            try:
                state["theatre_names"][str(tid)] = amc.theatre(tid).get(
                    "name", f"Theatre {tid}"
                )
            except Exception:
                state["theatre_names"][str(tid)] = f"Theatre {tid}"
    tasks = [(tid, day) for tid in state["theatres"] for day in daylist]
    data = {tid: [] for tid in state["theatres"]}
    if tasks:
        with ThreadPoolExecutor(max_workers=min(12, len(tasks))) as ex:
            for (tid, _), shows in zip(
                tasks, ex.map(lambda t: _day_showtimes(*t), tasks)
            ):
                data[tid] += shows
    return data


def build_board(state, data, day=None):
    """A day's lineup (default today), grouped by theatre then movie, ranked by popularity."""
    day = day or dt.date.today().isoformat()
    now = dt.datetime.now().isoformat()

    # all board movies are at this theatre, so relevance ranks them by popularity (incl. fan-fave boost)
    def rank(kv):
        mid = kv[0][1]
        return relevance({"id": mid, **state["movies"].get(str(mid), {})}, frozenset())

    out = []
    for tid in state["theatres"]:
        grouped = {}
        for s in data.get(tid, []):
            local = s.get("showDateTimeLocal", "")
            if (
                local.startswith(day)
                and not s.get("isCanceled")
                and int(local[11:13]) >= state["earliest_hour"]
            ):
                grouped.setdefault(
                    (s.get("movieName") or "?", s.get("movieId")), []
                ).append(s)
        movies = []
        for (title, mid), shows in sorted(grouped.items(), key=rank, reverse=True):
            shows.sort(key=lambda s: s["showDateTimeLocal"])
            info = state["movies"].get(str(mid), {})
            movies.append(
                {
                    "id": mid,
                    "title": title,
                    "poster": movie_poster(state, mid),
                    "rerelease": bool(info.get("fanfave")),
                    "shows": [show_row(s, now=now) for s in shows],
                }
            )
        out.append(
            {
                "name": state["theatre_names"].get(str(tid), f"Theatre {tid}"),
                "movies": movies,
            }
        )
    return out


def build_watch(state, data):
    """Per watched movie (ranked by the same popularity metric as the Movies tab),
    with matching showtimes soonest first."""
    now = dt.datetime.now().isoformat()
    local_ids = {s.get("movieId") for shows in data.values() for s in shows}
    mids = sorted(
        watchlist(state),
        key=lambda mid: relevance(
            {"id": mid, **state["movies"].get(str(mid), {})}, local_ids
        ),
        reverse=True,
    )
    out = []
    for mid in mids:
        info = state["movies"].get(str(mid), {})
        hits = sorted(
            (
                (s, tid)
                for tid in state["theatres"]
                for s in data.get(tid, [])
                if s.get("movieId") == mid and matches(s, state)
            ),
            key=lambda x: x[0]["showDateTimeLocal"],
        )
        rows = []
        for s, tid in hits[:8]:
            r = show_row(s, with_date=True, now=now)
            r["theatre"] = state["theatre_names"].get(str(tid), f"Theatre {tid}")
            rows.append(r)
        out.append(
            {
                "id": mid,
                "title": info.get("name")
                or (hits[0][0]["movieName"] if hits else f"Movie {mid}"),
                "poster": info.get("poster", ""),
                "release": info.get("release", ""),
                "rerelease": bool(info.get("fanfave")),
                "matches": len(hits),
                "shows": rows,
            }
        )
    return out


FORMAT_ORDER = ["IMAX", "DOLBY", "XL", "LASER", "STANDARD"]


def build_movie_detail(state, data, movie_id):
    """One movie's showtimes across the lookahead window, grouped by theatre (rows)."""
    info = state["movies"].get(str(movie_id), {})
    now = dt.datetime.now().isoformat()
    title = info.get("name")
    formats_present = set()
    theatres = []
    for tid in state["theatres"]:
        shows = sorted(
            (
                s
                for s in data.get(tid, [])
                if s.get("movieId") == movie_id and not s.get("isCanceled")
            ),
            key=lambda s: s["showDateTimeLocal"],
        )
        rows = []
        for s in shows:
            r = show_row(s, with_date=True, now=now)
            r["hour"] = int(s["showDateTimeLocal"][11:13])
            rows.append(r)
            formats_present.add(r["fmt"])
            title = title or s.get("movieName")
        theatres.append(
            {
                "name": state["theatre_names"].get(str(tid), f"Theatre {tid}"),
                "shows": rows,
            }
        )
    return {
        "movie_id": movie_id,
        "title": title or f"Movie {movie_id}",
        "poster": info.get("poster", ""),
        "rerelease": bool(info.get("fanfave")),
        "theatres": theatres,
        "formats": [f for f in FORMAT_ORDER if f in formats_present],
    }
