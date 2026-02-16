import uuid
from datetime import date, datetime, timezone

import math

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.ab_testing import ABTest, ABTestMetricSnapshot, ABTestResult
from app.schemas.ab_testing import ABTestCreate, ABTestMetricSnapshotCreate, ABTestUpdate
from app.services.ab_testing.recommender import Recommender
from app.services.ab_testing.statistics import StatisticalCalculator
from app.utils.enums import ABTestStatus, StatMethod


class ABTestEngine:
    """Orchestrator for A/B test lifecycle and analysis."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.stats = StatisticalCalculator()
        self.recommender = Recommender()

    async def list_tests(
        self,
        seller_id: uuid.UUID,
        product_id: uuid.UUID | None = None,
        status: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[ABTest]:
        stmt = select(ABTest).where(ABTest.seller_account_id == seller_id)
        if product_id:
            stmt = stmt.where(ABTest.product_id == product_id)
        if status:
            stmt = stmt.where(ABTest.status == status)
        stmt = stmt.order_by(ABTest.created_at.desc()).offset(offset).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def create_test(self, seller_id: uuid.UUID, data: ABTestCreate) -> ABTest:
        test = ABTest(
            seller_account_id=seller_id,
            status=ABTestStatus.DRAFT.value,
            **data.model_dump(),
        )
        self.db.add(test)
        await self.db.flush()
        await self.db.refresh(test)
        return test

    async def get_test(self, test_id: uuid.UUID) -> ABTest | None:
        stmt = (
            select(ABTest)
            .where(ABTest.id == test_id)
            .options(selectinload(ABTest.result))
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def update_test(self, test_id: uuid.UUID, data: ABTestUpdate) -> ABTest | None:
        test = await self.db.get(ABTest, test_id)
        if test is None:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(test, field, value)
        await self.db.flush()
        await self.db.refresh(test)
        return test

    async def start_test(self, test_id: uuid.UUID) -> ABTest:
        test = await self.db.get(ABTest, test_id)
        if test is None:
            raise ValueError("Test not found")
        if test.status != ABTestStatus.DRAFT.value:
            raise ValueError(f"Test must be in draft status to start, current status: {test.status}")
        test.status = ABTestStatus.RUNNING.value
        test.test_period_start = date.today()
        await self.db.flush()
        await self.db.refresh(test)
        return test

    async def complete_test(self, test_id: uuid.UUID) -> ABTest:
        test = await self.db.get(ABTest, test_id)
        if test is None:
            raise ValueError("Test not found")
        if test.status != ABTestStatus.RUNNING.value:
            raise ValueError(f"Test must be running to complete, current status: {test.status}")

        test.status = ABTestStatus.COMPLETED.value
        test.test_period_end = date.today()
        await self.db.flush()

        await self._compute_results(test)

        # Reload with result
        stmt = select(ABTest).where(ABTest.id == test_id).options(selectinload(ABTest.result))
        result = await self.db.execute(stmt)
        return result.scalar_one()

    async def add_metric_snapshot(
        self, test_id: uuid.UUID, data: ABTestMetricSnapshotCreate
    ) -> ABTestMetricSnapshot:
        snapshot = ABTestMetricSnapshot(ab_test_id=test_id, **data.model_dump())
        self.db.add(snapshot)
        await self.db.flush()
        return snapshot

    async def list_metric_snapshots(self, test_id: uuid.UUID) -> list[ABTestMetricSnapshot]:
        stmt = (
            select(ABTestMetricSnapshot)
            .where(ABTestMetricSnapshot.ab_test_id == test_id)
            .order_by(ABTestMetricSnapshot.snapshot_date)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_result(self, test_id: uuid.UUID) -> ABTestResult | None:
        stmt = select(ABTestResult).where(ABTestResult.ab_test_id == test_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def _compute_results(self, test: ABTest) -> ABTestResult:
        """Run statistical analysis on collected metric snapshots."""
        snapshots = await self.list_metric_snapshots(test.id)

        baseline_data = [s for s in snapshots if s.period_type == "baseline"]
        variant_data = [s for s in snapshots if s.period_type == "test"]

        # Extract primary metric values
        baseline_values = self._extract_metric(baseline_data, test.primary_metric)
        variant_values = self._extract_metric(variant_data, test.primary_metric)

        confidence_level = float(test.confidence_level)
        stat_method = test.stat_method

        # Initialize result fields
        result_data = {
            "ab_test_id": test.id,
            "computed_at": datetime.now(timezone.utc),
            "stat_method_used": stat_method,
            "baseline_sample_size": len(baseline_values),
            "variant_sample_size": len(variant_values),
        }

        if len(baseline_values) < 2 or len(variant_values) < 2:
            result_data.update(
                is_significant=False,
                recommendation="extend_test",
                recommendation_reason="Insufficient data points for analysis. Need at least 2 data points per period.",
            )
        elif stat_method == StatMethod.TTEST.value:
            result_data = self._run_ttest(baseline_values, variant_values, confidence_level, test, result_data)
        elif stat_method == StatMethod.CHI_SQUARED.value:
            result_data = self._run_chi_squared(baseline_data, variant_data, confidence_level, test, result_data)
        elif stat_method == StatMethod.BAYESIAN.value:
            result_data = self._run_bayesian(baseline_values, variant_values, test, result_data)
        else:
            # Default to t-test
            result_data = self._run_ttest(baseline_values, variant_values, confidence_level, test, result_data)

        # Sanitize float values to avoid inf/nan
        float_fields = [
            "baseline_mean", "variant_mean", "baseline_std", "variant_std",
            "absolute_difference", "relative_difference_pct", "p_value",
            "t_statistic", "chi_squared_statistic", "bayesian_probability_b_better",
            "bayesian_expected_loss", "confidence_interval_lower", "confidence_interval_upper",
        ]
        for field in float_fields:
            if field in result_data:
                result_data[field] = self._sanitize_float(result_data[field])

        # Delete any existing result
        existing = await self.get_result(test.id)
        if existing:
            await self.db.delete(existing)
            await self.db.flush()

        ab_result = ABTestResult(**result_data)
        self.db.add(ab_result)
        await self.db.flush()
        return ab_result

    def _run_ttest(
        self, baseline_values, variant_values, confidence_level, test, result_data
    ) -> dict:
        b_arr = np.array(baseline_values)
        v_arr = np.array(variant_values)
        ttest_result = self.stats.welch_ttest(b_arr, v_arr, confidence_level)
        recommendation = self.recommender.decide_from_ttest(
            ttest_result, confidence_level, test.minimum_sample_size
        )

        result_data.update(
            baseline_mean=ttest_result.baseline_mean,
            variant_mean=ttest_result.variant_mean,
            baseline_std=ttest_result.baseline_std,
            variant_std=ttest_result.variant_std,
            t_statistic=ttest_result.t_statistic,
            p_value=ttest_result.p_value,
            absolute_difference=ttest_result.variant_mean - ttest_result.baseline_mean,
            relative_difference_pct=(
                (ttest_result.variant_mean - ttest_result.baseline_mean)
                / ttest_result.baseline_mean
                * 100
                if ttest_result.baseline_mean != 0
                else 0
            ),
            confidence_interval_lower=ttest_result.confidence_interval_lower,
            confidence_interval_upper=ttest_result.confidence_interval_upper,
            is_significant=ttest_result.is_significant,
            recommendation=recommendation.action,
            recommendation_reason=recommendation.reason,
        )
        return result_data

    def _run_chi_squared(
        self, baseline_data, variant_data, confidence_level, test, result_data
    ) -> dict:
        # For chi-squared, we need conversion counts
        b_sessions = sum(getattr(s, "sessions", 0) or 0 for s in baseline_data)
        b_orders = sum(getattr(s, "units_ordered", 0) or 0 for s in baseline_data)
        v_sessions = sum(getattr(s, "sessions", 0) or 0 for s in variant_data)
        v_orders = sum(getattr(s, "units_ordered", 0) or 0 for s in variant_data)

        if b_sessions == 0 or v_sessions == 0:
            result_data.update(
                is_significant=False,
                recommendation="extend_test",
                recommendation_reason="No session data available for chi-squared analysis.",
            )
            return result_data

        chi_result = self.stats.chi_squared_test(b_orders, b_sessions, v_orders, v_sessions, confidence_level)
        recommendation = self.recommender.decide_from_chi_squared(chi_result, confidence_level)

        result_data.update(
            baseline_mean=chi_result.baseline_rate,
            variant_mean=chi_result.variant_rate,
            chi_squared_statistic=chi_result.chi_squared_statistic,
            p_value=chi_result.p_value,
            relative_difference_pct=chi_result.relative_uplift_pct,
            is_significant=chi_result.is_significant,
            recommendation=recommendation.action,
            recommendation_reason=recommendation.reason,
        )
        return result_data

    def _run_bayesian(self, baseline_values, variant_values, test, result_data) -> dict:
        b_arr = np.array(baseline_values)
        v_arr = np.array(variant_values)
        bayes_result = self.stats.bayesian_ab_test(b_arr, v_arr)
        recommendation = self.recommender.decide_from_bayesian(bayes_result)

        result_data.update(
            baseline_mean=bayes_result.baseline_mean,
            variant_mean=bayes_result.variant_mean,
            bayesian_probability_b_better=bayes_result.probability_b_better,
            bayesian_expected_loss=bayes_result.expected_loss,
            confidence_interval_lower=bayes_result.credible_interval_lower,
            confidence_interval_upper=bayes_result.credible_interval_upper,
            is_significant=bayes_result.probability_b_better >= 0.95 or bayes_result.probability_b_better <= 0.05,
            recommendation=recommendation.action,
            recommendation_reason=recommendation.reason,
        )
        return result_data

    @staticmethod
    def _sanitize_float(value) -> float | None:
        """Convert inf/nan to None for JSON compatibility."""
        if value is None:
            return None
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f

    @staticmethod
    def _extract_metric(snapshots: list[ABTestMetricSnapshot], metric_name: str) -> list[float]:
        values = []
        for s in snapshots:
            val = getattr(s, metric_name, None)
            if val is not None:
                values.append(float(val))
        return values
