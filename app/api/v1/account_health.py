from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.account_health import AccountHealthCreate, AccountHealthRead
from app.services import account_health_service

router = APIRouter()


@router.get("/sellers/{seller_id}/account-health", response_model=list[AccountHealthRead], tags=["Account Health"])
async def list_health_snapshots(
    seller_id: UUID,
    marketplace_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await account_health_service.list_health_snapshots(db, seller_id, marketplace_id, offset, limit)


@router.post(
    "/sellers/{seller_id}/account-health",
    response_model=AccountHealthRead,
    status_code=201,
    tags=["Account Health"],
)
async def create_health_snapshot(seller_id: UUID, data: AccountHealthCreate, db: AsyncSession = Depends(get_db)):
    return await account_health_service.create_health_snapshot(db, seller_id, data)


@router.get(
    "/sellers/{seller_id}/account-health/latest",
    response_model=list[AccountHealthRead],
    tags=["Account Health"],
)
async def get_latest_health(seller_id: UUID, db: AsyncSession = Depends(get_db)):
    return await account_health_service.get_latest_health(db, seller_id)
