import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.business_report import BusinessReportDaily
from app.schemas.business_report import BusinessReportCreate


async def list_reports(
    db: AsyncSession,
    product_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[BusinessReportDaily]:
    stmt = select(BusinessReportDaily).where(BusinessReportDaily.product_id == product_id)
    if start_date:
        stmt = stmt.where(BusinessReportDaily.report_date >= start_date)
    if end_date:
        stmt = stmt.where(BusinessReportDaily.report_date <= end_date)
    stmt = stmt.order_by(BusinessReportDaily.report_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def upsert_report(db: AsyncSession, product_id: uuid.UUID, data: BusinessReportCreate) -> BusinessReportDaily:
    stmt = select(BusinessReportDaily).where(
        BusinessReportDaily.product_id == product_id,
        BusinessReportDaily.report_date == data.report_date,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(existing, field, value)
        await db.flush()
        return existing

    report = BusinessReportDaily(product_id=product_id, **data.model_dump())
    db.add(report)
    await db.flush()
    return report


async def bulk_upsert_reports(
    db: AsyncSession, product_id: uuid.UUID, reports: list[BusinessReportCreate]
) -> list[BusinessReportDaily]:
    results = []
    for report_data in reports:
        result = await upsert_report(db, product_id, report_data)
        results.append(result)
    return results
