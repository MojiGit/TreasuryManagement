# ── fetch_balances.py ─────────────────────────────────────
# Fetch ETH and USDT balances for multiple wallets
# ─────────────────────────────────────────────────────────

import asyncio
import aiohttp
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY       = os.getenv("ETHERSCAN_API_KEY")
ETHERSCAN_URL = "https://api.etherscan.io/v2/api"

# Tether USD (USDT) — Ethereum mainnet ERC-20 contract
USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
USDT_DECIMALS = 6


async def _fetch_usdt_balance(session: aiohttp.ClientSession, address: str):
    """
    Fetch USDT balance for one address.
    Returns (balance_float, None) on success.
    Returns (0.0, error_string) on failure so callers can distinguish
    a genuine zero balance from a fetch error.
    """
    params = {
        "chainid":         1,
        "module":          "account",
        "action":          "tokenbalance",
        "contractaddress": USDT_CONTRACT,
        "address":         address,
        "tag":             "latest",
        "apikey":          API_KEY,
    }
    try:
        async with session.get(
            ETHERSCAN_URL, params=params,
            timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            data = await resp.json()
        if data["status"] == "1":
            return round(int(data["result"]) / 10 ** USDT_DECIMALS, 2), None
        return 0.0, data.get("result", "Etherscan USDT error")
    except Exception as e:
        return 0.0, str(e)


async def get_balances(wallets: list) -> list:
    """
    Fetch ETH and USDT balances for all wallets.
    Uses one batched ETH call and concurrent per-wallet USDT calls.
    Returns wallet dicts enriched with 'balance' (ETH) and 'usdt_balance' (USDT).
    """
    addresses = [w["address"] for w in wallets]

    eth_params = {
        "chainid": 1,
        "module":  "account",
        "action":  "balancemulti",
        "address": ",".join(addresses),
        "tag":     "latest",
        "apikey":  API_KEY,
    }

    try:
        async with aiohttp.ClientSession() as session:
            # ETH — single batched request
            async with session.get(
                ETHERSCAN_URL, params=eth_params,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                eth_data = await resp.json()

            # USDT — sequential requests to avoid Etherscan rate-limit errors.
            # Concurrent calls hit the free-tier burst limit; only the first
            # succeeds and the rest return 0.  Sequential calls stay well within
            # the 5 req/s allowance.
            usdt_results = []
            for addr in addresses:
                usdt_results.append(await _fetch_usdt_balance(session, addr))

        # Split into balance and error maps
        usdt_map       = {addr: bal for addr, (bal, _)   in zip(addresses, usdt_results)}
        usdt_error_map = {addr: err for addr, (_, err)   in zip(addresses, usdt_results) if err}

        if eth_data["status"] == "1":
            eth_map = {
                item["account"].lower(): int(item["balance"])
                for item in eth_data["result"]
            }
            result = []
            for wallet in wallets:
                wei  = eth_map.get(wallet["address"].lower())
                usdt = usdt_map.get(wallet["address"], 0.0)
                usdt_err = usdt_error_map.get(wallet["address"])
                if wei is not None:
                    result.append({
                        **wallet,
                        "balance":      round(wei / 10 ** 18, 4),
                        "usdt_balance": usdt,
                        "usdt_error":   usdt_err,   # None = OK; string = fetch failed
                        "error":        None,
                    })
                else:
                    result.append({
                        **wallet,
                        "balance":      0,
                        "usdt_balance": 0.0,
                        "usdt_error":   usdt_err,
                        "error":        "Address not found in response",
                    })
            return result

        else:
            error_msg = eth_data.get("result", "Etherscan API error")
            return [{**w, "balance": 0, "usdt_balance": 0.0, "error": error_msg} for w in wallets]

    except asyncio.TimeoutError:
        return [{**w, "balance": 0, "usdt_balance": 0.0,
                 "error": "Timeout — Etherscan did not respond in 10 s"} for w in wallets]
    except Exception as e:
        return [{**w, "balance": 0, "usdt_balance": 0.0, "error": str(e)} for w in wallets]


def print_balances(wallets_with_balances: list) -> None:
    """Print a clean balance summary (CLI utility)."""
    print("\n-- Live Portfolio -------------------------------------------")
    print(f"{'Address':<20} {'Role':<8} {'ETH':>12} {'USDT':>14}  Status")
    print("-" * 64)

    total_eth = total_usdt = 0.0
    for w in wallets_with_balances:
        short = w["address"][:6] + "..." + w["address"][-4:]
        if w["error"]:
            print(f"{short:<20} {w['role']:<8} {'ERROR':>12} {'ERROR':>14}  ! {w['error']}")
        else:
            print(f"{short:<20} {w['role']:<8} {w['balance']:>12.4f} {w['usdt_balance']:>14.2f}  ok")
            total_eth  += w["balance"]
            total_usdt += w["usdt_balance"]

    print("-" * 64)
    print(f"{'Total ETH:':<36} {total_eth:.4f}")
    print(f"{'Total USDT:':<36} {total_usdt:.2f}")
    print("-" * 64)


# ── Test ──────────────────────────────────────────────────
if __name__ == "__main__":
    test_wallets = [
        {"address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
         "role": "master", "mode": None, "target": None},
        {"address": "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",
         "role": "sub",    "mode": "target", "target": 100.0},
        {"address": "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",
         "role": "sub",    "mode": "zero",   "target": 0},
    ]
    result = asyncio.run(get_balances(test_wallets))
    print_balances(result)
