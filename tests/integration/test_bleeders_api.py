"""Integration tests for the Bleeders report API."""

import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio

REPORT_DATE = date(2026, 7, 12)


@pytest_asyncio.fixture
async def seed_bleeders_data(db_session, seed_seller, seed_marketplace):
    """Seller linked to a marketplace with one campaign whose target and search term are bleeding."""
    from app.db.models.advertising import (
        AdCampaign,
        AdGroup,
        AdKeywordTarget,
        AdMetricsDaily,
        AdSearchTermMetricsDaily,
    )
    from app.db.models.marketplace import SellerMarketplaceLink

    db_session.add(
        SellerMarketplaceLink(
            id=uuid.uuid4(),
            seller_account_id=seed_seller.id,
            marketplace_id=seed_marketplace.id,
            is_active=True,
        )
    )

    campaign = AdCampaign(
        id=uuid.uuid4(),
        seller_account_id=seed_seller.id,
        marketplace_id=seed_marketplace.id,
        campaign_name="BSQ_EXACT_test_Insiders",
        campaign_type="SP",
        portfolio_name="01. Test Portfolio",
        state="enabled",
        currency="USD",
    )
    ad_group = AdGroup(id=uuid.uuid4(), campaign_id=campaign.id, ad_group_name="Test Ad Group")
    keyword = AdKeywordTarget(
        id=uuid.uuid4(),
        ad_group_id=ad_group.id,
        keyword_text="popcorn maker",
        match_type="exact",
        state="enabled",
    )
    db_session.add_all([campaign, ad_group, keyword])

    # Target: 12 clicks, zero sales across the last 60 days -> B1 target row.
    for offset, clicks in ((5, 7), (40, 5)):
        db_session.add(
            AdMetricsDaily(
                id=uuid.uuid4(),
                campaign_id=campaign.id,
                ad_group_id=ad_group.id,
                keyword_target_id=keyword.id,
                report_date=REPORT_DATE - timedelta(days=offset),
                impressions=1000,
                clicks=clicks,
                spend=6.0,
                sales_14d=0,
                orders_14d=0,
                currency="USD",
            )
        )

    # Search term: 11 clicks, zero sales -> B1 search-term row.
    db_session.add(
        AdSearchTermMetricsDaily(
            id=uuid.uuid4(),
            campaign_id=campaign.id,
            ad_group_id=ad_group.id,
            keyword_target_id=keyword.id,
            target_text="popcorn maker",
            search_term="popcorn maker machine",
            match_type="exact",
            report_date=REPORT_DATE - timedelta(days=3),
            impressions=500,
            clicks=11,
            spend=8.0,
            sales=0,
            orders=0,
            currency="USD",
        )
    )
    await db_session.flush()
    return campaign


@pytest.mark.asyncio
async def test_bleeders_report_all_marketplaces(client, seed_seller, seed_marketplace, seed_bleeders_data):
    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/bleeders/report",
        params={"report_date": REPORT_DATE.isoformat(), "target_acos": 35},
    )
    assert response.status_code == 200
    bundle = response.json()
    assert bundle["report_date"] == REPORT_DATE.isoformat()
    assert len(bundle["reports"]) == 1

    report = bundle["reports"][0]
    assert report["marketplace_code"] == "US"
    assert report["summary"]["b1_targets"] == 1
    assert report["summary"]["b1_search_terms"] == 1
    # Campaign spend (12 + 8 clicks worth) never exceeds 100% ACOS rule: zero sales -> no ACOS.
    assert report["summary"]["campaigns_over_threshold"] == 0

    levels = {row["level"] for row in report["rows"]}
    assert levels == {"target", "search-term"}
    target_row = next(r for r in report["rows"] if r["level"] == "target")
    assert target_row["clicks"] == 12
    assert target_row["source"] == "B1"
    assert target_row["recommended_action"] == "Pause"
    term_row = next(r for r in report["rows"] if r["level"] == "search-term")
    assert term_row["recommended_action"] == "Negative Exact"
    assert term_row["amazon_search_url"] == "https://amazon.com/s?k=popcorn+maker+machine"


@pytest.mark.asyncio
async def test_bleeders_report_respects_click_threshold(client, seed_seller, seed_bleeders_data):
    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/bleeders/report",
        params={"report_date": REPORT_DATE.isoformat(), "b1_clicks_threshold": 20},
    )
    assert response.status_code == 200
    report = response.json()["reports"][0]
    assert report["summary"]["total_rows"] == 0


@pytest.mark.asyncio
async def test_bleeders_csv_single_marketplace(client, seed_seller, seed_marketplace, seed_bleeders_data):
    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/bleeders/report.csv",
        params={
            "report_date": REPORT_DATE.isoformat(),
            "marketplace_id": str(seed_marketplace.id),
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "GNO_Bleeders_Report_US_20260712.csv" in response.headers["content-disposition"]
    lines = response.text.strip().splitlines()
    assert lines[0].endswith("Source")  # exact GNO layout, no Marketplace column
    assert len(lines) == 3  # header + target + search term


@pytest.mark.asyncio
async def test_bleeders_csv_all_marketplaces_appends_marketplace_column(
    client, seed_seller, seed_bleeders_data
):
    response = await client.get(
        f"/api/v1/sellers/{seed_seller.id}/bleeders/report.csv",
        params={"report_date": REPORT_DATE.isoformat()},
    )
    assert response.status_code == 200
    lines = response.text.strip().splitlines()
    assert lines[0].endswith("Source,Marketplace")
    assert all(line.endswith(",US") for line in lines[1:])


@pytest.mark.asyncio
async def test_search_term_metrics_bulk_ingest(client, seed_seller, seed_marketplace, seed_bleeders_data):
    campaign = seed_bleeders_data
    response = await client.post(
        f"/api/v1/sellers/{seed_seller.id}/search-term-metrics/bulk",
        json=[
            {
                "campaign_id": str(campaign.id),
                "search_term": "air popper",
                "match_type": "broad",
                "report_date": "2026-07-10",
                "impressions": 200,
                "clicks": 4,
                "spend": 2.5,
                "sales": 0,
                "orders": 0,
                "currency": "USD",
            }
        ],
    )
    assert response.status_code == 201
    assert response.json()[0]["search_term"] == "air popper"
