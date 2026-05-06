# ── fetch_balances.py ─────────────────────────────────────
# Fetch ETH balances for multiple wallets in a single API call
# ─────────────────────────────────────────────────────────

import asyncio
import aiohttp
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("ETHERSCAN_API_KEY")
ETHERSCAN_URL = "https://api.etherscan.io/v2/api"


async def get_balances(wallets):
    """
    Fetch ETH balances for all wallets in one balancemulti call.
    Supports up to 20 addresses. Returns wallet dicts with balance populated.
    """
    addresses = [w["address"] for w in wallets]

    params = {
        "chainid": 1,
        "module":  "account",
        "action":  "balancemulti",
        "address": ",".join(addresses),
        "tag":     "latest",
        "apikey":  API_KEY
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                ETHERSCAN_URL, params=params,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                data = await response.json()

        if data["status"] == "1":
            balance_map = {
                item["account"].lower(): int(item["balance"])
                for item in data["result"]
            }
            result = []
            for wallet in wallets:
                wei = balance_map.get(wallet["address"].lower())
                if wei is not None:
                    result.append({**wallet, "balance": round(wei / 10**18, 4), "error": None})
                else:
                    result.append({**wallet, "balance": 0, "error": "Address not found in response"})
            return result

        else:
            error_msg = data.get("result", "Etherscan API error")
            return [{**w, "balance": 0, "error": error_msg} for w in wallets]

    except asyncio.TimeoutError:
        return [{**w, "balance": 0, "error": "Timeout — Etherscan did not respond in 10 seconds"} for w in wallets]
    except Exception as e:
        return [{**w, "balance": 0, "error": str(e)} for w in wallets]


def print_balances(wallets_with_balances):
    """Print a clean balance summary."""
    print("\n-- Live Portfolio -------------------------------------------")
    print(f"{'Address':<20} {'Role':<8} {'Balance':>12} {'Status'}")
    print("-" * 60)

    total = 0
    for w in wallets_with_balances:
        address_short = w["address"][:6] + "..." + w["address"][-4:]
        if w["error"]:
            print(f"{address_short:<20} {w['role']:<8} {'ERROR':>12}   ! {w['error']}")
        else:
            balance_str = f"{w['balance']:.4f} ETH"
            print(f"{address_short:<20} {w['role']:<8} {balance_str:>12}   ok")
            total += w["balance"]

    print("-" * 60)
    print(f"{'Total ETH:':<30} {total:.4f} ETH")
    print("-" * 60)


# ── Test it ───────────────────────────────────────────────
if __name__ == "__main__":

    test_wallets = [
        {"address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "role": "master", "mode": None,     "target": None},
        {"address": "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8", "role": "sub",    "mode": "target", "target": 100.0},
        {"address": "0x8EB8a3b98659Cce290402893d0123abb75E3ab28", "role": "sub",    "mode": "zero",   "target": 0},
    ]

    print("Fetching live balances from Etherscan...")
    result = asyncio.run(get_balances(test_wallets))
    print_balances(result)
