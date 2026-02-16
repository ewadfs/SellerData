from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.marketplace import (
    MarketplaceRead,
    SellerAccountCreate,
    SellerAccountRead,
    SellerAccountUpdate,
    SellerMarketplaceLinkCreate,
    SellerMarketplaceLinkRead,
)
from app.services import marketplace_service

router = APIRouter()


@router.get("/marketplaces", response_model=list[MarketplaceRead], tags=["Marketplaces"])
async def list_marketplaces(db: AsyncSession = Depends(get_db)):
    return await marketplace_service.list_marketplaces(db)


@router.get("/marketplaces/{marketplace_id}", response_model=MarketplaceRead, tags=["Marketplaces"])
async def get_marketplace(marketplace_id: UUID, db: AsyncSession = Depends(get_db)):
    mp = await marketplace_service.get_marketplace(db, marketplace_id)
    if mp is None:
        raise HTTPException(status_code=404, detail="Marketplace not found")
    return mp


@router.get("/sellers", response_model=list[SellerAccountRead], tags=["Sellers"])
async def list_sellers(db: AsyncSession = Depends(get_db)):
    return await marketplace_service.list_sellers(db)


@router.post("/sellers", response_model=SellerAccountRead, status_code=201, tags=["Sellers"])
async def create_seller(data: SellerAccountCreate, db: AsyncSession = Depends(get_db)):
    return await marketplace_service.create_seller(db, data)


@router.get("/sellers/{seller_id}", response_model=SellerAccountRead, tags=["Sellers"])
async def get_seller(seller_id: UUID, db: AsyncSession = Depends(get_db)):
    seller = await marketplace_service.get_seller(db, seller_id)
    if seller is None:
        raise HTTPException(status_code=404, detail="Seller not found")
    return seller


@router.patch("/sellers/{seller_id}", response_model=SellerAccountRead, tags=["Sellers"])
async def update_seller(seller_id: UUID, data: SellerAccountUpdate, db: AsyncSession = Depends(get_db)):
    seller = await marketplace_service.update_seller(db, seller_id, data)
    if seller is None:
        raise HTTPException(status_code=404, detail="Seller not found")
    return seller


@router.post(
    "/sellers/{seller_id}/marketplaces",
    response_model=SellerMarketplaceLinkRead,
    status_code=201,
    tags=["Sellers"],
)
async def link_marketplace(seller_id: UUID, data: SellerMarketplaceLinkCreate, db: AsyncSession = Depends(get_db)):
    return await marketplace_service.link_marketplace(db, seller_id, data)
