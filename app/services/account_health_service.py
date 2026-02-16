import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.account_health import AccountHealthMetric
from app.schemas.account_health import AccountHealthCreate


async def create_health_snapshot(
    db: AsyncSession, seller_id: uuid.UUID, data: AccountHealthCreate
) -> AccountHealthMetric:
    record = AccountHealthMetric(seller_account_id=seller_id, **data.model_dump())
    db.add(record)
    await db.flush()
    return record


async def list_health_snapshots(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[AccountHealthMetric]:
    stmt = select(AccountHealthMetric).where(AccountHealthMetric.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(AccountHealthMetric.marketplace_id == marketplace_id)
    stmt = stmt.order_by(AccountHealthMetric.snapshot_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_latest_health(
    db: AsyncSession, seller_id: uuid.UUID
) -> list[AccountHealthMetric]:
    subq = (
        select(
            AccountHealthMetric.marketplace_id,
            AccountHealthMetric.snapshot_date,
        )
        .where(AccountHealthMetric.seller_account_id == seller_id)
        .distinct(AccountHealthMetric.marketplace_id)
        .order_by(AccountHealthMetric.marketplace_id, AccountHealthMetric.snapshot_date.desc())
        .subquery()
    )
    stmt = select(AccountHealthMetric).where(
        AccountHealthMetric.seller_account_id == seller_id,
        AccountHealthMetric.marketplace_id == subq.c.marketplace_id,
        AccountHealthMetric.snapshot_date == subq.c.snapshot_date,
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
