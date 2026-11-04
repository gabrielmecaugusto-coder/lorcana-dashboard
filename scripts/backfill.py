"""One-time backfill of historical prices from the TCGCSV price archive.

The archive starts on 2024-02-08 (one 7z file per day, all games, ~2-4 MB each).
We keep only Lorcana (category 71). To respect TCGCSV's bandwidth we fetch:
  * one snapshot per week since 2024-02-08, and
  * every day for the most recent --daily-days days.
Dates that already exist in data/prices are skipped, so each archive is downloaded once.

Requires the `7z` command (p7zip / 7-Zip), available on GitHub's ubuntu runners.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
from datetime import date, timedelta
from pathlib import Path

from common import CATEGORY_ID, DATA, TCGCSV, http_get, snapshot_dates, write_snapshot

MISSING_FILE = DATA / "archive_missing.txt"  # archive dates that returned 404 (not retried)

ARCHIVE_START = date(2024, 2, 8)


def wanted_dates(today: date, daily_days: int, weekly: bool = True) -> list[date]:
    daily_from = today - timedelta(days=daily_days)
    out, d = [], ARCHIVE_START
    while weekly and d < daily_from:
        out.append(d)
        d += timedelta(days=7)
    d = daily_from
    while d < today:
        out.append(d)
        d += timedelta(days=1)
    return out


def extract_lorcana(archive: Path, day: str, workdir: Path) -> list[dict]:
    subprocess.run(
        ["7z", "x", "-y", "-bd", "-bso0", "-bsp0", f"-o{workdir}", str(archive), f"{day}/{CATEGORY_ID}/*", "-r"],
        check=True,
    )
    base = workdir / day / str(CATEGORY_ID)
    if not base.exists():  # fall back to extracting everything
        subprocess.run(["7z", "x", "-y", "-bd", "-bso0", "-bsp0", f"-o{workdir}", str(archive)], check=True)
    rows = []
    for f in base.glob("*/prices"):
        try:
            rows.extend(json.loads(f.read_text()).get("results") or [])
        except json.JSONDecodeError:
            pass
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--daily-days", type=int, default=90)
    ap.add_argument("--max", type=int, default=0, help="stop after N downloads (0 = no limit)")
    ap.add_argument("--no-weekly", action="store_true", help="only fill recent daily gaps")
    ap.add_argument("--pause", type=float, default=4.0, help="seconds between archive downloads")
    args = ap.parse_args()

    if not shutil.which("7z"):
        print("7z not found", file=sys.stderr)
        return 1

    have = set(snapshot_dates())
    missing = set(MISSING_FILE.read_text().split()) if MISSING_FILE.exists() else set()
    todo = [d for d in wanted_dates(date.today(), args.daily_days, weekly=not args.no_weekly)
            if d.isoformat() not in have and d.isoformat() not in missing]
    print(f"{len(todo)} archive dates to fetch ({len(have)} snapshots already present)")

    done = 0
    for d in todo:
        day = d.isoformat()
        url = f"{TCGCSV}/archive/tcgplayer/prices-{day}.ppmd.7z"
        if done:
            time.sleep(args.pause)  # be gentle with TCGCSV's bandwidth
        try:
            blob = http_get(url, binary=True, timeout=180)
        except urllib.error.HTTPError as e:
            print(f"  {day}: HTTP {e.code}, skipped")
            if e.code == 404 and d < date.today() - timedelta(days=3):
                missing.add(day)
                MISSING_FILE.write_text("\n".join(sorted(missing)) + "\n")
            continue
        except RuntimeError as e:
            # Persistent failure (e.g. still rate limited): stop cleanly so what we have gets
            # committed; the next run continues from here.
            print(f"  {day}: {e}; stopping, will resume next run")
            break
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            arc = tmp / "a.7z"
            arc.write_bytes(blob)
            rows = extract_lorcana(arc, day, tmp / "x")
        if rows:
            write_snapshot(day, rows)
            print(f"  {day}: {len(rows)} prices ({len(blob)//1024} KB archive)")
        else:
            print(f"  {day}: no Lorcana prices in archive")
        done += 1
        if args.max and done >= args.max:
            break
    print(f"Backfill fetched {done} archives")
    return 0


if __name__ == "__main__":
    sys.exit(main())
