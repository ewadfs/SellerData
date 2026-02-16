"""Integration tests for marketplace and seller API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_list_marketplaces_empty(client):
    response = await client.get("/api/v1/marketplaces")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_marketplaces_with_data(client, seed_marketplace):
    response = await client.get("/api/v1/marketplaces")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "US"
    assert data[0]["domain"] == "amazon.com"


@pytest.mark.asyncio
async def test_get_marketplace(client, seed_marketplace):
    response = await client.get(f"/api/v1/marketplaces/{seed_marketplace.id}")
    assert response.status_code == 200
    assert response.json()["code"] == "US"


@pytest.mark.asyncio
async def test_get_marketplace_not_found(client):
    response = await client.get("/api/v1/marketplaces/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_seller(client):
    response = await client.post("/api/v1/sellers", json={
        "seller_name": "My Amazon Store",
        "amazon_seller_id": "AXXXXXXX",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["seller_name"] == "My Amazon Store"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_sellers(client, seed_seller):
    response = await client.get("/api/v1/sellers")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_update_seller(client, seed_seller):
    response = await client.patch(f"/api/v1/sellers/{seed_seller.id}", json={
        "seller_name": "Updated Name",
    })
    assert response.status_code == 200
    assert response.json()["seller_name"] == "Updated Name"


@pytest.mark.asyncio
async def test_link_marketplace_to_seller(client, seed_seller, seed_marketplace):
    response = await client.post(
        f"/api/v1/sellers/{seed_seller.id}/marketplaces",
        json={"marketplace_id": str(seed_marketplace.id)},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["seller_account_id"] == str(seed_seller.id)
    assert data["marketplace_id"] == str(seed_marketplace.id)
