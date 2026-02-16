import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.sales import Order, OrderLineItem, Refund
from app.schemas.sales import OrderCreate, RefundCreate, SalesSummary


async def list_orders(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[Order]:
    stmt = select(Order).where(Order.seller_account_id == seller_id)
    if marketplace_id:
        stmt = stmt.where(Order.marketplace_id == marketplace_id)
    if start_date:
        stmt = stmt.where(Order.purchase_date >= start_date)
    if end_date:
        stmt = stmt.where(Order.purchase_date <= end_date)
    if status:
        stmt = stmt.where(Order.order_status == status)
    stmt = stmt.options(selectinload(Order.line_items)).order_by(Order.purchase_date.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().unique().all())


async def get_order(db: AsyncSession, order_id: uuid.UUID) -> Order | None:
    stmt = select(Order).where(Order.id == order_id).options(selectinload(Order.line_items))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_order(db: AsyncSession, seller_id: uuid.UUID, data: OrderCreate) -> Order:
    order_data = data.model_dump(exclude={"line_items"})
    order = Order(seller_account_id=seller_id, **order_data)
    db.add(order)
    await db.flush()

    for li_data in data.line_items:
        line_item = OrderLineItem(order_id=order.id, **li_data.model_dump())
        db.add(line_item)

    await db.flush()

    # Reload with line_items eagerly loaded for serialization
    stmt = select(Order).where(Order.id == order.id).options(selectinload(Order.line_items))
    result = await db.execute(stmt)
    return result.scalar_one()


async def create_refund(db: AsyncSession, data: RefundCreate) -> Refund:
    refund = Refund(**data.model_dump())
    db.add(refund)
    await db.flush()
    return refund


async def get_sales_summary(
    db: AsyncSession,
    seller_id: uuid.UUID,
    marketplace_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> SalesSummary:
    order_filter = [Order.seller_account_id == seller_id]
    if marketplace_id:
        order_filter.append(Order.marketplace_id == marketplace_id)
    if start_date:
        order_filter.append(Order.purchase_date >= start_date)
    if end_date:
        order_filter.append(Order.purchase_date <= end_date)

    # Total orders and revenue
    order_stmt = select(
        func.count(Order.id).label("total_orders"),
        func.coalesce(func.sum(Order.order_total), 0).label("total_revenue"),
    ).where(*order_filter)
    order_result = await db.execute(order_stmt)
    order_row = order_result.one()

    # Total units
    units_stmt = (
        select(func.coalesce(func.sum(OrderLineItem.quantity), 0))
        .join(Order, OrderLineItem.order_id == Order.id)
        .where(*order_filter)
    )
    units_result = await db.execute(units_stmt)
    total_units = units_result.scalar() or 0

    # Total refunds
    refund_stmt = (
        select(func.coalesce(func.sum(Refund.refund_amount), 0))
        .join(OrderLineItem, Refund.order_line_item_id == OrderLineItem.id)
        .join(Order, OrderLineItem.order_id == Order.id)
        .where(*order_filter)
    )
    refund_result = await db.execute(refund_stmt)
    total_refunds = refund_result.scalar() or 0

    return SalesSummary(
        total_orders=order_row.total_orders,
        total_units=total_units,
        total_revenue=float(order_row.total_revenue),
        total_refunds=float(total_refunds),
    )
