from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable


class CsvProvider:
    """Rows from a CSV file in the repo (default: data/listings.csv)."""

    def __init__(self, path: Path):
        self.path = path
        self.name = f"csv:{path.name}"

    def rows(self) -> Iterable[dict]:
        with self.path.open(newline="", encoding="utf-8") as f:
            yield from csv.DictReader(f)
