from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class AdCampaignCreate(BaseModel):
    marketplace_id: UUID
    amazon_campaign_id: str | None = None
    campaign_name: str
    campaign_type: str
    targeting_type: str | None = None
    portfolio_name: str | None = None
    is_ranking: bool = False
    state: str = "enabled"
    daily_budget: float | None = None
    currency: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class AdCampaignRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    amazon_campaign_id: str | None = None
    campaign_name: str
    campaign_type: str
    targeting_type: str | None = None
    portfolio_name: str | None = None
    is_ranking: bool = False
    state: str
    daily_budget: float | None = None
    currency: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AdMetricsDailyCreate(BaseModel):
    campaign_id: UUID
    ad_group_id: UUID | None = None
    product_id: UUID | None = None
    keyword_target_id: UUID | None = None
    report_date: date
    impressions: int = 0
    clicks: int = 0
    spend: float = 0
    sales_1d: float | None = None
    sales_7d: float | None = None
    sales_14d: float | None = None
    sales_30d: float | None = None
    orders_7d: int = 0
    orders_14d: int = 0
    units_7d: int = 0
    units_14d: int = 0
    acos_7d: float | None = None
    currency: str | None = None


class AdMetricsDailyRead(BaseModel):
    id: UUID
    campaign_id: UUID
    ad_group_id: UUID | None = None
    product_id: UUID | None = None
    keyword_target_id: UUID | None = None
    report_date: date
    impressions: int
    clicks: int
    spend: float
    sales_7d: float | None = None
    sales_14d: float | None = None
    orders_7d: int
    orders_14d: int
    acos_7d: float | None = None
    currency: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdSearchTermMetricsCreate(BaseModel):
    campaign_id: UUID
    ad_group_id: UUID | None = None
    keyword_target_id: UUID | None = None
    product_target_id: UUID | None = None
    target_text: str | None = None
    search_term: str
    match_type: str | None = None
    report_date: date
    impressions: int = 0
    clicks: int = 0
    spend: float = 0
    sales: float = 0
    orders: int = 0
    currency: str | None = None


class AdSearchTermMetricsRead(BaseModel):
    id: UUID
    campaign_id: UUID
    ad_group_id: UUID | None = None
    keyword_target_id: UUID | None = None
    product_target_id: UUID | None = None
    target_text: str | None = None
    search_term: str
    match_type: str | None = None
    report_date: date
    impressions: int
    clicks: int
    spend: float
    sales: float
    orders: int
    currency: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdvertisingSummary(BaseModel):
    total_spend: float
    total_sales_14d: float
    total_impressions: int
    total_clicks: int
    avg_acos: float | None = None
    tacos: float | None = None
    currency: str | None = None
