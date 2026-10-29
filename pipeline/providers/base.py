"""Provider interface. A provider yields raw rows (dicts with the CSV columns) for the pipeline to validate.

Today there are two curated providers: the CSV in the repo and an optional published Google Sheet.
An API provider (Booking.com Demand API, a paid data API, …) would implement `rows()` by searching each
resort for the season's weeks and the group sizes you care about, and yield one row per quote, e.g.:

    for resort in resorts:
        for week in season_weeks:
            for offer in api.search(resort.name, checkin, checkout, adults=8, bedrooms=4):
                yield {"resort": resort.id, "url": offer.url, "title": offer.name, ...}

Keep API keys in GitHub Secrets and read them from the environment; never commit them.
"""
from __future__ import annotations

from typing import Iterable, Protocol


class Provider(Protocol):
    name: str

    def rows(self) -> Iterable[dict]:
        ...
