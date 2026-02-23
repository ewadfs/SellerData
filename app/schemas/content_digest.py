from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


# --- Content Source schemas ---


class ContentSourceCreate(BaseModel):
    name: str = Field(..., max_length=255)
    source_type: str = Field(
        ...,
        pattern="^(rss|blog|newsletter|twitter_feed|twitter_list|facebook_group)$",
        description="One of: rss, blog, newsletter, twitter_feed, twitter_list, facebook_group",
    )
    url: str | None = Field(None, max_length=2048)
    config: dict | None = Field(
        None,
        description=(
            "Extra configuration. For twitter_feed: {\"username\": \"...\"}. "
            "For twitter_list: {\"list_id\": \"...\"}. "
            "For facebook_group: {\"group_id\": \"...\"}."
        ),
    )


class ContentSourceUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    url: str | None = Field(None, max_length=2048)
    config: dict | None = None
    is_active: bool | None = None


class ContentSourceRead(BaseModel):
    id: UUID
    name: str
    source_type: str
    url: str | None = None
    config: dict | None = None
    is_active: bool
    last_fetched_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --- VIP Person schemas ---


class VIPPersonCreate(BaseModel):
    platform: str = Field(..., pattern="^(twitter|facebook)$")
    handle: str = Field(..., max_length=255)
    display_name: str | None = Field(None, max_length=255)
    notes: str | None = None


class VIPPersonUpdate(BaseModel):
    display_name: str | None = None
    notes: str | None = None


class VIPPersonRead(BaseModel):
    id: UUID
    platform: str
    handle: str
    display_name: str | None = None
    notes: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Digest schemas ---


class DigestEntryRead(BaseModel):
    id: UUID
    summary: str
    topic: str
    importance_score: float | None = None
    display_title: str | None = None
    display_url: str | None = None
    source_name: str | None = None
    source_type: str | None = None
    is_from_vip: bool = False
    vip_name: str | None = None
    author: str | None = None

    model_config = {"from_attributes": True}


class DigestRead(BaseModel):
    id: UUID
    digest_date: date
    generated_at: datetime
    item_count: int
    entries: list[DigestEntryRead] = []

    model_config = {"from_attributes": True}


class DigestSummaryRead(BaseModel):
    id: UUID
    digest_date: date
    generated_at: datetime
    item_count: int

    model_config = {"from_attributes": True}


class DigestGenerateRequest(BaseModel):
    target_date: date | None = Field(None, description="Date to generate digest for. Defaults to today.")


class ContentItemRead(BaseModel):
    id: UUID
    source_id: UUID
    external_id: str
    title: str | None = None
    url: str | None = None
    author: str | None = None
    content_text: str | None = None
    published_at: datetime | None = None
    is_from_vip: bool = False
    vip_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NewsletterContentPost(BaseModel):
    """For posting newsletter content directly via API (e.g., from email forwarding)."""

    source_name: str = Field(..., description="Name of the newsletter")
    title: str
    content: str
    author: str | None = None
    url: str | None = None
    published_at: datetime | None = None
