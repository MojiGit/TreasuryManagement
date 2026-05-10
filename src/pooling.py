# ── pooling.py ────────────────────────────────────────────
# Core Cash Pooling Algorithm for CryptoTreasury
# ─────────────────────────────────────────────────────────

def calculate_surplus_deficit(wallets, master_minimum=0):
    """
    Calculate surplus and deficit for each wallet.

    Parameters:
        wallets: list of dicts, each representing a wallet:
            {
                "address":  str,   # wallet address
                "role":     str,   # "master" or "sub"
                "mode":     str,   # "zero" or "target" (ignored for master)
                "target":   float, # target ETH balance (only for "target" mode)
                "balance":  float  # current ETH balance
            }
        master_minimum: float, minimum ETH to keep in master (default 0)

    Returns:
        results: list of dicts with surplus/deficit per wallet
        master_available: float, how much ETH master can distribute
    """
    results = []

    for wallet in wallets:

        if wallet["role"] == "master":
            # Master: calculate how much is available to distribute
            available = wallet["balance"] - master_minimum
            results.append({
                "address":   wallet["address"],
                "role":      "master",
                "balance":   wallet["balance"],
                "target":    master_minimum,
                "surplus":   0,
                "deficit":   0,
                "available": round(available, 4)
            })

        elif wallet["role"] == "sub":

            if wallet["mode"] == "zero":
                # Zero balance: entire balance is surplus
                results.append({
                    "address": wallet["address"],
                    "role":    "sub",
                    "balance": wallet["balance"],
                    "target":  0,
                    "surplus": round(wallet["balance"], 4),
                    "deficit": 0,
                })

            elif wallet["mode"] == "target":
                diff = wallet["balance"] - wallet["target"]

                if diff > 0:
                    # Current > target: surplus
                    results.append({
                        "address": wallet["address"],
                        "role":    "sub",
                        "balance": wallet["balance"],
                        "target":  wallet["target"],
                        "surplus": round(diff, 4),
                        "deficit": 0,
                    })
                elif diff < 0:
                    # Current < target: deficit
                    results.append({
                        "address": wallet["address"],
                        "role":    "sub",
                        "balance": wallet["balance"],
                        "target":  wallet["target"],
                        "surplus": 0,
                        "deficit": round(abs(diff), 4),
                    })
                else:
                    # Current = target: no action needed
                    results.append({
                        "address": wallet["address"],
                        "role":    "sub",
                        "balance": wallet["balance"],
                        "target":  wallet["target"],
                        "surplus": 0,
                        "deficit": 0,
                    })

    return results


def print_surplus_deficit(results):
    """Print a readable summary of surplus/deficit per wallet."""
    print("\n── Wallet Summary ───────────────────────────────────")
    print(f"{'Address':<20} {'Role':<8} {'Balance':>10} {'Target':>10} {'Surplus':>10} {'Deficit':>10}")
    print("─" * 72)

    for w in results:
        address_short = w["address"][:6] + "..." + w["address"][-4:]
        role    = w["role"]
        balance = f"{w['balance']:.4f}"
        target  = f"{w['target']:.4f}"
        surplus = f"{w['surplus']:.4f}" if w["surplus"] > 0 else "-"
        deficit = f"{w['deficit']:.4f}" if w["deficit"] > 0 else "-"
        print(f"{address_short:<20} {role:<8} {balance:>10} {target:>10} {surplus:>10} {deficit:>10}")

    print("─" * 72)

    # ---------------

def validate_feasibility(results, master_available):
    """
        Check if there is enough ETH to meet all deficits.

        Returns:
            is_feasible: bool
            shortfall:   float (0 if feasible)
    """

    total_surplus = sum(w["surplus"] for w in results if w["role"] == "sub")
    total_deficit = sum(w["deficit"] for w in results if w["role"] == "sub")
    total_available = total_surplus + master_available

    shortfall = max(0, total_deficit - total_available)
    # Use an epsilon threshold rather than exact equality: floating-point arithmetic
    # on rounded 4dp values can produce residuals like 1e-15 instead of exact 0,
    # which would show "Insufficient funds. Shortfall: 0.0000 ETH" to the user.
    is_feasible = shortfall < 1e-9

    return is_feasible, round(shortfall, 4)


def generate_transfer_plan(results):
    """
    Generate the optimal transfer plan using greedy matching.

    Priority:
        1. Sub->Sub direct transfers (reduces total transaction count)
        2. Remaining surpluses -> Master
        3. Master -> remaining deficits

    Returns:
        transfers: list of dicts, each representing one transfer
        {
            "from":   str,   # source wallet address
            "to":     str,   # destination wallet address
            "amount": float, # ETH amount
            "type":   str    # "sub_to_sub", "sub_to_master", "master_to_sub"
        }
    """
    transfers = []

    # Work on mutable copies so we don't modify the originals
    master  = next(w for w in results if w["role"] == "master")
    surplus_wallets = sorted(
        [{"address": w["address"], "amount": w["surplus"]} for w in results if w["surplus"] > 0],
        key=lambda x: x["amount"], reverse=True  # largest surplus first
    )
    deficit_wallets = sorted(
        [{"address": w["address"], "amount": w["deficit"]} for w in results if w["deficit"] > 0],
        key=lambda x: x["amount"], reverse=True  # largest deficit first
    )

    # ── Step 1: Sub->Sub matching ─────────────────────────
    # Match largest surplus to largest deficit directly
    for surplus in surplus_wallets:
        for deficit in deficit_wallets:
            if surplus["amount"] <= 0 or deficit["amount"] <= 0:
                continue

            match_amount = min(surplus["amount"], deficit["amount"])
            match_amount = round(match_amount, 4)

            if match_amount > 0:
                transfers.append({
                    "from":   surplus["address"],
                    "to":     deficit["address"],
                    "amount": match_amount,
                    "type":   "sub_to_sub"
                })
                surplus["amount"] = round(surplus["amount"] - match_amount, 4)
                deficit["amount"] = round(deficit["amount"] - match_amount, 4)

    # ── Step 2: Remaining surpluses -> Master ─────────────
    for surplus in surplus_wallets:
        if surplus["amount"] > 0:
            transfers.append({
                "from":   surplus["address"],
                "to":     master["address"],
                "amount": surplus["amount"],
                "type":   "sub_to_master"
            })
            surplus["amount"] = 0

    # ── Step 3: Master -> remaining deficits ─────────────
    for deficit in deficit_wallets:
        if deficit["amount"] > 0:
            transfers.append({
                "from":   master["address"],
                "to":     deficit["address"],
                "amount": deficit["amount"],
                "type":   "master_to_sub"
            })
            deficit["amount"] = 0

    return transfers


