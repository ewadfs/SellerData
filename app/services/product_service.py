import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.product import Product, ProductSnapshot
from app.schemas.product import ProductCreate, ProductSnapshotCreate, ProductUpdate


async def list_products(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    asin: str | None = None,
    sku: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[Product]:
    stmt = select(Product).where(Product.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(Product.marketplace_id == marketplace_id)
    if asin:
        stmt = stmt.where(Product.asin == asin)
    if sku:
        stmt = stmt.where(Product.sku == sku)
    stmt = stmt.offset(offset).limit(limit).order_by(Product.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Product | None:
    return await db.get(Product, product_id)


async def create_product(db: AsyncSession, seller_id: uuid.UUID, data: ProductCreate) -> Product:
    product = Product(seller_account_id=seller_id, **data.model_dump())
    db.add(product)
    await db.flush()
    return product


async def update_product(db: AsyncSession, product_id: uuid.UUID, data: ProductUpdate) -> Product | None:
    product = await db.get(Product, product_id)
    if product is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    await db.flush()
    await db.refresh(product)
    return product


async def list_snapshots(
    db: AsyncSession, product_id: uuid.UUID, offset: int = 0, limit: int = 50
) -> list[ProductSnapshot]:
    stmt = (
        select(ProductSnapshot)
        .where(ProductSnapshot.product_id == product_id)
        .order_by(ProductSnapshot.snapshot_date.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_snapshot(db: AsyncSession, product_id: uuid.UUID, data: ProductSnapshotCreate) -> ProductSnapshot:
    snapshot = ProductSnapshot(product_id=product_id, **data.model_dump())
    db.add(snapshot)
    await db.flush()
    return snapshot
