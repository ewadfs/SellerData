"""Integration tests for A/B test lifecycle API endpoints."""

import pytest


@pytest.mark.asyncio
async def test_full_ab_test_lifecycle(client, seed_seller, seed_product):
    """Test the complete A/B test flow: create -> start -> add metrics -> complete -> results."""

    # 1. Create test
    create_response = await client.post(f"/api/v1/sellers/{seed_seller.id}/ab-tests", json={
        "product_id": str(seed_product.id),
        "test_name": "Main Image Test",
        "change_type": "main_image",
        "hypothesis": "New lifestyle image will increase conversion rate",
        "baseline_period_start": "2025-01-01",
        "baseline_period_end": "2025-01-14",
        "test_period_start": "2025-01-15",
        "primary_metric": "unit_session_percentage",
        "stat_method": "ttest",
        "confidence_level": 0.95,
        "minimum_sample_size": 5,
        "change_description": "Replaced white background with lifestyle image",
    })
    assert create_response.status_code == 201
    test_data = create_response.json()
    test_id = test_data["id"]
    assert test_data["status"] == "draft"
    assert test_data["change_type"] == "main_image"

    # 2. Start test
    start_response = await client.post(f"/api/v1/ab-tests/{test_id}/start")
    assert start_response.status_code == 200
    assert start_response.json()["status"] == "running"

    # 3. Add baseline metric snapshots
    baseline_metrics = [
        {"snapshot_date": f"2025-01-{d:02d}", "period_type": "baseline",
         "sessions": 100, "units_ordered": 5, "unit_session_percentage": 0.05,
         "ordered_product_sales": 150.00, "page_views": 120}
        for d in range(1, 15)
    ]
    for metric in baseline_metrics:
        resp = await client.post(f"/api/v1/ab-tests/{test_id}/metrics", json=metric)
        assert resp.status_code == 201

    # 4. Add test period metric snapshots (improved)
    test_metrics = [
        {"snapshot_date": f"2025-01-{d:02d}", "period_type": "test",
         "sessions": 100, "units_ordered": 8, "unit_session_percentage": 0.08,
         "ordered_product_sales": 240.00, "page_views": 130}
        for d in range(15, 29)
    ]
    for metric in test_metrics:
        resp = await client.post(f"/api/v1/ab-tests/{test_id}/metrics", json=metric)
        assert resp.status_code == 201

    # 5. Complete test
    complete_response = await client.post(f"/api/v1/ab-tests/{test_id}/complete")
    assert complete_response.status_code == 200
    complete_data = complete_response.json()
    assert complete_data["status"] == "completed"
    assert complete_data["result"] is not None

    # 6. Verify results
    result = complete_data["result"]
    assert result["stat_method_used"] == "ttest"
    assert result["baseline_sample_size"] == 14
    assert result["variant_sample_size"] == 14
    assert result["is_significant"] is True
    assert result["recommendation"] == "keep"
    assert result["variant_mean"] > result["baseline_mean"]

    # 7. Get results via dedicated endpoint
    results_response = await client.get(f"/api/v1/ab-tests/{test_id}/results")
    assert results_response.status_code == 200
    assert results_response.json()["recommendation"] == "keep"


@pytest.mark.asyncio
async def test_ab_test_with_no_improvement(client, seed_seller, seed_product):
    """Test that a test with declined metrics recommends revert."""

    create_response = await client.post(f"/api/v1/sellers/{seed_seller.id}/ab-tests", json={
        "product_id": str(seed_product.id),
        "test_name": "Price Increase Test",
        "change_type": "price",
        "baseline_period_start": "2025-02-01",
        "baseline_period_end": "2025-02-14",
        "test_period_start": "2025-02-15",
        "primary_metric": "ordered_product_sales",
        "stat_method": "ttest",
        "minimum_sample_size": 5,
    })
    test_id = create_response.json()["id"]
    await client.post(f"/api/v1/ab-tests/{test_id}/start")

    # Baseline: good sales
    for d in range(1, 15):
        await client.post(f"/api/v1/ab-tests/{test_id}/metrics", json={
            "snapshot_date": f"2025-02-{d:02d}", "period_type": "baseline",
            "sessions": 100, "units_ordered": 10, "ordered_product_sales": 300.00,
        })

    # Test period: declined sales
    for d in range(15, 29):
        await client.post(f"/api/v1/ab-tests/{test_id}/metrics", json={
            "snapshot_date": f"2025-02-{d:02d}", "period_type": "test",
            "sessions": 100, "units_ordered": 5, "ordered_product_sales": 150.00,
        })

    complete_response = await client.post(f"/api/v1/ab-tests/{test_id}/complete")
    result = complete_response.json()["result"]
    assert result["is_significant"] is True
    assert result["recommendation"] == "revert"


@pytest.mark.asyncio
async def test_list_ab_tests(client, seed_seller, seed_product):
    # Create two tests
    for name in ["Test 1", "Test 2"]:
        await client.post(f"/api/v1/sellers/{seed_seller.id}/ab-tests", json={
            "product_id": str(seed_product.id),
            "test_name": name,
            "change_type": "title",
            "baseline_period_start": "2025-01-01",
            "baseline_period_end": "2025-01-14",
            "test_period_start": "2025-01-15",
            "primary_metric": "sessions",
        })

    response = await client.get(f"/api/v1/sellers/{seed_seller.id}/ab-tests")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_cannot_start_non_draft_test(client, seed_seller, seed_product):
    create_response = await client.post(f"/api/v1/sellers/{seed_seller.id}/ab-tests", json={
        "product_id": str(seed_product.id),
        "test_name": "Already Started",
        "change_type": "images",
        "baseline_period_start": "2025-01-01",
        "baseline_period_end": "2025-01-14",
        "test_period_start": "2025-01-15",
        "primary_metric": "sessions",
    })
    test_id = create_response.json()["id"]

    # Start once (should succeed)
    resp1 = await client.post(f"/api/v1/ab-tests/{test_id}/start")
    assert resp1.status_code == 200

    # Start again (should fail)
    resp2 = await client.post(f"/api/v1/ab-tests/{test_id}/start")
    assert resp2.status_code == 422 or resp2.status_code == 500  # Validation error
