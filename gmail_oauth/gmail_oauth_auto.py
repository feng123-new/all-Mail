#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import secrets
import ssl
import subprocess
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "gmail_oauth.env"
RUNTIME_DIR = ROOT / "runtime"
CERT_DIR = RUNTIME_DIR / "certs"
DEFAULT_SCOPES = "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://mail.google.com/"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(
            f"Config file not found: {path}\nCopy {ROOT / 'gmail_oauth.env.example'} to {path} first."
        )

    config: dict[str, str] = {}
    for index, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"Invalid config line {index}: {raw_line}")
        key, value = line.split("=", 1)
        parsed = value.strip()
        if len(parsed) >= 2 and parsed[0] == parsed[-1] and parsed[0] in {'"', "'"}:
            parsed = parsed[1:-1]
        config[key.strip()] = parsed
    return config


def require(config: dict[str, str], key: str) -> str:
    value = config.get(key, "").strip()
    if not value:
        raise SystemExit(f"Missing required config key: {key}")
    return value


def is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def maybe_decode_jwt(token: str | None) -> dict:
    if not token:
        return {}
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return {}


def post_form(url: str, data: dict[str, str]) -> tuple[int, dict]:
    body = urlencode(data).encode()
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urlopen(request, timeout=60) as response:
            return response.getcode(), json.loads(response.read().decode())
    except HTTPError as error:
        payload = error.read().decode()
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = {"raw": payload}
        return error.code, parsed


def request_json(
    url: str,
    method: str = "GET",
    data: dict | None = None,
    headers: dict[str, str] | None = None,
) -> dict:
    payload = json.dumps(data).encode() if data is not None else None
    request_headers = {"Content-Type": "application/json"} if data is not None else {}
    if headers:
        request_headers.update(headers)
    request = Request(url, data=payload, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode())
    except HTTPError as error:
        body = error.read().decode()
        raise SystemExit(f"HTTP {error.code} for {method} {url}\n{body}")


def build_code_verifier() -> str:
    return secrets.token_urlsafe(64).rstrip("=")


def build_code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def load_google_client_settings(config: dict[str, str]) -> dict[str, object]:
    json_path_raw = config.get("GOOGLE_CLIENT_SECRET_JSON", "").strip()
    json_info: dict[str, object] = {}
    if json_path_raw:
        json_path = Path(json_path_raw).expanduser().resolve()
        if not json_path.exists():
            raise SystemExit(f"GOOGLE_CLIENT_SECRET_JSON not found: {json_path}")
        payload = json.loads(json_path.read_text())
        node = payload.get("installed") or payload.get("web")
        if not isinstance(node, dict):
            raise SystemExit(
                "Google client JSON must contain either 'installed' or 'web'"
            )
        json_info = {
            "jsonPath": str(json_path),
            "kind": "installed" if "installed" in payload else "web",
            "clientId": str(node.get("client_id") or "").strip(),
            "clientSecret": str(node.get("client_secret") or "").strip(),
            "redirectUris": [
                str(item).strip()
                for item in node.get("redirect_uris") or []
                if str(item).strip()
            ],
        }

    client_id = (
        config.get("GOOGLE_CLIENT_ID", "").strip()
        or str(json_info.get("clientId") or "").strip()
    )
    if not client_id:
        raise SystemExit(
            "Missing GOOGLE_CLIENT_ID (or GOOGLE_CLIENT_SECRET_JSON with client_id)"
        )
    client_secret_raw = config.get("GOOGLE_CLIENT_SECRET", "").strip()
    client_secret = (
        client_secret_raw or str(json_info.get("clientSecret") or "").strip() or None
    )

    redirect_uris = json_info.get("redirectUris")
    safe_redirect_uris = redirect_uris if isinstance(redirect_uris, list) else []

    return {
        "clientId": client_id,
        "clientSecret": client_secret,
        "kind": str(json_info.get("kind") or "manual"),
        "jsonPath": str(json_info.get("jsonPath") or ""),
        "redirectUris": safe_redirect_uris,
    }


