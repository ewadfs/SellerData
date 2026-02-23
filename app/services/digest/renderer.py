"""HTML rendering for the daily digest using Jinja2 templates."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from app.db.models.content_digest import Digest

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent.parent / "templates"


def _build_template_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=True,
    )

    def format_date(d: date) -> str:
        return d.strftime("%A, %B %-d, %Y")

    def format_time(dt: datetime) -> str:
        return dt.strftime("%-I:%M %p")

    env.filters["format_date"] = format_date
    env.filters["format_time"] = format_time
    return env


def render_digest_html(digest: Digest, digest_date: date) -> str:
    """Render the digest to a standalone HTML newsletter page."""
    env = _build_template_env()
    template = env.get_template("digest.html")

    # Separate VIP entries from regular entries
    vip_entries = []
    topic_entries: dict[str, list] = defaultdict(list)

    for entry in sorted(digest.entries, key=lambda e: (e.topic, -(e.importance_score or 0))):
        entry_data = {
            "summary": entry.summary,
            "topic": entry.topic,
            "importance_score": entry.importance_score,
            "title": entry.display_title or "Untitled",
            "url": entry.display_url or "#",
            "source_name": entry.source_name or "Unknown",
            "source_type": _format_source_type(entry.source_type),
            "is_from_vip": entry.is_from_vip,
            "vip_name": entry.vip_name,
            "author": entry.author,
        }
        if entry.is_from_vip:
            vip_entries.append(entry_data)
        else:
            topic_entries[entry.topic].append(entry_data)

    # Sort topics by number of entries (most articles first)
    sorted_topics = dict(sorted(topic_entries.items(), key=lambda kv: -len(kv[1])))

    return template.render(
        digest_date=digest_date,
        generated_at=digest.generated_at,
        total_items=digest.item_count,
        topic_count=len(sorted_topics),
        vip_entries=vip_entries,
        topics=sorted_topics,
    )


def _format_source_type(source_type: str | None) -> str:
    mapping = {
        "rss": "RSS",
        "blog": "Blog",
        "newsletter": "Newsletter",
        "twitter_feed": "Twitter",
        "twitter_list": "Twitter List",
        "facebook_group": "Facebook",
    }
    return mapping.get(source_type or "", source_type or "Unknown")
