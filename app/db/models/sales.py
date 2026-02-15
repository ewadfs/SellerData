import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_marketplace_purchase_date", "marketplace_id", "purchase_date"),
        Index("ix_orders_seller_purchase_date", "seller_account_id", "purchase_date"),
    )

    seller_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seller_accounts.id"), nullable=False
    )
    marketplace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("marketplaces.id"), nullable=False
    )
    amazon_order_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    purchase_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    order_status: Mapped[str] = mapped_column(String(20), nullable=False)
    fulfillment_channel: Mapped[str] = mapped_column(String(5), nullable=False)
    order_total: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    ship_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ship_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ship_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ship_country: Mapped[str | None] = mapped_column(String(5), nullable=True)
    is_business_order: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_prime: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    line_items: Mapped[list["OrderLineItem"]] = relationship(back_populates="order")


class OrderLineItem(Base):
    __tablename__ = "order_line_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id"), nullable=True
    )
    asin: Mapped[str] = mapped_column(String(20), nullable=False)
    sku: Mapped[str | None] = mapped_column(String(50), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    item_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    item_tax: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    shipping_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    shipping_tax: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    promotion_discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    order: Mapped["Order"] = relationship(back_populates="line_items")
    refunds: Mapped[list["Refund"]] = relationship(back_populates="line_item")


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_line_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order_line_items.id"), nullable=False
    )
    refund_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    quantity_refunded: Mapped[int] = mapped_column(Integer, nullable=False)
    refund_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    line_item: Mapped["OrderLineItem"] = relationship(back_populates="refunds")
