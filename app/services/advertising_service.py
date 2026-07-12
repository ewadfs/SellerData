import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.advertising import AdCampaign, AdMetricsDaily, AdSearchTermMetricsDaily
from app.schemas.advertising import (
    AdCampaignCreate,
    AdMetricsDailyCreate,
    AdSearchTermMetricsCreate,
    AdvertisingSummary,
)


async def list_campaigns(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    campaign_type: str | None = None,
    state: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[AdCampaign]:
    stmt = select(AdCampaign).where(AdCampaign.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(AdCampaign.marketplace_id == marketplace_id)
    if campaign_type:
        stmt = stmt.where(AdCampaign.campaign_type == campaign_type)
    if state:
        stmt = stmt.where(AdCampaign.state == state)
    stmt = stmt.order_by(AdCampaign.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_campaign(db: AsyncSession, seller_id: uuid.UUID, data: AdCampaignCreate) -> AdCampaign:
    campaign = AdCampaign(seller_account_id=seller_id, **data.model_dump())
    db.add(campaign)
    await db.flush()
    return campaign


async def create_ad_metrics(db: AsyncSession, metrics: list[AdMetricsDailyCreate]) -> list[AdMetricsDaily]:
    results = []
    for data in metrics:
        record = AdMetricsDaily(**data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def create_search_term_metrics(
    db: AsyncSession, metrics: list[AdSearchTermMetricsCreate]
) -> list[AdSearchTermMetricsDaily]:
    results = []
    for data in metrics:
        record = AdSearchTermMetricsDaily(**data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def get_advertising_summary(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> AdvertisingSummary:
    campaign_ids_stmt = select(AdCampaign.id).where(AdCampaign.seller_account_id == seller_id)
    if marketplace_id:
        campaign_ids_stmt = campaign_ids_stmt.where(AdCampaign.marketplace_id == marketplace_id)

    stmt = select(
        func.coalesce(func.sum(AdMetricsDaily.spend), 0).label("total_spend"),
        func.coalesce(func.sum(AdMetricsDaily.sales_14d), 0).label("total_sales_14d"),
        func.coalesce(func.sum(AdMetricsDaily.impressions), 0).label("total_impressions"),
        func.coalesce(func.sum(AdMetricsDaily.clicks), 0).label("total_clicks"),
    ).where(AdMetricsDaily.campaign_id.in_(campaign_ids_stmt))

    if start_date:
        stmt = stmt.where(AdMetricsDaily.report_date >= start_date)
    if end_date:
        stmt = stmt.where(AdMetricsDaily.report_date <= end_date)

    result = await db.execute(stmt)
    row = result.one()

    total_spend = float(row.total_spend)
    total_sales = float(row.total_sales_14d)
    avg_acos = (total_spend / total_sales * 100) if total_sales > 0 else None

    return AdvertisingSummary(
        total_spend=total_spend,
        total_sales_14d=total_sales,
        total_impressions=row.total_impressions,
        total_clicks=row.total_clicks,
        avg_acos=avg_acos,
    )
