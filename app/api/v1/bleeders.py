from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.bleeders import BleedersConfig, BleedersReportBundle
from app.services.bleeders import csv_export, service

router = APIRouter()


def get_bleeders_config(
    target_acos: float = Query(30.0, gt=0, description="Target/break-even ACOS in percent"),
    sp_acos_uplift: float = Query(20.0, ge=0),
    sb_sd_acos_uplift: float = Query(10.0, ge=0),
    b1_clicks_threshold: int = Query(10, ge=1),
    b1_window_days: int = Query(60, ge=1),
    b2_window_days: int = Query(30, ge=1),
    b2_max_orders: int = Query(5, ge=1),
    campaign_acos_threshold: float = Query(100.0, gt=0),
    exclude_ranking_campaigns: bool = Query(True),
) -> BleedersConfig:
    return BleedersConfig(
        target_acos=target_acos,
        sp_acos_uplift=sp_acos_uplift,
        sb_sd_acos_uplift=sb_sd_acos_uplift,
        b1_clicks_threshold=b1_clicks_threshold,
        b1_window_days=b1_window_days,
        b2_window_days=b2_window_days,
        b2_max_orders=b2_max_orders,
        campaign_acos_threshold=campaign_acos_threshold,
        exclude_ranking_campaigns=exclude_ranking_campaigns,
    )


@router.get("/sellers/{seller_id}/bleeders/report", response_model=BleedersReportBundle, tags=["Bleeders"])
async def get_bleeders_report(
    seller_id: UUID,
    report_date: date | None = Query(None, description="Report end date; defaults to today"),
    marketplace_id: UUID | None = Query(None, description="Limit to one marketplace; defaults to all"),
    config: BleedersConfig = Depends(get_bleeders_config),
    db: AsyncSession = Depends(get_db),
):
    """Generate the Bleeders report for every active marketplace of the seller."""
    return await service.generate_reports(
        db, seller_id, report_date or date.today(), config, marketplace_id=marketplace_id
    )


@router.get("/sellers/{seller_id}/bleeders/report.csv", tags=["Bleeders"])
async def get_bleeders_report_csv(
    seller_id: UUID,
    report_date: date | None = Query(None, description="Report end date; defaults to today"),
    marketplace_id: UUID | None = Query(None, description="Limit to one marketplace; defaults to all"),
    config: BleedersConfig = Depends(get_bleeders_config),
    db: AsyncSession = Depends(get_db),
):
    """Download the Bleeders report in the GNO CSV format.

    With a marketplace_id, the file matches the GNO per-marketplace layout exactly;
    without one, all marketplaces are combined and a Marketplace column is appended.
    """
    resolved_date = report_date or date.today()
    bundle = await service.generate_reports(db, seller_id, resolved_date, config, marketplace_id=marketplace_id)

    if marketplace_id:
        if not bundle.reports:
            raise HTTPException(status_code=404, detail="Marketplace not found for this seller")
        report = bundle.reports[0]
        content = csv_export.report_to_csv(report)
        filename = f"GNO_Bleeders_Report_{report.marketplace_code}_{resolved_date:%Y%m%d}.csv"
    else:
        content = csv_export.bundle_to_csv(bundle)
        filename = f"GNO_Bleeders_Report_ALL_{resolved_date:%Y%m%d}.csv"

    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
