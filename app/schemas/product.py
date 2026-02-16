from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class ProductCreate(BaseModel):
    marketplace_id: UUID
    asin: str
    sku: str
    fnsku: str | None = None
    title: str | None = None
    brand: str | None = None
    category: str | None = None
    subcategory: str | None = None
    parent_asin: str | None = None


class ProductUpdate(BaseModel):
    title: str | None = None
    brand: str | None = None
    category: str | None = None
    subcategory: str | None = None
    parent_asin: str | None = None
    is_active: bool | None = None


class ProductRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    asin: str
    sku: str
    fnsku: str | None = None
    title: str | None = None
    brand: str | None = None
    category: str | None = None
    subcategory: str | None = None
    parent_asin: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProductSnapshotCreate(BaseModel):
    snapshot_date: date
    title: str | None = None
    bullet_points: list[str] | None = None
    description: str | None = None
    main_image_url: str | None = None
    other_image_urls: list[str] | None = None
    price: float | None = None
    currency: str | None = None
    has_a_plus: bool | None = None
    a_plus_content_hash: str | None = None
    backend_keywords: str | None = None
    rating: float | None = None
    review_count: int | None = None
    best_seller_rank: int | None = None
    bsr_category: str | None = None
    buy_box_price: float | None = None
    buy_box_owner: str | None = None


class ProductSnapshotRead(BaseModel):
    id: UUID
    product_id: UUID
    snapshot_date: date
    title: str | None = None
    bullet_points: list[str] | None = None
    price: float | None = None
    currency: str | None = None
    has_a_plus: bool | None = None
    rating: float | None = None
    review_count: int | None = None
    best_seller_rank: int | None = None
    bsr_category: str | None = None
    buy_box_price: float | None = None
    buy_box_owner: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
