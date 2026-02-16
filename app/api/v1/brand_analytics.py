from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.brand_analytics import (
    DemographicsCreate,
    DemographicsRead,
    MarketBasketCreate,
    MarketBasketRead,
    RepeatPurchaseCreate,
    RepeatPurchaseRead,
    SearchTermReportCreate,
    SearchTermReportRead,
)
from app.services import brand_analytics_service

router = APIRouter()


# Search Terms
@router.post(
    "/sellers/{seller_id}/brand-analytics/search-terms",
    response_model=list[SearchTermReportRead],
    status_code=201,
    tags=["Brand Analytics"],
)
async def create_search_term_reports(
    seller_id: UUID, reports: list[SearchTermReportCreate], db: AsyncSession = Depends(get_db)
):
    return await brand_analytics_service.create_search_term_reports(db, seller_id, reports)


@router.get(
    "/sellers/{seller_id}/brand-analytics/search-terms",
    response_model=list[SearchTermReportRead],
    tags=["Brand Analytics"],
)
async def list_search_term_reports(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    search_term: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await brand_analytics_service.list_search_term_reports(
        db, seller_id, marketplace_id, search_term, start_date, end_date, offset, limit
    )


# Market Basket
@router.post(
    "/sellers/{seller_id}/brand-analytics/market-basket",
    response_model=list[MarketBasketRead],
    status_code=201,
    tags=["Brand Analytics"],
)
async def create_market_basket_reports(
    seller_id: UUID, reports: list[MarketBasketCreate], db: AsyncSession = Depends(get_db)
):
    return await brand_analytics_service.create_market_basket_reports(db, seller_id, reports)


@router.get(
    "/sellers/{seller_id}/brand-analytics/market-basket",
    response_model=list[MarketBasketRead],
    tags=["Brand Analytics"],
)
async def list_market_basket_reports(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    asin: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await brand_analytics_service.list_market_basket_reports(db, seller_id, marketplace_id, asin, offset, limit)


# Repeat Purchase
@router.post(
    "/sellers/{seller_id}/brand-analytics/repeat-purchase",
    response_model=list[RepeatPurchaseRead],
    status_code=201,
    tags=["Brand Analytics"],
)
async def create_repeat_purchase_reports(
    seller_id: UUID, reports: list[RepeatPurchaseCreate], db: AsyncSession = Depends(get_db)
):
    return await brand_analytics_service.create_repeat_purchase_reports(db, seller_id, reports)


@router.get(
    "/sellers/{seller_id}/brand-analytics/repeat-purchase",
    response_model=list[RepeatPurchaseRead],
    tags=["Brand Analytics"],
)
async def list_repeat_purchase_reports(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    asin: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await brand_analytics_service.list_repeat_purchase_reports(
        db, seller_id, marketplace_id, asin, offset, limit
    )


# Demographics
@router.post(
    "/sellers/{seller_id}/brand-analytics/demographics",
    response_model=list[DemographicsRead],
    status_code=201,
    tags=["Brand Analytics"],
)
async def create_demographics_reports(
    seller_id: UUID, reports: list[DemographicsCreate], db: AsyncSession = Depends(get_db)
):
    return await brand_analytics_service.create_demographics_reports(db, seller_id, reports)


@router.get(
    "/sellers/{seller_id}/brand-analytics/demographics",
    response_model=list[DemographicsRead],
    tags=["Brand Analytics"],
)
async def list_demographics_reports(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    asin: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await brand_analytics_service.list_demographics_reports(
        db, seller_id, marketplace_id, asin, offset, limit
    )
