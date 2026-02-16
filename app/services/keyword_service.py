import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.keywords import KeywordRanking, SearchVisibilityScore
from app.schemas.keywords import KeywordRankingCreate


async def upsert_rankings(
    db: AsyncSession, product_id: uuid.UUID, rankings: list[KeywordRankingCreate]
) -> list[KeywordRanking]:
    results = []
    for data in rankings:
        stmt = select(KeywordRanking).where(
            KeywordRanking.product_id == product_id,
            KeywordRanking.keyword == data.keyword,
            KeywordRanking.check_date == data.check_date,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            for field, value in data.model_dump(exclude_unset=True).items():
                setattr(existing, field, value)
            results.append(existing)
        else:
            record = KeywordRanking(product_id=product_id, **data.model_dump())
            db.add(record)
            results.append(record)
    await db.flush()
    return results


async def list_rankings(
    db: AsyncSession,
    product_id: uuid.UUID,
    keyword: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[KeywordRanking]:
    stmt = select(KeywordRanking).where(KeywordRanking.product_id == product_id)
    if keyword:
        stmt = stmt.where(KeywordRanking.keyword == keyword)
    if start_date:
        stmt = stmt.where(KeywordRanking.check_date >= start_date)
    if end_date:
        stmt = stmt.where(KeywordRanking.check_date <= end_date)
    stmt = stmt.order_by(KeywordRanking.check_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_visibility_scores(
    db: AsyncSession, product_id: uuid.UUID, offset: int = 0, limit: int = 50
) -> list[SearchVisibilityScore]:
    stmt = (
        select(SearchVisibilityScore)
        .where(SearchVisibilityScore.product_id == product_id)
        .order_by(SearchVisibilityScore.score_date.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
