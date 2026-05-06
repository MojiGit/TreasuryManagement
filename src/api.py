# ── api.py ────────────────────────────────────────────────
# CryptoTreasury — FastAPI Backend
# ─────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends, Response, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, EmailStr, field_validator
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
from auth import (
    hash_password, verify_password,
    create_token, COOKIE_NAME, EXPIRE_DAYS,
    get_user_id_from_cookie,
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


class AuthRequest(BaseModel):
    email:    str
    password: str

    @field_validator("password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class SaveConfigRequest(BaseModel):
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


# ── Auth endpoints ────────────────────────────────────────

def _get_db():
    from database import get_db
    try:
        return get_db()
    except RuntimeError as e:
        raise HTTPException(503, detail=str(e))


@app.post("/api/auth/register", status_code=201)
async def register(payload: AuthRequest, response: Response):
    db = _get_db()

    # Check if email already exists
    existing = db.table("users").select("id").eq("email", payload.email.lower()).execute()
    if existing.data:
        raise HTTPException(400, detail="Email already registered")

    result = db.table("users").insert({
        "email":         payload.email.lower(),
        "password_hash": hash_password(payload.password),
    }).execute()

    user = result.data[0]
    token = create_token(user["id"])
    response.set_cookie(
        key=COOKIE_NAME, value=token,
        httponly=True, samesite="lax",
        max_age=EXPIRE_DAYS * 86400,
    )
    return {"user_id": user["id"], "email": user["email"]}


@app.post("/api/auth/login")
async def login(payload: AuthRequest, response: Response):
    db = _get_db()

    result = db.table("users").select("*").eq("email", payload.email.lower()).execute()
    user   = result.data[0] if result.data else None

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, detail="Invalid email or password")

    token = create_token(user["id"])
    response.set_cookie(
        key=COOKIE_NAME, value=token,
        httponly=True, samesite="lax",
        max_age=EXPIRE_DAYS * 86400,
    )
    return {"user_id": user["id"], "email": user["email"]}


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user_id: Optional[str] = Depends(get_user_id_from_cookie)):
    if not user_id:
        return {"user_id": None, "email": None}

    try:
        db     = _get_db()
        result = db.table("users").select("id, email").eq("id", user_id).execute()
        user   = result.data[0] if result.data else None
        if not user:
            return {"user_id": None, "email": None}
        return {"user_id": user["id"], "email": user["email"]}
    except HTTPException:
        return {"user_id": None, "email": None}


# ── Wallet config endpoints ───────────────────────────────

@app.get("/api/wallet-config")
async def get_wallet_config(user_id: Optional[str] = Depends(get_user_id_from_cookie)):
    if not user_id:
        return {"config": None}
    db     = _get_db()
    result = db.table("wallet_configs").select("config").eq("user_id", user_id).execute()
    config = result.data[0]["config"] if result.data else None
    return {"config": config}


@app.post("/api/wallet-config")
async def save_wallet_config(
    payload: SaveConfigRequest,
    user_id: Optional[str] = Depends(get_user_id_from_cookie),
):
    if not user_id:
        raise HTTPException(401, detail="Login required to save configuration")

    db = _get_db()
    db.table("wallet_configs").upsert({
        "user_id":    user_id,
        "config":     [w.model_dump() for w in payload.wallets],
        "updated_at": "now()",
    }).execute()
    return {"ok": True}
