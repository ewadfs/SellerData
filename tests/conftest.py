import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import JSON, String, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import *  # noqa: F401, F403
from app.dependencies import get_db
from app.main import app

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@event.listens_for(Base.metadata, "before_create")
def _swap_jsonb_for_sqlite(target, connection, **kw):
    """Swap JSONB columns to JSON for SQLite compatibility."""
    if connection.dialect.name == "sqlite":
        for table in target.tables.values():
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()


engine = create_async_engine(TEST_DATABASE_URL, echo=False)
test_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with test_session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed_marketplace(db_session: AsyncSession):
    """Create a test marketplace."""
    from app.db.models.marketplace import Marketplace

    mp = Marketplace(
        id=uuid.uuid4(),
        code="US",
        name="United States",
        domain="amazon.com",
        region="NA",
        default_currency="USD",
        amazon_marketplace_id="ATVPDKIKX0DER",
        is_active=True,
    )
    db_session.add(mp)
    await db_session.flush()
    return mp


@pytest_asyncio.fixture
async def seed_seller(db_session: AsyncSession):
    """Create a test seller account."""
    from app.db.models.marketplace import SellerAccount

    seller = SellerAccount(
        id=uuid.uuid4(),
        seller_name="Test Seller",
        amazon_seller_id="A1234567890",
        is_active=True,
    )
    db_session.add(seller)
    await db_session.flush()
    return seller


@pytest_asyncio.fixture
async def seed_product(db_session: AsyncSession, seed_seller, seed_marketplace):
    """Create a test product."""
    from app.db.models.product import Product

    product = Product(
        id=uuid.uuid4(),
        seller_account_id=seed_seller.id,
        marketplace_id=seed_marketplace.id,
        asin="B0TEST12345",
        sku="TEST-SKU-001",
        title="Test Product",
        brand="Test Brand",
        category="Test Category",
        is_active=True,
    )
    db_session.add(product)
    await db_session.flush()
    return product
