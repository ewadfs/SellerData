import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.marketplace import Marketplace, SellerAccount, SellerMarketplaceLink
from app.schemas.marketplace import SellerAccountCreate, SellerAccountUpdate, SellerMarketplaceLinkCreate


async def list_marketplaces(db: AsyncSession, active_only: bool = True) -> list[Marketplace]:
    stmt = select(Marketplace)
    if active_only:
        stmt = stmt.where(Marketplace.is_active.is_(True))
    stmt = stmt.order_by(Marketplace.region, Marketplace.code)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_marketplace(db: AsyncSession, marketplace_id: uuid.UUID) -> Marketplace | None:
    return await db.get(Marketplace, marketplace_id)


async def list_sellers(db: AsyncSession) -> list[SellerAccount]:
    result = await db.execute(select(SellerAccount).order_by(SellerAccount.seller_name))
    return list(result.scalars().all())


async def get_seller(db: AsyncSession, seller_id: uuid.UUID) -> SellerAccount | None:
    return await db.get(SellerAccount, seller_id)


async def create_seller(db: AsyncSession, data: SellerAccountCreate) -> SellerAccount:
    seller = SellerAccount(**data.model_dump())
    db.add(seller)
    await db.flush()
    return seller


async def update_seller(db: AsyncSession, seller_id: uuid.UUID, data: SellerAccountUpdate) -> SellerAccount | None:
    seller = await db.get(SellerAccount, seller_id)
    if seller is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(seller, field, value)
    await db.flush()
    await db.refresh(seller)
    return seller


async def link_marketplace(
    db: AsyncSession, seller_id: uuid.UUID, data: SellerMarketplaceLinkCreate
) -> SellerMarketplaceLink:
    link = SellerMarketplaceLink(seller_account_id=seller_id, marketplace_id=data.marketplace_id)
    db.add(link)
    await db.flush()
    return link
