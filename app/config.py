from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "SellerData"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/sellerdata"
    DATABASE_ECHO: bool = False
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10

    # Test Database
    TEST_DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/sellerdata_test"

    # A/B Testing
    AB_TEST_DEFAULT_CONFIDENCE: float = 0.95
    AB_TEST_DEFAULT_MIN_SAMPLE: int = 100
    AB_TEST_BAYESIAN_SIMULATIONS: int = 100_000

    # AI Engine
    SUGGESTION_EXPIRY_DAYS: int = 30

    # Content Digest
    ANTHROPIC_API_KEY: str = ""
    TWITTER_BEARER_TOKEN: str = ""
    FACEBOOK_ACCESS_TOKEN: str = ""
    DIGEST_MAX_ITEMS: int = 50
    DIGEST_IMPORTANCE_THRESHOLD: float = 5.0

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
