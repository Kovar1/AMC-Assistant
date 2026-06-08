"""Read-only AMC API client. Theatres, showtimes, and movie views (TTL-cached)."""

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import cache

BASE = "https://api.amctheatres.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def load_env(path=".env"):
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def get(url, **params):
    if not url.startswith("http"):
        url = BASE + url
    params = {k: v for k, v in params.items() if v not in (None, "")}
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": UA,
            "X-AMC-Vendor-Key": os.environ["AMC_VENDOR_KEY"],
        },
    )
    # url is always our fixed https AMC API base; no user-controlled scheme
    with urllib.request.urlopen(req, timeout=30) as r:  # nosec B310
        return json.loads(r.read().decode("utf-8", "replace"))


def _collect(url, key, limit=None, **params):
    """Follow _links.next, gathering _embedded[key] items. Stop early once limit is reached."""
    items = []
    while url:
        page = get(url, **params)
        items += (page.get("_embedded") or {}).get(key, [])
        if limit and len(items) >= limit:
            return items[:limit]
        url = ((page.get("_links") or {}).get("next") or {}).get("href")
        params = {}
    return items


def theatre(theatre_id):
    return cache.get_or_fetch(
        f"theatre:{theatre_id}", 86400, lambda: get(f"/v2/theatres/{theatre_id}")
    )


def showtimes(theatre_id, date):
    return cache.get_or_fetch(
        f"showtimes:{theatre_id}:{date}",
        600,
        lambda: _collect(
            f"/v2/theatres/{theatre_id}/showtimes/{date}",
            "showtimes",
            **{"page-size": 100},
        ),
    )


def movies(view):
    """view: now-playing | coming-soon | advance (capped to the soonest 60)."""
    return cache.get_or_fetch(
        f"movies:{view}",
        1800,
        lambda: _collect(
            f"/v2/movies/views/{view}", "movies", limit=60, **{"page-size": 60}
        ),
    )


def search_theatres(name):
    return _collect(
        "/v2/theatres", "theatres", limit=30, name=name, **{"page-size": 30}
    )
