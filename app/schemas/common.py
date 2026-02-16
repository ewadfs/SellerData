from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field


class PaginationParams(BaseModel):
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=500)


class DateRangeFilter(BaseModel):
    start_date: date | None = None
    end_date: date | None = None


class PaginatedResponse(BaseModel):
    total: int
    offset: int
    limit: int


class IDResponse(BaseModel):
    id: UUID
