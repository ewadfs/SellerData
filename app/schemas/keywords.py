from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class KeywordRankingCreate(BaseModel):
    keyword: str
    check_date: date
    organic_rank: int | None = None
    sponsored_rank: int | None = None
    page_number: int | None = None
    search_volume_est: int | None = None


class KeywordRankingRead(BaseModel):
    id: UUID
    product_id: UUID
    keyword: str
    check_date: date
    organic_rank: int | None = None
    sponsored_rank: int | None = None
    page_number: int | None = None
    search_volume_est: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SearchVisibilityRead(BaseModel):
    id: UUID
    product_id: UUID
    score_date: date
    tracked_keywords_count: int | None = None
    keywords_in_top_10: int | None = None
    keywords_in_top_50: int | None = None
    weighted_visibility_score: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
