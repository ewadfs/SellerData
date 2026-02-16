from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.sales import OrderCreate, OrderRead, RefundCreate, RefundRead, SalesSummary
from app.services import sales_service

router = APIRouter()


@router.get("/sellers/{seller_id}/orders", response_model=list[OrderRead], tags=["Sales"])
async def list_orders(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await sales_service.list_orders(db, seller_id, marketplace_id, start_date, end_date, status, offset, limit)


@router.post("/sellers/{seller_id}/orders", response_model=OrderRead, status_code=201, tags=["Sales"])
async def create_order(seller_id: UUID, data: OrderCreate, db: AsyncSession = Depends(get_db)):
    return await sales_service.create_order(db, seller_id, data)


@router.get("/orders/{order_id}", response_model=OrderRead, tags=["Sales"])
async def get_order(order_id: UUID, db: AsyncSession = Depends(get_db)):
    order = await sales_service.get_order(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/refunds", response_model=RefundRead, status_code=201, tags=["Sales"])
async def create_refund(data: RefundCreate, db: AsyncSession = Depends(get_db)):
    return await sales_service.create_refund(db, data)


@router.get("/sellers/{seller_id}/sales/summary", response_model=SalesSummary, tags=["Sales"])
async def get_sales_summary(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await sales_service.get_sales_summary(db, seller_id, marketplace_id, start_date, end_date)
