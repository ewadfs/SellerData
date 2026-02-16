from dataclasses import dataclass

from app.services.ab_testing.statistics import BayesianResult, ChiSquaredResult, TTestResult


@dataclass
class Recommendation:
    action: str  # "keep", "revert", "extend_test", "inconclusive"
    reason: str
    warnings: list[str]


class Recommender:
    """Decision engine that interprets statistical results into actionable recommendations."""

    def decide_from_ttest(
        self,
        result: TTestResult,
        confidence_level: float = 0.95,
        min_sample_size: int = 100,
    ) -> Recommendation:
        warnings: list[str] = []

        if result.baseline_n < min_sample_size or result.variant_n < min_sample_size:
            needed = max(min_sample_size - result.baseline_n, min_sample_size - result.variant_n)
            return Recommendation(
                action="extend_test",
                reason=f"Insufficient data. Need approximately {needed} more days of data.",
                warnings=warnings,
            )

        alpha = 1 - confidence_level
        diff = result.variant_mean - result.baseline_mean

        if result.p_value <= alpha and diff > 0:
            pct_change = (diff / result.baseline_mean * 100) if result.baseline_mean != 0 else 0
            return Recommendation(
                action="keep",
                reason=(
                    f"Statistically significant improvement. "
                    f"Variant mean ({result.variant_mean:.4f}) is {pct_change:.1f}% higher than "
                    f"baseline ({result.baseline_mean:.4f}). p-value: {result.p_value:.6f}, "
                    f"Cohen's d: {result.cohens_d:.3f}."
                ),
                warnings=warnings,
            )

        if result.p_value <= alpha and diff < 0:
            pct_change = (diff / result.baseline_mean * 100) if result.baseline_mean != 0 else 0
            return Recommendation(
                action="revert",
                reason=(
                    f"Statistically significant decline. "
                    f"Variant mean ({result.variant_mean:.4f}) is {abs(pct_change):.1f}% lower than "
                    f"baseline ({result.baseline_mean:.4f}). p-value: {result.p_value:.6f}."
                ),
                warnings=warnings,
            )

        return Recommendation(
            action="inconclusive",
            reason=(
                f"No statistically significant difference detected. "
                f"p-value: {result.p_value:.6f} (threshold: {alpha:.3f}). "
                f"Consider extending the test or accepting the null hypothesis."
            ),
            warnings=warnings,
        )

    def decide_from_chi_squared(
        self,
        result: ChiSquaredResult,
        confidence_level: float = 0.95,
        min_sample_size: int = 100,
    ) -> Recommendation:
        warnings: list[str] = []

        if result.baseline_n < min_sample_size or result.variant_n < min_sample_size:
            return Recommendation(
                action="extend_test",
                reason="Insufficient sample size for reliable chi-squared test.",
                warnings=warnings,
            )

        alpha = 1 - confidence_level

        if result.p_value <= alpha and result.relative_uplift_pct > 0:
            return Recommendation(
                action="keep",
                reason=(
                    f"Statistically significant conversion rate improvement. "
                    f"Variant rate ({result.variant_rate:.4f}) is {result.relative_uplift_pct:.1f}% higher than "
                    f"baseline ({result.baseline_rate:.4f}). p-value: {result.p_value:.6f}."
                ),
                warnings=warnings,
            )

        if result.p_value <= alpha and result.relative_uplift_pct < 0:
            return Recommendation(
                action="revert",
                reason=(
                    f"Statistically significant conversion rate decline. "
                    f"Variant rate ({result.variant_rate:.4f}) is {abs(result.relative_uplift_pct):.1f}% lower. "
                    f"p-value: {result.p_value:.6f}."
                ),
                warnings=warnings,
            )

        return Recommendation(
            action="inconclusive",
            reason=(
                f"No statistically significant difference in conversion rates. "
                f"p-value: {result.p_value:.6f}."
            ),
            warnings=warnings,
        )

    def decide_from_bayesian(
        self,
        result: BayesianResult,
        threshold_keep: float = 0.95,
        threshold_revert: float = 0.05,
    ) -> Recommendation:
        warnings: list[str] = []

        if result.probability_b_better >= threshold_keep:
            return Recommendation(
                action="keep",
                reason=(
                    f"High probability that variant is better. "
                    f"P(variant > baseline) = {result.probability_b_better:.4f}. "
                    f"Expected loss if wrong: {result.expected_loss:.6f}."
                ),
                warnings=warnings,
            )

        if result.probability_b_better <= threshold_revert:
            return Recommendation(
                action="revert",
                reason=(
                    f"High probability that baseline is better. "
                    f"P(variant > baseline) = {result.probability_b_better:.4f}."
                ),
                warnings=warnings,
            )

        return Recommendation(
            action="extend_test",
            reason=(
                f"Uncertain result. P(variant > baseline) = {result.probability_b_better:.4f}. "
                f"More data needed for a confident decision."
            ),
            warnings=warnings,
        )

    def check_secondary_metrics(
        self,
        recommendation: Recommendation,
        secondary_degradations: list[dict],
    ) -> Recommendation:
        """
        Add warnings if secondary metrics degraded significantly,
        even when primary metric improved.
        """
        for degradation in secondary_degradations:
            metric = degradation.get("metric", "unknown")
            change_pct = degradation.get("change_pct", 0)
            p_value = degradation.get("p_value", 1.0)
            if p_value < 0.05 and change_pct < -10:
                recommendation.warnings.append(
                    f"WARNING: Secondary metric '{metric}' degraded by {abs(change_pct):.1f}% "
                    f"(p={p_value:.4f}). Review before finalizing decision."
                )
        return recommendation
