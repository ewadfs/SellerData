"""Content fetchers for various source types.

Each fetcher returns a list of raw content dicts with keys:
    external_id, title, url, author, content_text, published_at, raw_metadata
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

FETCH_TIMEOUT = 30.0


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


# ---------------------------------------------------------------------------
# RSS / Atom fetcher
# ---------------------------------------------------------------------------


async def fetch_rss(url: str, since: datetime | None = None) -> list[dict[str, Any]]:
    """Fetch articles from an RSS or Atom feed."""
    import feedparser

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "ContentDigest/1.0"})
        resp.raise_for_status()

    feed = feedparser.parse(resp.text)
    items: list[dict[str, Any]] = []
    for entry in feed.entries:
        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
        elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
            published = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)

        if since and published and published <= since:
            continue

        content_text = ""
        if hasattr(entry, "content") and entry.content:
            content_text = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            content_text = entry.summary or ""

        # Strip HTML tags for plain-text summary input
        content_text = _strip_html(content_text)

        items.append(
            {
                "external_id": getattr(entry, "id", None) or entry.get("link", ""),
                "title": getattr(entry, "title", ""),
                "url": getattr(entry, "link", ""),
                "author": getattr(entry, "author", None),
                "content_text": content_text,
                "published_at": published,
                "raw_metadata": {},
                "content_hash": _content_hash(content_text or getattr(entry, "title", "")),
            }
        )
    return items


# ---------------------------------------------------------------------------
# Blog / generic URL fetcher
# ---------------------------------------------------------------------------


async def fetch_blog(url: str, since: datetime | None = None) -> list[dict[str, Any]]:
    """Attempt to discover an RSS feed for a blog URL, falling back to page scraping."""
    from bs4 import BeautifulSoup

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "ContentDigest/1.0"})
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Try to find RSS/Atom feed link
    feed_link = soup.find("link", attrs={"type": "application/rss+xml"})
    if not feed_link:
        feed_link = soup.find("link", attrs={"type": "application/atom+xml"})

    if feed_link and feed_link.get("href"):
        feed_url = feed_link["href"]
        if feed_url.startswith("/"):
            from urllib.parse import urljoin

            feed_url = urljoin(url, feed_url)
        return await fetch_rss(feed_url, since)

    # Fallback: scrape the page for article-like content
    items: list[dict[str, Any]] = []
    articles = soup.find_all("article")
    if not articles:
        # Try h2/h3 links as article links
        articles = soup.find_all(["h2", "h3"])

    for art in articles[:20]:
        link_tag = art.find("a", href=True) if art.name != "a" else art
        if not link_tag or not link_tag.get("href"):
            continue

        from urllib.parse import urljoin

        article_url = urljoin(url, link_tag["href"])
        title = link_tag.get_text(strip=True)
        if not title:
            continue

        # Fetch article content
        article_text = ""
        try:
            async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
                art_resp = await client.get(article_url, headers={"User-Agent": "ContentDigest/1.0"})
                if art_resp.status_code == 200:
                    art_soup = BeautifulSoup(art_resp.text, "html.parser")
                    # Try to get the article body
                    body = art_soup.find("article") or art_soup.find("main") or art_soup.find("body")
                    if body:
                        article_text = body.get_text(separator=" ", strip=True)[:3000]
        except Exception:
            logger.debug("Failed to fetch article content for %s", article_url)

        items.append(
            {
                "external_id": article_url,
                "title": title,
                "url": article_url,
                "author": None,
                "content_text": article_text,
                "published_at": None,
                "raw_metadata": {},
                "content_hash": _content_hash(article_text or title),
            }
        )

    return items


# ---------------------------------------------------------------------------
# Twitter fetcher (API v2)
# ---------------------------------------------------------------------------


async def fetch_twitter_feed(
    username: str, since: datetime | None = None, vip_handles: set[str] | None = None
) -> list[dict[str, Any]]:
    """Fetch recent tweets from a user's timeline via Twitter API v2."""
    settings = get_settings()
    if not settings.TWITTER_BEARER_TOKEN:
        logger.warning("TWITTER_BEARER_TOKEN not configured, skipping Twitter fetch")
        return []

    headers = {"Authorization": f"Bearer {settings.TWITTER_BEARER_TOKEN}"}
    vip_handles = vip_handles or set()
    items: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
        # Resolve user ID
        user_resp = await client.get(
            f"https://api.twitter.com/2/users/by/username/{username}",
            headers=headers,
        )
        if user_resp.status_code != 200:
            logger.error("Twitter user lookup failed for %s: %s", username, user_resp.text)
            return []
        user_data = user_resp.json().get("data", {})
        user_id = user_data.get("id")
        if not user_id:
            return []

        # Fetch recent tweets
        params: dict[str, Any] = {
            "max_results": 100,
            "tweet.fields": "created_at,public_metrics,author_id,text",
            "expansions": "author_id",
            "user.fields": "username,name",
        }
        if since:
            params["start_time"] = since.strftime("%Y-%m-%dT%H:%M:%SZ")

        tweets_resp = await client.get(
            f"https://api.twitter.com/2/users/{user_id}/tweets",
            headers=headers,
            params=params,
        )
        if tweets_resp.status_code != 200:
            logger.error("Twitter tweets fetch failed: %s", tweets_resp.text)
            return []

        data = tweets_resp.json()
        tweets = data.get("data", [])
        users_map = {}
        for user in data.get("includes", {}).get("users", []):
            users_map[user["id"]] = user

        for tweet in tweets:
            author_info = users_map.get(tweet.get("author_id"), {})
            author_handle = author_info.get("username", "")
            author_name = author_info.get("name", author_handle)

            metrics = tweet.get("public_metrics", {})
            is_vip = author_handle.lower() in {h.lower() for h in vip_handles}

            created_at = None
            if tweet.get("created_at"):
                created_at = datetime.fromisoformat(tweet["created_at"].replace("Z", "+00:00"))

            items.append(
                {
                    "external_id": tweet["id"],
                    "title": f"@{author_handle}: {tweet['text'][:100]}",
                    "url": f"https://twitter.com/{author_handle}/status/{tweet['id']}",
                    "author": author_name,
                    "content_text": tweet["text"],
                    "published_at": created_at,
                    "raw_metadata": {
                        "platform": "twitter",
                        "metrics": metrics,
                        "author_handle": author_handle,
                    },
                    "content_hash": _content_hash(tweet["text"]),
                    "is_from_vip": is_vip,
                    "vip_name": author_name if is_vip else None,
                }
            )

    return items


