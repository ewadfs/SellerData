from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class BusinessReportCreate(BaseModel):
    report_date: date
    sessions: int = 0
    session_percentage: float | None = None
    page_views: int = 0
    page_view_percentage: float | None = None
    buy_box_percentage: float | None = None
    units_ordered: int = 0
    units_ordered_b2b: int = 0
    unit_session_percentage: float | None = None
    unit_session_percentage_b2b: float | None = None
    ordered_product_sales: float = 0
    ordered_product_sales_b2b: float = 0
    currency: str | None = None
    total_order_items: int = 0


class SellerBusinessReportCreate(BusinessReportCreate):
    """Create payload for the seller-scoped endpoint used by the dashboard.

    Unlike the product-scoped bulk endpoint (which takes ``product_id`` from the
    URL path), the dashboard sends ``product_id`` in the body. ``marketplace_id``
    is accepted for convenience but is derivable from the product and not stored.
    """

    product_id: UUID
    marketplace_id: UUID | None = None


class BusinessReportRead(BaseModel):
    id: UUID
    product_id: UUID
    report_date: date
    sessions: int
    session_percentage: float | None = None
    page_views: int
    page_view_percentage: float | None = None
    buy_box_percentage: float | None = None
    units_ordered: int
    units_ordered_b2b: int
    unit_session_percentage: float | None = None
    unit_session_percentage_b2b: float | None = None
    ordered_product_sales: float
    ordered_product_sales_b2b: float
    currency: str | None = None
    total_order_items: int
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerBusinessReportRead(BusinessReportRead):
    """Read model for the seller-scoped list endpoint.

    Includes the product ``asin`` so the dashboard table can display it.
    """

    asin: str | None = None
