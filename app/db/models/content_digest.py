import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ContentSource(TimestampMixin, Base):
    """A content source the user subscribes to (RSS feed, blog, Twitter feed, etc.)."""

    __tablename__ = "content_sources"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ContentItem"]] = relationship(back_populates="source")


class VIPPerson(TimestampMixin, Base):
    """A person on Twitter or Facebook whose content is always included."""

    __tablename__ = "vip_people"
    __table_args__ = (UniqueConstraint("platform", "handle", name="uq_vip_platform_handle"),)

    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    handle: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class ContentItem(TimestampMixin, Base):
    """A single piece of content fetched from a source."""

    __tablename__ = "content_items"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_content_source_external"),
        Index("ix_content_items_content_hash", "content_hash"),
        Index("ix_content_items_published_at", "published_at"),
    )

    source_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("content_sources.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(512), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_from_vip: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    vip_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    source: Mapped["ContentSource"] = relationship(back_populates="items")
    digest_entries: Mapped[list["DigestEntry"]] = relationship(back_populates="content_item")


class SeenContent(Base):
    """Tracks content hashes the user has already seen to prevent duplicates."""

    __tablename__ = "seen_content"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Digest(TimestampMixin, Base):
    """A generated daily digest."""

    __tablename__ = "digests"

    digest_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    html_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)

    entries: Mapped[list["DigestEntry"]] = relationship(back_populates="digest", lazy="selectin")


class DigestEntry(Base):
    """A single entry in a digest, with AI-generated summary and topic."""

    __tablename__ = "digest_entries"
    __table_args__ = (Index("ix_digest_entries_digest_topic", "digest_id", "topic"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    digest_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("digests.id"), nullable=False)
    content_item_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("content_items.id"), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    importance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    display_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    display_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_from_vip: Mapped[bool] = mapped_column(Boolean, default=False)
    vip_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)

    digest: Mapped["Digest"] = relationship(back_populates="entries")
    content_item: Mapped["ContentItem"] = relationship(back_populates="digest_entries")
