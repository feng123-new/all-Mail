#!/usr/bin/env python3

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from admin_client import AdminAPIError, AdminSession


class _FixtureHandler(BaseHTTPRequestHandler):
    login_attempts: list[dict] = []
    received_cookies: list[str] = []

    def _write_json(self, status: int, payload: dict, cookie: str | None = None) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        return json.loads(self.rfile.read(length).decode()) if length else {}

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/admin/auth/login":
            payload = self._read_json()
            self.login_attempts.append(payload)
            if payload.get("otp") != "123456":
                self._write_json(
                    401,
                    {"success": False, "error": {"code": "OTP_REQUIRED"}},
                )
                return
            self._write_json(
                200,
                {
                    "success": True,
                    "data": {
                        "admin": {
                            "id": 1,
                            "username": "admin",
                            "role": "SUPER_ADMIN",
                            "mustChangePassword": False,
                            "twoFactorEnabled": True,
                        }
                    },
                },
                cookie="token=fixture-session; Path=/; HttpOnly; SameSite=Lax",
            )
            return
        if path == "/admin/emails":
            cookie = self.headers.get("Cookie") or ""
            self.received_cookies.append(cookie)
            if "token=fixture-session" not in cookie:
                self._write_json(
                    401,
                    {"success": False, "error": {"code": "UNAUTHORIZED"}},
                )
                return
            self._write_json(
                200,
                {
                    "success": True,
                    "data": {
                        "id": 9,
                        "email": "owner@example.test",
                        "provider": "GMAIL",
                        "authType": "GOOGLE_OAUTH",
                        "status": "ACTIVE",
                    },
                },
            )
            return
        self._write_json(404, {"success": False, "error": {"code": "NOT_FOUND"}})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        cookie = self.headers.get("Cookie") or ""
        self.received_cookies.append(cookie)
        if "token=fixture-session" not in cookie:
            self._write_json(
                401,
                {"success": False, "error": {"code": "UNAUTHORIZED"}},
            )
            return
        if path == "/admin/emails":
            self._write_json(
                200,
                {
                    "success": True,
                    "data": {
                        "list": [
                            {
                                "id": 9,
                                "email": "owner@example.test",
                                "provider": "GMAIL",
                                "authType": "GOOGLE_OAUTH",
                                "status": "ACTIVE",
                            }
                        ],
                        "total": 1,
                    },
                },
            )
            return
        self._write_json(404, {"success": False, "error": {"code": "NOT_FOUND"}})

    def log_message(self, format: str, *args) -> None:
        return


class AdminSessionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _FixtureHandler.login_attempts = []
        _FixtureHandler.received_cookies = []
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address
        cls.base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def test_otp_challenge_and_cookie_backed_requests(self) -> None:
        session = AdminSession(self.base_url)
        with self.assertRaises(AdminAPIError) as context:
            session.login("admin", "correct-horse-battery-staple")
        self.assertEqual(context.exception.status, 401)
        self.assertEqual(context.exception.code, "OTP_REQUIRED")

        admin = session.login(
            "admin",
            "correct-horse-battery-staple",
            otp="123456",
        )
        self.assertEqual(admin["role"], "SUPER_ADMIN")
        self.assertFalse(admin["mustChangePassword"])

        listing = session.request_json("/admin/emails?page=1&pageSize=20")
        self.assertEqual(listing["data"]["total"], 1)
        created = session.request_json(
            "/admin/emails",
            method="POST",
            data={"email": "owner@example.test"},
        )
        self.assertEqual(created["data"]["id"], 9)
        self.assertTrue(
            all("token=fixture-session" in value for value in _FixtureHandler.received_cookies)
        )

    def test_invalid_request_path_is_rejected_before_network_access(self) -> None:
        session = AdminSession(self.base_url)
        with self.assertRaisesRegex(ValueError, "must start with /"):
            session.request_json("admin/emails")


if __name__ == "__main__":
    unittest.main()
