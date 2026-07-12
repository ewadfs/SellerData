from fastapi import APIRouter

from app.api.v1 import (
    ab_tests,
    account_health,
    advertising,
    bleeders,
    brand_analytics,
    business_reports,
    inventory,
    keywords,
    marketplaces,
    products,
    sales,
)

api_router = APIRouter()

api_router.include_router(marketplaces.router)
api_router.include_router(products.router)
api_router.include_router(sales.router)
api_router.include_router(business_reports.router)
api_router.include_router(brand_analytics.router)
api_router.include_router(inventory.router)
api_router.include_router(advertising.router)
api_router.include_router(bleeders.router)
api_router.include_router(keywords.router)
api_router.include_router(account_health.router)
api_router.include_router(ab_tests.router)