def build_redirect_uri(
    config: dict[str, str], client_settings: dict[str, object]
) -> str:
    explicit = config.get("REDIRECT_URI", "").strip()
    if explicit:
        return explicit

    raw_redirect_uris = client_settings.get("redirectUris")
    redirect_uris = (
        [str(item).strip() for item in raw_redirect_uris if str(item).strip()]
        if isinstance(raw_redirect_uris, list)
        else []
    )
    if redirect_uris:
        return redirect_uris[0]

    host = config.get("REDIRECT_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(config.get("REDIRECT_PORT", "8766").strip() or "8766")
    path = config.get("REDIRECT_PATH", "/callback").strip() or "/callback"
    if not path.startswith("/"):
        path = "/" + path
    return f"http://{host}:{port}{path}"


def build_auth_url(
    client_id: str, redirect_uri: str, scopes: str, state: str, code_challenge: str
) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return AUTH_URL + "?" + urlencode(params)


def fetch_userinfo(access_token: str) -> dict:
    request = Request(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def detect_email(config: dict[str, str], token_payload: dict) -> str | None:
    configured = config.get("ACCOUNT_EMAIL", "").strip()
    if configured:
        return configured
    id_claims = maybe_decode_jwt(token_payload.get("id_token"))
    for key in ("email", "preferred_username", "upn"):
        value = id_claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    access_token = token_payload.get("access_token")
    if isinstance(access_token, str) and access_token.strip():
        try:
            profile = fetch_userinfo(access_token)
            value = profile.get("email")
            if isinstance(value, str) and value.strip():
                return value.strip()
        except Exception:
            return None
    return None


def fetch_gmail_profile(access_token: str) -> dict:
    request = Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def fetch_gmail_messages(
    access_token: str, mailbox: str = "INBOX", limit: int = 5
) -> dict:
    params = urlencode({"labelIds": mailbox.upper(), "maxResults": str(limit)})
    request = Request(
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{params}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def find_existing_email(base_url: str, token: str, email: str) -> dict | None:
    query = urlencode({"page": 1, "pageSize": 20, "keyword": email})
    response = request_json(
        f"{base_url}/admin/emails?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )
    items = response.get("data", {}).get("list", [])
    target = email.strip().lower()
    for item in items:
        if str(item.get("email", "")).strip().lower() == target:
            return item
    return None


def create_email_account(
    base_url: str, token: str, payload: dict[str, str | None]
) -> dict:
    return request_json(
        f"{base_url}/admin/emails",
        method="POST",
        data={
            "email": payload["email"],
            "provider": "GMAIL",
            "authType": "GOOGLE_OAUTH",
            "clientId": payload["clientId"],
            "clientSecret": payload["clientSecret"],
            "refreshToken": payload["refreshToken"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )["data"]


def update_email_account(
    base_url: str, token: str, email_id: int, payload: dict[str, str | None]
) -> dict:
    return request_json(
        f"{base_url}/admin/emails/{email_id}",
        method="PUT",
        data={
            "email": payload["email"],
            "provider": "GMAIL",
            "authType": "GOOGLE_OAUTH",
            "clientId": payload["clientId"],
            "clientSecret": payload["clientSecret"],
            "refreshToken": payload["refreshToken"],
            "password": None,
            "status": "ACTIVE",
        },
        headers={"Authorization": f"Bearer {token}"},
    )["data"]


def maybe_auto_update_mailbox(
    config: dict[str, str],
    payload: dict[str, str | None],
    mailbox: str,
    skip_update: bool,
    skip_fetch_check: bool,
) -> dict | None:
    if skip_update:
        return None

    target_email_id = config.get("TARGET_EMAIL_ID", "").strip()
    admin_base_url = config.get("ADMIN_BASE_URL", "").strip()
    admin_username = config.get("ADMIN_USERNAME", "").strip()
    admin_password = config.get("ADMIN_PASSWORD", "").strip()
    allow_target_replace = is_truthy(config.get("ALLOW_TARGET_ID_REPLACE", ""))

    if not (admin_base_url and admin_username and admin_password):
        return None

    base_url = admin_base_url.rstrip("/")
    login = request_json(
        f"{base_url}/admin/auth/login",
        method="POST",
        data={"username": admin_username, "password": admin_password},
    )
    token = login["data"]["token"]
    existing_exact = find_existing_email(base_url, token, str(payload["email"]))

    action = "updated_exact_email"
    if existing_exact:
        email_id = int(existing_exact["id"])
        update_response = update_email_account(base_url, token, email_id, payload)
    else:
        if not target_email_id:
            action = "created_new_email"
            update_response = create_email_account(base_url, token, payload)
            email_id = int(update_response["id"])
        else:
            email_id = int(target_email_id)
            target_detail = request_json(
                f"{base_url}/admin/emails/{email_id}",
                headers={"Authorization": f"Bearer {token}"},
            )["data"]
            target_email = str(target_detail.get("email", "")).strip().lower()
            payload_email = str(payload["email"]).strip().lower()

            if target_email == payload_email:
                action = "updated_target_id"
                update_response = update_email_account(
                    base_url, token, email_id, payload
                )
            elif allow_target_replace:
                action = "replaced_target_id"
                update_response = update_email_account(
                    base_url, token, email_id, payload
                )
            else:
                action = "created_new_email"
                update_response = create_email_account(base_url, token, payload)
                email_id = int(update_response["id"])

    summary: dict[str, object] = {
        "updated": True,
        "action": action,
        "emailId": email_id,
        "email": update_response["email"],
        "status": update_response["status"],
        "updatedAt": update_response.get("updatedAt"),
    }

    detail = request_json(
        f"{base_url}/admin/emails/{email_id}?secrets=true",
        headers={"Authorization": f"Bearer {token}"},
    )["data"]
    summary["verify"] = {
        "email": detail["email"],
        "provider": detail["provider"],
        "authType": detail["authType"],
        "clientId": detail["clientId"],
        "clientSecretLength": len(detail.get("clientSecret") or ""),
        "refreshTokenLength": len(detail.get("refreshToken") or ""),
        "status": detail["status"],
    }

    if not skip_fetch_check:
        fetch_response = request_json(
            f"{base_url}/admin/emails/{email_id}/mails?mailbox={mailbox}",
            headers={"Authorization": f"Bearer {token}"},
        )
        summary["fetch"] = {
            "mailbox": mailbox,
            "method": fetch_response["data"].get("method"),
            "count": fetch_response["data"].get("count"),
            "firstSubject": (
                (fetch_response["data"].get("messages") or [{}])[0].get("subject")
                if fetch_response["data"].get("messages")
                else None
            ),
        }

    return summary


class CallbackCapture:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.query: dict[str, list[str]] | None = None


def ensure_localhost_certificate(hostname: str) -> tuple[Path, Path]:
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    cert_path = CERT_DIR / "localhost-cert.pem"
    key_path = CERT_DIR / "localhost-key.pem"
    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    san_entries = ["DNS:localhost", "IP:127.0.0.1"]
    if hostname not in {"localhost", "127.0.0.1"}:
        san_entries.append(f"DNS:{hostname}")
    command = [
        "openssl",
        "req",
        "-x509",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-keyout",
        str(key_path),
        "-out",
        str(cert_path),
        "-days",
        "3",
        "-subj",
        "/CN=localhost",
        "-addext",
        f"subjectAltName={','.join(san_entries)}",
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            f"Failed to generate localhost certificate via openssl: {error.stderr or error.stdout}"
        )
    return cert_path, key_path


def create_callback_server(parsed_redirect, capture: CallbackCapture):
    expected_path = parsed_redirect.path or "/"

    class OAuthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path != expected_path:
                self.send_response(404)
                self.end_headers()
                return
            capture.query = parse_qs(parsed.query)
            capture.event.set()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                "<html><body><h2>Google OAuth completed.</h2><p>You can return to the terminal.</p></body></html>".encode()
            )

        def log_message(self, format, *args):
            return

    host = parsed_redirect.hostname or "127.0.0.1"
    port = parsed_redirect.port or (443 if parsed_redirect.scheme == "https" else 80)
    server = ThreadingHTTPServer((host, port), OAuthHandler)
    if parsed_redirect.scheme == "https":
        cert_path, key_path = ensure_localhost_certificate(host)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def wait_for_callback(
    server: ThreadingHTTPServer, capture: CallbackCapture, timeout_seconds: int
) -> dict[str, list[str]]:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        if not capture.event.wait(timeout_seconds):
            raise SystemExit(
                f"Timed out waiting for Google callback after {timeout_seconds} seconds"
            )
        if capture.query is None:
            raise SystemExit("Google callback finished without query parameters")
        return capture.query
    finally:
        server.shutdown()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Automatic Gmail OAuth helper for all-Mail."
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG), help="Path to gmail_oauth.env file"
    )
    parser.add_argument(
        "--timeout", type=int, default=300, help="Seconds to wait for Google callback"
    )
    parser.add_argument(
        "--no-open-browser",
        action="store_true",
        help="Print auth URL only, do not auto-open browser",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Validate config and generate auth URL, then exit",
    )
    parser.add_argument(
        "--skip-update",
        action="store_true",
        help="Do not auto-create/update mailbox in all-Mail admin",
    )
    parser.add_argument(
        "--skip-fetch-check",
        action="store_true",
        help="Skip mailbox fetch verification after auto update",
    )
    args = parser.parse_args()

    config = load_env_file(Path(args.config).expanduser().resolve())
    client_settings = load_google_client_settings(config)
    client_id = str(client_settings["clientId"])
    client_secret = client_settings["clientSecret"]
    redirect_uri = build_redirect_uri(config, client_settings)
    parsed_redirect = urlparse(redirect_uri)
    if parsed_redirect.scheme not in {"http", "https"}:
        raise SystemExit(f"Unsupported redirect URI scheme: {redirect_uri}")

    scopes = config.get("SCOPES", DEFAULT_SCOPES).strip() or DEFAULT_SCOPES
    mailbox = config.get("MAILBOX", "INBOX").strip() or "INBOX"
    state = secrets.token_urlsafe(24)
    code_verifier = build_code_verifier()
    code_challenge = build_code_challenge(code_verifier)
    auth_url = build_auth_url(client_id, redirect_uri, scopes, state, code_challenge)

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    (RUNTIME_DIR / "gmail_last_auth_url.txt").write_text(auth_url)
    (RUNTIME_DIR / "gmail_last_redirect_uri.txt").write_text(redirect_uri + "\n")
    save_json(
        RUNTIME_DIR / "gmail_last_client_info.json",
        {
            "clientKind": client_settings["kind"],
            "clientJsonPath": client_settings["jsonPath"],
            "redirectUri": redirect_uri,
            "scopes": scopes.split(),
        },
    )

    print("== Step 1 / Browser authorization ==")
    print("Google authorization URL:")
    print(auth_url)
    print()
    print(f"redirect_uri={redirect_uri}")
    print(f"client_kind={client_settings['kind']}")
    if client_settings["jsonPath"]:
        print(f"client_json={client_settings['jsonPath']}")
    if parsed_redirect.scheme == "https":
        print(
            "NOTE: this Google client uses an HTTPS localhost callback. A temporary self-signed localhost certificate will be generated automatically."
        )
        print(
            "If your browser warns about the localhost certificate, continue through the warning once so the callback can complete."
        )
    print()

    if args.prepare_only:
        print("prepare_only=true")
        return 0

    if not args.no_open_browser:
        opened = webbrowser.open(auth_url)
        print(f"browser_opened={opened}")
    else:
        print("browser_opened=false")

    capture = CallbackCapture()
    server = create_callback_server(parsed_redirect, capture)
    print(f"Waiting for Google callback on {redirect_uri} ...")
    query = wait_for_callback(server, capture, args.timeout)

    if query.get("state", [""])[0] != state:
        raise SystemExit("State mismatch in Google callback")
    if query.get("error", [""])[0]:
        raise SystemExit(f"Google OAuth returned error: {query.get('error', [''])[0]}")
    code = query.get("code", [""])[0]
    if not code:
        raise SystemExit("Google callback did not include authorization code")

    print("\n== Step 2 / Exchange auth code ==")
    exchange_form = {
        "client_id": client_id,
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    if client_secret:
        exchange_form["client_secret"] = str(client_secret)
    exchange_status, exchange_payload = post_form(TOKEN_URL, exchange_form)
    if exchange_status != 200:
        print(json.dumps(exchange_payload, ensure_ascii=False, indent=2))
        raise SystemExit(f"Google code exchange failed with status {exchange_status}")

    refresh_token = exchange_payload.get("refresh_token", "")
    if not refresh_token:
        raise SystemExit(
            "Exchange succeeded but refresh_token is missing. Re-consent may be required."
        )

    save_json(RUNTIME_DIR / "gmail_latest_tokens.json", exchange_payload)
    email = detect_email(config, exchange_payload)
    if not email:
        raise SystemExit(
            "Could not detect Gmail address from token response. Set ACCOUNT_EMAIL in gmail_oauth.env and retry."
        )

    print("has_refresh_token=true")
    print(f"detected_email={email}")

    print("\n== Step 3 / Verify Google refresh and Gmail access ==")
    refresh_form = {
        "client_id": client_id,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if client_secret:
        refresh_form["client_secret"] = str(client_secret)
    refresh_status, refresh_payload = post_form(TOKEN_URL, refresh_form)
    if refresh_status != 200:
        print(json.dumps(refresh_payload, ensure_ascii=False, indent=2))
        raise SystemExit(
            f"Refresh token verification failed with status {refresh_status}"
        )

    access_token = str(
        refresh_payload.get("access_token", "")
        or exchange_payload.get("access_token", "")
    )
    if not access_token:
        raise SystemExit("Refresh succeeded but access_token is missing")

    profile = fetch_gmail_profile(access_token)
    message_list = fetch_gmail_messages(access_token, mailbox=mailbox.upper(), limit=5)
    verify_summary: dict[str, object] = {
        "email": email,
        "grantedScope": exchange_payload.get("scope"),
        "refreshStatus": refresh_status,
        "gmailProfile": {
            "emailAddress": profile.get("emailAddress"),
            "messagesTotal": profile.get("messagesTotal"),
            "threadsTotal": profile.get("threadsTotal"),
        },
        "gmailApi": {
            "mailbox": mailbox.upper(),
            "listedMessages": len(message_list.get("messages") or []),
        },
    }
    save_json(RUNTIME_DIR / "gmail_latest_verify.json", verify_summary)

    payload = {
        "email": email,
        "clientId": client_id,
        "clientSecret": str(client_secret) if client_secret else None,
        "refreshToken": refresh_token,
    }
    save_json(RUNTIME_DIR / "gmail_latest_payload.json", payload)
    import_line = f"GMAIL----{email}----{client_id}----{str(client_secret or '')}----{refresh_token}"
    (RUNTIME_DIR / "gmail_latest_import.txt").write_text(import_line + "\n")

    print("\n== Step 4 / Ready-to-import line ==")
    print(import_line)

    auto_update_summary = maybe_auto_update_mailbox(
        config,
        payload,
        mailbox=mailbox.upper(),
        skip_update=args.skip_update,
        skip_fetch_check=args.skip_fetch_check,
    )
    if auto_update_summary:
        save_json(RUNTIME_DIR / "gmail_latest_update_result.json", auto_update_summary)
        verify_summary["autoUpdate"] = auto_update_summary
        save_json(RUNTIME_DIR / "gmail_latest_verify.json", verify_summary)
        print("\n== Step 5 / Auto update all-Mail mailbox ==")
        print(json.dumps(auto_update_summary, ensure_ascii=False, indent=2))

    print("\nFiles written under:", RUNTIME_DIR)
    print("- gmail_last_auth_url.txt: latest Google authorization URL")
    print("- gmail_last_redirect_uri.txt: active redirect URI")
    print("- gmail_last_client_info.json: resolved client source + scopes")
    print("- gmail_latest_tokens.json: Google auth-code exchange result")
    print("- gmail_latest_payload.json: admin create/update payload")
    print("- gmail_latest_import.txt: GMAIL import line")
    print("- gmail_latest_verify.json: profile/API verification summary")
    if auto_update_summary:
        print(
            "- gmail_latest_update_result.json: all-Mail update + mailbox fetch summary"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
