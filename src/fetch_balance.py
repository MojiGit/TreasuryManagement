import requests
import os
from dotenv import load_dotenv

# Load the API key from .env file
load_dotenv()
API_KEY = os.getenv("ETHERSCAN_API_KEY")

def get_eth_balance(wallet_address):
    """
    Fetch the ETH balance of a wallet address using the Etherscan API.
    Returns the balance in ETH (not Wei).
    """
    url = "https://api.etherscan.io/v2/api"
    
    params = {
        "chainid": 1,
        "module": "account",
        "action": "balance",
        "address": wallet_address,
        "tag": "latest",
        "apikey": API_KEY
    }
    
    response = requests.get(url, params=params)
    data = response.json()

    if data["status"] == "1":
        balance_wei = int(data["result"])
        balance_eth = balance_wei / 10**18
        return round(balance_eth, 4)
    else:
        raise ValueError(f"API error: {data['message']} - {data['result']}")


# ── Run it ────────────────────────────────────────────────
if __name__ == "__main__":
    # Vitalik Buterin's public wallet — safe to use for testing
    test_address = "0x90512Af0B4d88C91b344A7F359CF35c7F83e948f"
    
    print(f"Fetching balance for: {test_address}")
    balance = get_eth_balance(test_address)
    print(f"Balance: {balance} ETH")