#!/usr/bin/env python3
"""Cookie-backed all-Mail administrator client for the Gmail OAuth helper."""

from __future__ import annotations

import json
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener


class AdminAPIError(RuntimeError):
    """Structured all-Mail API failure without exposing request credentials."""

    def __init__(
        self,
        status: int,
        method: str,
        url: str,
        payload: dict[str, Any] | None,
        raw_body: str,
    ) -> None:
        self.status = status
        self.method = method
        self.url = url
        self.payload = payload or {}
        self.raw_body = raw_body
        error = self.payload.get("error")
        self.code = str(error.get("code") or "") if isinstance(error, dict) else ""
        super().__init__(self.describe())

    def describe(self) -> str:
        suffix = f" ({self.code})" if self.code else ""
        detail = ""
        error = self.payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                detail = f": {message.strip()}"
        if not detail and self.raw_body and len(self.raw_body) <= 500:
            detail = f": {self.raw_body}"
        return f"all-Mail API returned HTTP {self.status}{suffix} for {self.method} {self.url}{detail}"


class AdminSession:
    """Minimal JSON client that preserves the administrator session cookie."""

    def __init__(self, base_url: str, timeout_seconds: int = 60) -> None:
        normalized = base_url.strip().rstrip("/")
        if not normalized:
            raise ValueError("base_url is required")
        self.base_url = normalized
        self.timeout_seconds = timeout_seconds
        self.cookie_jar = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookie_jar))

    def request_json(
        self,
        path: str,
        method: str = "GET",
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not path.startswith("/"):
            raise ValueError("request path must start with /")
        url = f"{self.base_url}{path}"
        payload = json.dumps(data).encode() if data is not None else None
        headers = {
            "Accept": "application/json",
            "User-Agent": "all-Mail-gmail-oauth-helper/2.1",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode()
        except HTTPError as error:
            body = error.read().decode()
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = None
            raise AdminAPIError(error.code, method, url, parsed, body) from error

        if not body.strip():
            return {}
        try:
            result = json.loads(body)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                f"all-Mail API returned invalid JSON for {method} {url}"
            ) from error
        if not isinstance(result, dict):
            raise RuntimeError(
                f"all-Mail API returned a non-object JSON response for {method} {url}"
            )
        return result

    def login(
        self,
        username: str,
        password: str,
        otp: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "username": username,
            "password": password,
        }
        if otp:
            payload["otp"] = otp
        response = self.request_json("/admin/auth/login", method="POST", data=payload)
        data = response.get("data")
        admin = data.get("admin") if isinstance(data, dict) else None
        if not isinstance(admin, dict):
            raise RuntimeError("all-Mail login response did not contain data.admin")
        if not list(self.cookie_jar):
            raise RuntimeError("all-Mail login succeeded without an administrator session cookie")
        return admin
