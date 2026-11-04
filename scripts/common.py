"""Shared helpers for the Lorcana price pipeline.

Data source: TCGCSV (https://tcgcsv.com), a public daily mirror of TCGplayer's API.
Usage guidelines from TCGCSV: fetch at most once per day, never from the browser,
and download each price archive only once.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PRICES_DIR = DATA / "prices"          # one gzipped CSV per snapshot date
CATALOG_FILE = DATA / "catalog.json"  # groups (sets) + products with attributes
SITE_DATA = ROOT / "site" / "data"

TCGCSV = "https://tcgcsv.com"
CATEGORY_ID = 71  # Lorcana TCG on TCGplayer
USER_AGENT = "lorcana-dashboard/1.0 (+https://github.com/gabrielmecaugusto-coder/lorcana-dashboard)"

PRICE_FIELDS = ["productId", "subTypeName", "marketPrice", "lowPrice", "midPrice", "highPrice", "directLowPrice"]


def http_get(url: str, *, binary: bool = False, retries: int = 4, timeout: int = 60):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
            return body if binary else body.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            last_err = e
        except Exception as e:  # network hiccup
            last_err = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed: {last_err}")


def get_json(url: str):
    return json.loads(http_get(url))


def write_snapshot(date: str, rows: list[dict]) -> Path:
    """Write price rows for one date as data/prices/<date>.csv.gz (sorted, deterministic)."""
    PRICES_DIR.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (int(r["productId"]), r["subTypeName"] or ""))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(PRICE_FIELDS)
    for r in rows:
        w.writerow(["" if r.get(f) is None else r.get(f) for f in PRICE_FIELDS])
    path = PRICES_DIR / f"{date}.csv.gz"
    # mtime=0 keeps the gzip bytes stable when content is unchanged (clean git diffs)
    with open(path, "wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:
        gz.write(buf.getvalue().encode("utf-8"))
    return path


def read_snapshot(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def snapshot_dates() -> list[str]:
    return sorted(p.name[:10] for p in PRICES_DIR.glob("*.csv.gz"))
