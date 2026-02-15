import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BusinessReportDaily(Base):
    __tablename__ = "business_report_daily"
    __table_args__ = (
        UniqueConstraint("product_id", "report_date"),
        Index("ix_business_report_daily_date", "report_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)
    sessions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    session_percentage: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    page_views: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    page_view_percentage: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    buy_box_percentage: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    units_ordered: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    units_ordered_b2b: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unit_session_percentage: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    unit_session_percentage_b2b: Mapped[float | None] = mapped_column(Numeric(6, 4), nullable=True)
    ordered_product_sales: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    ordered_product_sales_b2b: Mapped[float] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    total_order_items: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
