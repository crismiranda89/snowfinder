"""Build data/generated/listings.json from the curated sources.

    python -m pipeline.build_listings              # CSV (+ Google Sheet if LISTINGS_SHEET_URL is set), with photo lookup
    python -m pipeline.build_listings --no-enrich  # skip fetching listing pages
    python -m pipeline.build_listings --strict     # fail (exit 1) on any invalid row — used in CI for pull requests

Rows with the same URL become one house with several price quotes. Invalid rows are reported and skipped.
The output is rewritten only when the listings actually change, so the weekly job doesn't make empty commits.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlsplit, urlunsplit

from pydantic import ValidationError

from .enrich import fetch_og, https_or_none
from .providers.csv_file import CsvProvider
from .providers.sheet import SheetProvider
from .schema import QuoteRow

ROOT = Path(__file__).resolve().parents[1]
STATIC = ("title", "bedrooms", "sleeps", "rating10", "to_lift_m", "photo_url", "added_by", "notes")


def canonical(url: str) -> str:
    p = urlsplit(url.strip())
    return urlunsplit(("https", p.netloc.lower(), p.path.rstrip("/") or "/", "", ""))


def source_of(url: str) -> str:
    host = urlsplit(url).netloc.lower()
    for key, name in (("airbnb.", "airbnb"), ("booking.", "booking"), ("vrbo.", "vrbo")):
        if key in host:
            return name
    return host.removeprefix("www.")


def validate(rows: Iterable[dict], resort_ids: set[str], origin: str) -> tuple[list[QuoteRow], list[str]]:
    good, errors = [], []
    for i, raw in enumerate(rows, start=2):  # row 1 is the header
        if not any((v or "").strip() for v in raw.values() if isinstance(v, str)):
            continue
        try:
            q = QuoteRow.model_validate(raw)
        except ValidationError as e:
            msgs = "; ".join(f"{'.'.join(map(str, err['loc'])) or 'row'}: {err['msg']}" for err in e.errors())
            errors.append(f"{origin} row {i}: {msgs}")
            continue
        if q.resort not in resort_ids:
            errors.append(f"{origin} row {i}: unknown resort '{q.resort}' (use one of: {', '.join(sorted(resort_ids))})")
            continue
        good.append(q)
    return good, errors


def merge(quotes: list[QuoteRow]) -> tuple[list[dict], list[str]]:
    """Group quote rows by listing URL. The first non-empty value of each house field wins."""
    houses: dict[str, dict] = {}
    for q in quotes:
        key = canonical(q.url)
        h = houses.setdefault(key, {"url": q.url, "resort": q.resort, "quotes": {}, **{f: None for f in STATIC}})
        for f in STATIC:
            v = getattr(q, f)
            if h[f] is None and v is not None:
                h[f] = v
        h["quotes"][(q.checkin.isoformat(), q.checkout.isoformat())] = q  # a later row for the same dates wins
    out, errors = [], []
    for key, h in houses.items():
        missing = [f for f in ("title", "bedrooms", "sleeps") if h[f] is None]
        if missing:
            errors.append(f"{h['url']}: missing {', '.join(missing)} (fill them on the first row for this listing)")
            continue
        qs = sorted(h["quotes"].values(), key=lambda q: q.checkin)
        out.append({
            "id": hashlib.sha1(key.encode()).hexdigest()[:10],
            "resort": h["resort"],
            "url": h["url"],
            "title": h["title"],
            "source": source_of(h["url"]),
            "bedrooms": h["bedrooms"],
            "sleeps": h["sleeps"],
            "quotes": [{"checkin": q.checkin.isoformat(), "checkout": q.checkout.isoformat(), "nights": q.nights, "total": round(q.total_eur)} for q in qs],
            "rating": h["rating10"],
            "toLiftM": h["to_lift_m"],
            "photo": h["photo_url"],
            "addedBy": h["added_by"] or "",
            **({"notes": h["notes"]} if h["notes"] else {}),
        })
    out.sort(key=lambda x: (x["resort"], x["title"].lower()))
    return out, errors


def enrich(listings: list[dict], previous: dict[str, dict], fetch: Callable[[str], dict] = fetch_og) -> int:
    """Fill missing photo/title: reuse what the last build found, else read the page's og tags."""
    fetched = 0
    for x in listings:
        if x["photo"]:
            continue
        old = previous.get(x["id"])
        if old and old.get("photo"):
            x["photo"] = old["photo"]
            continue
        og = fetch(x["url"])
        fetched += 1
        x["photo"] = https_or_none(og.get("og:image"))
    return fetched


def build(root: Path = ROOT, sheet_url: str | None = None, do_enrich: bool = True,
          fetch: Callable[[str], dict] = fetch_og) -> tuple[dict, list[str], bool]:
    resort_ids = {r["id"] for r in json.loads((root / "data/resorts.json").read_text("utf-8"))["resorts"]}
    providers = [CsvProvider(root / "data/listings.csv")]
    if sheet_url:
        providers.append(SheetProvider(sheet_url))
    quotes, errors = [], []
    for p in providers:
        good, bad = validate(p.rows(), resort_ids, p.name)
        quotes += good
        errors += bad
    listings, merge_errors = merge(quotes)
    errors += merge_errors

    out_path = root / "data/generated/listings.json"
    previous = json.loads(out_path.read_text("utf-8")) if out_path.exists() else {"listings": []}
    if do_enrich:
        enrich(listings, {x["id"]: x for x in previous.get("listings", [])}, fetch)

    changed = listings != previous.get("listings")
    doc = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds") if changed else previous.get("generated"),
        "count": len(listings),
        "listings": listings,
    }
    if changed:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return doc, errors, changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-enrich", action="store_true", help="don't fetch listing pages for photos")
    ap.add_argument("--strict", action="store_true", help="exit 1 if any row is invalid")
    args = ap.parse_args(argv)
    doc, errors, changed = build(sheet_url=os.environ.get("LISTINGS_SHEET_URL") or None, do_enrich=not args.no_enrich)
    for e in errors:
        print("skipped:", e, file=sys.stderr)
    with_photo = sum(1 for x in doc["listings"] if x["photo"])
    print(f"{doc['count']} houses ({with_photo} with photos), {sum(len(x['quotes']) for x in doc['listings'])} quotes, "
          f"{len(errors)} problems, {'updated' if changed else 'unchanged'}")
    return 1 if (args.strict and errors) else 0


if __name__ == "__main__":
    sys.exit(main())
