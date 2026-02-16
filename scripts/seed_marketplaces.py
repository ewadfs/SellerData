"""Seed the marketplaces table with all supported Amazon marketplaces."""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.marketplace import Marketplace
from app.db.session import async_session_factory

MARKETPLACES = [
    # North America
    {"code": "US", "name": "United States", "domain": "amazon.com", "region": "NA", "default_currency": "USD", "amazon_marketplace_id": "ATVPDKIKX0DER"},
    {"code": "CA", "name": "Canada", "domain": "amazon.ca", "region": "NA", "default_currency": "CAD", "amazon_marketplace_id": "A2EUQ1WTGCTBG2"},
    {"code": "MX", "name": "Mexico", "domain": "amazon.com.mx", "region": "NA", "default_currency": "MXN", "amazon_marketplace_id": "A1AM78C64UM0Y8"},
    # Europe
    {"code": "UK", "name": "United Kingdom", "domain": "amazon.co.uk", "region": "EU", "default_currency": "GBP", "amazon_marketplace_id": "A1F83G8C2ARO7P"},
    {"code": "DE", "name": "Germany", "domain": "amazon.de", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "A1PA6795UKMFR9"},
    {"code": "FR", "name": "France", "domain": "amazon.fr", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "A13V1IB3VIYZZH"},
    {"code": "IT", "name": "Italy", "domain": "amazon.it", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "APJ6JRA9NG5V4"},
    {"code": "ES", "name": "Spain", "domain": "amazon.es", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "A1RKKUPIHCS9HS"},
    {"code": "NL", "name": "Netherlands", "domain": "amazon.nl", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "A1805IZSGTT6HS"},
    {"code": "SE", "name": "Sweden", "domain": "amazon.se", "region": "EU", "default_currency": "SEK", "amazon_marketplace_id": "A2NODRKZP88ZB9"},
    {"code": "PL", "name": "Poland", "domain": "amazon.pl", "region": "EU", "default_currency": "PLN", "amazon_marketplace_id": "A1C3SOZRARQ6R3"},
    {"code": "BE", "name": "Belgium", "domain": "amazon.com.be", "region": "EU", "default_currency": "EUR", "amazon_marketplace_id": "AMEN7PMS3EDWL"},
    # Far East
    {"code": "JP", "name": "Japan", "domain": "amazon.co.jp", "region": "FE", "default_currency": "JPY", "amazon_marketplace_id": "A1VC38T7YXB528"},
    {"code": "AU", "name": "Australia", "domain": "amazon.com.au", "region": "FE", "default_currency": "AUD", "amazon_marketplace_id": "A39IBJ37TRP1C6"},
    {"code": "IN", "name": "India", "domain": "amazon.in", "region": "FE", "default_currency": "INR", "amazon_marketplace_id": "A21TJRUUN4KGV"},
]


async def seed(db: AsyncSession) -> None:
    for mp_data in MARKETPLACES:
        stmt = select(Marketplace).where(Marketplace.code == mp_data["code"])
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing is None:
            marketplace = Marketplace(id=uuid.uuid4(), **mp_data)
            db.add(marketplace)
            print(f"  Created: {mp_data['code']} - {mp_data['name']}")
        else:
            print(f"  Exists:  {mp_data['code']} - {mp_data['name']}")
    await db.commit()


async def main() -> None:
    print("Seeding marketplaces...")
    async with async_session_factory() as db:
        await seed(db)
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
