"""Validation for one row of the curated listings sheet / CSV.

One row = one price quote. Several rows with the same URL are merged into one house with several quotes,
so you can record the same place for different weeks (only the first row needs the house details).
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

COLUMNS = ["resort", "url", "title", "bedrooms", "sleeps", "checkin", "checkout", "total_eur",
           "rating", "rating_scale", "to_lift_m", "photo_url", "added_by", "notes"]


def _blank_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


class QuoteRow(BaseModel):
    """A validated CSV row. House fields are optional so repeat rows can carry only new dates and a price."""

    resort: str
    url: str
    title: Optional[str] = None
    bedrooms: Optional[int] = Field(default=None, ge=1, le=30)
    sleeps: Optional[int] = Field(default=None, ge=1, le=60)
    checkin: date
    checkout: date
    total_eur: float = Field(gt=0, lt=200_000)
    rating: Optional[float] = Field(default=None, ge=0)
    rating_scale: Optional[float] = None
    to_lift_m: Optional[int] = Field(default=None, ge=0, le=50_000)
    photo_url: Optional[str] = None
    added_by: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=200)

    @field_validator("*", mode="before")
    @classmethod
    def blanks(cls, v):
        return _blank_to_none(v)

    @field_validator("resort", "url", "title", "added_by", "notes", "photo_url", mode="after")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("url", "photo_url")
    @classmethod
    def https(cls, v):
        if v is None:
            return v
        parts = urlsplit(v)
        if parts.scheme != "https" or not parts.netloc:
            raise ValueError("must be a full https:// link")
        return v

    @field_validator("rating_scale")
    @classmethod
    def scale(cls, v):
        if v is not None and v not in (5, 10):
            raise ValueError("rating_scale must be 5 (Airbnb) or 10 (Booking)")
        return v

    @model_validator(mode="after")
    def check(self):
        nights = (self.checkout - self.checkin).days
        if nights < 1 or nights > 30:
            raise ValueError("checkout must be 1–30 nights after checkin")
        if self.rating is not None and self.rating > self.scale_value:
            raise ValueError(f"rating {self.rating} is above its scale {self.scale_value:g}")
        return self

    @property
    def nights(self) -> int:
        return (self.checkout - self.checkin).days

    @property
    def scale_value(self) -> float:
        if self.rating_scale:
            return self.rating_scale
        return 5 if "airbnb." in urlsplit(self.url).netloc else 10

    @property
    def rating10(self) -> Optional[float]:
        return None if self.rating is None else round(self.rating * 10 / self.scale_value, 1)
