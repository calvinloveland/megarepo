import json
from datetime import datetime

import requests

COIN_KIND_KEY = "coinKind"
COIN_BALANCE_KEY = "coinBalance"


BASE_URL = "https://api.rally.io/v1"


def get_balances(rally_id):
    url = BASE_URL + "/users/rally/" + rally_id + "/balance"
    result = requests.get(url)
    if result.status_code != 200:
        print("Request error!")
        print(url)
        print(result.status_code)
        print(type(result.json()))
        print(result.json())
        return None
    return result.json()


def get_balance_of_coin(rally_id, coin_name):
    balances = get_balances(rally_id)
    if balances is None:
        return 0.0
    find_balance_of_coin(coin_name, balances)


def find_balance_of_coin(coin_name, balances):
    if balances is None:
        return 0.0
    for coin_balance in balances:
        if coin_balance[COIN_KIND_KEY] == coin_name:
            return float(coin_balance[COIN_BALANCE_KEY])
    return 0.0


def valid_coin_symbol(coin_name):
    url = BASE_URL + "/creator_coins/" + coin_name + "/price"
    result = requests.get(url)
    if result.status_code != 200:
        print("Request error!")
        print(url)
        print(result.status_code)
        print(type(result.json()))
        print(result.json())
        return False
    return json.loads(result.json())["symbol"] is not None
