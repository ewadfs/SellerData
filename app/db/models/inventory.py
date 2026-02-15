import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FBAInventory(Base):
    __tablename__ = "fba_inventory"
    __table_args__ = (UniqueConstraint("product_id", "snapshot_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    fulfillable_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inbound_working: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inbound_shipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inbound_receiving: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_fc_transfer: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_fc_processing: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_customer_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unfulfillable_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    researching_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    days_of_supply: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class StrandedInventory(Base):
    __tablename__ = "stranded_inventory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    stranded_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stranded_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_stranded: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AgedInventory(Base):
    __tablename__ = "aged_inventory"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    qty_0_90_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_91_180_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_181_270_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_271_365_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_365_plus_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    estimated_ltsf_fee: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RestockRecommendation(Base):
    __tablename__ = "restock_recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    recommended_ship_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recommended_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_daily_units_sold_last_30: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    avg_daily_units_sold_last_60: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    avg_daily_units_sold_last_90: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    days_until_stockout: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alert_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
