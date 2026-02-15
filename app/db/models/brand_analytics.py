import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SearchTermReport(Base):
    __tablename__ = "search_term_reports"
    __table_args__ = (
        Index("ix_search_term_reports_marketplace_term", "marketplace_id", "search_term"),
        Index("ix_search_term_reports_date", "report_date_start"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    report_date_start: Mapped[date] = mapped_column(Date, nullable=False)
    report_date_end: Mapped[date] = mapped_column(Date, nullable=False)
    search_term: Mapped[str] = mapped_column(String(500), nullable=False)
    search_frequency_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    asin_1: Mapped[str | None] = mapped_column(String(20), nullable=True)
    asin_1_click_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    asin_1_conversion_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    asin_2: Mapped[str | None] = mapped_column(String(20), nullable=True)
    asin_2_click_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    asin_2_conversion_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    asin_3: Mapped[str | None] = mapped_column(String(20), nullable=True)
    asin_3_click_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    asin_3_conversion_share: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MarketBasketReport(Base):
    __tablename__ = "market_basket_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    report_date_start: Mapped[date] = mapped_column(Date, nullable=False)
    report_date_end: Mapped[date] = mapped_column(Date, nullable=False)
    asin: Mapped[str] = mapped_column(String(20), nullable=False)
    purchased_with_asin: Mapped[str] = mapped_column(String(20), nullable=False)
    purchased_with_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    combination_percentage: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RepeatPurchaseReport(Base):
    __tablename__ = "repeat_purchase_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    report_date_start: Mapped[date] = mapped_column(Date, nullable=False)
    report_date_end: Mapped[date] = mapped_column(Date, nullable=False)
    asin: Mapped[str] = mapped_column(String(20), nullable=False)
    orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unique_customers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_customer_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_customer_pct: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    repeat_purchase_revenue: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DemographicsReport(Base):
    __tablename__ = "demographics_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    report_date_start: Mapped[date] = mapped_column(Date, nullable=False)
    report_date_end: Mapped[date] = mapped_column(Date, nullable=False)
    asin: Mapped[str] = mapped_column(String(20), nullable=False)
    age_range: Mapped[str | None] = mapped_column(String(20), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    household_income: Mapped[str | None] = mapped_column(String(50), nullable=True)
    education: Mapped[str | None] = mapped_column(String(50), nullable=True)
    marital_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    order_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ordered_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
