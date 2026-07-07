import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.business_report import BusinessReportDaily
from app.db.models.product import Product
from app.schemas.business_report import BusinessReportCreate, SellerBusinessReportCreate


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


async def list_reports_for_seller(
    db: AsyncSession,
    seller_id: uuid.UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[dict]:
    """List business reports across all of a seller's products, including the ASIN."""
    stmt = (
        select(BusinessReportDaily, Product.asin)
        .join(Product, Product.id == BusinessReportDaily.product_id)
        .where(Product.seller_account_id == seller_id)
    )
    if start_date:
        stmt = stmt.where(BusinessReportDaily.report_date >= start_date)
    if end_date:
        stmt = stmt.where(BusinessReportDaily.report_date <= end_date)
    stmt = stmt.order_by(BusinessReportDaily.report_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    reports = []
    for report, asin in result.all():
        data = {c.name: getattr(report, c.name) for c in report.__table__.columns}
        data["asin"] = asin
        reports.append(data)
    return reports


async def create_report_for_seller(
    db: AsyncSession, seller_id: uuid.UUID, data: SellerBusinessReportCreate
) -> dict | None:
    """Create/update a single report from the seller-scoped dashboard payload.

    Returns ``None`` if the product does not exist or does not belong to the seller.
    """
    product = await db.get(Product, data.product_id)
    if product is None or product.seller_account_id != seller_id:
        return None

    report_data = BusinessReportCreate(
        **data.model_dump(exclude={"product_id", "marketplace_id"})
    )
    report = await upsert_report(db, data.product_id, report_data)
    result = {c.name: getattr(report, c.name) for c in report.__table__.columns}
    result["asin"] = product.asin
    return result
