from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.advertising import AdCampaignCreate, AdCampaignRead, AdMetricsDailyCreate, AdMetricsDailyRead, AdvertisingSummary
from app.services import advertising_service

router = APIRouter()


@router.get("/sellers/{seller_id}/campaigns", response_model=list[AdCampaignRead], tags=["Advertising"])
async def list_campaigns(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    campaign_type: str | None = None,
    state: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await advertising_service.list_campaigns(db, seller_id, marketplace_id, campaign_type, state, offset, limit)


@router.post("/sellers/{seller_id}/campaigns", response_model=AdCampaignRead, status_code=201, tags=["Advertising"])
async def create_campaign(seller_id: UUID, data: AdCampaignCreate, db: AsyncSession = Depends(get_db)):
    return await advertising_service.create_campaign(db, seller_id, data)


@router.post(
    "/sellers/{seller_id}/ad-metrics/bulk",
    response_model=list[AdMetricsDailyRead],
    status_code=201,
    tags=["Advertising"],
)
async def bulk_create_ad_metrics(
    seller_id: UUID, metrics: list[AdMetricsDailyCreate], db: AsyncSession = Depends(get_db)
):
    return await advertising_service.create_ad_metrics(db, metrics)


@router.get("/sellers/{seller_id}/advertising/summary", response_model=AdvertisingSummary, tags=["Advertising"])
async def get_advertising_summary(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await advertising_service.get_advertising_summary(db, seller_id, marketplace_id, start_date, end_date)
