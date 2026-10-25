"""Tests for the pure logic in core.py — parsing, filtering, ranking, lifecycle."""

import datetime as dt

import core


def show(movie_id=1, name="Movie", local="2030-01-01T19:00:00", attrs=None, **extra):
    """Build a minimal AMC-shaped showtime dict. 2030-01-01 is a Tuesday."""
    s = {
        "id": extra.pop("id", 999),
        "movieId": movie_id,
        "movieName": name,
        "showDateTimeLocal": local,
        "attributes": attrs or [],
        "auditorium": 1,
        "purchaseUrl": "https://amc/book",
    }
    s.update(extra)
    return s


# --- fmt -------------------------------------------------------------------


def test_fmt_detects_each_format():
    assert core.fmt(show(attrs=[{"code": "IMAX"}])) == "IMAX"
    # IMAX wins over LASER when both present (IMAX-with-laser auditoriums)
    assert core.fmt(show(attrs=[{"code": "IMAXWITHLASERATAMC"}])) == "IMAX"
    assert core.fmt(show(attrs=[{"code": "DOLBYCINEMAATAMCPRIME"}])) == "DOLBY"
    assert core.fmt(show(attrs=[{"code": "XL"}])) == "XL"
    assert core.fmt(show(attrs=[{"code": "LASERATAMC"}])) == "LASER"
    assert core.fmt(show(attrs=[])) == "STANDARD"
    assert core.fmt(show(attrs=[{"code": "CLOSEDCAPTION"}])) == "STANDARD"


# --- matches ----------------------------------------------------------------


def test_matches_format_time_and_cancel():
    st = (
        core.load_state()
    )  # defaults: earliest_hour 18, formats [], weekends_only False
    imax_evening = show(attrs=[{"code": "IMAX"}], local="2030-01-01T19:00:00")
    assert core.matches(imax_evening, st) is True

    # before earliest_hour
    assert (
        core.matches(show(attrs=[{"code": "IMAX"}], local="2030-01-01T17:00:00"), st)
        is False
    )

    # canceled
    assert core.matches({**imax_evening, "isCanceled": True}, st) is False

    # format filter
    st["formats"] = ["IMAX"]
    assert core.matches(imax_evening, st) is True
    assert (
        core.matches(
            show(attrs=[{"code": "LASERATAMC"}], local="2030-01-01T19:00:00"), st
        )
        is False
    )


def test_matches_weekends_only_and_malformed():
    st = core.load_state()
    st["weekends_only"] = True
    weekday = show(attrs=[{"code": "IMAX"}], local="2030-01-01T19:00:00")  # Tuesday
    saturday = show(attrs=[{"code": "IMAX"}], local="2030-01-05T19:00:00")  # Saturday
    assert core.matches(weekday, st) is False
    assert core.matches(saturday, st) is True

    # malformed / missing time string is rejected, not crashed
    assert (
        core.matches({"showDateTimeLocal": "bad", "attributes": []}, core.load_state())
        is False
    )
    assert core.matches({"attributes": []}, core.load_state()) is False


# --- poster_url -------------------------------------------------------------


def test_poster_url_resizes_cloudinary_only():
    u = "https://amc-theatres-res.cloudinary.com/v1/amc-cdn/x.jpg"
    out = core.poster_url(u, 300)
    assert (
        out
        == "https://amc-theatres-res.cloudinary.com/w_300,f_auto,q_auto/v1/amc-cdn/x.jpg"
    )
    # non-cloudinary urls pass through untouched
    assert (
        core.poster_url("https://example.com/x.jpg", 300) == "https://example.com/x.jpg"
    )
    # empty / None are safe
    assert core.poster_url("", 300) == ""
    assert core.poster_url(None, 300) == ""


# --- relevance ranking ------------------------------------------------------


def test_relevance_orders_local_then_score_with_boosts():
    movies = [
        {"id": 1, "score": 0.10},  # non-local
        {"id": 2, "score": 0.0, "fanfave": True},  # non-local, +0.15 boost
        {"id": 3, "score": 0.05, "intl": True},  # non-local, -0.15 penalty
        {"id": 4, "score": 0.01},  # LOCAL
    ]
    local_ids = {4}
    order = [
        m["id"]
        for m in sorted(
            movies, key=lambda m: core.relevance(m, local_ids), reverse=True
        )
    ]
    # local first; then fan-fave (0.15) > 0.10 > intl (-0.10)
    assert order == [4, 2, 1, 3]


# --- show_row.passed --------------------------------------------------------


def test_show_row_passed_flag():
    past = show(local="2020-01-01T10:00:00")
    future = show(local="2099-01-01T10:00:00")
    assert core.show_row(past, now="2020-01-01T12:00:00")["passed"] is True
    assert core.show_row(future, now="2020-01-01T12:00:00")["passed"] is False
    assert (
        core.show_row(past, now=None)["passed"] is False
    )  # no reference time -> not passed


# --- gc ---------------------------------------------------------------------


def test_gc_drops_stale_and_cleans_notified():
    state = core.load_state()
    today = dt.date.today()
    state["movies"] = {
        "10": {"last_seen": today.isoformat(), "watch": False},
        "20": {"last_seen": (today - dt.timedelta(days=10)).isoformat(), "watch": True},
    }
    state["notified"] = {"20:2253": [1, 2], "10:2253": [3]}
    dropped = core.gc(state)
    assert dropped == ["20"]
    assert "20" not in state["movies"] and "10" in state["movies"]
    assert "20:2253" not in state["notified"] and "10:2253" in state["notified"]


