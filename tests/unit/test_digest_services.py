"""Unit tests for digest service utilities."""

import hashlib
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.digest.ai_processor import ProcessedItem, filter_important_social_posts
from app.services.digest.fetchers import _content_hash, _strip_html
from app.services.digest.renderer import _format_source_type


class TestContentHash:
    def test_deterministic(self):
        assert _content_hash("hello") == _content_hash("hello")

    def test_different_inputs(self):
        assert _content_hash("hello") != _content_hash("world")

    def test_sha256_format(self):
        result = _content_hash("test content")
        assert len(result) == 64  # SHA-256 hex digest length
        assert result == hashlib.sha256(b"test content").hexdigest()


class TestStripHtml:
    def test_strips_tags(self):
        result = _strip_html("<p>Hello <b>World</b></p>")
        assert "Hello" in result
        assert "World" in result
        assert "<p>" not in result
        assert "<b>" not in result

    def test_plain_text_passthrough(self):
        result = _strip_html("no html here")
        assert "no html here" in result

    def test_empty_string(self):
        assert _strip_html("") == ""

    def test_nested_tags(self):
        result = _strip_html("<div><p>inner <a href='#'>link</a></p></div>")
        assert "inner" in result
        assert "link" in result


class TestFormatSourceType:
    def test_known_types(self):
        assert _format_source_type("rss") == "RSS"
        assert _format_source_type("blog") == "Blog"
        assert _format_source_type("newsletter") == "Newsletter"
        assert _format_source_type("twitter_feed") == "Twitter"
        assert _format_source_type("twitter_list") == "Twitter List"
        assert _format_source_type("facebook_group") == "Facebook"

    def test_unknown_type(self):
        assert _format_source_type("something_else") == "something_else"

    def test_none(self):
        assert _format_source_type(None) == "Unknown"


class TestImportanceFilter:
    @pytest.mark.asyncio
    async def test_vip_always_passes(self):
        items = [
            {"source_type": "twitter_feed", "is_from_vip": True},
        ]
        processed = [ProcessedItem(index=0, summary="test", topic="Tech", importance_score=1.0)]

        result = await filter_important_social_posts(items, processed, threshold=5.0)
        assert 0 in result

    @pytest.mark.asyncio
    async def test_low_importance_social_filtered(self):
        items = [
            {"source_type": "twitter_feed", "is_from_vip": False},
        ]
        processed = [ProcessedItem(index=0, summary="test", topic="Tech", importance_score=2.0)]

        result = await filter_important_social_posts(items, processed, threshold=5.0)
        assert 0 not in result

    @pytest.mark.asyncio
    async def test_high_importance_social_passes(self):
        items = [
            {"source_type": "twitter_feed", "is_from_vip": False},
        ]
        processed = [ProcessedItem(index=0, summary="test", topic="Tech", importance_score=8.0)]

        result = await filter_important_social_posts(items, processed, threshold=5.0)
        assert 0 in result

    @pytest.mark.asyncio
    async def test_non_social_always_passes(self):
        items = [
            {"source_type": "rss", "is_from_vip": False},
        ]
        processed = [ProcessedItem(index=0, summary="test", topic="Tech", importance_score=1.0)]

        result = await filter_important_social_posts(items, processed, threshold=5.0)
        assert 0 in result

    @pytest.mark.asyncio
    async def test_mixed_items(self):
        items = [
            {"source_type": "rss", "is_from_vip": False},           # passes (non-social)
            {"source_type": "twitter_feed", "is_from_vip": False},   # fails (low score)
            {"source_type": "twitter_feed", "is_from_vip": True},    # passes (VIP)
            {"source_type": "facebook_group", "is_from_vip": False}, # passes (high score)
            {"source_type": "blog", "is_from_vip": False},           # passes (non-social)
        ]
        processed = [
            ProcessedItem(index=0, summary="", topic="Tech", importance_score=3.0),
            ProcessedItem(index=1, summary="", topic="Tech", importance_score=2.0),
            ProcessedItem(index=2, summary="", topic="Tech", importance_score=1.0),
            ProcessedItem(index=3, summary="", topic="Tech", importance_score=7.0),
            ProcessedItem(index=4, summary="", topic="Tech", importance_score=1.0),
        ]

        result = await filter_important_social_posts(items, processed, threshold=5.0)
        assert result == [0, 2, 3, 4]
