import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.inventory import AgedInventory, FBAInventory, RestockRecommendation, StrandedInventory
from app.schemas.inventory import (
    AgedInventoryCreate,
    FBAInventoryCreate,
    RestockRecommendationCreate,
    StrandedInventoryCreate,
)


async def upsert_fba_inventory(
    db: AsyncSession, product_id: uuid.UUID, data: FBAInventoryCreate
) -> FBAInventory:
    stmt = select(FBAInventory).where(
        FBAInventory.product_id == product_id,
        FBAInventory.snapshot_date == data.snapshot_date,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(existing, field, value)
        await db.flush()
        return existing
    record = FBAInventory(product_id=product_id, **data.model_dump())
    db.add(record)
    await db.flush()
    return record


async def list_fba_inventory(
    db: AsyncSession,
    product_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[FBAInventory]:
    stmt = select(FBAInventory).where(FBAInventory.product_id == product_id)
    if start_date:
        stmt = stmt.where(FBAInventory.snapshot_date >= start_date)
    if end_date:
        stmt = stmt.where(FBAInventory.snapshot_date <= end_date)
    stmt = stmt.order_by(FBAInventory.snapshot_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_stranded_inventory(
    db: AsyncSession, product_id: uuid.UUID, data: StrandedInventoryCreate
) -> StrandedInventory:
    record = StrandedInventory(product_id=product_id, **data.model_dump())
    db.add(record)
    await db.flush()
    return record


async def list_stranded_inventory(
    db: AsyncSession, product_id: uuid.UUID, offset: int = 0, limit: int = 50
) -> list[StrandedInventory]:
    stmt = (
        select(StrandedInventory)
        .where(StrandedInventory.product_id == product_id)
        .order_by(StrandedInventory.snapshot_date.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_aged_inventory(db: AsyncSession, product_id: uuid.UUID, data: AgedInventoryCreate) -> AgedInventory:
    record = AgedInventory(product_id=product_id, **data.model_dump())
    db.add(record)
    await db.flush()
    return record


async def list_aged_inventory(
    db: AsyncSession, product_id: uuid.UUID, offset: int = 0, limit: int = 50
) -> list[AgedInventory]:
    stmt = (
        select(AgedInventory)
        .where(AgedInventory.product_id == product_id)
        .order_by(AgedInventory.snapshot_date.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def create_restock_recommendation(
    db: AsyncSession, product_id: uuid.UUID, data: RestockRecommendationCreate
) -> RestockRecommendation:
    record = RestockRecommendation(product_id=product_id, **data.model_dump())
    db.add(record)
    await db.flush()
    return record


async def list_restock_recommendations(
    db: AsyncSession, product_id: uuid.UUID, offset: int = 0, limit: int = 50
) -> list[RestockRecommendation]:
    stmt = (
        select(RestockRecommendation)
        .where(RestockRecommendation.product_id == product_id)
        .order_by(RestockRecommendation.snapshot_date.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