# --- set_watch / watchlist --------------------------------------------------


def test_set_watch_and_watchlist():
    state = core.load_state()
    assert core.watchlist(state) == []
    core.set_watch(state, 42, True)
    assert core.watchlist(state) == [42]
    core.set_watch(state, 42, False)
    assert core.watchlist(state) == []


# --- refresh_movies (network stubbed) --------------------------------------


def test_refresh_movies_caches_flags_and_preserves_watch(monkeypatch):
    feed = [
        {
            "id": 10,
            "name": "Alpha",
            "releaseDateUtc": "2030-01-01T00:00:00Z",
            "score": 0.3,
            "hasScheduledShowtimes": True,
            "attributes": [{"code": "FANFAVES"}],
            "media": {"posterDynamic": "https://p"},
        }
    ]
    monkeypatch.setattr(core.amc, "movies", lambda view: feed)
    state = core.load_state()
    state["movies"]["10"] = {"watch": True}  # pre-existing watch must survive a refresh
    core.refresh_movies(state)
    m = state["movies"]["10"]
    assert m["name"] == "Alpha"
    assert m["score"] == 0.3
    assert m["fanfave"] is True and m["intl"] is False
    assert m["playing"] is True
    assert m["watch"] is True
    assert m["last_seen"] == dt.date.today().isoformat()


# --- build_board ------------------------------------------------------------


def test_build_board_groups_filters_and_ranks():
    state = core.load_state()
    state["theatres"] = [2253]
    state["theatre_names"] = {"2253": "GSP"}
    state["movies"] = {"10": {"score": 0.1}, "20": {"score": 0.0, "fanfave": True}}
    day = "2030-01-01"
    data = {
        2253: [
            show(10, "Alpha", f"{day}T19:00:00"),
            show(10, "Alpha", f"{day}T21:00:00"),
            show(20, "Beta", f"{day}T20:00:00"),
            show(10, "Alpha", f"{day}T16:00:00"),  # before earliest_hour 18 -> excluded
        ]
    }
    board = core.build_board(state, data, day)
    assert len(board) == 1
    titles = [m["title"] for m in board[0]["movies"]]
    assert titles == ["Beta", "Alpha"]  # Beta fan-fave (0.15) outranks Alpha (0.10)
    alpha = next(m for m in board[0]["movies"] if m["title"] == "Alpha")
    assert len(alpha["shows"]) == 2  # 16:00 excluded
    beta = next(m for m in board[0]["movies"] if m["title"] == "Beta")
    assert beta["rerelease"] is True


# --- build_watch ------------------------------------------------------------


def test_build_watch_only_watched_with_matches():
    state = core.load_state()
    state["theatres"] = [2253]
    state["theatre_names"] = {"2253": "GSP"}
    state["movies"] = {
        "10": {"name": "Alpha", "watch": True, "score": 0.1},
        "20": {"name": "Beta", "watch": False, "score": 0.2},
    }
    data = {
        2253: [
            show(10, "Alpha", "2030-01-04T19:00:00"),  # Friday evening -> matches
            show(20, "Beta", "2030-01-04T19:00:00"),
        ]
    }
    watch = core.build_watch(state, data)
    assert [w["title"] for w in watch] == ["Alpha"]  # Beta isn't watched
    assert watch[0]["matches"] == 1


# --- build_movie_detail -----------------------------------------------------


def test_build_movie_detail_groups_and_lists_present_formats():
    state = core.load_state()
    state["theatres"] = [2253]
    state["theatre_names"] = {"2253": "GSP"}
    state["movies"] = {}  # not cached -> title falls back to the showtime's movieName
    data = {
        2253: [
            show(10, "Alpha", "2030-01-01T19:00:00", attrs=[{"code": "IMAX"}]),
            show(
                10,
                "Alpha",
                "2030-01-01T21:00:00",
                attrs=[{"code": "DOLBYCINEMAATAMCPRIME"}],
            ),
        ]
    }
    d = core.build_movie_detail(state, data, 10)
    assert d["title"] == "Alpha"
    assert len(d["theatres"]) == 1
    assert d["theatres"][0]["shows"][0]["hour"] == 19
    assert d["formats"] == [
        "IMAX",
        "DOLBY",
    ]  # only formats that exist, in canonical order


# --- alert log --------------------------------------------------------------


def test_alert_log_roundtrip_newest_first():
    assert core.read_alerts() == []  # nothing logged yet
    core.log_alert({"movie": "Alpha", "theatre": "GSP", "shows": ["x"], "sent": True})
    core.log_alert({"movie": "Beta", "theatre": "GSP", "shows": ["y"], "sent": False})
    alerts = core.read_alerts()
    assert [a["movie"] for a in alerts] == ["Beta", "Alpha"]  # newest first
    assert alerts[0]["sent"] is False
    assert "ts" in alerts[0]  # timestamp added automatically


# --- state persistence ------------------------------------------------------


def test_state_roundtrip_and_defaults():
    state = core.load_state()
    assert state["onboarded"] is False  # default when no file exists
    state["onboarded"] = True
    state["theatres"] = [1, 2]
    core.save_state(state)
    loaded = core.load_state()
    assert loaded["onboarded"] is True
    assert loaded["theatres"] == [1, 2]
