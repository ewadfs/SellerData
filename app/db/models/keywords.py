import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KeywordRanking(Base):
    __tablename__ = "keyword_rankings"
    __table_args__ = (
        UniqueConstraint("product_id", "keyword", "check_date"),
        Index("ix_keyword_rankings_keyword_date", "keyword", "check_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    check_date: Mapped[date] = mapped_column(Date, nullable=False)
    organic_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sponsored_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    search_volume_est: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SearchVisibilityScore(Base):
    __tablename__ = "search_visibility_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    score_date: Mapped[date] = mapped_column(Date, nullable=False)
    tracked_keywords_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    keywords_in_top_10: Mapped[int | None] = mapped_column(Integer, nullable=True)
    keywords_in_top_50: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weighted_visibility_score: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
