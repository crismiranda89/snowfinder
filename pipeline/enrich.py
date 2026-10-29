"""Fill in a missing photo or title from the listing page's preview tags (og:image / og:title).

Works for pages that serve their tags without JavaScript (Airbnb does today). Booking.com shows a bot
check instead, so for Booking listings paste the photo link into the sheet's photo_url column.
Photos are never downloaded or stored: the site shows them from the listing, credited and linked back.
"""
from __future__ import annotations

import urllib.request
from html.parser import HTMLParser
from typing import Optional

UA = "Mozilla/5.0 (compatible; SnowfinderBot/0.1; +https://github.com/snowfinder)"


class _OG(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        a = dict(attrs)
        key = a.get("property") or a.get("name")
        if key in ("og:image", "og:title") and a.get("content") and key not in self.found:
            self.found[key] = a["content"]


def parse_og(html: str) -> dict[str, str]:
    p = _OG()
    p.feed(html)
    return p.found


def fetch_og(url: str, timeout: float = 15) -> dict[str, str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.8"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return {}
            html = r.read(600_000).decode("utf-8", "replace")
        return parse_og(html)
    except Exception:
        return {}


def https_or_none(v: Optional[str]) -> Optional[str]:
    return v if v and v.startswith("https://") else None
