from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class OrderLineItemCreate(BaseModel):
    asin: str
    sku: str | None = None
    product_id: UUID | None = None
    quantity: int
    item_price: float | None = None
    item_tax: float | None = None
    shipping_price: float | None = None
    shipping_tax: float | None = None
    promotion_discount: float = 0
    currency: str | None = None


class OrderCreate(BaseModel):
    marketplace_id: UUID
    amazon_order_id: str
    purchase_date: datetime
    order_status: str
    fulfillment_channel: str
    order_total: float | None = None
    currency: str | None = None
    ship_city: str | None = None
    ship_state: str | None = None
    ship_postal_code: str | None = None
    ship_country: str | None = None
    is_business_order: bool = False
    is_prime: bool = False
    line_items: list[OrderLineItemCreate] = []


class OrderLineItemRead(BaseModel):
    id: UUID
    order_id: UUID
    product_id: UUID | None = None
    asin: str
    sku: str | None = None
    quantity: int
    item_price: float | None = None
    item_tax: float | None = None
    shipping_price: float | None = None
    shipping_tax: float | None = None
    promotion_discount: float
    currency: str | None = None

    model_config = {"from_attributes": True}


class OrderRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    amazon_order_id: str
    purchase_date: datetime
    order_status: str
    fulfillment_channel: str
    order_total: float | None = None
    currency: str | None = None
    ship_country: str | None = None
    is_business_order: bool
    is_prime: bool
    created_at: datetime
    line_items: list[OrderLineItemRead] = []

    model_config = {"from_attributes": True}


class RefundCreate(BaseModel):
    order_line_item_id: UUID
    refund_date: datetime
    quantity_refunded: int
    refund_amount: float
    currency: str | None = None
    reason: str | None = None


class RefundRead(BaseModel):
    id: UUID
    order_line_item_id: UUID
    refund_date: datetime
    quantity_refunded: int
    refund_amount: float
    currency: str | None = None
    reason: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SalesSummary(BaseModel):
    total_orders: int
    total_units: int
    total_revenue: float
    total_refunds: float
    currency: str | None = None
