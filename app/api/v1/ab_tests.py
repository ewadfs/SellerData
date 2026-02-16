from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.ab_testing import (
    ABTestCreate,
    ABTestDetailRead,
    ABTestMetricSnapshotCreate,
    ABTestMetricSnapshotRead,
    ABTestRead,
    ABTestResultRead,
    ABTestUpdate,
)
from app.services.ab_testing.engine import ABTestEngine

router = APIRouter()


def _get_engine(db: AsyncSession = Depends(get_db)) -> ABTestEngine:
    return ABTestEngine(db)


@router.get("/sellers/{seller_id}/ab-tests", response_model=list[ABTestRead], tags=["A/B Tests"])
async def list_tests(
    seller_id: UUID,
    product_id: UUID | None = None,
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    engine: ABTestEngine = Depends(_get_engine),
):
    return await engine.list_tests(seller_id, product_id, status, offset, limit)


@router.post("/sellers/{seller_id}/ab-tests", response_model=ABTestRead, status_code=201, tags=["A/B Tests"])
async def create_test(seller_id: UUID, data: ABTestCreate, engine: ABTestEngine = Depends(_get_engine)):
    return await engine.create_test(seller_id, data)


@router.get("/ab-tests/{test_id}", response_model=ABTestDetailRead, tags=["A/B Tests"])
async def get_test(test_id: UUID, engine: ABTestEngine = Depends(_get_engine)):
    test = await engine.get_test(test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="A/B test not found")
    return test


@router.patch("/ab-tests/{test_id}", response_model=ABTestRead, tags=["A/B Tests"])
async def update_test(test_id: UUID, data: ABTestUpdate, engine: ABTestEngine = Depends(_get_engine)):
    test = await engine.update_test(test_id, data)
    if test is None:
        raise HTTPException(status_code=404, detail="A/B test not found")
    return test


@router.post("/ab-tests/{test_id}/start", response_model=ABTestRead, tags=["A/B Tests"])
async def start_test(test_id: UUID, engine: ABTestEngine = Depends(_get_engine)):
    return await engine.start_test(test_id)


@router.post("/ab-tests/{test_id}/complete", response_model=ABTestDetailRead, tags=["A/B Tests"])
async def complete_test(test_id: UUID, engine: ABTestEngine = Depends(_get_engine)):
    return await engine.complete_test(test_id)


@router.get("/ab-tests/{test_id}/results", response_model=ABTestResultRead, tags=["A/B Tests"])
async def get_results(test_id: UUID, engine: ABTestEngine = Depends(_get_engine)):
    result = await engine.get_result(test_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Results not found. Test may not be completed.")
    return result


@router.get("/ab-tests/{test_id}/metrics", response_model=list[ABTestMetricSnapshotRead], tags=["A/B Tests"])
async def list_metrics(test_id: UUID, engine: ABTestEngine = Depends(_get_engine)):
    return await engine.list_metric_snapshots(test_id)


@router.post(
    "/ab-tests/{test_id}/metrics",
    response_model=ABTestMetricSnapshotRead,
    status_code=201,
    tags=["A/B Tests"],
)
async def add_metric_snapshot(
    test_id: UUID, data: ABTestMetricSnapshotCreate, engine: ABTestEngine = Depends(_get_engine)
):
    return await engine.add_metric_snapshot(test_id, data)
