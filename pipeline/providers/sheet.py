from __future__ import annotations

import csv
import io
import urllib.request
from typing import Iterable


class SheetProvider:
    """Rows from a Google Sheet published as CSV (File → Share → Publish to web → CSV).

    The URL comes from the LISTINGS_SHEET_URL secret so friends can add houses without touching GitHub.
    The sheet must use the same column names as data/listings.csv.
    """

    def __init__(self, url: str, timeout: float = 30):
        if not url.startswith("https://"):
            raise ValueError("LISTINGS_SHEET_URL must be an https:// link")
        self.url = url
        self.timeout = timeout
        self.name = "google-sheet"

    def rows(self) -> Iterable[dict]:
        req = urllib.request.Request(self.url, headers={"User-Agent": "SnowfinderBot/0.1"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            text = r.read().decode("utf-8-sig")
        yield from csv.DictReader(io.StringIO(text))
