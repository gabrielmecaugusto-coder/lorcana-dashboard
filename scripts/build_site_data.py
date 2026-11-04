"""Turn data/catalog.json + data/prices/*.csv.gz into the JSON files the website reads.

Outputs (site/data/):
  cards.json            every single x printing with attributes, current price and changes
  sets.json             sets with release date and card counts
  events.json           main-set release dates and Core rotations (chart annotations)
  history/<groupId>.json  price series of every card in that set (loaded on demand)
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import date, timedelta

from common import CATALOG_FILE, PRICES_DIR, SITE_DATA, read_snapshot, snapshot_dates
from formats import BANNED, CORE_MIN_SET, ROTATIONS

PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")


def identity(name: str) -> str:
    """Card identity shared by all printings: 'Elsa - Ice Maker (Foil)' -> 'Elsa - Ice Maker'."""
    prev = None
    while prev != name:
        prev, name = name, PAREN_RE.sub("", name)
    return name.strip()

PRINTING = {"Normal": "N", "Holofoil": "H", "Cold Foil": "C"}
WINDOWS = {"d1": 1, "d7": 7, "d30": 30, "d90": 90, "d365": 365}
# For a window of N days, accept a past price no older than this many extra days
# (history before the daily period is weekly).
TOLERANCE = {"d1": 1, "d7": 3, "d30": 7, "d90": 7, "d365": 7}


def to_float(v):
    try:
        f = float(v)
        return round(f, 2) if f > 0 else None
    except (TypeError, ValueError):
        return None


def main() -> None:
    catalog = json.loads(CATALOG_FILE.read_text())
    groups = {g["groupId"]: g for g in catalog["groups"]}
    products = {p["productId"]: p for p in catalog["products"] if p.get("isSingle")}

    dates = snapshot_dates()
    if not dates:
        raise SystemExit("no price snapshots yet")

    # series[key] = {date: (market, low)}
    series: dict[str, dict[str, tuple]] = {}
    meta: dict[str, tuple[int, str]] = {}
    for d in dates:
        for r in read_snapshot(PRICES_DIR / f"{d}.csv.gz"):
            pid = int(r["productId"])
            if pid not in products:
                continue
            sub = r["subTypeName"] or "Normal"
            key = f"{pid}-{PRINTING.get(sub, sub[:1])}"
            meta[key] = (pid, sub)
            series.setdefault(key, {})[d] = (to_float(r["marketPrice"]), to_float(r["lowPrice"]))

    latest = dates[-1]
    latest_d = date.fromisoformat(latest)
    g_release = {gid: g.get("publishedOn") for gid, g in groups.items()}

    # Format legality by card identity (any printing in a legal main set makes all printings legal).
    def set_number(gid):
        ab = (groups.get(gid) or {}).get("abbreviation") or ""
        return int(ab) if ab.isdigit() else None

    in_main, in_core = set(), set()
    for p in products.values():
        n = set_number(p["groupId"])
        if n is None:
            continue
        ident = identity(p["name"])
        in_main.add(ident)
        if n >= CORE_MIN_SET:
            in_core.add(ident)

    def price_near(s: dict, target: date, tol: int):
        """Market price at the latest snapshot on/before target, within tol days."""
        for back in range(tol + 1):
            v = s.get((target - timedelta(days=back)).isoformat())
            if v and v[0]:
                return v[0]
        return None

    def pct(now, then):
        return round((now / then - 1) * 100, 1) if now and then else None

    cards = []
    for key, s in series.items():
        pid, sub = meta[key]
        p = products[pid]
        cur = s.get(latest)
        market, low = (cur if cur else (None, None))
        # Base price for "since launch": one week after the card's launch, so pre-release and
        # launch-week hype don't distort the change. Launch = later of set release and the card's
        # first quote. Cards that already existed when our history starts use the first snapshot.
        obs = [d for d in dates if s.get(d) and s[d][0]]
        first_date = first_price = None
        if obs:
            release = g_release.get(p["groupId"]) or obs[0]
            launch = max(release, obs[0])
            if obs[0] == dates[0] and release < dates[0]:
                first_date = obs[0]
            else:
                target = (date.fromisoformat(launch) + timedelta(days=7)).isoformat()
                first_date = next((d for d in obs if d >= target), None)
            first_price = s[first_date][0] if first_date else None
        ch = {w: pct(market, price_near(s, latest_d - timedelta(days=n), TOLERANCE[w])) for w, n in WINDOWS.items()}
        ch["all"] = pct(market, first_price)
        g = groups.get(p["groupId"], {})
        ident = identity(p["name"])
        quest = (g.get("abbreviation") or "").startswith("Q")  # Illumineer's Quest: legal in no format
        cards.append({
            "id": key,
            "pid": pid,
            "name": p["name"],
            "set": p["groupId"],
            "setCode": g.get("abbreviation"),
            "num": p.get("number"),
            "rarity": p.get("rarity"),
            "ink": p.get("ink"),
            "type": p.get("cardType"),
            "cost": p.get("cost"),
            "printing": sub,
            "ident": ident,
            "core": not quest and ident in in_core and ident not in BANNED["core"],
            "inf": not quest and ident in in_main and ident not in BANNED["infinity"],
            "price": market,
            "low": low,
            "first": [first_date, first_price] if first_date else None,
            "ch": ch,
            "img": p.get("imageUrl"),
            "url": p.get("url"),
        })
    cards.sort(key=lambda c: -(c["price"] or 0))

    out = SITE_DATA
    if (out / "history").exists():
        shutil.rmtree(out / "history")
    (out / "history").mkdir(parents=True)

    def dump(name, obj):
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))

    dump("cards.json", {"updated": catalog.get("updated"), "latest": latest, "firstSnapshot": dates[0],
                        "snapshots": len(dates), "cards": cards})

    by_set: dict[int, list[str]] = {}
    for c in cards:
        by_set.setdefault(c["set"], []).append(c["id"])

    sets_out = []
    for gid, g in groups.items():
        keys = by_set.get(gid, [])
        sets_out.append({**g, "cards": len(keys)})
        if keys:
            dump(f"history/{gid}.json", {
                "dates": dates,
                "s": {k: [(series[k].get(d) or (None,))[0] for d in dates] for k in keys},
            })
    dump("sets.json", sorted(sets_out, key=lambda g: g["publishedOn"] or ""))

    # Timeline events for the charts: main-set releases and Core rotations.
    releases = [
        {"date": g["publishedOn"], "code": g["abbreviation"], "name": g["name"]}
        for g in catalog["groups"]
        if (g.get("abbreviation") or "").isdigit() and g.get("publishedOn")
    ]
    dump("events.json", {"releases": releases, "rotations": ROTATIONS})
    print(f"Built site data: {len(cards)} cards, {len(dates)} snapshots ({dates[0]} .. {latest})")


if __name__ == "__main__":
    main()
