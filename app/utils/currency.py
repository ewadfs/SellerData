from decimal import Decimal

EXCHANGE_RATES_TO_USD: dict[str, Decimal] = {
    "USD": Decimal("1.0"),
    "CAD": Decimal("0.74"),
    "MXN": Decimal("0.058"),
    "GBP": Decimal("1.27"),
    "EUR": Decimal("1.09"),
    "SEK": Decimal("0.096"),
    "PLN": Decimal("0.25"),
    "JPY": Decimal("0.0067"),
    "AUD": Decimal("0.65"),
    "INR": Decimal("0.012"),
}


def convert_to_usd(amount: Decimal, from_currency: str) -> Decimal:
    rate = EXCHANGE_RATES_TO_USD.get(from_currency)
    if rate is None:
        raise ValueError(f"Unknown currency: {from_currency}")
    return (amount * rate).quantize(Decimal("0.01"))
