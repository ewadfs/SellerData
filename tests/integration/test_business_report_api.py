"""Integration tests for business report API endpoints.

These cover the seller-scoped endpoints used by the dashboard "Add Report"
flow, which previously 404'd because only product-scoped routes existed.
"""

import uuid

import pytest


@pytest.mark.asyncio
async def test_create_seller_report(client, seed_seller, seed_marketplace, seed_product):
    response = await client.post(
        f"/api/v1/sellers/{seed_seller.id}/business-reports",
        json={
            "marketplace_id": str(seed_marketplace.id),
            "product_id": str(seed_product.id),
            "report_date": "2025-01-15",
            "sessions": 120,
            "page_views": 340,
            "units_ordered": 12,
            "unit_session_percentage": 0.1,
            "ordered_product_sales": 150.00,
            "buy_box_percentage": 0.98,
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["product_id"] == str(seed_product.id)
    assert data["sessions"] == 120
    assert data["ordered_product_sales"] == 150.00
    assert data["asin"] == "B0TEST12345"


@pytest.mark.asyncio
async def test_list_seller_reports(client, seed_seller, seed_product):
    await client.post(
        f"/api/v1/sellers/{seed_seller.id}/business-reports",
        json={
            "product_id": str(seed_product.id),
            "report_date": "2025-01-15",
            "sessions": 120,
            "ordered_product_sales": 150.00,
        },
    )

    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/business-reports")
    assert response.status_code == 200
    reports = response.json()
    assert len(reports) == 1
    assert reports[0]["asin"] == "B0TEST12345"
    assert reports[0]["sessions"] == 120


@pytest.mark.asyncio
async def test_create_seller_report_upserts_on_same_date(client, seed_seller, seed_product):
    payload = {
        "product_id": str(seed_product.id),
        "report_date": "2025-01-15",
        "sessions": 120,
    }
    await client.post(f"/api/v1/sellers/{seed_seller.id}/business-reports", json=payload)

    # Same product + date should update, not duplicate.
    payload["sessions"] = 999
    await client.post(f"/api/v1/sellers/{seed_seller.id}/business-reports", json=payload)

    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/business-reports")
    reports = response.json()
    assert len(reports) == 1
    assert reports[0]["sessions"] == 999


@pytest.mark.asyncio
async def test_create_seller_report_rejects_foreign_product(client, seed_seller, seed_product):
    other_seller_id = uuid.uuid4()
    response = await client.post(
        f"/api/v1/sellers/{other_seller_id}/business-reports",
        json={
            "product_id": str(seed_product.id),
            "report_date": "2025-01-15",
            "sessions": 10,
        },
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_seller_report_missing_product_id(client, seed_seller):
    response = await client.post(
        f"/api/v1/sellers/{seed_seller.id}/business-reports",
        json={"report_date": "2025-01-15", "sessions": 10},
    )
    assert response.status_code == 422
