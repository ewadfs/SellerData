from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class FBAInventoryCreate(BaseModel):
    snapshot_date: date
    fulfillable_quantity: int = 0
    inbound_working: int = 0
    inbound_shipped: int = 0
    inbound_receiving: int = 0
    reserved_quantity: int = 0
    reserved_fc_transfer: int = 0
    reserved_fc_processing: int = 0
    reserved_customer_order: int = 0
    unfulfillable_quantity: int = 0
    researching_quantity: int = 0
    total_quantity: int = 0
    days_of_supply: int | None = None


class FBAInventoryRead(BaseModel):
    id: UUID
    product_id: UUID
    snapshot_date: date
    fulfillable_quantity: int
    inbound_working: int
    inbound_shipped: int
    inbound_receiving: int
    reserved_quantity: int
    reserved_fc_transfer: int
    reserved_fc_processing: int
    reserved_customer_order: int
    unfulfillable_quantity: int
    researching_quantity: int
    total_quantity: int
    days_of_supply: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class StrandedInventoryCreate(BaseModel):
    snapshot_date: date
    stranded_quantity: int | None = None
    stranded_reason: str | None = None
    date_stranded: date | None = None


class StrandedInventoryRead(BaseModel):
    id: UUID
    product_id: UUID
    snapshot_date: date
    stranded_quantity: int | None = None
    stranded_reason: str | None = None
    date_stranded: date | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AgedInventoryCreate(BaseModel):
    snapshot_date: date
    qty_0_90_days: int = 0
    qty_91_180_days: int = 0
    qty_181_270_days: int = 0
    qty_271_365_days: int = 0
    qty_365_plus_days: int = 0
    estimated_ltsf_fee: float | None = None
    currency: str | None = None


class AgedInventoryRead(BaseModel):
    id: UUID
    product_id: UUID
    snapshot_date: date
    qty_0_90_days: int
    qty_91_180_days: int
    qty_181_270_days: int
    qty_271_365_days: int
    qty_365_plus_days: int
    estimated_ltsf_fee: float | None = None
    currency: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RestockRecommendationCreate(BaseModel):
    snapshot_date: date
    recommended_ship_date: date | None = None
    recommended_quantity: int | None = None
    avg_daily_units_sold_last_30: float | None = None
    avg_daily_units_sold_last_60: float | None = None
    avg_daily_units_sold_last_90: float | None = None
    days_until_stockout: int | None = None
    alert_level: str | None = None


class RestockRecommendationRead(BaseModel):
    id: UUID
    product_id: UUID
    snapshot_date: date
    recommended_ship_date: date | None = None
    recommended_quantity: int | None = None
    avg_daily_units_sold_last_30: float | None = None
    avg_daily_units_sold_last_60: float | None = None
    avg_daily_units_sold_last_90: float | None = None
    days_until_stockout: int | None = None
    alert_level: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
