"""Classification rules for the GNO Bleeders report.

Pure functions: aggregated performance lines in, flagged ``BleederRow``s out.

Rules implemented (from the Bleeders 1.0 / 2.0 SOPs):
- B1: 10+ clicks and zero sales in the B1 window -> pause target / negative-exact search term.
- B2: 1-4 orders in the B2 window with ACOS above the ad-type threshold
  (target ACOS + 20 points for SP, + 10 points for SB/SBV/SD).
- Campaigns with ACOS over 100% in the campaign window -> pause, except ranking campaigns.
"""

from dataclasses import dataclass
from urllib.parse import quote_plus
from uuid import UUID

from app.schemas.bleeders import BleederRow, BleedersConfig

LEVEL_TARGET = "target"
LEVEL_SEARCH_TERM = "search-term"
LEVEL_CAMPAIGN = "campaign"

SOURCE_B1 = "B1"
SOURCE_B2 = "B2"


@dataclass
class PerfLine:
    """A performance aggregate over a reporting window."""

    campaign_type: str  # SP / SB / SD
    campaign_id: UUID
    campaign_name: str
    portfolio: str | None
    ad_group: str | None
    target: str | None
    search_term: str | None
    match_type: str | None
    level: str
    impressions: int
    clicks: int
    spend: float
    sales: float
    orders: int
    currency: str
    is_ranking: bool = False


def acos_threshold(campaign_type: str, config: BleedersConfig) -> float:
    uplift = config.sp_acos_uplift if campaign_type.upper() == "SP" else config.sb_sd_acos_uplift
    return config.target_acos + uplift


def is_ranking_campaign(line: PerfLine, config: BleedersConfig) -> bool:
    if line.is_ranking:
        return True
    name = line.campaign_name.upper()
    return any(pattern.upper() in name for pattern in config.ranking_name_patterns)


def line_acos(line: PerfLine) -> float | None:
    if line.sales > 0:
        return line.spend / line.sales * 100
    return None


def _search_url(line: PerfLine, domain: str | None) -> str | None:
    term = line.search_term or line.target
    if not domain or not term or term.startswith("—"):
        return None
    return f"https://{domain}/s?k={quote_plus(term)}"


def _build_row(
    line: PerfLine,
    reason: str,
    reason_category: str,
    recommended_action: str,
    source: str,
    domain: str | None,
) -> BleederRow:
    acos = line_acos(line)
    return BleederRow(
        campaign_type=line.campaign_type,
        portfolio=line.portfolio,
        campaign=line.campaign_name,
        campaign_id=line.campaign_id,
        ad_group=line.ad_group,
        target=line.target,
        search_term=line.search_term,
        match_type=line.match_type,
        level=line.level,
        impressions=line.impressions,
        clicks=line.clicks,
        spend=round(line.spend, 2),
        ctr=(line.clicks / line.impressions * 100) if line.impressions else None,
        cpc=(line.spend / line.clicks) if line.clicks else None,
        sales=round(line.sales, 2),
        orders=line.orders,
        cvr=(line.orders / line.clicks * 100) if line.clicks else None,
        acos=acos,
        roas=(line.sales / line.spend) if line.spend else None,
        reason=reason,
        reason_category=reason_category,
        recommended_action=recommended_action,
        source=source,
        currency=line.currency,
        amazon_search_url=_search_url(line, domain),
    )


def classify_b1(line: PerfLine, config: BleedersConfig, domain: str | None = None) -> BleederRow | None:
    """Bleeders 1.0: zero conversions with clicks at or above the threshold."""
    if line.level == LEVEL_CAMPAIGN:
        return None
    if line.clicks < config.b1_clicks_threshold or line.orders > 0 or line.sales > 0:
        return None
    if line.level == LEVEL_TARGET:
        reason = f"Zero Conversions — Target Level ({line.clicks} clicks >= {config.b1_clicks_threshold} threshold)"
        return _build_row(line, reason, "Zero Conversions — Target", "Pause", SOURCE_B1, domain)
    reason = f"Zero Conversions ({line.clicks} clicks >= {config.b1_clicks_threshold} threshold)"
    return _build_row(line, reason, "Zero Conversions", "Negative Exact", SOURCE_B1, domain)


def classify_b2(line: PerfLine, config: BleedersConfig, domain: str | None = None) -> BleederRow | None:
    """Bleeders 2.0: low order volume with ACOS above the ad-type threshold."""
    if line.level == LEVEL_CAMPAIGN:
        return None
    if not (config.b2_min_orders <= line.orders < config.b2_max_orders):
        return None
    acos = line_acos(line)
    threshold = acos_threshold(line.campaign_type, config)
    if acos is None or acos <= threshold:
        return None
    detail = (
        f"ACOS {acos:.1f}% > {threshold:.1f}% threshold, "
        f"{line.orders} orders < {config.b2_max_orders} in last {config.b2_window_days} days"
    )
    if line.level == LEVEL_TARGET:
        return _build_row(
            line,
            f"High ACOS — Target Level ({detail})",
            "High ACOS — Target",
            "Pause / Reduce Bid",
            SOURCE_B2,
            domain,
        )
    return _build_row(
        line,
        f"High ACOS ({detail})",
        "High ACOS",
        "Negative Exact",
        SOURCE_B2,
        domain,
    )


def classify_campaign(line: PerfLine, config: BleedersConfig, domain: str | None = None) -> BleederRow | None:
    """Campaigns with ACOS over the pause threshold (ranking campaigns exempt)."""
    if line.level != LEVEL_CAMPAIGN:
        return None
    acos = line_acos(line)
    if acos is None or acos <= config.campaign_acos_threshold:
        return None
    if config.exclude_ranking_campaigns and is_ranking_campaign(line, config):
        return None
    reason = (
        f"Campaign ACOS {acos:.1f}% > {config.campaign_acos_threshold:.0f}% "
        f"({line.orders} orders in last {config.campaign_window_days} days)"
    )
    return _build_row(
        line,
        reason,
        f"Campaign ACOS > {config.campaign_acos_threshold:.0f}%",
        "Pause Campaign / Cut CPC 50%",
        SOURCE_B2,
        domain,
    )


def evaluate(
    b1_lines: list[PerfLine],
    b2_lines: list[PerfLine],
    campaign_lines: list[PerfLine],
    config: BleedersConfig,
    domain: str | None = None,
) -> list[BleederRow]:
    """Run all rules and return flagged rows sorted for review (targets, search terms, campaigns)."""
    rows: list[BleederRow] = []
    for line in b1_lines:
        row = classify_b1(line, config, domain)
        if row:
            rows.append(row)
    for line in b2_lines:
        row = classify_b2(line, config, domain)
        if row:
            rows.append(row)
    for line in campaign_lines:
        row = classify_campaign(line, config, domain)
        if row:
            rows.append(row)

    level_order = {LEVEL_TARGET: 0, LEVEL_SEARCH_TERM: 1, LEVEL_CAMPAIGN: 2}
    rows.sort(key=lambda r: (level_order.get(r.level, 3), r.source, -r.spend))
    return rows
