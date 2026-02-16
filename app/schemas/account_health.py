from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class AccountHealthCreate(BaseModel):
    marketplace_id: UUID
    snapshot_date: date
    order_defect_rate: float | None = None
    late_shipment_rate: float | None = None
    pre_fulfillment_cancel_rate: float | None = None
    valid_tracking_rate: float | None = None
    on_time_delivery_rate: float | None = None
    customer_service_dissatisfaction_rate: float | None = None
    return_dissatisfaction_rate: float | None = None
    policy_violations_count: int = 0
    intellectual_property_complaints: int = 0
    product_authenticity_complaints: int = 0
    listing_policy_violations: int = 0
    account_status: str | None = None


class AccountHealthRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    snapshot_date: date
    order_defect_rate: float | None = None
    late_shipment_rate: float | None = None
    pre_fulfillment_cancel_rate: float | None = None
    valid_tracking_rate: float | None = None
    on_time_delivery_rate: float | None = None
    customer_service_dissatisfaction_rate: float | None = None
    return_dissatisfaction_rate: float | None = None
    policy_violations_count: int
    intellectual_property_complaints: int
    product_authenticity_complaints: int
    listing_policy_violations: int
    account_status: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
