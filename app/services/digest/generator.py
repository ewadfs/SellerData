"""Digest generation orchestrator.

Coordinates fetching from all sources, deduplication, AI processing,
importance filtering, and final digest assembly.
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models.content_digest import (
    ContentItem,
    ContentSource,
    Digest,
    DigestEntry,
    SeenContent,
    VIPPerson,
)
from app.services.digest import ai_processor, fetchers

logger = logging.getLogger(__name__)


async def generate_digest(db: AsyncSession, target_date: date | None = None) -> Digest:
    """Generate a digest for the given date (defaults to today).

    Steps:
    1. Load all active sources and VIP people
    2. Fetch new content from each source
    3. Deduplicate against previously seen content
    4. Process through AI (summarize, classify, score)
    5. Filter social media by importance
    6. Assemble and persist the digest
    """
    settings = get_settings()
    target_date = target_date or date.today()

    # Check if digest already exists for this date
    existing = await db.execute(select(Digest).where(Digest.digest_date == target_date))
    existing_digest = existing.scalar_one_or_none()
    if existing_digest:
        # Delete old entries and regenerate
        for entry in existing_digest.entries:
            await db.delete(entry)
        await db.delete(existing_digest)
        await db.flush()

    # 1. Load sources and VIP people
    sources_result = await db.execute(
        select(ContentSource).where(ContentSource.is_active.is_(True))
    )
    sources = list(sources_result.scalars().all())

    vip_result = await db.execute(select(VIPPerson))
    vip_people = list(vip_result.scalars().all())

    twitter_vip_handles = {v.handle.lstrip("@").lower() for v in vip_people if v.platform == "twitter"}
    facebook_vip_ids = {v.handle for v in vip_people if v.platform == "facebook"}

    # 2. Fetch content from all sources
    all_raw_items: list[dict[str, Any]] = []
    source_map: dict[int, ContentSource] = {}

    for source in sources:
        try:
            raw_items = await _fetch_source(source, twitter_vip_handles, facebook_vip_ids)
            for item in raw_items:
                item["_source"] = source
                item["source_type"] = source.source_type
            all_raw_items.extend(raw_items)

            # Update last_fetched_at
            source.last_fetched_at = datetime.now(timezone.utc)
        except Exception:
            logger.exception("Failed to fetch source: %s (%s)", source.name, source.source_type)

    logger.info("Fetched %d raw items from %d sources", len(all_raw_items), len(sources))

    # 3. Deduplicate against seen content
    new_items = await _deduplicate(db, all_raw_items)
    logger.info("After dedup: %d new items", len(new_items))

    if not new_items:
        digest = Digest(digest_date=target_date, item_count=0, html_content="")
        db.add(digest)
        await db.flush()
        return digest

    # 4. AI processing: summarize, classify topics, score importance
    processed = await ai_processor.process_content_batch(new_items)

    # 5. Filter social media posts by importance (VIPs always pass)
    keep_indices = await ai_processor.filter_important_social_posts(
        new_items, processed, settings.DIGEST_IMPORTANCE_THRESHOLD
    )

    # Limit total items
    keep_indices = keep_indices[: settings.DIGEST_MAX_ITEMS]

    # 6. Persist content items and build digest
    processed_map = {p.index: p for p in processed}
    digest = Digest(digest_date=target_date, item_count=len(keep_indices))
    db.add(digest)
    await db.flush()

    for idx in keep_indices:
        item_data = new_items[idx]
        proc = processed_map.get(idx)
        if not proc:
            continue

        source: ContentSource = item_data["_source"]

        # Persist the content item
        content_item = ContentItem(
            source_id=source.id,
            external_id=item_data["external_id"],
            content_hash=item_data.get("content_hash", ""),
            title=item_data.get("title"),
            url=item_data.get("url"),
            author=item_data.get("author"),
            content_text=item_data.get("content_text"),
            published_at=item_data.get("published_at"),
            raw_metadata=item_data.get("raw_metadata"),
            is_from_vip=item_data.get("is_from_vip", False),
            vip_name=item_data.get("vip_name"),
        )
        db.add(content_item)
        await db.flush()

        # Create digest entry
        entry = DigestEntry(
            id=uuid.uuid4(),
            digest_id=digest.id,
            content_item_id=content_item.id,
            summary=proc.summary,
            topic=proc.topic,
            importance_score=proc.importance_score,
            display_title=item_data.get("title"),
            display_url=item_data.get("url"),
            source_name=source.name,
            source_type=source.source_type,
            is_from_vip=item_data.get("is_from_vip", False),
            vip_name=item_data.get("vip_name"),
            author=item_data.get("author"),
        )
        db.add(entry)

        # Mark as seen
        seen = SeenContent(
            id=uuid.uuid4(),
            content_hash=item_data.get("content_hash", ""),
        )
        db.add(seen)

    await db.flush()

    # 7. Render HTML
    from app.services.digest.renderer import render_digest_html

    digest.html_content = render_digest_html(digest, target_date)
    await db.flush()
    await db.refresh(digest)

    return digest


async def _fetch_source(
    source: ContentSource,
    twitter_vip_handles: set[str],
    facebook_vip_ids: set[str],
) -> list[dict[str, Any]]:
    """Fetch content from a single source based on its type."""
    since = source.last_fetched_at

    match source.source_type:
        case "rss":
            return await fetchers.fetch_rss(source.url, since)
        case "blog":
            return await fetchers.fetch_blog(source.url, since)
        case "twitter_feed":
            config = source.config or {}
            username = config.get("username", "")
            return await fetchers.fetch_twitter_feed(username, since, twitter_vip_handles)
        case "twitter_list":
            config = source.config or {}
            list_id = config.get("list_id", "")
            return await fetchers.fetch_twitter_list(list_id, since, twitter_vip_handles)
        case "facebook_group":
            config = source.config or {}
            group_id = config.get("group_id", "")
            return await fetchers.fetch_facebook_group(group_id, since, facebook_vip_ids)
        case "newsletter":
            # Newsletters are ingested via the POST endpoint, not fetched
            return []
        case _:
            logger.warning("Unknown source type: %s", source.source_type)
            return []


async def _deduplicate(db: AsyncSession, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter out items whose content_hash has already been seen."""
    if not items:
        return []

    hashes = [item.get("content_hash", "") for item in items if item.get("content_hash")]
    if not hashes:
        return items

    # Query existing seen hashes
    result = await db.execute(select(SeenContent.content_hash).where(SeenContent.content_hash.in_(hashes)))
    seen_hashes = {row[0] for row in result.all()}

    # Also check within the current batch for duplicates
    new_items: list[dict[str, Any]] = []
    batch_hashes: set[str] = set()
    for item in items:
        h = item.get("content_hash", "")
        if h and (h in seen_hashes or h in batch_hashes):
            continue
        batch_hashes.add(h)
        new_items.append(item)

    return new_items
