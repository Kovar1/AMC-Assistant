"""AMC assistant web UI (single user). Run on demand: python app.py -> http://localhost:5000

Shares state.json with assistant.py (the cron alerter). First visit runs onboarding.
"""

import datetime as dt
import os

from flask import Flask, jsonify, redirect, render_template, request, url_for

import amc
import core

amc.load_env()
app = Flask(__name__)
app.jinja_env.filters["thumb"] = core.poster_url

FORMATS = ["IMAX", "DOLBY", "XL", "LASER", "STANDARD"]
HOURS = list(range(0, 24))


@app.before_request
def require_onboarding():
    if request.endpoint in ("setup", "settings", "theatre_search", "static", "phone"):
        return
    if not core.load_state().get("onboarded"):
        return redirect(url_for("setup"))


@app.route("/")
def home():
    state = core.load_state()
    core.refresh_movies(state)
    today = dt.date.today()
    selected = request.args.get("date") or today.isoformat()
    board = core.build_board(
        state, core.fetch_showtimes(state, dates=[selected]), selected
    )
    core.save_state(state)

    dates = []
    for n in range(state["lookahead_days"]):
        d = today + dt.timedelta(n)
        dates.append(
            {
                "iso": d.isoformat(),
                "dow": "Today" if n == 0 else ("Tom" if n == 1 else f"{d:%a}"),
                "day": f"{d:%b} {d.day}",
            }
        )
    sel = dt.date.fromisoformat(selected)
    heading = (
        "Tonight" if selected == today.isoformat() else f"{sel:%A}, {sel:%b} {sel.day}"
    )
    return render_template(
        "home.html",
        nav="home",
        board=board,
        state=state,
        dates=dates,
        selected=selected,
        heading=heading,
    )


@app.route("/phone")
def phone():
    return render_template("phone.html")


@app.route("/log")
def log():
    return render_template("log.html", nav="log", alerts=core.read_alerts())


@app.route("/movie/<int:movie_id>")
def movie_detail(movie_id):
    state = core.load_state()
    core.refresh_movies(state)
    data = core.fetch_showtimes(state)
    core.save_state(state)
    detail = core.build_movie_detail(state, data, movie_id)
    return render_template("movie.html", nav=None, **detail)


@app.route("/movies")
def movies():
    state = core.load_state()
    core.refresh_movies(state)
    data = core.fetch_showtimes(state)
    core.save_state(state)
    local_ids = {s.get("movieId") for shows in data.values() for s in shows}
    now, soon = core.movie_grid(state, local_ids)
    return render_template("movies.html", nav="movies", now=now, soon=soon)


@app.route("/toggle/<int:movie_id>", methods=["POST"])
def toggle(movie_id):
    state = core.load_state()
    new = not state["movies"].get(str(movie_id), {}).get("watch", False)
    core.set_watch(state, movie_id, new)
    core.save_state(state)
    return jsonify(watch=new)


@app.route("/watchlist")
def watchlist():
    state = core.load_state()
    watch = core.build_watch(state, core.fetch_showtimes(state))
    core.save_state(state)
    return render_template("watchlist.html", nav="watchlist", watch=watch)


@app.route("/api/theatres")
def theatre_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    try:
        results = amc.search_theatres(q)
    except Exception:
        results = []
    return jsonify(
        [
            {
                "id": t.get("id"),
                "name": t.get("name"),
                "city": (t.get("location") or {}).get("city", ""),
            }
            for t in results[:12]
        ]
    )


def _apply_prefs(state, form):
    chosen = [int(x) for x in form.getlist("theatres")]
    if chosen:
        state["theatres"] = chosen
    state["formats"] = [f for f in form.getlist("formats") if f in FORMATS]
    state["earliest_hour"] = int(form.get("earliest_hour", 18))
    state["weekends_only"] = form.get("weekends_only") == "on"
    state["party_size"] = max(1, int(form.get("party_size", 2)))
    state["lookahead_days"] = max(1, int(form.get("lookahead_days", 7)))
    for tid in state["theatres"]:
        if str(tid) not in state["theatre_names"]:
            try:
                state["theatre_names"][str(tid)] = amc.theatre(tid).get(
                    "name", f"Theatre {tid}"
                )
            except Exception:
                state["theatre_names"][str(tid)] = f"Theatre {tid}"


@app.route("/setup", methods=["GET", "POST"])
def setup():
    return _settings_view(is_setup=True)


@app.route("/settings", methods=["GET", "POST"])
def settings():
    return _settings_view(is_setup=False)


def _settings_view(is_setup):
    state = core.load_state()
    if request.method == "POST":
        _apply_prefs(state, request.form)
        state["onboarded"] = True
        core.save_state(state)
        return redirect(url_for("home"))
    current = [
        {"id": tid, "name": state["theatre_names"].get(str(tid), f"Theatre {tid}")}
        for tid in state["theatres"]
    ]
    return render_template(
        "settings.html",
        nav="settings",
        state=state,
        formats=FORMATS,
        hours=HOURS,
        current=current,
        is_setup=is_setup,
    )


if __name__ == "__main__":
    # Debug is OFF by default — the Werkzeug debugger allows code execution, which is unsafe
    # if the server is ever reachable beyond localhost. Opt in with FLASK_DEBUG=1 for local dev.
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", port=5000)
