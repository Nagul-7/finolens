"""
Options chain endpoint.

GET /options/chain/{symbol}
  Returns the nearest-expiry options chain for an NSE stock via yfinance,
  including PCR, max-pain strike, and an AI-derived signal.
"""

from fastapi import APIRouter, HTTPException
from app.models.schemas import OptionsChainResponse, OptionsRow

router = APIRouter(prefix="/options", tags=["options"])


def _calculate_max_pain(calls_df, puts_df) -> float:
    """Return the strike price at which total option value at expiry is minimum."""
    import pandas as pd
    all_strikes = sorted(set(
        calls_df["strike"].tolist() + puts_df["strike"].tolist()
    ))
    if not all_strikes:
        return 0.0

    min_pain = float("inf")
    max_pain_strike = all_strikes[0]

    for s in all_strikes:
        call_loss = sum(
            max(s - float(row["strike"]), 0) * int(row.get("openInterest", 0) or 0)
            for _, row in calls_df.iterrows()
        )
        put_loss = sum(
            max(float(row["strike"]) - s, 0) * int(row.get("openInterest", 0) or 0)
            for _, row in puts_df.iterrows()
        )
        total = call_loss + put_loss
        if total < min_pain:
            min_pain = total
            max_pain_strike = s

    return float(max_pain_strike)


def _ai_signal(pcr: float, current_price: float, max_pain: float) -> tuple[str, str]:
    pain_diff_pct = (current_price - max_pain) / max_pain * 100 if max_pain else 0

    if pcr > 1.5:
        return "STRONG BUY", f"PCR {pcr:.2f} — heavy put writing indicates strong bullish sentiment"
    if pcr > 1.1:
        return "BUY", f"PCR {pcr:.2f} — put-call ratio tilted bullish"
    if pcr < 0.7:
        return "STRONG SELL", f"PCR {pcr:.2f} — heavy call writing indicates bearish pressure"
    if pcr < 0.9:
        return "SELL", f"PCR {pcr:.2f} — options flow slightly bearish"
    if abs(pain_diff_pct) < 1:
        return "NEUTRAL", f"Price near max pain ({max_pain:.0f}) — expect consolidation"
    return "NEUTRAL", f"PCR {pcr:.2f} — balanced options activity, no clear directional bias"


@router.get("/chain/{symbol}", response_model=OptionsChainResponse)
async def get_options_chain(symbol: str):
    symbol = symbol.upper().strip()
    if symbol.endswith(".NS"):
        symbol = symbol[:-3]

    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol}.NS")

        expiries = ticker.options
        if not expiries:
            raise HTTPException(status_code=404, detail=f"No options data available for '{symbol}'.")

        # Use nearest expiry
        nearest = expiries[0]
        chain = ticker.option_chain(nearest)
        calls_df = chain.calls
        puts_df  = chain.puts

        if calls_df.empty and puts_df.empty:
            raise HTTPException(status_code=404, detail=f"Empty options chain for '{symbol}'.")

        # Current price from recent history
        hist = ticker.history(period="5d", auto_adjust=True)
        if hist.empty:
            raise HTTPException(status_code=404, detail=f"No price data for '{symbol}'.")
        current_price = round(float(hist["Close"].iloc[-1]), 2)

        # PCR
        total_call_oi = int(calls_df["openInterest"].fillna(0).sum())
        total_put_oi  = int(puts_df["openInterest"].fillna(0).sum())
        pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else 1.0

        # Max pain
        max_pain = _calculate_max_pain(calls_df, puts_df)

        ai_signal, ai_reason = _ai_signal(pcr, current_price, max_pain)

        def _row(r) -> OptionsRow:
            return OptionsRow(
                strike=round(float(r.get("strike", 0)), 2),
                oi=int(r.get("openInterest", 0) or 0),
                chg_oi=0,
                volume=int(r.get("volume", 0) or 0),
                iv=round(float(r.get("impliedVolatility", 0) or 0) * 100, 2),
                ltp=round(float(r.get("lastPrice", 0) or 0), 2),
                ltp_chg_pct=round(float(r.get("percentChange", 0) or 0), 2),
                itm=bool(r.get("inTheMoney", False)),
            )

        calls_list = [_row(r) for r in calls_df.to_dict("records")]
        puts_list  = [_row(r) for r in puts_df.to_dict("records")]

        return OptionsChainResponse(
            symbol=symbol,
            expiry=nearest,
            current_price=current_price,
            pcr=pcr,
            max_pain=round(max_pain, 2),
            ai_signal=ai_signal,
            ai_reason=ai_reason,
            calls=calls_list,
            puts=puts_list,
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Options chain fetch failed: {exc}")
