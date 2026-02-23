from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.content_digest import (
    ContentItemRead,
    ContentSourceCreate,
    ContentSourceRead,
    ContentSourceUpdate,
    DigestGenerateRequest,
    DigestRead,
    DigestSummaryRead,
    NewsletterContentPost,
    VIPPersonCreate,
    VIPPersonRead,
    VIPPersonUpdate,
)
from app.services.digest import source_service
from app.services.digest.generator import generate_digest

router = APIRouter(tags=["Content Digest"])


# ---------------------------------------------------------------------------
# Content Sources
# ---------------------------------------------------------------------------


@router.get("/digest/sources", response_model=list[ContentSourceRead])
async def list_sources(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    return await source_service.list_sources(db, active_only)


@router.post("/digest/sources", response_model=ContentSourceRead, status_code=201)
async def create_source(data: ContentSourceCreate, db: AsyncSession = Depends(get_db)):
    return await source_service.create_source(db, data)


@router.get("/digest/sources/{source_id}", response_model=ContentSourceRead)
async def get_source(source_id: UUID, db: AsyncSession = Depends(get_db)):
    source = await source_service.get_source(db, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@router.patch("/digest/sources/{source_id}", response_model=ContentSourceRead)
async def update_source(
    source_id: UUID, data: ContentSourceUpdate, db: AsyncSession = Depends(get_db)
):
    source = await source_service.update_source(db, source_id, data)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@router.delete("/digest/sources/{source_id}", status_code=204)
async def delete_source(source_id: UUID, db: AsyncSession = Depends(get_db)):
    deleted = await source_service.delete_source(db, source_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Source not found")


# ---------------------------------------------------------------------------
# VIP People
# ---------------------------------------------------------------------------


@router.get("/digest/vip-people", response_model=list[VIPPersonRead])
async def list_vip_people(
    platform: str | None = Query(None, pattern="^(twitter|facebook)$"),
    db: AsyncSession = Depends(get_db),
):
    return await source_service.list_vip_people(db, platform)


@router.post("/digest/vip-people", response_model=VIPPersonRead, status_code=201)
async def create_vip_person(data: VIPPersonCreate, db: AsyncSession = Depends(get_db)):
    return await source_service.create_vip_person(db, data)


@router.get("/digest/vip-people/{vip_id}", response_model=VIPPersonRead)
async def get_vip_person(vip_id: UUID, db: AsyncSession = Depends(get_db)):
    vip = await source_service.get_vip_person(db, vip_id)
    if vip is None:
        raise HTTPException(status_code=404, detail="VIP person not found")
    return vip


@router.patch("/digest/vip-people/{vip_id}", response_model=VIPPersonRead)
async def update_vip_person(
    vip_id: UUID, data: VIPPersonUpdate, db: AsyncSession = Depends(get_db)
):
    vip = await source_service.update_vip_person(db, vip_id, data)
    if vip is None:
        raise HTTPException(status_code=404, detail="VIP person not found")
    return vip


@router.delete("/digest/vip-people/{vip_id}", status_code=204)
async def delete_vip_person(vip_id: UUID, db: AsyncSession = Depends(get_db)):
    deleted = await source_service.delete_vip_person(db, vip_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="VIP person not found")


# ---------------------------------------------------------------------------
# Newsletter Ingestion
# ---------------------------------------------------------------------------


@router.post("/digest/newsletters", response_model=ContentItemRead, status_code=201)
async def ingest_newsletter(data: NewsletterContentPost, db: AsyncSession = Depends(get_db)):
    """Ingest newsletter content (e.g., forwarded from email via webhook)."""
    return await source_service.ingest_newsletter(db, data)


# ---------------------------------------------------------------------------
# Digest Generation & Retrieval
# ---------------------------------------------------------------------------


@router.post("/digest/generate", response_model=DigestRead)
async def generate_daily_digest(
    body: DigestGenerateRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Generate (or regenerate) the digest for a given date."""
    target_date = (body.target_date if body else None) or date.today()
    digest = await generate_digest(db, target_date)
    return digest


@router.get("/digest/latest", response_model=DigestRead)
async def get_latest_digest(db: AsyncSession = Depends(get_db)):
    digests = await source_service.list_digests(db, limit=1)
    if not digests:
        raise HTTPException(status_code=404, detail="No digests found")
    return digests[0]


@router.get("/digest/history", response_model=list[DigestSummaryRead])
async def list_digests(
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await source_service.list_digests(db, limit)


@router.get("/digest/{digest_date_str}")
async def get_digest_by_date(digest_date_str: str, db: AsyncSession = Depends(get_db)):
    """Get a digest by date (YYYY-MM-DD). Returns JSON by default."""
    try:
        target_date = date.fromisoformat(digest_date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    digest = await source_service.get_digest_by_date(db, target_date)
    if digest is None:
        raise HTTPException(status_code=404, detail="No digest found for this date")
    return DigestRead.model_validate(digest)


@router.get("/digest/{digest_date_str}/html", response_class=HTMLResponse)
async def get_digest_html(digest_date_str: str, db: AsyncSession = Depends(get_db)):
    """Get the pre-rendered HTML digest for reading. This is the morning coffee page."""
    try:
        target_date = date.fromisoformat(digest_date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    digest = await source_service.get_digest_by_date(db, target_date)
    if digest is None:
        raise HTTPException(status_code=404, detail="No digest found for this date")
    if not digest.html_content:
        raise HTTPException(status_code=404, detail="Digest HTML not yet generated")
    return HTMLResponse(content=digest.html_content)


@router.get("/digest/latest/html", response_class=HTMLResponse)
async def get_latest_digest_html(db: AsyncSession = Depends(get_db)):
    """Get the latest digest as a clean HTML page for morning reading."""
    digests = await source_service.list_digests(db, limit=1)
    if not digests:
        raise HTTPException(status_code=404, detail="No digests found")
    if not digests[0].html_content:
        raise HTTPException(status_code=404, detail="Digest HTML not yet generated")
    return HTMLResponse(content=digests[0].html_content)
