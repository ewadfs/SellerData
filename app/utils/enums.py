from enum import Enum


class MarketplaceCode(str, Enum):
    US = "US"
    CA = "CA"
    MX = "MX"
    UK = "UK"
    DE = "DE"
    FR = "FR"
    IT = "IT"
    ES = "ES"
    NL = "NL"
    SE = "SE"
    PL = "PL"
    BE = "BE"
    JP = "JP"
    AU = "AU"
    IN = "IN"


class MarketplaceRegion(str, Enum):
    NA = "NA"
    EU = "EU"
    FE = "FE"


class Currency(str, Enum):
    USD = "USD"
    CAD = "CAD"
    MXN = "MXN"
    GBP = "GBP"
    EUR = "EUR"
    SEK = "SEK"
    PLN = "PLN"
    JPY = "JPY"
    AUD = "AUD"
    INR = "INR"


class FulfillmentChannel(str, Enum):
    FBA = "FBA"
    FBM = "FBM"
    SFP = "SFP"


class OrderStatus(str, Enum):
    PENDING = "Pending"
    SHIPPED = "Shipped"
    CANCELED = "Canceled"
    RETURNED = "Returned"


class ABTestStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    REVERTED = "reverted"


class ABTestChangeType(str, Enum):
    TITLE = "title"
    BULLET_POINTS = "bullet_points"
    IMAGES = "images"
    MAIN_IMAGE = "main_image"
    A_PLUS_CONTENT = "a_plus_content"
    PRICE = "price"
    BACKEND_KEYWORDS = "backend_keywords"


class StatMethod(str, Enum):
    TTEST = "ttest"
    CHI_SQUARED = "chi_squared"
    BAYESIAN = "bayesian"


class CampaignType(str, Enum):
    SP = "SP"
    SB = "SB"
    SD = "SD"


class TargetingType(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


class MatchType(str, Enum):
    EXACT = "exact"
    PHRASE = "phrase"
    BROAD = "broad"


class AdState(str, Enum):
    ENABLED = "enabled"
    PAUSED = "paused"
    ARCHIVED = "archived"


class AccountStatus(str, Enum):
    HEALTHY = "healthy"
    AT_RISK = "at_risk"
    UNHEALTHY = "unhealthy"
    DEACTIVATED = "deactivated"


class AlertLevel(str, Enum):
    OK = "ok"
    WATCH = "watch"
    URGENT = "urgent"
    STOCKOUT = "stockout"
