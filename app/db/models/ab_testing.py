import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ABTest(TimestampMixin, Base):
    __tablename__ = "ab_tests"
    __table_args__ = (
        Index("ix_ab_tests_product_status", "product_id", "status"),
        Index("ix_ab_tests_seller_status", "seller_account_id", "status"),
    )

    seller_account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    test_name: Mapped[str] = mapped_column(String(255), nullable=False)
    change_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    hypothesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    baseline_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    variant_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    baseline_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    baseline_period_end: Mapped[date] = mapped_column(Date, nullable=False)
    test_period_start: Mapped[date] = mapped_column(Date, nullable=False)
    test_period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    minimum_sample_size: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    confidence_level: Mapped[float] = mapped_column(Numeric(4, 3), default=0.95, nullable=False)
    primary_metric: Mapped[str] = mapped_column(String(50), nullable=False)
    secondary_metrics: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    stat_method: Mapped[str] = mapped_column(String(20), default="ttest", nullable=False)
    change_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    metric_snapshots: Mapped[list["ABTestMetricSnapshot"]] = relationship(back_populates="ab_test")
    result: Mapped["ABTestResult | None"] = relationship(back_populates="ab_test", uselist=False)


class ABTestMetricSnapshot(Base):
    __tablename__ = "ab_test_metric_snapshots"
    __table_args__ = (UniqueConstraint("ab_test_id", "snapshot_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ab_test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_type: Mapped[str] = mapped_column(String(10), nullable=False)
    sessions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    units_ordered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ordered_product_sales: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    unit_session_percentage: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    buy_box_percentage: Mapped[float | None] = mapped_column(Numeric(8, 6), nullable=True)
    avg_rating: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    organic_rank_avg: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    ad_spend: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    ad_sales: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    refund_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    refund_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ab_test: Mapped["ABTest"] = relationship(back_populates="metric_snapshots")


class ABTestResult(Base):
    __tablename__ = "ab_test_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ab_test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    stat_method_used: Mapped[str | None] = mapped_column(String(20), nullable=True)
    baseline_mean: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    variant_mean: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    baseline_std: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    variant_std: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    baseline_sample_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    variant_sample_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    absolute_difference: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    relative_difference_pct: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    p_value: Mapped[float | None] = mapped_column(Numeric(10, 8), nullable=True)
    t_statistic: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    chi_squared_statistic: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    bayesian_probability_b_better: Mapped[float | None] = mapped_column(Numeric(10, 8), nullable=True)
    bayesian_expected_loss: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    confidence_interval_lower: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    confidence_interval_upper: Mapped[float | None] = mapped_column(Numeric(14, 6), nullable=True)
    is_significant: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(String(20), nullable=True)
    recommendation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    secondary_metric_results: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ab_test: Mapped["ABTest"] = relationship(back_populates="result")
