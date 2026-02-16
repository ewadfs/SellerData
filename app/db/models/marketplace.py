import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Marketplace(TimestampMixin, Base):
    __tablename__ = "marketplaces"

    code: Mapped[str] = mapped_column(String(5), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    domain: Mapped[str] = mapped_column(String(100), nullable=False)
    region: Mapped[str] = mapped_column(String(20), nullable=False)
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amazon_marketplace_id: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    seller_links: Mapped[list["SellerMarketplaceLink"]] = relationship(back_populates="marketplace")


class SellerAccount(TimestampMixin, Base):
    __tablename__ = "seller_accounts"

    seller_name: Mapped[str] = mapped_column(String(255), nullable=False)
    amazon_seller_id: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    amazon_mws_auth_token: Mapped[str | None] = mapped_column(String, nullable=True)
    sp_api_refresh_token: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    marketplace_links: Mapped[list["SellerMarketplaceLink"]] = relationship(back_populates="seller_account")
    products: Mapped[list["Product"]] = relationship(back_populates="seller_account")  # noqa: F821


class SellerMarketplaceLink(Base):
    __tablename__ = "seller_marketplace_links"
    __table_args__ = (UniqueConstraint("seller_account_id", "marketplace_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seller_accounts.id"), nullable=False
    )
    marketplace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("marketplaces.id"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    seller_account: Mapped["SellerAccount"] = relationship(back_populates="marketplace_links")
    marketplace: Mapped["Marketplace"] = relationship(back_populates="seller_links")
