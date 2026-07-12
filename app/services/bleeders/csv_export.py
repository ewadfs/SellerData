"""Render Bleeders reports as CSV in the GNO report format."""

import csv
import io

from app.schemas.bleeders import BleederRow, BleedersMarketplaceReport, BleedersReportBundle

CSV_COLUMNS = [
    "Type",
    "Portfolio",
    "Campaign",
    "Ad Group",
    "Target / Keyword",
    "Customer Search Term",
    "Match Type",
    "Level",
    "Impressions",
    "Clicks",
    "Spend",
    "CTR",
    "CPC",
    "Sales",
    "Orders",
    "CVR",
    "ACoS",
    "ROAS",
    "Reason",
    "Reason Category",
    "Decision",
    "Bid Down %",
    "Source",
]

CURRENCY_SYMBOLS = {
    "USD": "$",
    "CAD": "$",
    "MXN": "$",
    "AUD": "$",
    "GBP": "£",
    "EUR": "€",
    "JPY": "¥",
    "SEK": "kr",
    "PLN": "zł",
    "INR": "₹",
}


def _money(value: float, currency: str) -> str:
    symbol = CURRENCY_SYMBOLS.get(currency, "")
    return f"{symbol}{value:.2f}"


def _pct(value: float | None) -> str:
    return f"{value:.1f}%" if value is not None else "0.0%"


def _match_type(value: str | None) -> str:
    return value.capitalize() if value else ""


def _row_values(row: BleederRow) -> list[str]:
    return [
        row.campaign_type,
        row.portfolio or "(No Portfolio)",
        row.campaign,
        row.ad_group or "",
        row.target or "",
        row.search_term or "",
        _match_type(row.match_type),
        row.level,
        str(row.impressions),
        str(row.clicks),
        _money(row.spend, row.currency),
        _pct(row.ctr),
        _money(row.cpc or 0, row.currency),
        _money(row.sales, row.currency),
        str(row.orders),
        _pct(row.cvr),
        _pct(row.acos),
        f"{row.roas:.2f}" if row.roas is not None else "0.00",
        row.reason,
        row.reason_category,
        "",  # Decision — filled in by the operator
        "",  # Bid Down % — filled in by the operator
        row.source,
    ]


def report_to_csv(report: BleedersMarketplaceReport, include_marketplace: bool = False) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    columns = [*CSV_COLUMNS, "Marketplace"] if include_marketplace else CSV_COLUMNS
    writer.writerow(columns)
    for row in report.rows:
        values = _row_values(row)
        if include_marketplace:
            values.append(report.marketplace_code)
        writer.writerow(values)
    return buffer.getvalue()


def bundle_to_csv(bundle: BleedersReportBundle) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([*CSV_COLUMNS, "Marketplace"])
    for report in bundle.reports:
        for row in report.rows:
            writer.writerow([*_row_values(row), report.marketplace_code])
    return buffer.getvalue()
