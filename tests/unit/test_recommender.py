"""Unit tests for the A/B test recommender decision engine."""

import pytest

from app.services.ab_testing.recommender import Recommender
from app.services.ab_testing.statistics import BayesianResult, ChiSquaredResult, TTestResult


@pytest.fixture
def recommender():
    return Recommender()


class TestTTestRecommendations:
    def test_keep_when_significant_improvement(self, recommender):
        result = TTestResult(
            baseline_mean=100.0, variant_mean=115.0,
            baseline_std=10.0, variant_std=10.0,
            baseline_n=200, variant_n=200,
            t_statistic=3.5, p_value=0.001,
            confidence_interval_lower=5.0, confidence_interval_upper=25.0,
            cohens_d=1.5, is_significant=True,
        )
        rec = recommender.decide_from_ttest(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "keep"

    def test_revert_when_significant_decline(self, recommender):
        result = TTestResult(
            baseline_mean=115.0, variant_mean=100.0,
            baseline_std=10.0, variant_std=10.0,
            baseline_n=200, variant_n=200,
            t_statistic=-3.5, p_value=0.001,
            confidence_interval_lower=-25.0, confidence_interval_upper=-5.0,
            cohens_d=-1.5, is_significant=True,
        )
        rec = recommender.decide_from_ttest(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "revert"

    def test_inconclusive_when_not_significant(self, recommender):
        result = TTestResult(
            baseline_mean=100.0, variant_mean=101.0,
            baseline_std=15.0, variant_std=15.0,
            baseline_n=200, variant_n=200,
            t_statistic=0.5, p_value=0.60,
            confidence_interval_lower=-3.0, confidence_interval_upper=5.0,
            cohens_d=0.07, is_significant=False,
        )
        rec = recommender.decide_from_ttest(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "inconclusive"

    def test_extend_when_insufficient_data(self, recommender):
        result = TTestResult(
            baseline_mean=100.0, variant_mean=120.0,
            baseline_std=10.0, variant_std=10.0,
            baseline_n=10, variant_n=10,  # Below min_sample_size
            t_statistic=3.5, p_value=0.001,
            confidence_interval_lower=5.0, confidence_interval_upper=35.0,
            cohens_d=2.0, is_significant=True,
        )
        rec = recommender.decide_from_ttest(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "extend_test"


class TestChiSquaredRecommendations:
    def test_keep_when_conversion_improves(self, recommender):
        result = ChiSquaredResult(
            baseline_rate=0.05, variant_rate=0.08,
            baseline_n=1000, variant_n=1000,
            chi_squared_statistic=7.8, p_value=0.005,
            relative_uplift_pct=60.0, is_significant=True,
        )
        rec = recommender.decide_from_chi_squared(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "keep"

    def test_revert_when_conversion_declines(self, recommender):
        result = ChiSquaredResult(
            baseline_rate=0.08, variant_rate=0.05,
            baseline_n=1000, variant_n=1000,
            chi_squared_statistic=7.8, p_value=0.005,
            relative_uplift_pct=-37.5, is_significant=True,
        )
        rec = recommender.decide_from_chi_squared(result, confidence_level=0.95, min_sample_size=100)
        assert rec.action == "revert"


class TestBayesianRecommendations:
    def test_keep_when_high_probability(self, recommender):
        result = BayesianResult(
            baseline_mean=100.0, variant_mean=115.0,
            probability_b_better=0.98, expected_loss=0.5,
            credible_interval_lower=5.0, credible_interval_upper=25.0,
        )
        rec = recommender.decide_from_bayesian(result)
        assert rec.action == "keep"

    def test_revert_when_low_probability(self, recommender):
        result = BayesianResult(
            baseline_mean=115.0, variant_mean=100.0,
            probability_b_better=0.02, expected_loss=15.0,
            credible_interval_lower=-25.0, credible_interval_upper=-5.0,
        )
        rec = recommender.decide_from_bayesian(result)
        assert rec.action == "revert"

    def test_extend_when_uncertain(self, recommender):
        result = BayesianResult(
            baseline_mean=100.0, variant_mean=102.0,
            probability_b_better=0.65, expected_loss=3.0,
            credible_interval_lower=-5.0, credible_interval_upper=9.0,
        )
        rec = recommender.decide_from_bayesian(result)
        assert rec.action == "extend_test"


class TestSecondaryMetricGuardrails:
    def test_adds_warning_for_degraded_secondary_metric(self, recommender):
        from app.services.ab_testing.recommender import Recommendation

        rec = Recommendation(action="keep", reason="Primary metric improved.", warnings=[])
        degradations = [
            {"metric": "ordered_product_sales", "change_pct": -15.0, "p_value": 0.01},
        ]
        updated = recommender.check_secondary_metrics(rec, degradations)
        assert len(updated.warnings) == 1
        assert "ordered_product_sales" in updated.warnings[0]

    def test_no_warning_for_acceptable_secondary(self, recommender):
        from app.services.ab_testing.recommender import Recommendation

        rec = Recommendation(action="keep", reason="Primary metric improved.", warnings=[])
        degradations = [
            {"metric": "sessions", "change_pct": -5.0, "p_value": 0.20},  # Not significant
        ]
        updated = recommender.check_secondary_metrics(rec, degradations)
        assert len(updated.warnings) == 0
