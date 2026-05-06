# ── main.py ───────────────────────────────────────────────
# CryptoTreasury — Full Pipeline
# Fetch live balances → Run pooling algorithm → Output plan
# ─────────────────────────────────────────────────────────

import asyncio
from fetch_balances import get_balances, print_balances
from pooling import (
    calculate_surplus_deficit,
    validate_feasibility,
    generate_transfer_plan,
    calculate_before_after,
    print_surplus_deficit,
    print_transfer_plan,
    print_before_after
)


def run_pool(wallet_config, master_minimum=0):
    """
    Full pipeline:
    1. Fetch live balances for all wallets
    2. Calculate surplus/deficit
    3. Validate feasibility
    4. Generate transfer plan
    5. Show before/after view

    Parameters:
        wallet_config:    list of wallet dicts (without balances)
        master_minimum:   float, minimum ETH to keep in master
    """

    # ── Step 1: Fetch live balances ───────────────────────
    print("\nFetching live balances from Etherscan...")
    wallets = asyncio.run(get_balances(wallet_config))
    print_balances(wallets)

    # ── Step 2: Calculate surplus/deficit ─────────────────
    results = calculate_surplus_deficit(wallets, master_minimum)
    print_surplus_deficit(results)

    # ── Step 3: Validate feasibility ──────────────────────
    master_available = next(w["available"] for w in results if w["role"] == "master")
    is_feasible, shortfall = validate_feasibility(results, master_available)

    if not is_feasible:
        print(f"\n❌ Insufficient funds. Shortfall: {shortfall} ETH")
        print("   Increase master balance or reduce subwallet targets.")
        return

    print(f"\n✅ Feasibility check passed.")

    # ── Step 4: Generate transfer plan ────────────────────
    transfers = generate_transfer_plan(results)
    print_transfer_plan(transfers)

    # ── Step 5: Before/after view ─────────────────────────
    summary = calculate_before_after(wallets, transfers, master_minimum)
    print_before_after(summary)


# ── Define your wallets here ──────────────────────────────
if __name__ == "__main__":

    # Replace these with real wallet addresses to test
    # For now we use well-known public addresses
    wallet_config = [
        {
            "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",  # Vitalik
            "role":    "master",
            "mode":    None,
            "target":  None,
        },
        {
            "address": "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",  # Binance
            "role":    "sub",
            "mode":    "target",
            "target":  1996000.0,
        },
        {
            "address": "0x8EB8a3b98659Cce290402893d0123abb75E3ab28",  # Kraken
            "role":    "sub",
            "mode":    "zero",
            "target":  0,
        },
    ]

    # Master minimum balance: keep at least 100 ETH in master
    run_pool(wallet_config, master_minimum=100.0)