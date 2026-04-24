from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import signals
from app.routers.market_data import router as market_router
from app.routers.technical import router as technical_router
from app.routers.options import router as options_router
from app.routers.screener import router as screener_router
from app.models.schemas import HealthResponse
from datetime import datetime, timezone
import uvicorn

app = FastAPI(
    title="FinoLens ML Service",
    description="NSE signal engine — RSI · MACD · Bollinger Bands · VWAP · EMA · Options",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(signals.router)
app.include_router(market_router)
app.include_router(technical_router)
app.include_router(options_router)
app.include_router(screener_router)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        service="finolens-ml",
        version="2.0.0",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