async def fetch_twitter_list(
    list_id: str, since: datetime | None = None, vip_handles: set[str] | None = None
) -> list[dict[str, Any]]:
    """Fetch recent tweets from a Twitter list."""
    settings = get_settings()
    if not settings.TWITTER_BEARER_TOKEN:
        logger.warning("TWITTER_BEARER_TOKEN not configured, skipping Twitter list fetch")
        return []

    headers = {"Authorization": f"Bearer {settings.TWITTER_BEARER_TOKEN}"}
    vip_handles = vip_handles or set()
    items: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
        params: dict[str, Any] = {
            "max_results": 100,
            "tweet.fields": "created_at,public_metrics,author_id,text",
            "expansions": "author_id",
            "user.fields": "username,name",
        }

        resp = await client.get(
            f"https://api.twitter.com/2/lists/{list_id}/tweets",
            headers=headers,
            params=params,
        )
        if resp.status_code != 200:
            logger.error("Twitter list fetch failed: %s", resp.text)
            return []

        data = resp.json()
        tweets = data.get("data", [])
        users_map = {}
        for user in data.get("includes", {}).get("users", []):
            users_map[user["id"]] = user

        for tweet in tweets:
            author_info = users_map.get(tweet.get("author_id"), {})
            author_handle = author_info.get("username", "")
            author_name = author_info.get("name", author_handle)

            metrics = tweet.get("public_metrics", {})
            is_vip = author_handle.lower() in {h.lower() for h in vip_handles}

            created_at = None
            if tweet.get("created_at"):
                created_at = datetime.fromisoformat(tweet["created_at"].replace("Z", "+00:00"))

            if since and created_at and created_at <= since:
                continue

            items.append(
                {
                    "external_id": tweet["id"],
                    "title": f"@{author_handle}: {tweet['text'][:100]}",
                    "url": f"https://twitter.com/{author_handle}/status/{tweet['id']}",
                    "author": author_name,
                    "content_text": tweet["text"],
                    "published_at": created_at,
                    "raw_metadata": {
                        "platform": "twitter",
                        "metrics": metrics,
                        "author_handle": author_handle,
                    },
                    "content_hash": _content_hash(tweet["text"]),
                    "is_from_vip": is_vip,
                    "vip_name": author_name if is_vip else None,
                }
            )

    return items


