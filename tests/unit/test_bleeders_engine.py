"""Unit tests for the Bleeders classification engine and CSV export."""

import uuid

from app.schemas.bleeders import BleedersConfig
from app.services.bleeders import csv_export, engine
from app.services.bleeders.engine import (
    LEVEL_CAMPAIGN,
    LEVEL_SEARCH_TERM,
    LEVEL_TARGET,
    PerfLine,
    acos_threshold,
    classify_b1,
    classify_b2,
    classify_campaign,
)

CONFIG = BleedersConfig(target_acos=35.0)


def make_line(**overrides) -> PerfLine:
    defaults = dict(
        campaign_type="SP",
        campaign_id=uuid.uuid4(),
        campaign_name="BSQ_EXACT_test_Insiders",
        portfolio="01. Test Portfolio",
        ad_group="Test Ad Group",
        target="popcorn maker",
        search_term=None,
        match_type="exact",
        level=LEVEL_TARGET,
        impressions=1000,
        clicks=15,
        spend=10.0,
        sales=0.0,
        orders=0,
        currency="USD",
    )
    defaults.update(overrides)
    return PerfLine(**defaults)


def test_acos_thresholds_by_ad_type():
    assert acos_threshold("SP", CONFIG) == 55.0
    assert acos_threshold("SB", CONFIG) == 45.0
    assert acos_threshold("SD", CONFIG) == 45.0


def test_b1_flags_zero_conversion_target_at_threshold():
    row = classify_b1(make_line(clicks=10), CONFIG)
    assert row is not None
    assert row.source == "B1"
    assert row.reason_category == "Zero Conversions — Target"
    assert "10 clicks >= 10 threshold" in row.reason
    assert row.recommended_action == "Pause"


def test_b1_ignores_below_click_threshold_or_with_sales():
    assert classify_b1(make_line(clicks=9), CONFIG) is None
    assert classify_b1(make_line(clicks=20, sales=25.0, orders=1), CONFIG) is None


def test_b1_search_term_recommends_negative_exact():
    row = classify_b1(
        make_line(level=LEVEL_SEARCH_TERM, search_term="popcorn maker machine"), CONFIG
    )
    assert row is not None
    assert row.reason_category == "Zero Conversions"
    assert row.recommended_action == "Negative Exact"


def test_b2_flags_high_acos_low_orders_sp():
    # ACOS = 30/50 = 60% > 55% SP threshold, 2 orders
    row = classify_b2(make_line(clicks=40, spend=30.0, sales=50.0, orders=2), CONFIG)
    assert row is not None
    assert row.source == "B2"
    assert "ACOS 60.0% > 55.0% threshold" in row.reason


def test_b2_respects_sp_vs_sb_thresholds():
    # ACOS 50%: below the 55% SP threshold but above the 45% SB threshold
    line_sp = make_line(clicks=40, spend=25.0, sales=50.0, orders=2)
    line_sb = make_line(campaign_type="SB", clicks=40, spend=25.0, sales=50.0, orders=2)
    assert classify_b2(line_sp, CONFIG) is None
    assert classify_b2(line_sb, CONFIG) is not None


def test_b2_ignores_five_or_more_orders():
    row = classify_b2(make_line(clicks=40, spend=60.0, sales=50.0, orders=5), CONFIG)
    assert row is None


def test_campaign_over_100_acos_flagged_but_ranking_exempt():
    campaign = make_line(level=LEVEL_CAMPAIGN, target=None, spend=120.0, sales=100.0, orders=4)
    row = classify_campaign(campaign, CONFIG)
    assert row is not None
    assert row.recommended_action == "Pause Campaign / Cut CPC 50%"

    ranking = make_line(
        level=LEVEL_CAMPAIGN, target=None, spend=120.0, sales=100.0, orders=4, is_ranking=True
    )
    assert classify_campaign(ranking, CONFIG) is None

    by_name = make_line(
        level=LEVEL_CAMPAIGN,
        target=None,
        campaign_name="BSQ_RANKING_push_Insiders",
        spend=120.0,
        sales=100.0,
        orders=4,
    )
    assert classify_campaign(by_name, CONFIG) is None


def test_evaluate_sorts_targets_then_search_terms_then_campaigns():
    target = make_line(clicks=12)
    term = make_line(level=LEVEL_SEARCH_TERM, search_term="popcorn", clicks=12)
    campaign = make_line(level=LEVEL_CAMPAIGN, target=None, spend=150.0, sales=100.0, orders=3)
    rows = engine.evaluate([target, term], [], [campaign], CONFIG)
    assert [r.level for r in rows] == [LEVEL_TARGET, LEVEL_SEARCH_TERM, LEVEL_CAMPAIGN]


def test_csv_export_matches_gno_format():
    from app.schemas.bleeders import (
        BleedersMarketplaceReport,
        BleedersSummary,
    )

    row = classify_b1(make_line(clicks=11, spend=5.65, impressions=2682), CONFIG)
    report = BleedersMarketplaceReport(
        marketplace_id=uuid.uuid4(),
        marketplace_code="US",
        marketplace_name="United States",
        currency="USD",
        report_date="2026-07-12",
        b1_window_start="2026-05-14",
        b1_window_end="2026-07-12",
        b2_window_start="2026-06-13",
        b2_window_end="2026-07-12",
        summary=BleedersSummary(
            total_rows=1,
            b1_targets=1,
            b1_search_terms=0,
            b2_targets=0,
            b2_search_terms=0,
            campaigns_over_threshold=0,
            flagged_target_spend=5.65,
            flagged_search_term_spend=0,
            flagged_campaign_spend=0,
        ),
        rows=[row],
    )
    content = csv_export.report_to_csv(report)
    lines = content.strip().splitlines()
    assert lines[0].startswith(
        "Type,Portfolio,Campaign,Ad Group,Target / Keyword,Customer Search Term,Match Type,Level,"
    )
    assert lines[0].endswith("Reason,Reason Category,Decision,Bid Down %,Source")
    assert "$5.65" in lines[1]
    assert "Exact" in lines[1]
    assert lines[1].endswith("B1")
