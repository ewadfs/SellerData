import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AccountHealthMetric(Base):
    __tablename__ = "account_health_metrics"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    seller_account_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    marketplace_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    order_defect_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    late_shipment_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    pre_fulfillment_cancel_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    valid_tracking_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    on_time_delivery_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    customer_service_dissatisfaction_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    return_dissatisfaction_rate: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    policy_violations_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    intellectual_property_complaints: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    product_authenticity_complaints: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    listing_policy_violations: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    account_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
