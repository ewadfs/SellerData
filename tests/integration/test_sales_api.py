"""Integration tests for sales API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_create_order_with_line_items(client, seed_seller, seed_marketplace):
    response = await client.post(f"/api/v1/sellers/{seed_seller.id}/orders", json={
        "marketplace_id": str(seed_marketplace.id),
        "amazon_order_id": "111-2222222-3333333",
        "purchase_date": "2025-01-15T10:00:00Z",
        "order_status": "Shipped",
        "fulfillment_channel": "FBA",
        "order_total": 49.99,
        "currency": "USD",
        "is_prime": True,
        "line_items": [
            {
                "asin": "B0TEST12345",
                "sku": "TEST-SKU-001",
                "quantity": 2,
                "item_price": 24.99,
                "currency": "USD",
            }
        ],
    })
    assert response.status_code == 201
    data = response.json()
    assert data["amazon_order_id"] == "111-2222222-3333333"
    assert data["is_prime"] is True


@pytest.mark.asyncio
async def test_list_orders(client, seed_seller, seed_marketplace):
    # Create an order first
    await client.post(f"/api/v1/sellers/{seed_seller.id}/orders", json={
        "marketplace_id": str(seed_marketplace.id),
        "amazon_order_id": "111-0000000-0000001",
        "purchase_date": "2025-01-15T10:00:00Z",
        "order_status": "Shipped",
        "fulfillment_channel": "FBA",
        "order_total": 25.00,
        "currency": "USD",
        "line_items": [],
    })

    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/orders")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_get_sales_summary(client, seed_seller, seed_marketplace):
    # Create some orders
    for i in range(3):
        await client.post(f"/api/v1/sellers/{seed_seller.id}/orders", json={
            "marketplace_id": str(seed_marketplace.id),
            "amazon_order_id": f"111-SUMM-{i:07d}",
            "purchase_date": f"2025-01-{15+i}T10:00:00Z",
            "order_status": "Shipped",
            "fulfillment_channel": "FBA",
            "order_total": 30.00,
            "currency": "USD",
            "line_items": [{"asin": "B0TEST", "quantity": 1, "item_price": 30.00, "currency": "USD"}],
        })

    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/sales/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["total_orders"] == 3
    assert data["total_revenue"] == 90.0
