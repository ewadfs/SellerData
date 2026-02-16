from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.inventory import (
    AgedInventoryCreate,
    AgedInventoryRead,
    FBAInventoryCreate,
    FBAInventoryRead,
    RestockRecommendationCreate,
    RestockRecommendationRead,
    StrandedInventoryCreate,
    StrandedInventoryRead,
)
from app.services import inventory_service

router = APIRouter()


@router.get("/products/{product_id}/inventory/fba", response_model=list[FBAInventoryRead], tags=["Inventory"])
async def list_fba_inventory(
    product_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_fba_inventory(db, product_id, start_date, end_date, offset, limit)


@router.post("/products/{product_id}/inventory/fba", response_model=FBAInventoryRead, status_code=201, tags=["Inventory"])
async def upsert_fba_inventory(product_id: UUID, data: FBAInventoryCreate, db: AsyncSession = Depends(get_db)):
    return await inventory_service.upsert_fba_inventory(db, product_id, data)


@router.get("/products/{product_id}/inventory/stranded", response_model=list[StrandedInventoryRead], tags=["Inventory"])
async def list_stranded_inventory(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_stranded_inventory(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/stranded",
    response_model=StrandedInventoryRead,
    status_code=201,
    tags=["Inventory"],
)
async def create_stranded_inventory(
    product_id: UUID, data: StrandedInventoryCreate, db: AsyncSession = Depends(get_db)
):
    return await inventory_service.create_stranded_inventory(db, product_id, data)


@router.get("/products/{product_id}/inventory/aged", response_model=list[AgedInventoryRead], tags=["Inventory"])
async def list_aged_inventory(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_aged_inventory(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/aged", response_model=AgedInventoryRead, status_code=201, tags=["Inventory"]
)
async def create_aged_inventory(product_id: UUID, data: AgedInventoryCreate, db: AsyncSession = Depends(get_db)):
    return await inventory_service.create_aged_inventory(db, product_id, data)


@router.get(
    "/products/{product_id}/inventory/restock",
    response_model=list[RestockRecommendationRead],
    tags=["Inventory"],
)
async def list_restock_recommendations(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_restock_recommendations(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/restock",
    response_model=RestockRecommendationRead,
    status_code=201,
    tags=["Inventory"],
)
async def create_restock_recommendation(
    product_id: UUID, data: RestockRecommendationCreate, db: AsyncSession = Depends(get_db)
):
    return await inventory_service.create_restock_recommendation(db, product_id, data)
