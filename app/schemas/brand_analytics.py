from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class SearchTermReportCreate(BaseModel):
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    search_term: str
    search_frequency_rank: int | None = None
    asin_1: str | None = None
    asin_1_click_share: float | None = None
    asin_1_conversion_share: float | None = None
    asin_2: str | None = None
    asin_2_click_share: float | None = None
    asin_2_conversion_share: float | None = None
    asin_3: str | None = None
    asin_3_click_share: float | None = None
    asin_3_conversion_share: float | None = None


class SearchTermReportRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    search_term: str
    search_frequency_rank: int | None = None
    asin_1: str | None = None
    asin_1_click_share: float | None = None
    asin_1_conversion_share: float | None = None
    asin_2: str | None = None
    asin_2_click_share: float | None = None
    asin_2_conversion_share: float | None = None
    asin_3: str | None = None
    asin_3_click_share: float | None = None
    asin_3_conversion_share: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MarketBasketCreate(BaseModel):
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    purchased_with_asin: str
    purchased_with_title: str | None = None
    combination_percentage: float | None = None


class MarketBasketRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    purchased_with_asin: str
    purchased_with_title: str | None = None
    combination_percentage: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RepeatPurchaseCreate(BaseModel):
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    orders: int | None = None
    unique_customers: int | None = None
    repeat_customer_count: int | None = None
    repeat_customer_pct: float | None = None
    repeat_purchase_revenue: float | None = None
    currency: str | None = None


class RepeatPurchaseRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    orders: int | None = None
    unique_customers: int | None = None
    repeat_customer_count: int | None = None
    repeat_customer_pct: float | None = None
    repeat_purchase_revenue: float | None = None
    currency: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class DemographicsCreate(BaseModel):
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    age_range: str | None = None
    gender: str | None = None
    household_income: str | None = None
    education: str | None = None
    marital_status: str | None = None
    order_count: int | None = None
    ordered_units: int | None = None


class DemographicsRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    report_date_start: date
    report_date_end: date
    asin: str
    age_range: str | None = None
    gender: str | None = None
    household_income: str | None = None
    education: str | None = None
    marital_status: str | None = None
    order_count: int | None = None
    ordered_units: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
