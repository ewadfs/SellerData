from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class ABTestCreate(BaseModel):
    product_id: UUID
    test_name: str
    change_type: str
    hypothesis: str | None = None
    baseline_period_start: date
    baseline_period_end: date
    test_period_start: date
    test_period_end: date | None = None
    minimum_sample_size: int = 100
    confidence_level: float = 0.95
    primary_metric: str = "unit_session_percentage"
    secondary_metrics: list[str] | None = None
    stat_method: str = "ttest"
    change_description: str | None = None
    change_details: dict | None = None


class ABTestUpdate(BaseModel):
    status: str | None = None
    test_period_end: date | None = None
    hypothesis: str | None = None


class ABTestRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    product_id: UUID
    test_name: str
    change_type: str
    status: str
    hypothesis: str | None = None
    baseline_period_start: date
    baseline_period_end: date
    test_period_start: date
    test_period_end: date | None = None
    minimum_sample_size: int
    confidence_level: float
    primary_metric: str
    secondary_metrics: list[str] | None = None
    stat_method: str
    change_description: str | None = None
    change_details: dict | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ABTestMetricSnapshotCreate(BaseModel):
    snapshot_date: date
    period_type: str
    sessions: int | None = None
    page_views: int | None = None
    units_ordered: int | None = None
    ordered_product_sales: float | None = None
    unit_session_percentage: float | None = None
    buy_box_percentage: float | None = None
    avg_rating: float | None = None
    review_count: int | None = None
    organic_rank_avg: float | None = None
    ad_spend: float | None = None
    ad_sales: float | None = None
    refund_count: int | None = None
    refund_amount: float | None = None
    currency: str | None = None


class ABTestMetricSnapshotRead(BaseModel):
    id: UUID
    ab_test_id: UUID
    snapshot_date: date
    period_type: str
    sessions: int | None = None
    page_views: int | None = None
    units_ordered: int | None = None
    ordered_product_sales: float | None = None
    unit_session_percentage: float | None = None
    buy_box_percentage: float | None = None
    avg_rating: float | None = None
    review_count: int | None = None
    organic_rank_avg: float | None = None
    ad_spend: float | None = None
    ad_sales: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ABTestResultRead(BaseModel):
    id: UUID
    ab_test_id: UUID
    computed_at: datetime
    stat_method_used: str | None = None
    baseline_mean: float | None = None
    variant_mean: float | None = None
    baseline_std: float | None = None
    variant_std: float | None = None
    baseline_sample_size: int | None = None
    variant_sample_size: int | None = None
    absolute_difference: float | None = None
    relative_difference_pct: float | None = None
    p_value: float | None = None
    t_statistic: float | None = None
    chi_squared_statistic: float | None = None
    bayesian_probability_b_better: float | None = None
    bayesian_expected_loss: float | None = None
    confidence_interval_lower: float | None = None
    confidence_interval_upper: float | None = None
    is_significant: bool | None = None
    recommendation: str | None = None
    recommendation_reason: str | None = None
    secondary_metric_results: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ABTestDetailRead(ABTestRead):
    result: ABTestResultRead | None = None
