import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.brand_analytics import DemographicsReport, MarketBasketReport, RepeatPurchaseReport, SearchTermReport
from app.schemas.brand_analytics import (
    DemographicsCreate,
    MarketBasketCreate,
    RepeatPurchaseCreate,
    SearchTermReportCreate,
)


async def create_search_term_reports(
    db: AsyncSession, seller_id: uuid.UUID, reports: list[SearchTermReportCreate]
) -> list[SearchTermReport]:
    results = []
    for data in reports:
        record = SearchTermReport(seller_account_id=seller_id, **data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def list_search_term_reports(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    search_term: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[SearchTermReport]:
    stmt = select(SearchTermReport).where(SearchTermReport.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(SearchTermReport.marketplace_id == marketplace_id)
    if search_term:
        stmt = stmt.where(SearchTermReport.search_term.ilike(f"%{search_term}%"))
    if start_date:
        stmt = stmt.where(SearchTermReport.report_date_start >= start_date)
    if end_date:
        stmt = stmt.where(SearchTermReport.report_date_end <= end_date)
    stmt = stmt.order_by(SearchTermReport.report_date_start.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_market_basket_reports(
    db: AsyncSession, seller_id: uuid.UUID, reports: list[MarketBasketCreate]
) -> list[MarketBasketReport]:
    results = []
    for data in reports:
        record = MarketBasketReport(seller_account_id=seller_id, **data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def list_market_basket_reports(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    asin: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[MarketBasketReport]:
    stmt = select(MarketBasketReport).where(MarketBasketReport.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(MarketBasketReport.marketplace_id == marketplace_id)
    if asin:
        stmt = stmt.where(MarketBasketReport.asin == asin)
    stmt = stmt.order_by(MarketBasketReport.report_date_start.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_repeat_purchase_reports(
    db: AsyncSession, seller_id: uuid.UUID, reports: list[RepeatPurchaseCreate]
) -> list[RepeatPurchaseReport]:
    results = []
    for data in reports:
        record = RepeatPurchaseReport(seller_account_id=seller_id, **data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def list_repeat_purchase_reports(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    asin: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[RepeatPurchaseReport]:
    stmt = select(RepeatPurchaseReport).where(RepeatPurchaseReport.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(RepeatPurchaseReport.marketplace_id == marketplace_id)
    if asin:
        stmt = stmt.where(RepeatPurchaseReport.asin == asin)
    stmt = stmt.order_by(RepeatPurchaseReport.report_date_start.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_demographics_reports(
    db: AsyncSession, seller_id: uuid.UUID, reports: list[DemographicsCreate]
) -> list[DemographicsReport]:
    results = []
    for data in reports:
        record = DemographicsReport(seller_account_id=seller_id, **data.model_dump())
        db.add(record)
        results.append(record)
    await db.flush()
    return results


async def list_demographics_reports(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    asin: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[DemographicsReport]:
    stmt = select(DemographicsReport).where(DemographicsReport.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(DemographicsReport.marketplace_id == marketplace_id)
    if asin:
        stmt = stmt.where(DemographicsReport.asin == asin)
    stmt = stmt.order_by(DemographicsReport.report_date_start.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())
