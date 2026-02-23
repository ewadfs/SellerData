"""CRUD operations for content sources, VIP people, and digests."""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.content_digest import (
    ContentItem,
    ContentSource,
    Digest,
    SeenContent,
    VIPPerson,
)
from app.schemas.content_digest import (
    ContentSourceCreate,
    ContentSourceUpdate,
    NewsletterContentPost,
    VIPPersonCreate,
    VIPPersonUpdate,
)


# --- Content Sources ---


async def list_sources(db: AsyncSession, active_only: bool = True) -> list[ContentSource]:
    stmt = select(ContentSource).order_by(ContentSource.name)
    if active_only:
        stmt = stmt.where(ContentSource.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_source(db: AsyncSession, source_id: uuid.UUID) -> ContentSource | None:
    return await db.get(ContentSource, source_id)


async def create_source(db: AsyncSession, data: ContentSourceCreate) -> ContentSource:
    source = ContentSource(**data.model_dump())
    db.add(source)
    await db.flush()
    return source


async def update_source(
    db: AsyncSession, source_id: uuid.UUID, data: ContentSourceUpdate
) -> ContentSource | None:
    source = await db.get(ContentSource, source_id)
    if source is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    await db.flush()
    await db.refresh(source)
    return source


async def delete_source(db: AsyncSession, source_id: uuid.UUID) -> bool:
    source = await db.get(ContentSource, source_id)
    if source is None:
        return False
    await db.delete(source)
    await db.flush()
    return True


# --- VIP People ---


async def list_vip_people(db: AsyncSession, platform: str | None = None) -> list[VIPPerson]:
    stmt = select(VIPPerson).order_by(VIPPerson.platform, VIPPerson.handle)
    if platform:
        stmt = stmt.where(VIPPerson.platform == platform)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_vip_person(db: AsyncSession, vip_id: uuid.UUID) -> VIPPerson | None:
    return await db.get(VIPPerson, vip_id)


async def create_vip_person(db: AsyncSession, data: VIPPersonCreate) -> VIPPerson:
    vip = VIPPerson(**data.model_dump())
    db.add(vip)
    await db.flush()
    return vip


async def update_vip_person(
    db: AsyncSession, vip_id: uuid.UUID, data: VIPPersonUpdate
) -> VIPPerson | None:
    vip = await db.get(VIPPerson, vip_id)
    if vip is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(vip, field, value)
    await db.flush()
    await db.refresh(vip)
    return vip


async def delete_vip_person(db: AsyncSession, vip_id: uuid.UUID) -> bool:
    vip = await db.get(VIPPerson, vip_id)
    if vip is None:
        return False
    await db.delete(vip)
    await db.flush()
    return True


# --- Digests ---


async def list_digests(db: AsyncSession, limit: int = 30) -> list[Digest]:
    result = await db.execute(
        select(Digest).order_by(Digest.digest_date.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def get_digest(db: AsyncSession, digest_id: uuid.UUID) -> Digest | None:
    return await db.get(Digest, digest_id)


async def get_digest_by_date(db: AsyncSession, target_date: date) -> Digest | None:
    result = await db.execute(
        select(Digest).where(Digest.digest_date == target_date)
    )
    return result.scalar_one_or_none()


# --- Newsletter ingestion ---


async def ingest_newsletter(db: AsyncSession, data: NewsletterContentPost) -> ContentItem:
    """Ingest newsletter content posted via API.

    Finds or creates a newsletter source, then stores the content item.
    """
    # Find or create the newsletter source
    result = await db.execute(
        select(ContentSource).where(
            ContentSource.source_type == "newsletter",
            ContentSource.name == data.source_name,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        source = ContentSource(
            name=data.source_name,
            source_type="newsletter",
            is_active=True,
        )
        db.add(source)
        await db.flush()

    content_hash = hashlib.sha256(
        (data.content or data.title).encode("utf-8", errors="replace")
    ).hexdigest()

    item = ContentItem(
        source_id=source.id,
        external_id=content_hash[:32],
        content_hash=content_hash,
        title=data.title,
        url=data.url,
        author=data.author,
        content_text=data.content,
        published_at=data.published_at or datetime.now(timezone.utc),
    )
    db.add(item)
    await db.flush()
    return item
