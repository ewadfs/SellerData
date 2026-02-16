"""Integration tests for product API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_create_product(client, seed_seller, seed_marketplace):
    response = await client.post(f"/api/v1/sellers/{seed_seller.id}/products", json={
        "marketplace_id": str(seed_marketplace.id),
        "asin": "B0NEWPROD123",
        "sku": "NEW-SKU-001",
        "title": "New Product Title",
        "brand": "Test Brand",
        "category": "Electronics",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["asin"] == "B0NEWPROD123"
    assert data["sku"] == "NEW-SKU-001"
    assert data["seller_account_id"] == str(seed_seller.id)


@pytest.mark.asyncio
async def test_list_products(client, seed_seller, seed_product):
    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/products")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_list_products_filter_by_asin(client, seed_seller, seed_product):
    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/products",
        params={"asin": "B0TEST12345"},
    )
    assert response.status_code == 200
    assert len(response.json()) == 1

    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/products",
        params={"asin": "NONEXISTENT"},
    )
    assert response.status_code == 200
    assert len(response.json()) == 0


@pytest.mark.asyncio
async def test_get_product(client, seed_product):
    response = await client.get(f"/api/v1/products/{seed_product.id}")
    assert response.status_code == 200
    assert response.json()["asin"] == "B0TEST12345"


@pytest.mark.asyncio
async def test_update_product(client, seed_product):
    response = await client.patch(f"/api/v1/products/{seed_product.id}", json={
        "title": "Updated Product Title",
    })
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Product Title"


@pytest.mark.asyncio
async def test_create_snapshot(client, seed_product):
    response = await client.post(f"/api/v1/products/{seed_product.id}/snapshots", json={
        "snapshot_date": "2025-01-15",
        "title": "Snapshot Title",
        "price": 29.99,
        "currency": "USD",
        "rating": 4.5,
        "review_count": 150,
        "best_seller_rank": 1234,
    })
    assert response.status_code == 201
    data = response.json()
    assert data["price"] == 29.99
    assert data["rating"] == 4.5


@pytest.mark.asyncio
async def test_list_snapshots(client, seed_product):
    # Create two snapshots
    await client.post(f"/api/v1/products/{seed_product.id}/snapshots", json={
        "snapshot_date": "2025-01-10",
        "price": 25.99,
        "currency": "USD",
    })
    await client.post(f"/api/v1/products/{seed_product.id}/snapshots", json={
        "snapshot_date": "2025-01-15",
        "price": 29.99,
        "currency": "USD",
    })

    response = await client.get(f"/api/v1/products/{seed_product.id}/snapshots")
    assert response.status_code == 200
    assert len(response.json()) == 2
