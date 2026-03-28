import json
import logging
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.inventory import (
    AWDInventoryCreate,
    AWDInventoryRead,
    AWDSyncDebugResponse,
    AgedInventoryCreate,
    AgedInventoryRead,
    FBAInventoryCreate,
    FBAInventoryRead,
    RestockRecommendationCreate,
    RestockRecommendationRead,
    StrandedInventoryCreate,
    StrandedInventoryRead,
)
from app.services import inventory_service

logger = logging.getLogger("sellerdata.awd_sync")

router = APIRouter()


@router.get("/products/{product_id}/inventory/fba", response_model=list[FBAInventoryRead], tags=["Inventory"])
async def list_fba_inventory(
    product_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_fba_inventory(db, product_id, start_date, end_date, offset, limit)


@router.post("/products/{product_id}/inventory/fba", response_model=FBAInventoryRead, status_code=201, tags=["Inventory"])
async def upsert_fba_inventory(product_id: UUID, data: FBAInventoryCreate, db: AsyncSession = Depends(get_db)):
    return await inventory_service.upsert_fba_inventory(db, product_id, data)


@router.get("/products/{product_id}/inventory/stranded", response_model=list[StrandedInventoryRead], tags=["Inventory"])
async def list_stranded_inventory(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_stranded_inventory(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/stranded",
    response_model=StrandedInventoryRead,
    status_code=201,
    tags=["Inventory"],
)
async def create_stranded_inventory(
    product_id: UUID, data: StrandedInventoryCreate, db: AsyncSession = Depends(get_db)
):
    return await inventory_service.create_stranded_inventory(db, product_id, data)


@router.get("/products/{product_id}/inventory/aged", response_model=list[AgedInventoryRead], tags=["Inventory"])
async def list_aged_inventory(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_aged_inventory(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/aged", response_model=AgedInventoryRead, status_code=201, tags=["Inventory"]
)
async def create_aged_inventory(product_id: UUID, data: AgedInventoryCreate, db: AsyncSession = Depends(get_db)):
    return await inventory_service.create_aged_inventory(db, product_id, data)


@router.get(
    "/products/{product_id}/inventory/restock",
    response_model=list[RestockRecommendationRead],
    tags=["Inventory"],
)
async def list_restock_recommendations(
    product_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_restock_recommendations(db, product_id, offset, limit)


@router.post(
    "/products/{product_id}/inventory/restock",
    response_model=RestockRecommendationRead,
    status_code=201,
    tags=["Inventory"],
)
async def create_restock_recommendation(
    product_id: UUID, data: RestockRecommendationCreate, db: AsyncSession = Depends(get_db)
):
    return await inventory_service.create_restock_recommendation(db, product_id, data)


# --- AWD Inventory Endpoints ---


@router.get("/products/{product_id}/inventory/awd", response_model=list[AWDInventoryRead], tags=["AWD Inventory"])
async def list_awd_inventory(
    product_id: UUID,
    start_date: date | None = None,
    end_date: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await inventory_service.list_awd_inventory(db, product_id, start_date, end_date, offset, limit)


@router.post(
    "/products/{product_id}/inventory/awd", response_model=AWDInventoryRead, status_code=201, tags=["AWD Inventory"]
)
async def upsert_awd_inventory(product_id: UUID, data: AWDInventoryCreate, db: AsyncSession = Depends(get_db)):
    return await inventory_service.upsert_awd_inventory(db, product_id, data)


# --- AWD Debug Sync Endpoint ---
# This endpoint receives raw API responses from the external sync service,
# logs the raw data for debugging, and shows the field mapping.


def _extract_awd_quantities(raw_item: dict[str, Any]) -> dict[str, Any]:
    """
    Map raw Amazon API response fields to our AWD inventory fields.

    Known Amazon SP-API response shapes for inventory:

    1. FBA Inventory API (getInventorySummaries):
       {
         "sellerSku": "...",
         "fnSku": "...",
         "asin": "...",
         "inventoryDetails": {
           "fulfillableQuantity": 6120,
           "inboundWorkingQuantity": 0,
           "inboundShippedQuantity": 0,
           "inboundReceivingQuantity": 0,
           "reservedQuantity": {
             "totalReservedQuantity": 24,
             "pendingCustomerOrderQuantity": 0,
             "pendingTransshipmentQuantity": 0,
             "fcProcessingQuantity": 0
           }
         }
       }

    2. AWD Inbound Shipment / Distribution inventory:
       {
         "sku": "...",
         "fnsku": "...",
         "asin": "...",
         "totalQuantity": 6120,
         "inboundQuantity": 0,
         "onhandQuantity": 6120,
         "transferringQuantity": 0
       }

    This mapper tries ALL known shapes and extracts what it can.
    """
    mapped = {
        "seller_sku": None,
        "fnsku": None,
        "asin": None,
        "total_onhand_quantity": 0,
        "total_inbound_quantity": 0,
        "total_transferring_quantity": 0,
        "quantity_available": 0,
        "quantity_reserved": 0,
        "quantity_inbound_working": 0,
        "quantity_inbound_shipped": 0,
        "quantity_inbound_receiving": 0,
    }

    # SKU identifiers (try multiple field name conventions)
    mapped["seller_sku"] = (
        raw_item.get("sellerSku")
        or raw_item.get("seller_sku")
        or raw_item.get("sku")
        or raw_item.get("msku")
    )
    mapped["fnsku"] = raw_item.get("fnSku") or raw_item.get("fnsku")
    mapped["asin"] = raw_item.get("asin") or raw_item.get("ASIN")

    # --- Shape 1: FBA Inventory API (nested inventoryDetails) ---
    inv_details = raw_item.get("inventoryDetails") or raw_item.get("inventory_details") or {}
    if inv_details:
        mapped["quantity_available"] = _safe_int(inv_details.get("fulfillableQuantity"))
        mapped["quantity_inbound_working"] = _safe_int(inv_details.get("inboundWorkingQuantity"))
        mapped["quantity_inbound_shipped"] = _safe_int(inv_details.get("inboundShippedQuantity"))
        mapped["quantity_inbound_receiving"] = _safe_int(inv_details.get("inboundReceivingQuantity"))

        reserved = inv_details.get("reservedQuantity") or {}
        if isinstance(reserved, dict):
            mapped["quantity_reserved"] = _safe_int(reserved.get("totalReservedQuantity"))
        else:
            mapped["quantity_reserved"] = _safe_int(reserved)

        # Compute totals from breakdown
        mapped["total_onhand_quantity"] = mapped["quantity_available"] + mapped["quantity_reserved"]
        mapped["total_inbound_quantity"] = (
            mapped["quantity_inbound_working"]
            + mapped["quantity_inbound_shipped"]
            + mapped["quantity_inbound_receiving"]
        )

    # --- Shape 2: Flat AWD fields ---
    if raw_item.get("onhandQuantity") is not None or raw_item.get("onhand_quantity") is not None:
        mapped["total_onhand_quantity"] = _safe_int(
            raw_item.get("onhandQuantity") or raw_item.get("onhand_quantity")
        )
    if raw_item.get("totalQuantity") is not None or raw_item.get("total_quantity") is not None:
        # If totalQuantity is present and onhand wasn't, use it as onhand
        total_q = _safe_int(raw_item.get("totalQuantity") or raw_item.get("total_quantity"))
        if mapped["total_onhand_quantity"] == 0:
            mapped["total_onhand_quantity"] = total_q
    if raw_item.get("inboundQuantity") is not None or raw_item.get("inbound_quantity") is not None:
        mapped["total_inbound_quantity"] = _safe_int(
            raw_item.get("inboundQuantity") or raw_item.get("inbound_quantity")
        )
    if raw_item.get("transferringQuantity") is not None or raw_item.get("transferring_quantity") is not None:
        mapped["total_transferring_quantity"] = _safe_int(
            raw_item.get("transferringQuantity") or raw_item.get("transferring_quantity")
        )

    # --- Shape 3: Top-level flat fields (some APIs) ---
    if raw_item.get("fulfillableQuantity") is not None:
        mapped["quantity_available"] = _safe_int(raw_item.get("fulfillableQuantity"))
    if raw_item.get("quantity") is not None and mapped["quantity_available"] == 0:
        mapped["quantity_available"] = _safe_int(raw_item.get("quantity"))
    if raw_item.get("reservedQuantity") is not None:
        val = raw_item.get("reservedQuantity")
        if isinstance(val, dict):
            mapped["quantity_reserved"] = _safe_int(val.get("totalReservedQuantity"))
        else:
            mapped["quantity_reserved"] = _safe_int(val)

    return mapped


def _safe_int(val: Any) -> int:
    """Safely convert a value to int, defaulting to 0."""
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


@router.post("/sync/awd-inventory/debug", response_model=AWDSyncDebugResponse, tags=["AWD Inventory Sync"])
async def debug_awd_inventory_sync(request: Request):
    """
    Debug endpoint: accepts raw API response items, logs them,
    and returns the field mapping analysis WITHOUT writing to DB.

    Post the raw `inventorySummaries` array (or equivalent) from the
    Amazon API response to see exactly how fields are being mapped.
    """
    body = await request.json()

    # Accept either a list directly or an object with a known key
    raw_items: list[dict[str, Any]] = []
    if isinstance(body, list):
        raw_items = body
    elif isinstance(body, dict):
        # Try common wrapper keys
        for key in ["inventorySummaries", "inventory_summaries", "items", "data", "results", "payload"]:
            if key in body:
                raw_items = body[key] if isinstance(body[key], list) else [body[key]]
                break
        if not raw_items:
            # Treat the whole dict as a single item
            raw_items = [body]

    # Log the raw response (first 3 items)
    sample_raw = raw_items[:3]
    logger.warning(
        "AWD_SYNC_DEBUG: Raw API response sample (%d total items):\n%s",
        len(raw_items),
        json.dumps(sample_raw, indent=2, default=str),
    )

    # Map each item and log the result
    mapped_items = []
    nonzero_count = 0
    all_keys: set[str] = set()

    for item in raw_items:
        all_keys.update(item.keys())
        # Recursively collect nested keys
        for k, v in item.items():
            if isinstance(v, dict):
                all_keys.update(f"{k}.{nk}" for nk in v.keys())
                for nk, nv in v.items():
                    if isinstance(nv, dict):
                        all_keys.update(f"{k}.{nk}.{nnk}" for nnk in nv.keys())

        mapped = _extract_awd_quantities(item)
        mapped_items.append(mapped)

        if mapped["total_onhand_quantity"] > 0 or mapped["quantity_available"] > 0:
            nonzero_count += 1

    sample_mapped = mapped_items[:3]
    logger.warning(
        "AWD_SYNC_DEBUG: Mapped result sample (%d items with non-zero qty):\n%s",
        nonzero_count,
        json.dumps(sample_mapped, indent=2, default=str),
    )

    return AWDSyncDebugResponse(
        raw_sample=sample_raw,
        mapped_sample=sample_mapped,
        total_items=len(raw_items),
        items_with_nonzero_quantity=nonzero_count,
        field_keys_found=sorted(all_keys),
        message=(
            f"Analyzed {len(raw_items)} items. "
            f"{nonzero_count} have non-zero quantity. "
            f"Fields found: {sorted(all_keys)}. "
            "Review raw_sample vs mapped_sample to verify field mapping."
        ),
    )


@router.post("/sync/awd-inventory", tags=["AWD Inventory Sync"])
async def sync_awd_inventory(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receives raw AWD inventory data from the external sync service,
    maps fields using the multi-shape mapper, and upserts records.

    Logs raw data for debugging before mapping.
    """
    body = await request.json()

    # Accept either a list directly or an object with a known key
    raw_items: list[dict[str, Any]] = []
    if isinstance(body, list):
        raw_items = body
    elif isinstance(body, dict):
        for key in ["inventorySummaries", "inventory_summaries", "items", "data", "results", "payload"]:
            if key in body:
                raw_items = body[key] if isinstance(body[key], list) else [body[key]]
                break
        if not raw_items:
            raw_items = [body]

    # Log raw sample
    logger.warning(
        "AWD_SYNC: Received %d items. Raw sample:\n%s",
        len(raw_items),
        json.dumps(raw_items[:3], indent=2, default=str),
    )

    results = []
    skipped = []
    today = date.today()

    for item in raw_items:
        mapped = _extract_awd_quantities(item)
        sku = mapped["seller_sku"]

        if not sku:
            skipped.append({"reason": "no_sku", "raw": item})
            continue

        # Look up product by SKU
        from sqlalchemy import select as sa_select
        from app.db.models.product import Product
        stmt = sa_select(Product).where(Product.sku == sku)
        result = await db.execute(stmt)
        product = result.scalar_one_or_none()

        if not product:
            skipped.append({"reason": "product_not_found", "sku": sku})
            logger.info("AWD_SYNC: SKU %s not found in products table, skipping", sku)
            continue

        awd_data = AWDInventoryCreate(
            snapshot_date=today,
            seller_sku=mapped["seller_sku"],
            fnsku=mapped["fnsku"],
            asin=mapped["asin"],
            total_onhand_quantity=mapped["total_onhand_quantity"],
            total_inbound_quantity=mapped["total_inbound_quantity"],
            total_transferring_quantity=mapped["total_transferring_quantity"],
            quantity_available=mapped["quantity_available"],
            quantity_reserved=mapped["quantity_reserved"],
            quantity_inbound_working=mapped["quantity_inbound_working"],
            quantity_inbound_shipped=mapped["quantity_inbound_shipped"],
            quantity_inbound_receiving=mapped["quantity_inbound_receiving"],
        )

        record = await inventory_service.upsert_awd_inventory(db, product.id, awd_data)
        results.append({
            "sku": sku,
            "product_id": str(product.id),
            "total_onhand_quantity": mapped["total_onhand_quantity"],
            "quantity_available": mapped["quantity_available"],
            "quantity_reserved": mapped["quantity_reserved"],
        })

    await db.commit()

    logger.warning(
        "AWD_SYNC: Completed. %d upserted, %d skipped.\nResults: %s",
        len(results),
        len(skipped),
        json.dumps(results[:5], indent=2, default=str),
    )

    return {
        "synced": len(results),
        "skipped": len(skipped),
        "skipped_details": skipped[:10],
        "results_sample": results[:5],
    }
