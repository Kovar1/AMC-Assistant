"""Tiny TTL disk cache so the UI never re-hits AMC for data it just fetched."""

import hashlib
import json
import time
from pathlib import Path

DIR = Path(".cache")


def get_or_fetch(key, ttl, fetch):
    DIR.mkdir(exist_ok=True)
    f = DIR / (hashlib.md5(key.encode(), usedforsecurity=False).hexdigest() + ".json")
    if f.exists():
        try:
            blob = json.loads(f.read_text(encoding="utf-8"))
            if time.time() - blob["ts"] < ttl:
                return blob["data"]
        except Exception:  # nosec B110 - corrupt/expired cache entry: fall through and re-fetch
            pass
    data = fetch()
    f.write_text(json.dumps({"ts": time.time(), "data": data}), encoding="utf-8")
    return data
