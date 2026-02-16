from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class MarketplaceRead(BaseModel):
    id: UUID
    code: str
    name: str
    domain: str
    region: str
    default_currency: str
    amazon_marketplace_id: str | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerAccountCreate(BaseModel):
    seller_name: str
    amazon_seller_id: str | None = None


class SellerAccountUpdate(BaseModel):
    seller_name: str | None = None
    amazon_seller_id: str | None = None
    is_active: bool | None = None


class SellerAccountRead(BaseModel):
    id: UUID
    seller_name: str
    amazon_seller_id: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SellerMarketplaceLinkCreate(BaseModel):
    marketplace_id: UUID


class SellerMarketplaceLinkRead(BaseModel):
    id: UUID
    seller_account_id: UUID
    marketplace_id: UUID
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
