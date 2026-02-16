"""Basic tests for enum definitions."""

from app.utils.enums import (
    ABTestChangeType,
    ABTestStatus,
    AccountStatus,
    CampaignType,
    Currency,
    FulfillmentChannel,
    MarketplaceCode,
    MarketplaceRegion,
    MatchType,
    StatMethod,
)


def test_marketplace_codes():
    assert MarketplaceCode.US.value == "US"
    assert MarketplaceCode.UK.value == "UK"
    assert MarketplaceCode.DE.value == "DE"
    assert len(MarketplaceCode) == 15


def test_marketplace_regions():
    assert MarketplaceRegion.NA.value == "NA"
    assert MarketplaceRegion.EU.value == "EU"
    assert MarketplaceRegion.FE.value == "FE"


def test_currencies():
    assert Currency.USD.value == "USD"
    assert Currency.GBP.value == "GBP"
    assert Currency.EUR.value == "EUR"


def test_ab_test_statuses():
    assert ABTestStatus.DRAFT.value == "draft"
    assert ABTestStatus.RUNNING.value == "running"
    assert ABTestStatus.COMPLETED.value == "completed"


def test_ab_test_change_types():
    assert ABTestChangeType.MAIN_IMAGE.value == "main_image"
    assert ABTestChangeType.TITLE.value == "title"
    assert ABTestChangeType.PRICE.value == "price"


def test_stat_methods():
    assert StatMethod.TTEST.value == "ttest"
    assert StatMethod.CHI_SQUARED.value == "chi_squared"
    assert StatMethod.BAYESIAN.value == "bayesian"


def test_fulfillment_channels():
    assert FulfillmentChannel.FBA.value == "FBA"
    assert FulfillmentChannel.FBM.value == "FBM"


def test_campaign_types():
    assert CampaignType.SP.value == "SP"
    assert CampaignType.SB.value == "SB"
    assert CampaignType.SD.value == "SD"


def test_match_types():
    assert MatchType.EXACT.value == "exact"
    assert MatchType.PHRASE.value == "phrase"
    assert MatchType.BROAD.value == "broad"


def test_account_status():
    assert AccountStatus.HEALTHY.value == "healthy"
    assert AccountStatus.AT_RISK.value == "at_risk"
