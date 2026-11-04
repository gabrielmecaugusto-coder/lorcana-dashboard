"""Daily collector: Lorcana catalog + prices from TCGCSV.

Run once per day after TCGCSV refreshes (~20:00 UTC). Writes:
  data/catalog.json            sets and products (with card attributes)
  data/prices/<date>.csv.gz    one row per product x printing
"""
from __future__ import annotations

import json
import re
import sys

from common import CATALOG_FILE, CATEGORY_ID, DATA, TCGCSV, get_json, http_get, write_snapshot

ATTR_MAP = {
    "Rarity": "rarity",
    "Number": "number",
    "InkType": "ink",
    "CardType": "cardType",
    "Cost Ink": "cost",
    "InkwellIcononCard": "inkable",
    "Classification": "classification",
    "Property": "franchise",
    "Character Version": "version",
    "Strength": "strength",
    "Willpower": "willpower",
    "Lore Value": "lore",
    "Description": "text",
}

TAG_RE = re.compile(r"<[^>]+>")


def parse_product(p: dict) -> dict:
    out = {
        "productId": p["productId"],
        "groupId": p["groupId"],
        "name": p["name"],
        "imageUrl": p.get("imageUrl"),
        "url": p.get("url"),
    }
    for e in p.get("extendedData") or []:
        key = ATTR_MAP.get(e.get("name"))
        if key:
            val = e.get("value")
            if key == "text" and val:
                val = TAG_RE.sub("", val).strip()
            out[key] = val
    # A "single" is a card with a collector number; sealed products have none.
    out["isSingle"] = bool(out.get("number"))
    return out


def main() -> int:
    last_updated = http_get(f"{TCGCSV}/last-updated.txt").strip()
    date = last_updated[:10]
    print(f"TCGCSV last updated: {last_updated} -> snapshot {date}")

    groups = get_json(f"{TCGCSV}/tcgplayer/{CATEGORY_ID}/groups")["results"]
    old = json.loads(CATALOG_FILE.read_text()) if CATALOG_FILE.exists() else {"groups": [], "products": []}
    products = {p["productId"]: p for p in old["products"]}

    rows = []
    for g in groups:
        gid = g["groupId"]
        prods = get_json(f"{TCGCSV}/tcgplayer/{CATEGORY_ID}/{gid}/products").get("results") or []
        for p in prods:
            products[p["productId"]] = parse_product(p)
        prices = get_json(f"{TCGCSV}/tcgplayer/{CATEGORY_ID}/{gid}/prices").get("results") or []
        rows.extend(prices)
        print(f"  {g['name']}: {len(prods)} products, {len(prices)} prices")

    catalog = {
        "updated": last_updated,
        "groups": [
            {
                "groupId": g["groupId"],
                "name": g["name"],
                "abbreviation": g.get("abbreviation"),
                "publishedOn": (g.get("publishedOn") or "")[:10],
            }
            for g in sorted(groups, key=lambda g: g.get("publishedOn") or "")
        ],
        "products": sorted(products.values(), key=lambda p: p["productId"]),
    }
    DATA.mkdir(exist_ok=True)
    CATALOG_FILE.write_text(json.dumps(catalog, ensure_ascii=False, indent=0))
    path = write_snapshot(date, rows)
    print(f"Wrote {len(catalog['products'])} products and {len(rows)} prices -> {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
