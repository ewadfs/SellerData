from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.keywords import KeywordRankingCreate, KeywordRankingRead, SearchVisibilityRead
from app.services import keyword_service

router = APIRouter()


@router.get("/products/{product_id}/keywords", response_model=list[KeywordRankingRead], tags=["Keywords"])
async def list_rankings(
    product_id: UUID,
    keyword: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await keyword_service.list_rankings(db, product_id, keyword, start_date, end_date, offset, limit)


@router.post(
    "/products/{product_id}/keywords/rankings",
    response_model=list[KeywordRankingRead],
    status_code=201,
    tags=["Keywords"],
)
async def upsert_rankings(
    product_id: UUID, rankings: list[KeywordRankingCreate], db: AsyncSession = Depends(get_db)
):
    return await keyword_service.upsert_rankings(db, product_id, rankings)


@router.get(
    "/products/{product_id}/search-visibility",
    response_model=list[SearchVisibilityRead],
    tags=["Keywords"],
)
async def list_visibility_scores(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await keyword_service.list_visibility_scores(db, product_id, offset, limit)
