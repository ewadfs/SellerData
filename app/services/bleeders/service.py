"""Bleeders report generation: aggregates PPC performance per marketplace and applies the rules."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.advertising import (
    AdCampaign,
    AdGroup,
    AdKeywordTarget,
    AdMetricsDaily,
    AdProductTarget,
    AdSearchTermMetricsDaily,
)
from app.db.models.marketplace import Marketplace, SellerMarketplaceLink
from app.schemas.bleeders import (
    BleedersConfig,
    BleedersMarketplaceReport,
    BleedersReportBundle,
    BleedersSummary,
)
from app.services.bleeders.engine import LEVEL_CAMPAIGN, LEVEL_SEARCH_TERM, LEVEL_TARGET, PerfLine, evaluate
from app.utils.date_helpers import trailing_period


async def _marketplaces_for_seller(
    db: AsyncSession, seller_id: uuid.UUID, marketplace_id: uuid.UUID | None = None
) -> list[Marketplace]:
    stmt = (
        select(Marketplace)
        .join(SellerMarketplaceLink, SellerMarketplaceLink.marketplace_id == Marketplace.id)
        .where(
            SellerMarketplaceLink.seller_account_id == seller_id,
            SellerMarketplaceLink.is_active.is_(True),
            Marketplace.is_active.is_(True),
        )
        .order_by(Marketplace.code)
    )
    if marketplace_id:
        stmt = stmt.where(Marketplace.id == marketplace_id)
    marketplaces = list((await db.execute(stmt)).scalars().all())
    if marketplaces or marketplace_id is None:
        return marketplaces
    # Fall back to the marketplace itself when no link row exists but campaigns do.
    stmt = select(Marketplace).where(Marketplace.id == marketplace_id)
    return list((await db.execute(stmt)).scalars().all())


def _campaign_filter(stmt, seller_id: uuid.UUID, marketplace_id: uuid.UUID):
    return stmt.where(
        AdCampaign.seller_account_id == seller_id,
        AdCampaign.marketplace_id == marketplace_id,
    )


async def _aggregate_keyword_targets(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace: Marketplace,
    start: date,
    end: date,
) -> list[PerfLine]:
    stmt = (
        select(
            AdCampaign.campaign_type,
            AdCampaign.id.label("campaign_id"),
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdKeywordTarget.keyword_text,
            AdKeywordTarget.match_type,
            func.coalesce(func.sum(AdMetricsDaily.impressions), 0).label("impressions"),
            func.coalesce(func.sum(AdMetricsDaily.clicks), 0).label("clicks"),
            func.coalesce(func.sum(AdMetricsDaily.spend), 0).label("spend"),
            func.coalesce(func.sum(AdMetricsDaily.sales_14d), 0).label("sales"),
            func.coalesce(func.sum(AdMetricsDaily.orders_14d), 0).label("orders"),
        )
        .join(AdKeywordTarget, AdMetricsDaily.keyword_target_id == AdKeywordTarget.id)
        .join(AdGroup, AdKeywordTarget.ad_group_id == AdGroup.id)
        .join(AdCampaign, AdGroup.campaign_id == AdCampaign.id)
        .where(AdMetricsDaily.report_date >= start, AdMetricsDaily.report_date <= end)
        .group_by(
            AdKeywordTarget.id,
            AdCampaign.campaign_type,
            AdCampaign.id,
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdKeywordTarget.keyword_text,
            AdKeywordTarget.match_type,
        )
    )
    stmt = _campaign_filter(stmt, seller_id, marketplace.id)
    rows = (await db.execute(stmt)).all()
    return [
        PerfLine(
            campaign_type=r.campaign_type,
            campaign_id=r.campaign_id,
            campaign_name=r.campaign_name,
            portfolio=r.portfolio_name,
            ad_group=r.ad_group_name,
            target=r.keyword_text,
            search_term=None,
            match_type=r.match_type,
            level=LEVEL_TARGET,
            impressions=int(r.impressions),
            clicks=int(r.clicks),
            spend=float(r.spend),
            sales=float(r.sales),
            orders=int(r.orders),
            currency=marketplace.default_currency,
            is_ranking=bool(r.is_ranking),
        )
        for r in rows
    ]


async def _aggregate_product_targets(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace: Marketplace,
    start: date,
    end: date,
) -> list[PerfLine]:
    stmt = (
        select(
            AdCampaign.campaign_type,
            AdCampaign.id.label("campaign_id"),
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdProductTarget.target_asin,
            AdProductTarget.target_category,
            func.coalesce(func.sum(AdMetricsDaily.impressions), 0).label("impressions"),
            func.coalesce(func.sum(AdMetricsDaily.clicks), 0).label("clicks"),
            func.coalesce(func.sum(AdMetricsDaily.spend), 0).label("spend"),
            func.coalesce(func.sum(AdMetricsDaily.sales_14d), 0).label("sales"),
            func.coalesce(func.sum(AdMetricsDaily.orders_14d), 0).label("orders"),
        )
        .join(AdProductTarget, AdMetricsDaily.product_target_id == AdProductTarget.id)
        .join(AdGroup, AdProductTarget.ad_group_id == AdGroup.id)
        .join(AdCampaign, AdGroup.campaign_id == AdCampaign.id)
        .where(AdMetricsDaily.report_date >= start, AdMetricsDaily.report_date <= end)
        .group_by(
            AdProductTarget.id,
            AdCampaign.campaign_type,
            AdCampaign.id,
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdProductTarget.target_asin,
            AdProductTarget.target_category,
        )
    )
    stmt = _campaign_filter(stmt, seller_id, marketplace.id)
    rows = (await db.execute(stmt)).all()
    lines = []
    for r in rows:
        if r.target_asin:
            target = f'— (asin="{r.target_asin}")'
        elif r.target_category:
            target = f'— (category="{r.target_category}")'
        else:
            target = "— (product target)"
        lines.append(
            PerfLine(
                campaign_type=r.campaign_type,
                campaign_id=r.campaign_id,
                campaign_name=r.campaign_name,
                portfolio=r.portfolio_name,
                ad_group=r.ad_group_name,
                target=target,
                search_term=None,
                match_type=None,
                level=LEVEL_TARGET,
                impressions=int(r.impressions),
                clicks=int(r.clicks),
                spend=float(r.spend),
                sales=float(r.sales),
                orders=int(r.orders),
                currency=marketplace.default_currency,
                is_ranking=bool(r.is_ranking),
            )
        )
    return lines


async def _aggregate_search_terms(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace: Marketplace,
    start: date,
    end: date,
) -> list[PerfLine]:
    stmt = (
        select(
            AdCampaign.campaign_type,
            AdCampaign.id.label("campaign_id"),
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdSearchTermMetricsDaily.target_text,
            AdSearchTermMetricsDaily.search_term,
            AdSearchTermMetricsDaily.match_type,
            func.coalesce(func.sum(AdSearchTermMetricsDaily.impressions), 0).label("impressions"),
            func.coalesce(func.sum(AdSearchTermMetricsDaily.clicks), 0).label("clicks"),
            func.coalesce(func.sum(AdSearchTermMetricsDaily.spend), 0).label("spend"),
            func.coalesce(func.sum(AdSearchTermMetricsDaily.sales), 0).label("sales"),
            func.coalesce(func.sum(AdSearchTermMetricsDaily.orders), 0).label("orders"),
        )
        .join(AdCampaign, AdSearchTermMetricsDaily.campaign_id == AdCampaign.id)
        .join(AdGroup, AdSearchTermMetricsDaily.ad_group_id == AdGroup.id, isouter=True)
        .where(
            AdSearchTermMetricsDaily.report_date >= start,
            AdSearchTermMetricsDaily.report_date <= end,
        )
        .group_by(
            AdCampaign.campaign_type,
            AdCampaign.id,
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            AdGroup.ad_group_name,
            AdSearchTermMetricsDaily.target_text,
            AdSearchTermMetricsDaily.search_term,
            AdSearchTermMetricsDaily.match_type,
        )
    )
    stmt = _campaign_filter(stmt, seller_id, marketplace.id)
    rows = (await db.execute(stmt)).all()
    return [
        PerfLine(
            campaign_type=r.campaign_type,
            campaign_id=r.campaign_id,
            campaign_name=r.campaign_name,
            portfolio=r.portfolio_name,
            ad_group=r.ad_group_name,
            target=r.target_text,
            search_term=r.search_term,
            match_type=r.match_type,
            level=LEVEL_SEARCH_TERM,
            impressions=int(r.impressions),
            clicks=int(r.clicks),
            spend=float(r.spend),
            sales=float(r.sales),
            orders=int(r.orders),
            currency=marketplace.default_currency,
            is_ranking=bool(r.is_ranking),
        )
        for r in rows
    ]


async def _aggregate_campaigns(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace: Marketplace,
    start: date,
    end: date,
) -> list[PerfLine]:
    stmt = (
        select(
            AdCampaign.campaign_type,
            AdCampaign.id.label("campaign_id"),
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
            func.coalesce(func.sum(AdMetricsDaily.impressions), 0).label("impressions"),
            func.coalesce(func.sum(AdMetricsDaily.clicks), 0).label("clicks"),
            func.coalesce(func.sum(AdMetricsDaily.spend), 0).label("spend"),
            func.coalesce(func.sum(AdMetricsDaily.sales_14d), 0).label("sales"),
            func.coalesce(func.sum(AdMetricsDaily.orders_14d), 0).label("orders"),
        )
        .join(AdCampaign, AdMetricsDaily.campaign_id == AdCampaign.id)
        .where(AdMetricsDaily.report_date >= start, AdMetricsDaily.report_date <= end)
        .group_by(
            AdCampaign.id,
            AdCampaign.campaign_type,
            AdCampaign.campaign_name,
            AdCampaign.portfolio_name,
            AdCampaign.is_ranking,
        )
    )
    stmt = _campaign_filter(stmt, seller_id, marketplace.id)
    rows = (await db.execute(stmt)).all()
    return [
        PerfLine(
            campaign_type=r.campaign_type,
            campaign_id=r.campaign_id,
            campaign_name=r.campaign_name,
            portfolio=r.portfolio_name,
            ad_group=None,
            target=None,
            search_term=None,
            match_type=None,
            level=LEVEL_CAMPAIGN,
            impressions=int(r.impressions),
            clicks=int(r.clicks),
            spend=float(r.spend),
            sales=float(r.sales),
            orders=int(r.orders),
            currency=marketplace.default_currency,
            is_ranking=bool(r.is_ranking),
        )
        for r in rows
    ]


def _summarize(rows) -> BleedersSummary:
    def _count(source: str, level: str) -> int:
        return sum(1 for r in rows if r.source == source and r.level == level)

    return BleedersSummary(
        total_rows=len(rows),
        b1_targets=_count("B1", LEVEL_TARGET),
        b1_search_terms=_count("B1", LEVEL_SEARCH_TERM),
        b2_targets=_count("B2", LEVEL_TARGET),
        b2_search_terms=_count("B2", LEVEL_SEARCH_TERM),
        campaigns_over_threshold=sum(1 for r in rows if r.level == LEVEL_CAMPAIGN),
        flagged_target_spend=round(sum(r.spend for r in rows if r.level == LEVEL_TARGET), 2),
        flagged_search_term_spend=round(sum(r.spend for r in rows if r.level == LEVEL_SEARCH_TERM), 2),
        flagged_campaign_spend=round(sum(r.spend for r in rows if r.level == LEVEL_CAMPAIGN), 2),
    )


async def generate_marketplace_report(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace: Marketplace,
    report_date: date,
    config: BleedersConfig,
) -> BleedersMarketplaceReport:
    b1_start, b1_end = trailing_period(report_date, config.b1_window_days)
    b2_start, b2_end = trailing_period(report_date, config.b2_window_days)
    camp_start, camp_end = trailing_period(report_date, config.campaign_window_days)

    b1_lines = [
        *(await _aggregate_keyword_targets(db, seller_id, marketplace, b1_start, b1_end)),
        *(await _aggregate_product_targets(db, seller_id, marketplace, b1_start, b1_end)),
        *(await _aggregate_search_terms(db, seller_id, marketplace, b1_start, b1_end)),
    ]
    b2_lines = [
        *(await _aggregate_keyword_targets(db, seller_id, marketplace, b2_start, b2_end)),
        *(await _aggregate_product_targets(db, seller_id, marketplace, b2_start, b2_end)),
        *(await _aggregate_search_terms(db, seller_id, marketplace, b2_start, b2_end)),
    ]
    campaign_lines = await _aggregate_campaigns(db, seller_id, marketplace, camp_start, camp_end)

    rows = evaluate(b1_lines, b2_lines, campaign_lines, config, domain=marketplace.domain)

    return BleedersMarketplaceReport(
        marketplace_id=marketplace.id,
        marketplace_code=marketplace.code,
        marketplace_name=marketplace.name,
        currency=marketplace.default_currency,
        report_date=report_date,
        b1_window_start=b1_start,
        b1_window_end=b1_end,
        b2_window_start=b2_start,
        b2_window_end=b2_end,
        summary=_summarize(rows),
        rows=rows,
    )


async def generate_reports(
    db: AsyncSession,
    seller_id: uuid.UUID,
    report_date: date,
    config: BleedersConfig,
    marketplace_id: uuid.UUID | None = None,
) -> BleedersReportBundle:
    marketplaces = await _marketplaces_for_seller(db, seller_id, marketplace_id)
    reports = [
        await generate_marketplace_report(db, seller_id, marketplace, report_date, config)
        for marketplace in marketplaces
    ]
    return BleedersReportBundle(
        seller_id=seller_id,
        report_date=report_date,
        config=config,
        reports=reports,
    )
