# ── api.py ────────────────────────────────────────────────
# CryptoTreasury — FastAPI Backend
# ─────────────────────────────────────────────────────────

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from fetch_balances import get_balances
from pooling import (
    calculate_surplus_deficit,
    validate_feasibility,
    generate_transfer_plan,
    calculate_before_after,
)

app = FastAPI()
app.mount("/static", StaticFiles(directory="."), name="static")
templates = Jinja2Templates(directory=".")


# ── Pydantic models ───────────────────────────────────────

class WalletInput(BaseModel):
    address: str
    role:    str
    mode:    Optional[str]
    target:  Optional[float]


class LoadRequest(BaseModel):
    wallets: List[WalletInput]


# ── Pages ─────────────────────────────────────────────────

@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(request, "index.html")


# ── Portfolio endpoints ───────────────────────────────────

@app.post("/api/load")
async def load_portfolio(payload: LoadRequest):
    wallets              = [w.model_dump() for w in payload.wallets]
    wallets_with_bals    = await get_balances(wallets)
    errors               = [w for w in wallets_with_bals if w["error"]]
    success              = [w for w in wallets_with_bals if not w["error"]]
    total_eth            = round(sum(w["balance"] for w in success), 4)
    return {
        "wallets":   wallets_with_bals,
        "total_eth": total_eth,
        "errors":    [{"address": w["address"], "error": w["error"]} for w in errors],
    }


@app.post("/api/pool")
async def pool(payload: LoadRequest):
    wallets              = [w.model_dump() for w in payload.wallets]
    wallets_with_bals    = await get_balances(wallets)
    master               = next(w for w in wallets_with_bals if w["role"] == "master")
    master_minimum       = master.get("target") or 0
    results              = calculate_surplus_deficit(wallets_with_bals, master_minimum)
    master_available     = next(w["available"] for w in results if w["role"] == "master")
    is_feasible, shortfall = validate_feasibility(results, master_available)

    if not is_feasible:
        return {"feasible": False, "shortfall": shortfall, "transfers": [], "summary": []}

    transfers = generate_transfer_plan(results)
    summary   = calculate_before_after(wallets_with_bals, transfers, master_minimum)
    return {"feasible": True, "shortfall": 0, "transfers": transfers, "summary": summary}