# ---------------------------------------------------------------------------
# Facebook Group fetcher
# ---------------------------------------------------------------------------


async def fetch_facebook_group(
    group_id: str, since: datetime | None = None, vip_ids: set[str] | None = None
) -> list[dict[str, Any]]:
    """Fetch recent posts from a Facebook group via Graph API."""
    settings = get_settings()
    if not settings.FACEBOOK_ACCESS_TOKEN:
        logger.warning("FACEBOOK_ACCESS_TOKEN not configured, skipping Facebook fetch")
        return []

    vip_ids = vip_ids or set()
    items: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
        params: dict[str, str] = {
            "access_token": settings.FACEBOOK_ACCESS_TOKEN,
            "fields": "id,message,created_time,from,shares,reactions.summary(true),comments.summary(true),permalink_url",
            "limit": "100",
        }
        if since:
            params["since"] = str(int(since.timestamp()))

        resp = await client.get(
            f"https://graph.facebook.com/v19.0/{group_id}/feed",
            params=params,
        )
        if resp.status_code != 200:
            logger.error("Facebook group fetch failed: %s", resp.text)
            return []

        data = resp.json()
        posts = data.get("data", [])

        for post in posts:
            message = post.get("message", "")
            if not message:
                continue

            from_info = post.get("from", {})
            author_id = from_info.get("id", "")
            author_name = from_info.get("name", "Unknown")
            is_vip = author_id in vip_ids or author_name.lower() in {v.lower() for v in vip_ids}

            reactions_count = post.get("reactions", {}).get("summary", {}).get("total_count", 0)
            comments_count = post.get("comments", {}).get("summary", {}).get("total_count", 0)
            shares_count = post.get("shares", {}).get("count", 0)

            created_at = None
            if post.get("created_time"):
                created_at = datetime.fromisoformat(post["created_time"].replace("+0000", "+00:00"))

            permalink = post.get("permalink_url", f"https://facebook.com/{post['id']}")

            items.append(
                {
                    "external_id": post["id"],
                    "title": f"{author_name}: {message[:100]}",
                    "url": permalink,
                    "author": author_name,
                    "content_text": message,
                    "published_at": created_at,
                    "raw_metadata": {
                        "platform": "facebook",
                        "metrics": {
                            "reactions": reactions_count,
                            "comments": comments_count,
                            "shares": shares_count,
                        },
                        "author_id": author_id,
                    },
                    "content_hash": _content_hash(message),
                    "is_from_vip": is_vip,
                    "vip_name": author_name if is_vip else None,
                }
            )

    return items


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_html(html: str) -> str:
    """Remove HTML tags from a string."""
    from html.parser import HTMLParser
    from io import StringIO

    class _HTMLStripper(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.fed: list[str] = []

        def handle_data(self, d: str) -> None:
            self.fed.append(d)

        def get_data(self) -> str:
            return " ".join(self.fed)

    s = _HTMLStripper()
    s.feed(html)
    return s.get_data()
