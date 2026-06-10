"""Tests for the Flask routes. Network is stubbed by the autouse fixture in conftest.py."""

import app as app_module
import core


def client():
    app_module.app.config.update(TESTING=True)
    return app_module.app.test_client()


def onboard():
    state = core.load_state()
    state["onboarded"] = True
    state["theatres"] = [2253]
    core.save_state(state)


def test_redirects_to_setup_when_not_onboarded():
    r = client().get("/")
    assert r.status_code == 302
    assert "/setup" in r.headers["Location"]


def test_setup_reachable_before_onboarding():
    r = client().get("/setup")
    assert r.status_code == 200


def test_home_ok_after_onboarding():
    onboard()
    r = client().get("/")
    assert r.status_code == 200


def test_toggle_returns_json_and_flips_watch():
    onboard()
    c = client()
    assert c.post("/toggle/123").get_json() == {"watch": True}
    assert c.post("/toggle/123").get_json() == {"watch": False}
    # and it persisted
    assert 123 not in core.watchlist(core.load_state())


def test_theatre_search_empty_query_returns_empty_list():
    onboard()
    r = client().get("/api/theatres?q=")
    assert r.status_code == 200
    assert r.get_json() == []


def test_movie_detail_renders():
    onboard()
    r = client().get("/movie/999")
    assert r.status_code == 200


def test_log_page_renders_with_alerts():
    onboard()
    core.log_alert(
        {"movie": "Alpha", "theatre": "GSP", "shows": ["Fri · 7 PM"], "sent": True}
    )
    r = client().get("/log")
    assert r.status_code == 200
    assert b"Alpha" in r.data
