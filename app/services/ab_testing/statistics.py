from dataclasses import dataclass

import numpy as np
from scipy import stats


@dataclass
class TTestResult:
    baseline_mean: float
    variant_mean: float
    baseline_std: float
    variant_std: float
    baseline_n: int
    variant_n: int
    t_statistic: float
    p_value: float
    confidence_interval_lower: float
    confidence_interval_upper: float
    cohens_d: float
    is_significant: bool


@dataclass
class ChiSquaredResult:
    baseline_rate: float
    variant_rate: float
    baseline_n: int
    variant_n: int
    chi_squared_statistic: float
    p_value: float
    relative_uplift_pct: float
    is_significant: bool


@dataclass
class BayesianResult:
    baseline_mean: float
    variant_mean: float
    probability_b_better: float
    expected_loss: float
    credible_interval_lower: float
    credible_interval_upper: float


class StatisticalCalculator:
    """Core statistical engine for A/B test analysis."""

    def welch_ttest(
        self,
        baseline: np.ndarray,
        variant: np.ndarray,
        confidence_level: float = 0.95,
    ) -> TTestResult:
        """
        Welch's t-test for comparing means of two independent samples
        with potentially unequal variances.

        Use for continuous metrics: ordered_product_sales, sessions, page_views.
        """
        baseline = np.asarray(baseline, dtype=float)
        variant = np.asarray(variant, dtype=float)

        b_mean, v_mean = float(np.mean(baseline)), float(np.mean(variant))
        b_std, v_std = float(np.std(baseline, ddof=1)), float(np.std(variant, ddof=1))
        b_n, v_n = len(baseline), len(variant)

        t_stat, p_value = stats.ttest_ind(variant, baseline, equal_var=False)

        # Confidence interval for the difference in means
        se = np.sqrt(b_std**2 / b_n + v_std**2 / v_n)
        alpha = 1 - confidence_level
        # Welch-Satterthwaite degrees of freedom
        if b_std == 0 and v_std == 0:
            df = b_n + v_n - 2
        else:
            num = (b_std**2 / b_n + v_std**2 / v_n) ** 2
            denom = (b_std**2 / b_n) ** 2 / max(b_n - 1, 1) + (v_std**2 / v_n) ** 2 / max(v_n - 1, 1)
            df = num / denom if denom > 0 else b_n + v_n - 2

        t_crit = stats.t.ppf(1 - alpha / 2, df)
        diff = v_mean - b_mean
        ci_lower = diff - t_crit * se
        ci_upper = diff + t_crit * se

        # Cohen's d effect size
        pooled_std = np.sqrt(((b_n - 1) * b_std**2 + (v_n - 1) * v_std**2) / max(b_n + v_n - 2, 1))
        cohens_d = diff / pooled_std if pooled_std > 0 else 0.0

        return TTestResult(
            baseline_mean=b_mean,
            variant_mean=v_mean,
            baseline_std=b_std,
            variant_std=v_std,
            baseline_n=b_n,
            variant_n=v_n,
            t_statistic=float(t_stat),
            p_value=float(p_value),
            confidence_interval_lower=float(ci_lower),
            confidence_interval_upper=float(ci_upper),
            cohens_d=float(cohens_d),
            is_significant=float(p_value) < (1 - confidence_level),
        )

    def chi_squared_test(
        self,
        baseline_conversions: int,
        baseline_total: int,
        variant_conversions: int,
        variant_total: int,
        confidence_level: float = 0.95,
    ) -> ChiSquaredResult:
        """
        Chi-squared test for comparing conversion rates (proportions).

        Use for: unit_session_percentage (conversion rate), buy_box_percentage.
        """
        table = np.array([
            [baseline_conversions, baseline_total - baseline_conversions],
            [variant_conversions, variant_total - variant_conversions],
        ])

        # Handle edge case of zero cells
        if np.any(table < 0):
            raise ValueError("Contingency table cannot have negative values")

        chi2, p_value, _, _ = stats.chi2_contingency(table, correction=True)

        b_rate = baseline_conversions / baseline_total if baseline_total > 0 else 0
        v_rate = variant_conversions / variant_total if variant_total > 0 else 0
        relative_uplift = ((v_rate - b_rate) / b_rate * 100) if b_rate > 0 else 0

        return ChiSquaredResult(
            baseline_rate=b_rate,
            variant_rate=v_rate,
            baseline_n=baseline_total,
            variant_n=variant_total,
            chi_squared_statistic=float(chi2),
            p_value=float(p_value),
            relative_uplift_pct=float(relative_uplift),
            is_significant=float(p_value) < (1 - confidence_level),
        )

    def bayesian_ab_test(
        self,
        baseline: np.ndarray,
        variant: np.ndarray,
        n_simulations: int = 100_000,
        is_conversion: bool = False,
    ) -> BayesianResult:
        """
        Bayesian A/B test using Monte Carlo simulation.

        For continuous metrics: uses Normal-Inverse-Gamma conjugate prior.
        For conversion rates (is_conversion=True): uses Beta-Binomial conjugate.

        Returns probability that variant is better and expected loss.
        """
        rng = np.random.default_rng(42)
        baseline = np.asarray(baseline, dtype=float)
        variant = np.asarray(variant, dtype=float)

        if is_conversion:
            # Beta-Binomial model
            # Prior: Beta(1, 1) = uniform
            b_successes = int(np.sum(baseline))
            b_total = len(baseline)
            v_successes = int(np.sum(variant))
            v_total = len(variant)

            b_samples = rng.beta(1 + b_successes, 1 + b_total - b_successes, n_simulations)
            v_samples = rng.beta(1 + v_successes, 1 + v_total - v_successes, n_simulations)
        else:
            # Normal model with weakly informative prior
            b_mean, b_std = float(np.mean(baseline)), float(np.std(baseline, ddof=1))
            v_mean, v_std = float(np.mean(variant)), float(np.std(variant, ddof=1))
            b_n, v_n = len(baseline), len(variant)

            # Draw from posterior (using t-distribution approximation)
            b_se = b_std / np.sqrt(b_n) if b_n > 0 else 1
            v_se = v_std / np.sqrt(v_n) if v_n > 0 else 1

            b_samples = rng.normal(b_mean, b_se, n_simulations)
            v_samples = rng.normal(v_mean, v_se, n_simulations)

        prob_b_better = float(np.mean(v_samples > b_samples))

        # Expected loss if we choose variant but baseline is actually better
        loss = np.maximum(b_samples - v_samples, 0)
        expected_loss = float(np.mean(loss))

        # 95% credible interval for the difference
        diff_samples = v_samples - b_samples
        ci_lower = float(np.percentile(diff_samples, 2.5))
        ci_upper = float(np.percentile(diff_samples, 97.5))

        return BayesianResult(
            baseline_mean=float(np.mean(b_samples)),
            variant_mean=float(np.mean(v_samples)),
            probability_b_better=prob_b_better,
            expected_loss=expected_loss,
            credible_interval_lower=ci_lower,
            credible_interval_upper=ci_upper,
        )

    def compute_minimum_sample_size(
        self,
        baseline_rate: float,
        minimum_detectable_effect: float,
        alpha: float = 0.05,
        power: float = 0.80,
    ) -> int:
        """
        Required sample size per group for a two-proportion z-test.

        Args:
            baseline_rate: Current conversion rate (e.g., 0.10 for 10%)
            minimum_detectable_effect: Relative effect size (e.g., 0.05 for 5% lift)
            alpha: Significance level (default 0.05)
            power: Statistical power (default 0.80)

        Returns:
            Required sample size per group.
        """
        p1 = baseline_rate
        p2 = baseline_rate * (1 + minimum_detectable_effect)

        if p1 <= 0 or p1 >= 1 or p2 <= 0 or p2 >= 1:
            return 0

        z_alpha = stats.norm.ppf(1 - alpha / 2)
        z_beta = stats.norm.ppf(power)

        numerator = (z_alpha + z_beta) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))
        denominator = (p2 - p1) ** 2

        if denominator == 0:
            return 0

        return int(np.ceil(numerator / denominator))
