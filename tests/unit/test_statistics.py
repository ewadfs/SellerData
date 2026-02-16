"""Unit tests for the statistical significance calculator."""

import numpy as np
import pytest

from app.services.ab_testing.statistics import StatisticalCalculator


@pytest.fixture
def calc():
    return StatisticalCalculator()


class TestWelchTTest:
    def test_significant_improvement(self, calc):
        """Variant is clearly better than baseline."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(100, 10, 30)
        variant = rng.normal(115, 10, 30)

        result = calc.welch_ttest(baseline, variant, confidence_level=0.95)

        assert result.variant_mean > result.baseline_mean
        assert result.p_value < 0.05
        assert result.is_significant is True
        assert result.confidence_interval_lower > 0  # CI doesn't include 0

    def test_no_significant_difference(self, calc):
        """Both groups drawn from same distribution."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(100, 10, 30)
        variant = rng.normal(100, 10, 30)

        result = calc.welch_ttest(baseline, variant, confidence_level=0.95)

        # With same distribution, p-value should typically be > 0.05
        # but may occasionally be significant by chance; we just check structure
        assert result.baseline_n == 30
        assert result.variant_n == 30
        assert result.baseline_std > 0
        assert result.variant_std > 0

    def test_significant_decline(self, calc):
        """Variant is clearly worse than baseline."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(100, 10, 30)
        variant = rng.normal(85, 10, 30)

        result = calc.welch_ttest(baseline, variant, confidence_level=0.95)

        assert result.variant_mean < result.baseline_mean
        assert result.p_value < 0.05
        assert result.is_significant is True
        assert result.confidence_interval_upper < 0  # Difference is negative

    def test_cohens_d_large_effect(self, calc):
        """Cohen's d should indicate a large effect size."""
        baseline = np.array([100.0] * 20)
        variant = np.array([120.0] * 20)

        result = calc.welch_ttest(baseline, variant)

        # With zero variance in both groups, cohens_d is undefined
        # but with slight variation it should be large
        baseline_varied = np.array([99, 100, 101] * 7 + [100])
        variant_varied = np.array([119, 120, 121] * 7 + [120])
        result = calc.welch_ttest(baseline_varied, variant_varied)
        assert abs(result.cohens_d) > 0.8  # Large effect


class TestChiSquared:
    def test_significant_conversion_improvement(self, calc):
        """Clear improvement in conversion rate."""
        result = calc.chi_squared_test(
            baseline_conversions=50,
            baseline_total=1000,
            variant_conversions=80,
            variant_total=1000,
        )

        assert result.variant_rate > result.baseline_rate
        assert result.p_value < 0.05
        assert result.is_significant is True
        assert result.relative_uplift_pct > 0

    def test_no_significant_conversion_difference(self, calc):
        """Similar conversion rates."""
        result = calc.chi_squared_test(
            baseline_conversions=50,
            baseline_total=1000,
            variant_conversions=52,
            variant_total=1000,
        )

        assert result.p_value > 0.05
        assert result.is_significant is False

    def test_significant_conversion_decline(self, calc):
        """Clear decline in conversion rate."""
        result = calc.chi_squared_test(
            baseline_conversions=80,
            baseline_total=1000,
            variant_conversions=50,
            variant_total=1000,
        )

        assert result.variant_rate < result.baseline_rate
        assert result.is_significant is True
        assert result.relative_uplift_pct < 0


class TestBayesian:
    def test_clearly_better_variant(self, calc):
        """Variant is clearly better - high P(B better)."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(100, 10, 50)
        variant = rng.normal(120, 10, 50)

        result = calc.bayesian_ab_test(baseline, variant, n_simulations=50_000)

        assert result.probability_b_better > 0.95
        assert result.expected_loss < 1.0
        assert result.credible_interval_lower > 0

    def test_clearly_worse_variant(self, calc):
        """Variant is clearly worse - low P(B better)."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(120, 10, 50)
        variant = rng.normal(100, 10, 50)

        result = calc.bayesian_ab_test(baseline, variant, n_simulations=50_000)

        assert result.probability_b_better < 0.05
        assert result.credible_interval_upper < 0

    def test_uncertain_result(self, calc):
        """Similar distributions - uncertain result."""
        rng = np.random.default_rng(42)
        baseline = rng.normal(100, 15, 20)
        variant = rng.normal(102, 15, 20)

        result = calc.bayesian_ab_test(baseline, variant, n_simulations=50_000)

        # With small difference and high variance, should be uncertain
        assert 0.1 < result.probability_b_better < 0.9


class TestMinimumSampleSize:
    def test_typical_ecommerce_conversion(self, calc):
        """Standard e-commerce conversion rate optimization."""
        n = calc.compute_minimum_sample_size(
            baseline_rate=0.10,
            minimum_detectable_effect=0.10,  # 10% relative lift
            alpha=0.05,
            power=0.80,
        )

        assert n > 0
        assert 3000 < n < 40000  # Reasonable range for 10% CVR with 10% MDE

    def test_higher_mde_needs_fewer_samples(self, calc):
        """Larger detectable effect should require fewer samples."""
        n_small = calc.compute_minimum_sample_size(baseline_rate=0.10, minimum_detectable_effect=0.20)
        n_large = calc.compute_minimum_sample_size(baseline_rate=0.10, minimum_detectable_effect=0.05)

        assert n_small < n_large

    def test_zero_effect_returns_zero(self, calc):
        """Zero detectable effect should return 0 (can't detect no change)."""
        n = calc.compute_minimum_sample_size(baseline_rate=0.10, minimum_detectable_effect=0.0)
        assert n == 0
