import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class AdCampaign(TimestampMixin, Base):
    __tablename__ = "ad_campaigns"

    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    amazon_campaign_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    campaign_name: Mapped[str] = mapped_column(String(500), nullable=False)
    campaign_type: Mapped[str] = mapped_column(String(20), nullable=False)
    targeting_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    daily_budget: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    ad_groups: Mapped[list["AdGroup"]] = relationship(back_populates="campaign")


class AdGroup(Base):
    __tablename__ = "ad_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    amazon_ad_group_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ad_group_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    default_bid: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    campaign: Mapped["AdCampaign"] = relationship(back_populates="ad_groups")
    keyword_targets: Mapped[list["AdKeywordTarget"]] = relationship(back_populates="ad_group")
    product_targets: Mapped[list["AdProductTarget"]] = relationship(back_populates="ad_group")


class AdKeywordTarget(Base):
    __tablename__ = "ad_keyword_targets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ad_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    keyword_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    match_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bid: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ad_group: Mapped["AdGroup"] = relationship(back_populates="keyword_targets")


class AdProductTarget(Base):
    __tablename__ = "ad_product_targets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ad_group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    target_asin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bid: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    state: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ad_group: Mapped["AdGroup"] = relationship(back_populates="product_targets")


class AdMetricsDaily(Base):
    __tablename__ = "ad_metrics_daily"
    __table_args__ = (
        Index("ix_ad_metrics_daily_campaign_date", "campaign_id", "report_date"),
        Index("ix_ad_metrics_daily_date", "report_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    ad_group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    keyword_target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    impressions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clicks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    spend: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    sales_1d: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    sales_7d: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    sales_14d: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    sales_30d: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    orders_7d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    orders_14d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    units_7d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    units_14d: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    acos_7d: Mapped[float | None] = mapped_column(Numeric(8, 4), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
