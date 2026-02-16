from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.product import ProductCreate, ProductRead, ProductSnapshotCreate, ProductSnapshotRead, ProductUpdate
from app.services import product_service

router = APIRouter()


@router.get("/sellers/{seller_id}/products", response_model=list[ProductRead], tags=["Products"])
async def list_products(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    asin: str | None = None,
    sku: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await product_service.list_products(db, seller_id, marketplace_id, asin, sku, offset, limit)


@router.post("/sellers/{seller_id}/products", response_model=ProductRead, status_code=201, tags=["Products"])
async def create_product(seller_id: UUID, data: ProductCreate, db: AsyncSession = Depends(get_db)):
    return await product_service.create_product(db, seller_id, data)


@router.get("/products/{product_id}", response_model=ProductRead, tags=["Products"])
async def get_product(product_id: UUID, db: AsyncSession = Depends(get_db)):
    product = await product_service.get_product(db, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.patch("/products/{product_id}", response_model=ProductRead, tags=["Products"])
async def update_product(product_id: UUID, data: ProductUpdate, db: AsyncSession = Depends(get_db)):
    product = await product_service.update_product(db, product_id, data)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/products/{product_id}/snapshots", response_model=list[ProductSnapshotRead], tags=["Products"])
async def list_snapshots(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await product_service.list_snapshots(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/snapshots", response_model=ProductSnapshotRead, status_code=201, tags=["Products"]
)
async def create_snapshot(product_id: UUID, data: ProductSnapshotCreate, db: AsyncSession = Depends(get_db)):
    return await product_service.create_snapshot(db, product_id, data)
