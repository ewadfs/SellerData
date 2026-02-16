import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("seller_account_id", "marketplace_id", "sku"),
        Index("ix_products_marketplace_asin", "marketplace_id", "asin"),
    )

    seller_account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("seller_accounts.id"), nullable=False
    )
    marketplace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("marketplaces.id"), nullable=False
    )
    asin: Mapped[str] = mapped_column(String(20), nullable=False)
    sku: Mapped[str] = mapped_column(String(50), nullable=False)
    fnsku: Mapped[str | None] = mapped_column(String(50), nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subcategory: Mapped[str | None] = mapped_column(String(255), nullable=True)
    parent_asin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    seller_account: Mapped["SellerAccount"] = relationship(back_populates="products")  # noqa: F821
    snapshots: Mapped[list["ProductSnapshot"]] = relationship(back_populates="product")


class ProductSnapshot(Base):
    __tablename__ = "product_snapshots"
    __table_args__ = (Index("ix_product_snapshots_product_date", "product_id", "snapshot_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("products.id"), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    bullet_points: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    main_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    other_image_urls: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    has_a_plus: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    a_plus_content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    backend_keywords: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[float | None] = mapped_column(Numeric(2, 1), nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_seller_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bsr_category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    buy_box_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    buy_box_owner: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    product: Mapped["Product"] = relationship(back_populates="snapshots")