def print_transfer_plan(transfers):
    """Print a readable numbered transfer plan."""
    print("\n── Transfer Plan ────────────────────────────────────")

    if not transfers:
        print("All wallets are already at target. No transfers required.")
        print("─" * 72)
        return

    type_order = {"sub_to_sub": 1, "sub_to_master": 2, "master_to_sub": 3}
    sorted_transfers = sorted(transfers, key=lambda x: type_order[x["type"]])

    type_labels = {
        "sub_to_sub":     "Sub → Sub",
        "sub_to_master":  "Sub → Master",
        "master_to_sub":  "Master → Sub"
    }

    print(f"{'#':<4} {'Type':<16} {'From':<22} {'To':<22} {'Amount':>10}")
    print("─" * 78)

    for i, t in enumerate(sorted_transfers, 1):
        from_short  = t["from"][:6]  + "..." + t["from"][-4:]
        to_short    = t["to"][:6]    + "..." + t["to"][-4:]
        label       = type_labels[t["type"]]
        amount      = f"{t['amount']:.4f} ETH"
        print(f"{i:<4} {label:<16} {from_short:<22} {to_short:<22} {amount:>14}")

    print("─" * 78)
    total_eth = sum(t["amount"] for t in sorted_transfers)
    print(f"{'Total transfers:':<44} {len(sorted_transfers)}")
    print(f"{'Total ETH moved:':<44} {round(total_eth, 4)} ETH")
    print("─" * 78)

def calculate_before_after(wallets, transfers, master_minimum=0):
    """
    Calculate the before and after balances for each wallet.

    Returns a list of dicts showing the full picture per wallet.
    """
    # Build a lookup of post-pool balances starting from current
    post_balances = {w["address"]: w["balance"] for w in wallets}

    for t in transfers:
        post_balances[t["from"]] = round(post_balances[t["from"]] - t["amount"], 4)
        post_balances[t["to"]]   = round(post_balances[t["to"]]   + t["amount"], 4)

    summary = []
    for w in wallets:
        current  = w["balance"]
        post     = post_balances[w["address"]]
        target   = w["target"] if w["target"] is not None else master_minimum
        delta    = round(post - current, 4)

        summary.append({
            "address": w["address"],
            "role":    w["role"],
            "current": current,
            "target":  target,
            "post":    post,
            "delta":   delta
        })

    return summary


def print_before_after(summary):
    """Print a before/after comparison table."""
    print("\n── Before / After ───────────────────────────────────")
    print(f"{'Address':<20} {'Role':<8} {'Before':>10} {'Target':>10} {'After':>10} {'Delta':>10}")
    print("─" * 72)

    for w in summary:
        address_short = w["address"][:6] + "..." + w["address"][-4:]
        delta_str = f"+{w['delta']:.4f}" if w["delta"] > 0 else f"{w['delta']:.4f}"
        delta_str = "-" if w["delta"] == 0 else delta_str
        print(
            f"{address_short:<20} {w['role']:<8} "
            f"{w['current']:>10.4f} {w['target']:>10.4f} "
            f"{w['post']:>10.4f} {delta_str:>10}"
        )

    print("─" * 72)


if __name__ == "__main__":

    test_wallets = [
        {"address": "0xMASTER1234567890123456789012345678901234",
         "role": "master", "mode": None, "target": None, "balance": 10.0},
        {"address": "0xSUBA1234567890123456789012345678901234AB",
         "role": "sub", "mode": "zero", "target": 0, "balance": 3.0},
        {"address": "0xSUBB1234567890123456789012345678901234BC",
         "role": "sub", "mode": "target", "target": 3.0, "balance": 5.0},
        {"address": "0xSUBC1234567890123456789012345678901234CD",
         "role": "sub", "mode": "target", "target": 4.0, "balance": 1.0},
        {"address": "0xSUBD1234567890123456789012345678901234DE",
         "role": "sub", "mode": "target", "target": 2.0, "balance": 2.0},
    ]

    master_minimum = 2.0
    results = calculate_surplus_deficit(test_wallets, master_minimum)
    print_surplus_deficit(results)

    # Get master available from results
    master_available = next(w["available"] for w in results if w["role"] == "master")

    # Validate feasibility
    is_feasible, shortfall = validate_feasibility(results, master_available)
    if not is_feasible:
        print(f"\n❌ Insufficient funds. Shortfall: {shortfall} ETH")
    else:
        print(f"\n✅ Feasibility check passed.")
        transfers = generate_transfer_plan(results)
        print_transfer_plan(transfers)    
        summary = calculate_before_after(test_wallets, transfers, master_minimum)
        print_before_after(summary)
        