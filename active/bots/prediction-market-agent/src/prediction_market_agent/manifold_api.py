from __future__ import annotations

import json
from typing import Any, Protocol
from urllib import error, parse, request


class APIError(RuntimeError):
    pass


class JsonTransport(Protocol):
    def request_json(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> Any:
        ...


class UrllibTransport:
    def request_json(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: float = 10.0,
    ) -> Any:
        encoded_payload = None
        request_headers = dict(headers or {})
        if payload is not None:
            encoded_payload = json.dumps(payload).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        req = request.Request(url, data=encoded_payload, headers=request_headers, method=method)
        try:
            with request.urlopen(req, timeout=timeout) as response:
                body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            raise APIError(body or f"HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise APIError(str(exc.reason)) from exc
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise APIError("Received non-JSON response from Manifold API") from exc


class ManifoldClient:
    def __init__(
        self,
        base_url: str = "https://api.manifold.markets",
        api_key: str | None = None,
        transport: JsonTransport | None = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.transport = transport or UrllibTransport()
        self.timeout_seconds = timeout_seconds

    def _headers(self, require_auth: bool = False) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Key {self.api_key}"
        elif require_auth:
            raise ValueError("This endpoint requires MANIFOLD_API_KEY")
        return headers

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        require_auth: bool = False,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            query = parse.urlencode({key: value for key, value in params.items() if value is not None})
            if query:
                url = f"{url}?{query}"
        return self.transport.request_json(
            method=method,
            url=url,
            headers=self._headers(require_auth=require_auth),
            payload=payload,
            timeout=self.timeout_seconds,
        )

    def get_market(self, market_id: str) -> dict[str, Any]:
        safe_id = parse.quote(market_id, safe="")
        return self._request("GET", f"/v0/market/{safe_id}")

    def list_comments(self, market_id: str) -> list[dict[str, Any]]:
        response = self._request("GET", "/v0/comments", params={"contractId": market_id})
        return list(response)

    def get_user_by_id(self, user_id: str) -> dict[str, Any]:
        safe_id = parse.quote(user_id, safe="")
        return self._request("GET", f"/v0/user/by-id/{safe_id}")

    def get_me(self) -> dict[str, Any]:
        return self._request("GET", "/v0/me", require_auth=True)

    def place_bet(
        self,
        contract_id: str,
        amount: float,
        outcome: str,
        limit_prob: float | None = None,
    ) -> dict[str, Any]:
        payload = {
            "amount": amount,
            "contractId": contract_id,
            "outcome": outcome,
        }
        if limit_prob is not None:
            payload["limitProb"] = limit_prob
        response = self._request("POST", "/v0/bet", payload=payload, require_auth=True)
        return dict(response)
