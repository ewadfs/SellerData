from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.business_report import (
    BusinessReportCreate,
    BusinessReportRead,
    SellerBusinessReportCreate,
    SellerBusinessReportRead,
)
from app.services import business_report_service

router = APIRouter()


@router.get(
    "/sellers/{seller_id}/business-reports",
    response_model=list[SellerBusinessReportRead],
    tags=["Business Reports"],
)
async def list_seller_reports(
    seller_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await business_report_service.list_reports_for_seller(
        db, seller_id, start_date, end_date, offset, limit
    )


@router.post(
    "/sellers/{seller_id}/business-reports",
    response_model=SellerBusinessReportRead,
    status_code=201,
    tags=["Business Reports"],
)
async def create_seller_report(
    seller_id: UUID,
    report: SellerBusinessReportCreate,
    db: AsyncSession = Depends(get_db),
):
    result = await business_report_service.create_report_for_seller(db, seller_id, report)
    if result is None:
        raise HTTPException(status_code=404, detail="Product not found for this seller")
    return result


@router.get("/products/{product_id}/business-reports", response_model=list[BusinessReportRead], tags=["Business Reports"])
async def list_reports(
    product_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await business_report_service.list_reports(db, product_id, start_date, end_date, offset, limit)


@router.post(
    "/products/{product_id}/business-reports",
    response_model=list[BusinessReportRead],
    status_code=201,
    tags=["Business Reports"],
)
async def bulk_upsert_reports(
    product_id: UUID,
    reports: list[BusinessReportCreate],
    db: AsyncSession = Depends(get_db),
):
    return await business_report_service.bulk_upsert_reports(db, product_id, reports)
