#!/usr/bin/env python3
import argparse
import base64
import json
import secrets
import socket
import ssl
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / "runtime"
DEFAULT_CONFIG = ROOT / "config.env"
DEFAULT_SCOPES = "offline_access openid profile https://graph.microsoft.com/Mail.Read https://outlook.office.com/IMAP.AccessAsUser.All"
DEFAULT_TENANT = "consumers"
IMAP_HOST = "outlook.office365.com"
IMAP_PORT = 993
OIDC_SCOPES = {"openid", "profile", "email", "offline_access"}
GRAPH_MAIL_READ_SCOPE = "https://graph.microsoft.com/Mail.Read"
IMAP_ACCESS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All"


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(
            f"Config file not found: {path}\nCopy {ROOT / 'config.example.env'} to {path} first."
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


def post_form(token_url: str, data: dict[str, str]) -> tuple[int, dict]:
    body = urlencode(data).encode()
    request = Request(
        token_url,
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


def build_auth_url(
    client_id: str, redirect_uri: str, scopes: str, tenant: str, state: str
) -> str:
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": scopes,
        "state": state,
        "prompt": "select_account",
    }
    return (
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?"
        + urlencode(params)
    )


def parse_scope_groups(scopes: str) -> tuple[list[str], list[str]]:
    ordered = [scope for scope in scopes.split() if scope]
    oidc = [scope for scope in ordered if scope in OIDC_SCOPES]
    resources = [scope for scope in ordered if scope not in OIDC_SCOPES]
    return oidc, resources


def build_single_resource_scope(oidc_scopes: list[str], resource_scope: str) -> str:
    return " ".join([*oidc_scopes, resource_scope])


def select_exchange_resource_scope(resource_scopes: list[str]) -> str:
    if GRAPH_MAIL_READ_SCOPE in resource_scopes:
        return GRAPH_MAIL_READ_SCOPE
    if resource_scopes:
        return resource_scopes[0]
    raise SystemExit("SCOPES must contain at least one resource scope")


def detect_email(config: dict[str, str], token_payload: dict) -> str | None:
    configured = config.get("ACCOUNT_EMAIL", "").strip()
    if configured:
        return configured
    id_claims = maybe_decode_jwt(token_payload.get("id_token"))
    for key in ("preferred_username", "email", "upn"):
        value = id_claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def verify_imap(email: str, access_token: str) -> dict[str, str | int | bool]:
    import imaplib

    result: dict[str, str | int | bool] = {"attempted": True}
    socket.setdefaulttimeout(20)
    try:
        auth_string = f"user={email}\x01auth=Bearer {access_token}\x01\x01".encode()
        xoauth2 = base64.b64encode(auth_string)
        client = imaplib.IMAP4_SSL(
            IMAP_HOST, IMAP_PORT, ssl_context=ssl.create_default_context(), timeout=20
        )
        try:
            auth_type, auth_response = client.authenticate("XOAUTH2", lambda _: xoauth2)
            list_type, mailboxes = client.list()
            result.update(
                {
                    "ok": True,
                    "auth_type": str(auth_type),
                    "auth_response": str(auth_response),
                    "list_type": str(list_type),
                    "mailbox_count": len(mailboxes or []),
                }
            )
        finally:
            try:
                client.logout()
            except Exception:
                pass
    except Exception as error:
        result.update(
            {
                "ok": False,
                "error_type": type(error).__name__,
                "error": str(error),
            }
        )
    return result


def save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


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


def is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


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


def create_email_account(base_url: str, token: str, payload: dict[str, str]) -> dict:
    return request_json(
        f"{base_url}/admin/emails",
        method="POST",
        data={
            "email": payload["email"],
            "clientId": payload["clientId"],
            "clientSecret": payload["clientSecret"],
            "refreshToken": payload["refreshToken"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )["data"]


def update_email_account(
    base_url: str, token: str, email_id: int, payload: dict[str, str]
) -> dict:
    return request_json(
        f"{base_url}/admin/emails/{email_id}",
        method="PUT",
        data={
            "email": payload["email"],
            "clientId": payload["clientId"],
            "clientSecret": payload["clientSecret"],
            "refreshToken": payload["refreshToken"],
        },
        headers={"Authorization": f"Bearer {token}"},
    )["data"]


def maybe_auto_update_mailbox(
    config: dict[str, str],
    payload: dict[str, str],
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
    existing_exact = find_existing_email(base_url, token, payload["email"])

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
            payload_email = payload["email"].strip().lower()

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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Interactive Microsoft OAuth helper for all-Mail."
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG), help="Path to config.env file"
    )
    parser.add_argument(
        "--callback-url",
        help="Optional callback URL. If omitted, script will prompt for it.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Only generate auth URL and save state, then exit",
    )
    parser.add_argument(
        "--skip-imap", action="store_true", help="Skip final IMAP XOAUTH2 login test"
    )
    parser.add_argument(
        "--skip-update",
        action="store_true",
        help="Do not auto-update TARGET_EMAIL_ID even if admin config exists",
    )
    parser.add_argument(
        "--skip-fetch-check",
        action="store_true",
        help="Skip mailbox fetch verification after automatic update",
    )
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    config = load_env_file(config_path)
    tenant = config.get("TENANT", DEFAULT_TENANT).strip().strip("/") or DEFAULT_TENANT
    scopes = config.get("SCOPES", DEFAULT_SCOPES).strip() or DEFAULT_SCOPES
    oidc_scopes, resource_scopes = parse_scope_groups(scopes)
    separator = config.get("SEPARATOR", "----") or "----"
    client_id = require(config, "CLIENT_ID")
    client_secret = require(config, "CLIENT_SECRET")
    redirect_uri = require(config, "REDIRECT_URI")
    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    exchange_resource_scope = select_exchange_resource_scope(resource_scopes)
    exchange_scope = build_single_resource_scope(oidc_scopes, exchange_resource_scope)

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    state_path = RUNTIME_DIR / "last_state.txt"
    auth_url_path = RUNTIME_DIR / "last_auth_url.txt"

    if args.callback_url and state_path.exists() and auth_url_path.exists():
        state = state_path.read_text().strip()
        auth_url = auth_url_path.read_text().strip()
    else:
        state = secrets.token_urlsafe(24)
        auth_url = build_auth_url(client_id, redirect_uri, scopes, tenant, state)
        state_path.write_text(state)
        auth_url_path.write_text(auth_url)

    print("== Step 1 / Browser authorization ==")
    print("Open this URL in your browser and complete Microsoft login:")
    print(auth_url)
    print()

    if args.prepare_only:
        print("prepare_only=true")
        print(f"saved_state={state_path}")
        print(f"saved_auth_url={auth_url_path}")
        return 0

    callback_url = (
        args.callback_url.strip()
        if args.callback_url
        else input("Paste the full callback URL here: ").strip()
    )
    query = parse_qs(urlparse(callback_url).query)
    code = query.get("code", [""])[0]
    callback_state = query.get("state", [""])[0]
    if not code:
        raise SystemExit("Callback URL missing code")
    if callback_state != state:
        raise SystemExit(f"State mismatch: expected {state}, got {callback_state}")

    print("\n== Step 2 / Exchange auth code ==")
    exchange_status, exchange_payload = post_form(
        token_url,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "scope": exchange_scope,
        },
    )
    if exchange_status != 200:
        print(json.dumps(exchange_payload, ensure_ascii=False, indent=2))
        raise SystemExit(f"Code exchange failed with status {exchange_status}")

    latest_tokens_path = RUNTIME_DIR / "latest_tokens.json"
    save_json(latest_tokens_path, exchange_payload)
    print(f"saved_tokens={latest_tokens_path}")
    print("exchange_scope=" + exchange_scope)
    print("scope=" + str(exchange_payload.get("scope")))
    print("has_refresh_token=" + str(bool(exchange_payload.get("refresh_token"))))
    print("has_access_token=" + str(bool(exchange_payload.get("access_token"))))

    email = detect_email(config, exchange_payload)
    refresh_token = exchange_payload.get("refresh_token", "")
    if not refresh_token:
        raise SystemExit("Exchange succeeded but refresh_token is missing")

    print("\n== Step 3 / Verify refresh flow ==")
    old_refresh_status, old_refresh_payload = post_form(
        token_url,
        {
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": build_single_resource_scope(oidc_scopes, exchange_resource_scope),
        },
    )
    patched_graph_status, patched_graph_payload = post_form(
        token_url,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": build_single_resource_scope(oidc_scopes, GRAPH_MAIL_READ_SCOPE),
        },
    )
    patched_imap_status, patched_imap_payload = post_form(
        token_url,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": build_single_resource_scope(oidc_scopes, IMAP_ACCESS_SCOPE),
        },
    )

    verify_summary: dict[str, object] = {
        "tenant": tenant,
        "redirect_uri": redirect_uri,
        "scope": exchange_payload.get("scope"),
        "email": email,
        "old_refresh_status": old_refresh_status,
        "old_refresh_error": old_refresh_payload.get("error"),
        "patched_graph_status": patched_graph_status,
        "patched_graph_ok": patched_graph_status == 200,
        "patched_imap_status": patched_imap_status,
        "patched_imap_ok": patched_imap_status == 200,
    }

    if patched_graph_status != 200 or patched_imap_status != 200:
        verify_summary["patched_graph_payload"] = patched_graph_payload
        verify_summary["patched_imap_payload"] = patched_imap_payload
        save_json(RUNTIME_DIR / "latest_verify.json", verify_summary)
        print(json.dumps(verify_summary, ensure_ascii=False, indent=2))
        raise SystemExit("Resource refresh failed; cannot continue")

    save_json(RUNTIME_DIR / "latest_graph_refresh.json", patched_graph_payload)
    save_json(RUNTIME_DIR / "latest_imap_refresh.json", patched_imap_payload)
    print("old_refresh_status=" + str(old_refresh_status))
    print("old_refresh_error=" + str(old_refresh_payload.get("error")))
    print("patched_graph_status=" + str(patched_graph_status))
    print("patched_imap_status=" + str(patched_imap_status))

    import_line = None
    if email:
        import_line = f"{email}{separator}{client_id}{separator}{client_secret}{separator}oauth{separator}{refresh_token}"
        (RUNTIME_DIR / "latest_import.txt").write_text(import_line + "\n")
        save_json(
            RUNTIME_DIR / "latest_payload.json",
            {
                "email": email,
                "clientId": client_id,
                "clientSecret": client_secret,
                "refreshToken": refresh_token,
            },
        )
        print("\n== Step 4 / Ready-to-import line ==")
        print(import_line)
    else:
        print("\n== Step 4 / Ready-to-import line skipped ==")
        print(
            "Could not detect email from id_token. Set ACCOUNT_EMAIL in config.env and rerun."
        )

    if not args.skip_imap:
        print("\n== Step 5 / IMAP XOAUTH2 test ==")
        if email:
            imap_access_token = str(patched_imap_payload.get("access_token", ""))
            verify_summary["imap"] = verify_imap(email, imap_access_token)
            print(json.dumps(verify_summary["imap"], ensure_ascii=False, indent=2))
        else:
            verify_summary["imap"] = {"attempted": False, "reason": "missing email"}
            print("Skipping IMAP test because email is unavailable.")
    else:
        verify_summary["imap"] = {"attempted": False, "reason": "skip requested"}

    if email:
        auto_update_payload = {
            "email": email,
            "clientId": client_id,
            "clientSecret": client_secret,
            "refreshToken": refresh_token,
        }
        auto_update_summary = maybe_auto_update_mailbox(
            config,
            auto_update_payload,
            mailbox="INBOX",
            skip_update=args.skip_update,
            skip_fetch_check=args.skip_fetch_check,
        )
        if auto_update_summary:
            save_json(RUNTIME_DIR / "latest_update_result.json", auto_update_summary)
            verify_summary["autoUpdate"] = auto_update_summary
            print("\n== Step 6 / Auto update all-Mail mailbox ==")
            print(json.dumps(auto_update_summary, ensure_ascii=False, indent=2))

    save_json(RUNTIME_DIR / "latest_verify.json", verify_summary)
    print("\nFiles written under:", RUNTIME_DIR)
    print("- latest_tokens.json: auth-code exchange result")
    print("- latest_graph_refresh.json: Graph Mail.Read refresh result")
    print("- latest_imap_refresh.json: IMAP refresh result")
    print("- latest_verify.json: verification summary")
    if "autoUpdate" in verify_summary:
        print("- latest_update_result.json: automatic mailbox update summary")
    if import_line:
        print("- latest_import.txt: paste this line into all-Mail batch import")
        print("- latest_payload.json: manual form payload if needed")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
