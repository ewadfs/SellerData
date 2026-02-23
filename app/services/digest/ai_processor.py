"""AI-powered content processing using Claude.

Handles summarization, topic classification, and importance filtering
in batched API calls for efficiency.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import anthropic

from app.config import get_settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 20


@dataclass
class ProcessedItem:
    index: int
    summary: str
    topic: str
    importance_score: float


async def process_content_batch(items: list[dict[str, Any]]) -> list[ProcessedItem]:
    """Summarize, classify topics, and score importance for a batch of content items.

    Each item dict should have: title, content_text, source_type, author, raw_metadata.
    Returns a ProcessedItem for each input item (matched by index).
    """
    settings = get_settings()
    if not settings.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not configured, returning placeholder summaries")
        return [
            ProcessedItem(index=i, summary=item.get("content_text", "")[:200], topic="Uncategorized", importance_score=5.0)
            for i, item in enumerate(items)
        ]

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    all_results: list[ProcessedItem] = []

    for batch_start in range(0, len(items), BATCH_SIZE):
        batch = items[batch_start : batch_start + BATCH_SIZE]
        batch_results = await _process_single_batch(client, batch, batch_start)
        all_results.extend(batch_results)

    return all_results


async def _process_single_batch(
    client: anthropic.Anthropic, batch: list[dict[str, Any]], offset: int
) -> list[ProcessedItem]:
    """Process a single batch of up to BATCH_SIZE items."""
    content_parts = []
    for i, item in enumerate(batch):
        idx = offset + i
        source_type = item.get("source_type", "unknown")
        metrics_str = ""
        metadata = item.get("raw_metadata") or {}
        if metadata.get("metrics"):
            metrics_str = f"\nEngagement metrics: {json.dumps(metadata['metrics'])}"

        content_parts.append(
            f"---\n"
            f"[{idx}] Title: {item.get('title', 'No title')}\n"
            f"Source type: {source_type}\n"
            f"Author: {item.get('author', 'Unknown')}\n"
            f"Content: {(item.get('content_text') or '')[:2000]}\n"
            f"{metrics_str}\n"
        )

    prompt = (
        "You are a content digest assistant. For each piece of content below, provide:\n"
        "1. A concise 2-3 sentence summary capturing the key points\n"
        "2. A topic category (e.g., Technology, Business, AI/ML, Politics, Science, "
        "Health, Finance, Culture, Sports, World News, Opinion, etc.)\n"
        "3. An importance score from 0-10 where:\n"
        "   - 0-3: Trivial, low-value content (casual chatter, memes, mundane updates)\n"
        "   - 4-6: Moderately interesting or informative\n"
        "   - 7-10: Highly important, breaking news, significant insights\n"
        "   For social media posts, weight engagement metrics heavily.\n\n"
        "Content items:\n"
        + "\n".join(content_parts)
        + "\n---\n\n"
        "Respond ONLY with a JSON array. Each element must have exactly these keys:\n"
        '{"id": <index number>, "summary": "...", "topic": "...", "importance_score": <float>}\n'
        "Return valid JSON only, no markdown fences."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Handle potential markdown code fences
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        parsed = json.loads(text)
        results = []
        for entry in parsed:
            results.append(
                ProcessedItem(
                    index=entry["id"],
                    summary=entry["summary"],
                    topic=entry["topic"],
                    importance_score=float(entry["importance_score"]),
                )
            )
        return results
    except (json.JSONDecodeError, KeyError, anthropic.APIError) as e:
        logger.error("AI processing failed: %s", e)
        # Fallback: return basic results
        return [
            ProcessedItem(
                index=offset + i,
                summary=(item.get("content_text") or "")[:200],
                topic="Uncategorized",
                importance_score=5.0,
            )
            for i, item in enumerate(batch)
        ]


async def filter_important_social_posts(
    items: list[dict[str, Any]], processed: list[ProcessedItem], threshold: float
) -> list[int]:
    """Return indices of social media items that pass the importance threshold or are from VIPs.

    Items from VIP people always pass regardless of score.
    """
    keep_indices: list[int] = []
    processed_map = {p.index: p for p in processed}

    for i, item in enumerate(items):
        p = processed_map.get(i)
        if not p:
            continue

        is_social = item.get("source_type") in ("twitter_feed", "twitter_list", "facebook_group")
        is_vip = item.get("is_from_vip", False)

        if is_vip:
            keep_indices.append(i)
        elif is_social and p.importance_score < threshold:
            continue
        else:
            keep_indices.append(i)

    return keep_indices
