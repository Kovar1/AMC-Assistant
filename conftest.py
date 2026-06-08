"""Shared test fixtures.

Lives at the repo root so `core`, `amc`, `app` are importable, and so every test runs with
the real state.json swapped for a temp file and all AMC network calls stubbed out.
"""

import pytest

import amc
import core


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    # never read or clobber the real state.json
    monkeypatch.setattr(core, "STATE", tmp_path / "state.json")
    # never hit the AMC network; tests that need data override these per-test
    monkeypatch.setattr(amc, "movies", lambda view: [])
    monkeypatch.setattr(amc, "showtimes", lambda tid, day: [])
    monkeypatch.setattr(amc, "theatre", lambda tid: {"name": f"Theatre {tid}"})
    monkeypatch.setattr(amc, "search_theatres", lambda q: [])
    yield
