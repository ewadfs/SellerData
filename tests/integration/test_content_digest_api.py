"""Integration tests for the content digest API endpoints."""

import pytest


# ---------------------------------------------------------------------------
# Content Sources
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_sources_empty(client):
    response = await client.get("/api/v1/digest/sources")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_create_rss_source(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "Hacker News",
            "source_type": "rss",
            "url": "https://hnrss.org/frontpage",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Hacker News"
    assert data["source_type"] == "rss"
    assert data["url"] == "https://hnrss.org/frontpage"
    assert data["is_active"] is True
    assert "id" in data


@pytest.mark.asyncio
async def test_create_twitter_feed_source(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "My Twitter Feed",
            "source_type": "twitter_feed",
            "config": {"username": "elonmusk"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["source_type"] == "twitter_feed"
    assert data["config"]["username"] == "elonmusk"


@pytest.mark.asyncio
async def test_create_twitter_list_source(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "Tech Leaders List",
            "source_type": "twitter_list",
            "config": {"list_id": "123456789"},
        },
    )
    assert response.status_code == 201
    assert response.json()["source_type"] == "twitter_list"


@pytest.mark.asyncio
async def test_create_facebook_group_source(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "Amazon Sellers Group",
            "source_type": "facebook_group",
            "config": {"group_id": "987654321"},
        },
    )
    assert response.status_code == 201
    assert response.json()["source_type"] == "facebook_group"


@pytest.mark.asyncio
async def test_create_blog_source(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "Paul Graham",
            "source_type": "blog",
            "url": "https://paulgraham.com",
        },
    )
    assert response.status_code == 201
    assert response.json()["source_type"] == "blog"


@pytest.mark.asyncio
async def test_create_source_invalid_type(client):
    response = await client.post(
        "/api/v1/digest/sources",
        json={
            "name": "Bad Source",
            "source_type": "invalid_type",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_sources_with_data(client):
    await client.post(
        "/api/v1/digest/sources",
        json={"name": "Feed 1", "source_type": "rss", "url": "https://example.com/rss"},
    )
    await client.post(
        "/api/v1/digest/sources",
        json={"name": "Feed 2", "source_type": "blog", "url": "https://example.com/blog"},
    )
    response = await client.get("/api/v1/digest/sources")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_get_source(client):
    create_resp = await client.post(
        "/api/v1/digest/sources",
        json={"name": "Test RSS", "source_type": "rss", "url": "https://example.com/feed"},
    )
    source_id = create_resp.json()["id"]
    response = await client.get(f"/api/v1/digest/sources/{source_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Test RSS"


@pytest.mark.asyncio
async def test_get_source_not_found(client):
    response = await client.get("/api/v1/digest/sources/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_source(client):
    create_resp = await client.post(
        "/api/v1/digest/sources",
        json={"name": "Old Name", "source_type": "rss", "url": "https://example.com/feed"},
    )
    source_id = create_resp.json()["id"]
    response = await client.patch(
        f"/api/v1/digest/sources/{source_id}",
        json={"name": "New Name", "is_active": False},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"
    assert response.json()["is_active"] is False


@pytest.mark.asyncio
async def test_delete_source(client):
    create_resp = await client.post(
        "/api/v1/digest/sources",
        json={"name": "To Delete", "source_type": "rss", "url": "https://example.com/feed"},
    )
    source_id = create_resp.json()["id"]
    delete_resp = await client.delete(f"/api/v1/digest/sources/{source_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/v1/digest/sources/{source_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_source_not_found(client):
    response = await client.delete("/api/v1/digest/sources/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# VIP People
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_vip_people_empty(client):
    response = await client.get("/api/v1/digest/vip-people")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_create_twitter_vip(client):
    response = await client.post(
        "/api/v1/digest/vip-people",
        json={
            "platform": "twitter",
            "handle": "elonmusk",
            "display_name": "Elon Musk",
            "notes": "Tesla/SpaceX CEO",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["platform"] == "twitter"
    assert data["handle"] == "elonmusk"
    assert data["display_name"] == "Elon Musk"


@pytest.mark.asyncio
async def test_create_facebook_vip(client):
    response = await client.post(
        "/api/v1/digest/vip-people",
        json={
            "platform": "facebook",
            "handle": "zuck",
            "display_name": "Mark Zuckerberg",
        },
    )
    assert response.status_code == 201
    assert response.json()["platform"] == "facebook"


@pytest.mark.asyncio
async def test_create_vip_invalid_platform(client):
    response = await client.post(
        "/api/v1/digest/vip-people",
        json={"platform": "linkedin", "handle": "someone"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_vip_people_filter_platform(client):
    await client.post(
        "/api/v1/digest/vip-people",
        json={"platform": "twitter", "handle": "user1"},
    )
    await client.post(
        "/api/v1/digest/vip-people",
        json={"platform": "facebook", "handle": "user2"},
    )

    all_resp = await client.get("/api/v1/digest/vip-people")
    assert len(all_resp.json()) == 2

    twitter_resp = await client.get("/api/v1/digest/vip-people?platform=twitter")
    assert len(twitter_resp.json()) == 1
    assert twitter_resp.json()[0]["platform"] == "twitter"


@pytest.mark.asyncio
async def test_update_vip_person(client):
    create_resp = await client.post(
        "/api/v1/digest/vip-people",
        json={"platform": "twitter", "handle": "testuser"},
    )
    vip_id = create_resp.json()["id"]
    response = await client.patch(
        f"/api/v1/digest/vip-people/{vip_id}",
        json={"display_name": "Test User Updated", "notes": "Updated notes"},
    )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Test User Updated"


@pytest.mark.asyncio
async def test_delete_vip_person(client):
    create_resp = await client.post(
        "/api/v1/digest/vip-people",
        json={"platform": "twitter", "handle": "todelete"},
    )
    vip_id = create_resp.json()["id"]
    delete_resp = await client.delete(f"/api/v1/digest/vip-people/{vip_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/v1/digest/vip-people/{vip_id}")
    assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Newsletter Ingestion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_newsletter(client):
    response = await client.post(
        "/api/v1/digest/newsletters",
        json={
            "source_name": "Morning Brew",
            "title": "Today's Top Stories",
            "content": "The market surged today as tech stocks led gains...",
            "author": "Morning Brew Team",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Today's Top Stories"
    assert data["author"] == "Morning Brew Team"


@pytest.mark.asyncio
async def test_ingest_newsletter_creates_source(client):
    await client.post(
        "/api/v1/digest/newsletters",
        json={
            "source_name": "The Hustle",
            "title": "Daily Digest",
            "content": "Here are today's top business stories...",
        },
    )
    # The newsletter source should now exist
    sources_resp = await client.get("/api/v1/digest/sources")
    sources = sources_resp.json()
    newsletter_sources = [s for s in sources if s["source_type"] == "newsletter"]
    assert len(newsletter_sources) == 1
    assert newsletter_sources[0]["name"] == "The Hustle"


# ---------------------------------------------------------------------------
# Digest Generation & Retrieval
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_latest_digest_empty(client):
    response = await client.get("/api/v1/digest/latest")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_digest_by_date_not_found(client):
    response = await client.get("/api/v1/digest/2025-01-01")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_digest_by_invalid_date(client):
    response = await client.get("/api/v1/digest/not-a-date")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_digest_html_not_found(client):
    response = await client.get("/api/v1/digest/2025-01-01/html")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_digest_history_empty(client):
    response = await client.get("/api/v1/digest/history")
    assert response.status_code == 200
    assert response.json() == []
