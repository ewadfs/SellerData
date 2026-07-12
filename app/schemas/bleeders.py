from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class BleedersConfig(BaseModel):
    """Thresholds for the GNO Bleeders process (Bleeders 1.0 + 2.0 SOPs).

    - B1 (Bleeders 1.0): targets/search terms with 10+ clicks and zero sales in the last 60 days.
    - B2 (Bleeders 2.0): targets/search terms with 1-4 orders in the last 30 days whose ACOS exceeds
      the target ACOS by 20 points (SP) or 10 points (SB/SBV/SD).
    - Campaigns with ACOS over 100% in the last 30 days are flagged for pause (ranking campaigns exempt).
    """

    target_acos: float = Field(30.0, gt=0, description="Target/break-even ACOS in percent")
    sp_acos_uplift: float = Field(20.0, ge=0, description="Points added to target ACOS for SP thresholds")
    sb_sd_acos_uplift: float = Field(10.0, ge=0, description="Points added to target ACOS for SB/SD thresholds")
    b1_clicks_threshold: int = Field(10, ge=1)
    b1_window_days: int = Field(60, ge=1)
    b2_window_days: int = Field(30, ge=1)
    b2_min_orders: int = Field(1, ge=1)
    b2_max_orders: int = Field(5, ge=1, description="Exclusive upper bound (fewer than 5 orders)")
    campaign_acos_threshold: float = Field(100.0, gt=0)
    campaign_window_days: int = Field(30, ge=1)
    exclude_ranking_campaigns: bool = True
    ranking_name_patterns: list[str] = Field(default_factory=lambda: ["RANK"])


class BleederRow(BaseModel):
    campaign_type: str
    portfolio: str | None = None
    campaign: str
    campaign_id: UUID
    ad_group: str | None = None
    target: str | None = None
    search_term: str | None = None
    match_type: str | None = None
    level: str
    impressions: int
    clicks: int
    spend: float
    ctr: float | None = None
    cpc: float | None = None
    sales: float
    orders: int
    cvr: float | None = None
    acos: float | None = None
    roas: float | None = None
    reason: str
    reason_category: str
    recommended_action: str
    source: str
    currency: str
    amazon_search_url: str | None = None


class BleedersSummary(BaseModel):
    total_rows: int
    b1_targets: int
    b1_search_terms: int
    b2_targets: int
    b2_search_terms: int
    campaigns_over_threshold: int
    flagged_target_spend: float
    flagged_search_term_spend: float
    flagged_campaign_spend: float


class BleedersMarketplaceReport(BaseModel):
    marketplace_id: UUID
    marketplace_code: str
    marketplace_name: str
    currency: str
    report_date: date
    b1_window_start: date
    b1_window_end: date
    b2_window_start: date
    b2_window_end: date
    summary: BleedersSummary
    rows: list[BleederRow]


class BleedersReportBundle(BaseModel):
    seller_id: UUID
    report_date: date
    config: BleedersConfig
    reports: list[BleedersMarketplaceReport]
