# ── api.py ────────────────────────────────────────────────
# CryptoTreasury — FastAPI Backend
# ─────────────────────────────────────────────────────────

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import List, Optional
import aiohttp
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from fetch_balances import get_balances, API_KEY, ETHERSCAN_URL
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
    address:      str
    role:         str
    mode:         Optional[str]   = None
    target:       Optional[float] = None
    usdt_mode:    Optional[str]   = None
    usdt_target:  Optional[float] = None
    # Pre-fetched balances — when the frontend includes these the pool endpoint
    # skips the second Etherscan round-trip.  This prevents a silent USDT = 0
    # if the token-balance API returns an error on the re-fetch.
    balance:      Optional[float] = None
    usdt_balance: Optional[float] = None


class LoadRequest(BaseModel):
    wallets: List[WalletInput]


# ── Pages ─────────────────────────────────────────────────

@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse(request, "index.html")


# ── Helpers ───────────────────────────────────────────────

def _build_inputs(wallets_with_bals, balance_key, mode_key, target_key):
    """
    Build pooling-algorithm input dicts for a given token.
      balance_key : "balance"      for ETH  | "usdt_balance" for USDT
      mode_key    : "mode"         for ETH  | "usdt_mode"    for USDT
      target_key  : "target"       for ETH  | "usdt_target"  for USDT
    """
    return [
        {
            "address": w["address"],
            "role":    w["role"],
            "balance": w[balance_key],
            "mode":    w.get(mode_key),
            "target":  w.get(target_key),
        }
        for w in wallets_with_bals
    ]


def _run_pool(inputs):
    """
    Run the full pooling pipeline on a set of token inputs.
    Always returns a summary (zero-change when infeasible) so the
    frontend can render the after-view for the feasible token.
    Returns (feasible, shortfall, transfers, summary).
    """
    master           = next(w for w in inputs if w["role"] == "master")
    master_minimum   = master.get("target") or 0
    results          = calculate_surplus_deficit(inputs, master_minimum)
    master_available = next(w["available"] for w in results if w["role"] == "master")
    feasible, shortfall = validate_feasibility(results, master_available)

    if not feasible:
        # Return a no-change summary so the after-view still has data
        summary = calculate_before_after(inputs, [], master_minimum)
        return False, shortfall, [], summary

    transfers = generate_transfer_plan(results)
    summary   = calculate_before_after(inputs, transfers, master_minimum)
    return True, 0, transfers, summary


# ── Portfolio endpoints ───────────────────────────────────

@app.post("/api/load")
async def load_portfolio(payload: LoadRequest):
    wallets           = [w.model_dump() for w in payload.wallets]
    wallets_with_bals = await get_balances(wallets)
    errors            = [w for w in wallets_with_bals if w["error"]]
    success           = [w for w in wallets_with_bals if not w["error"]]
    total_eth         = round(sum(w["balance"]      for w in success), 4)
    total_usdt        = round(sum(w["usdt_balance"] for w in success), 2)
    return {
        "wallets":    wallets_with_bals,
        "total_eth":  total_eth,
        "total_usdt": total_usdt,
        "errors":     [{"address": w["address"], "error": w["error"]} for w in errors],
    }



@app.get("/api/gas")
async def gas_oracle():
    """
    Proxy to Etherscan Gas Tracker — must run server-side because Etherscan
    does not include CORS headers, so direct browser requests are blocked.
    Returns ProposeGasPrice in Gwei as a float.
    """
    params = {
        "chainid": 1,
        "module":  "gastracker",
        "action":  "gasoracle",
        "apikey":  API_KEY,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                ETHERSCAN_URL, params=params,
                timeout=aiohttp.ClientTimeout(total=8)
            ) as resp:
                data = await resp.json()
        if data.get("status") == "1":
            r        = data["result"]
            propose  = float(r["ProposeGasPrice"])
            # Add a priority fee (tip) equal to the base fee, capped at 1 Gwei.
            # Kept server-side so the frontend receives only the effective price.
            tip      = min(propose, 1.0)
            return {"propose": round(propose + tip, 9)}
    except Exception:
        pass
    return {"propose": None}


@app.post("/api/pool")
async def pool(payload: LoadRequest):
    wallets = [w.model_dump() for w in payload.wallets]

    # If the frontend already sent pre-fetched balances, use them directly and
    # skip the second Etherscan call.  A second call can silently return 0 for
    # USDT (rate-limit / transient error), which would produce no USDT transfers
    # even when wallets hold real USDT.  The user can always hit ↺ Refresh in
    # the portfolio view to pull fresh balances before running the pool.
    if all(w.get("balance") is not None and w.get("usdt_balance") is not None
           for w in wallets):
        wallets_with_bals = wallets
    else:
        wallets_with_bals = await get_balances(wallets)

    # ── ETH pooling ───────────────────────────────────────
    eth_inputs = _build_inputs(wallets_with_bals, "balance",      "mode",      "target")
    eth_feasible, eth_shortfall, eth_transfers, eth_summary = _run_pool(eth_inputs)
    for t in eth_transfers:
        t["token"] = "ETH"

    # ── USDT pooling ──────────────────────────────────────
    usdt_inputs = _build_inputs(wallets_with_bals, "usdt_balance", "usdt_mode", "usdt_target")
    usdt_feasible, usdt_shortfall, usdt_transfers, usdt_summary = _run_pool(usdt_inputs)
    for t in usdt_transfers:
        t["token"] = "USDT"

    # ── Merged transfer list (ETH first, then USDT) ───────
    all_transfers = eth_transfers + usdt_transfers

    # ── Merged per-wallet summary ─────────────────────────
    usdt_map = {w["address"]: w for w in usdt_summary}
    merged_summary = []
    for eth_entry in eth_summary:
        addr = eth_entry["address"]
        usdt = usdt_map.get(addr, {})
        merged_summary.append({
            **eth_entry,
            "usdt_current": usdt.get("current", 0.0),
            "usdt_target":  usdt.get("target",  0.0),
            "usdt_post":    usdt.get("post",     0.0),
            "usdt_delta":   usdt.get("delta",    0.0),
        })

    return {
        "eth_feasible":   eth_feasible,
        "eth_shortfall":  eth_shortfall,
        "usdt_feasible":  usdt_feasible,
        "usdt_shortfall": usdt_shortfall,
        "transfers":      all_transfers,
        "summary":        merged_summary,
    }
