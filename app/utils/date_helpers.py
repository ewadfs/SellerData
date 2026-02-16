from datetime import date, timedelta


def date_range(start: date, end: date) -> list[date]:
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]


def trailing_period(end_date: date, days: int) -> tuple[date, date]:
    start = end_date - timedelta(days=days - 1)
    return start, end_date
