import json
import shutil
from pathlib import Path

import pytest

from pipeline.build_listings import build, canonical, merge, validate
from pipeline.enrich import parse_og
from pipeline.schema import QuoteRow

ROOT = Path(__file__).resolve().parents[2]
HEADER = "resort,url,title,bedrooms,sleeps,checkin,checkout,total_eur,rating,rating_scale,to_lift_m,photo_url,added_by,notes\n"


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "data").mkdir()
    shutil.copy(ROOT / "data/resorts.json", tmp_path / "data/resorts.json")
    return tmp_path


def write_csv(repo, body):
    (repo / "data/listings.csv").write_text(HEADER + body, "utf-8")


def row(**kw):
    base = dict(resort="soldeu", url="https://www.airbnb.com/rooms/1", title="Chalet", bedrooms="4", sleeps="8",
                checkin="2027-03-03", checkout="2027-03-08", total_eur="3000", rating="", rating_scale="",
                to_lift_m="", photo_url="", added_by="t", notes="")
    base.update(kw)
    return base


def test_rating_scale_defaults_by_site():
    assert QuoteRow.model_validate(row(rating="4.8")).rating10 == 9.6
    assert QuoteRow.model_validate(row(url="https://www.booking.com/hotel/ad/x.html", rating="8.4")).rating10 == 8.4


@pytest.mark.parametrize("bad, msg", [
    (dict(checkout="2027-03-03"), "nights"),
    (dict(url="http://insecure.example/x"), "https"),
    (dict(total_eur="0"), "greater than 0"),
    (dict(rating="6", rating_scale="5"), "above its scale"),
    (dict(resort="atlantis"), "unknown resort"),
])
def test_invalid_rows_are_reported(bad, msg):
    good, errors = validate([row(**bad)], {"soldeu"}, "test")
    assert not good and len(errors) == 1 and msg in errors[0]


def test_same_url_merges_into_quotes_and_later_row_wins():
    rows = [row(), row(title="", bedrooms="", sleeps="", checkin="2027-01-24", checkout="2027-01-29", total_eur="2000"),
            row(total_eur="3100", url="https://www.airbnb.com/rooms/1/?adults=8")]  # same place, same dates, newer price
    good, _ = validate(rows, {"soldeu"}, "t")
    houses, errors = merge(good)
    assert not errors and len(houses) == 1
    h = houses[0]
    assert [q["total"] for q in h["quotes"]] == [2000, 3100]
    assert h["bedrooms"] == 4 and h["sleeps"] == 8 and h["source"] == "airbnb"


def test_repeat_row_without_house_details_first_is_an_error():
    good, _ = validate([row(title="", bedrooms="", sleeps="")], {"soldeu"}, "t")
    houses, errors = merge(good)
    assert not houses and "missing title, bedrooms, sleeps" in errors[0]


def test_canonical_url_drops_query_and_trailing_slash():
    assert canonical("https://WWW.Airbnb.com/rooms/1/?check_in=x#p") == "https://www.airbnb.com/rooms/1"


def test_parse_og():
    html = '<html><head><meta property="og:title" content="Nice chalet"><meta property="og:image" content="https://img/x.jpg"></head></html>'
    assert parse_og(html) == {"og:title": "Nice chalet", "og:image": "https://img/x.jpg"}


def test_build_enriches_once_then_reuses_and_does_not_churn(repo):
    write_csv(repo, "soldeu,https://www.airbnb.com/rooms/9,Chalet,4,8,2027-03-03,2027-03-08,3000,4.9,5,300,,t,\n")
    calls = []
    fake = lambda url: calls.append(url) or {"og:image": "https://a0.muscache.com/x.jpg"}
    doc, errors, changed = build(repo, fetch=fake)
    assert not errors and changed and calls == ["https://www.airbnb.com/rooms/9"]
    assert doc["listings"][0]["photo"] == "https://a0.muscache.com/x.jpg"
    stamp = doc["generated"]
    doc2, _, changed2 = build(repo, fetch=fake)
    assert not changed2 and len(calls) == 1 and doc2["generated"] == stamp


def test_seed_file_is_valid():
    import csv
    ids = {r["id"] for r in json.loads((ROOT / "data/resorts.json").read_text("utf-8"))["resorts"]}
    with (ROOT / "data/listings.csv").open(encoding="utf-8") as f:
        good, errs = validate(csv.DictReader(f), ids, "seed")
    houses, merge_errs = merge(good)
    assert not errs and not merge_errs and len(houses) >= 10


def test_coordinates_and_nearest_lift():
    from pipeline.build_listings import merge, nearest_lift, validate
    lifts = [{"name": "Far", "lat": 42.60, "lng": 1.70}, {"name": "Gondola", "lat": 42.5770, "lng": 1.6670}]
    near = nearest_lift(42.5780, 1.6665, lifts)
    assert near["name"] == "Gondola" and 100 < near["m"] < 130
    assert nearest_lift(43.5, 1.6, lifts) is None  # more than 5 km away: no lift
    row = {"resort": "soldeu", "url": "https://www.booking.com/hotel/ad/x.html", "title": "X", "bedrooms": "4", "sleeps": "9",
           "checkin": "2027-03-04", "checkout": "2027-03-09", "total_eur": "3000", "lat": "42.5780", "lng": "1.6665", "location": "exact"}
    good, bad = validate([row], {"soldeu"}, "test")
    assert not bad
    houses, _ = merge(good, lifts)
    assert houses[0]["lat"] == 42.578 and houses[0]["locApprox"] is False and houses[0]["lift"]["name"] == "Gondola"
    _, bad = validate([{**row, "lng": ""}], {"soldeu"}, "test")
    assert bad  # lat without lng is rejected
