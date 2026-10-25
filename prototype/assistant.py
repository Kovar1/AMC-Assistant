"""AMC assistant — cron entrypoint (Telegram drop-alerts).

Usage:
  python assistant.py            Refresh feeds, drop stale movies, alert on NEW matching
                                 showtimes for watched movies, save state.
  python assistant.py discover [now-playing|coming-soon|advance]

Preferences and the watchlist are managed in the web UI (app.py); both share state.json.
Telegram is optional: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to receive pings,
otherwise alerts print to the console.
"""

import html
import os
import re
import sys
import urllib.parse
import urllib.request

import amc
import core


def telegram(text):
    """Send a message. Returns True if delivered, False otherwise (incl. not configured)."""
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print(
            "\n[telegram not configured — would send]\n" + re.sub("<[^>]+>", "", text)
        )
        return False
    body = urllib.parse.urlencode(
        {
            "chat_id": chat,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }
    ).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=body
    )
    try:
        urllib.request.urlopen(req, timeout=30)  # nosec B310 - fixed https Telegram API URL
        print("Telegram alert sent.")
        return True
    except Exception as e:
        print(f"Telegram failed: {e}")
        return False


def notify(state, data):
    """Alert once per new matching showtime of a watched movie (deduped via notified)."""
    alerted = []
    for mid in core.watchlist(state):
        for tid in state["theatres"]:
            hits = [
                s
                for s in data.get(tid, [])
                if s.get("movieId") == mid and core.matches(s, state)
            ]
            if not hits:
                continue
            key = f"{mid}:{tid}"
            already = set(state["notified"].get(key, []))
            new = [s for s in hits if s["id"] not in already]
            if not new:
                continue
            title = state["movies"].get(str(mid), {}).get("name") or hits[0].get(
                "movieName"
            )
            tname = state["theatre_names"].get(str(tid), f"Theatre {tid}")
            lines = [
                f"<b>{html.escape(title)}</b> just dropped at {html.escape(tname)}"
            ]
            plain = []  # human-readable showtimes for the alert log
            for s in sorted(new, key=lambda s: s["showDateTimeLocal"])[:8]:
                tag = core.fmt(s)
                suffix = "" if tag == "STANDARD" else " · " + tag
                when = core.pretty(s["showDateTimeLocal"], with_date=True)
                lines.append(
                    f"• {when}{suffix} · Aud {s.get('auditorium', '?')} — "
                    f'<a href="{s.get("purchaseUrl")}">Book</a>'
                )
                plain.append(f"{when}{suffix}")
            sent = telegram("\n".join(lines))
            core.log_alert(
                {"movie": title, "theatre": tname, "shows": plain, "sent": sent}
            )
            state["notified"][key] = sorted(already | {s["id"] for s in new})
            alerted.append(title)
    return alerted


def run(state):
    core.refresh_movies(state)
    dropped = core.gc(state)
    data = core.fetch_showtimes(state)
    alerted = notify(state, data)
    core.save_state(state)
    print(
        f"Watching {len(core.watchlist(state))} movie(s). "
        f"Dropped {len(dropped)} stale. "
        f"Alerted: {', '.join(alerted) if alerted else 'nothing new'}."
    )


def main(argv):
    amc.load_env()
    state = core.load_state()
    cmd = argv[0] if argv else "run"

    if cmd == "run":
        run(state)
    elif cmd == "discover":
        view = argv[1] if len(argv) > 1 else "coming-soon"
        for m in amc.movies(view):
            flag = "HAS showtimes" if m.get("hasScheduledShowtimes") else "waiting"
            print(
                f"{m['id']:>6}  {(m.get('releaseDateUtc') or '')[:10]}  [{flag:>13}]  {m.get('name')}"
            )
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
