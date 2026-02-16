import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.advertising import AdMetricsDaily
from app.db.models.business_report import BusinessReportDaily
from app.db.models.keywords import KeywordRanking
from app.db.models.sales import Order, OrderLineItem, Refund
from app.schemas.ab_testing import ABTestMetricSnapshotCreate


class SnapshotCollector:
    """Gathers daily metrics from various data sources for A/B test analysis."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def collect_for_date(
        self, product_id: uuid.UUID, snapshot_date: date, period_type: str
    ) -> ABTestMetricSnapshotCreate:
        """Collect all metrics for a product on a given date."""
        biz = await self._get_business_report(product_id, snapshot_date)
        ad_data = await self._get_ad_metrics(product_id, snapshot_date)
        rank_data = await self._get_avg_rank(product_id, snapshot_date)
        refund_data = await self._get_refund_data(product_id, snapshot_date)

        return ABTestMetricSnapshotCreate(
            snapshot_date=snapshot_date,
            period_type=period_type,
            sessions=biz.get("sessions"),
            page_views=biz.get("page_views"),
            units_ordered=biz.get("units_ordered"),
            ordered_product_sales=biz.get("ordered_product_sales"),
            unit_session_percentage=biz.get("unit_session_percentage"),
            buy_box_percentage=biz.get("buy_box_percentage"),
            organic_rank_avg=rank_data,
            ad_spend=ad_data.get("spend"),
            ad_sales=ad_data.get("sales"),
            refund_count=refund_data.get("count"),
            refund_amount=refund_data.get("amount"),
            currency=biz.get("currency"),
        )

    async def _get_business_report(self, product_id: uuid.UUID, report_date: date) -> dict:
        stmt = select(BusinessReportDaily).where(
            BusinessReportDaily.product_id == product_id,
            BusinessReportDaily.report_date == report_date,
        )
        result = await self.db.execute(stmt)
        report = result.scalar_one_or_none()
        if report is None:
            return {}
        return {
            "sessions": report.sessions,
            "page_views": report.page_views,
            "units_ordered": report.units_ordered,
            "ordered_product_sales": float(report.ordered_product_sales) if report.ordered_product_sales else None,
            "unit_session_percentage": float(report.unit_session_percentage) if report.unit_session_percentage else None,
            "buy_box_percentage": float(report.buy_box_percentage) if report.buy_box_percentage else None,
            "currency": report.currency,
        }

    async def _get_ad_metrics(self, product_id: uuid.UUID, report_date: date) -> dict:
        stmt = select(
            func.coalesce(func.sum(AdMetricsDaily.spend), 0),
            func.coalesce(func.sum(AdMetricsDaily.sales_14d), 0),
        ).where(
            AdMetricsDaily.product_id == product_id,
            AdMetricsDaily.report_date == report_date,
        )
        result = await self.db.execute(stmt)
        row = result.one()
        return {"spend": float(row[0]), "sales": float(row[1])}

    async def _get_avg_rank(self, product_id: uuid.UUID, check_date: date) -> float | None:
        stmt = select(func.avg(KeywordRanking.organic_rank)).where(
            KeywordRanking.product_id == product_id,
            KeywordRanking.check_date == check_date,
            KeywordRanking.organic_rank.isnot(None),
        )
        result = await self.db.execute(stmt)
        avg = result.scalar()
        return float(avg) if avg is not None else None

    async def _get_refund_data(self, product_id: uuid.UUID, refund_date: date) -> dict:
        stmt = (
            select(
                func.count(Refund.id),
                func.coalesce(func.sum(Refund.refund_amount), 0),
            )
            .join(OrderLineItem, Refund.order_line_item_id == OrderLineItem.id)
            .where(
                OrderLineItem.product_id == product_id,
                func.date(Refund.refund_date) == refund_date,
            )
        )
        result = await self.db.execute(stmt)
        row = result.one()
        return {"count": row[0], "amount": float(row[1])}
