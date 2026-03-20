#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "config.env"
DEFAULT_PAYLOAD = ROOT / "runtime" / "latest_payload.json"


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(f"Config file not found: {path}")

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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update an existing all-Mail email account from latest OAuth payload."
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG), help="Path to oauth config.env"
    )
    parser.add_argument(
        "--payload", default=str(DEFAULT_PAYLOAD), help="Path to latest_payload.json"
    )
    parser.add_argument(
        "--email-id", type=int, help="Existing all-Mail email account ID to update"
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Fetch the updated record with secrets=true after update",
    )
    args = parser.parse_args()

    config = load_env_file(Path(args.config).expanduser().resolve())
    payload_path = Path(args.payload).expanduser().resolve()
    if not payload_path.exists():
        raise SystemExit(f"Payload file not found: {payload_path}")

    email_id = args.email_id
    if email_id is None:
        configured_id = config.get("TARGET_EMAIL_ID", "").strip()
        if configured_id:
            email_id = int(configured_id)
    if email_id is None:
        raise SystemExit("Provide --email-id or TARGET_EMAIL_ID in config.env")

    base_url = require(config, "ADMIN_BASE_URL").rstrip("/")
    username = require(config, "ADMIN_USERNAME")
    password = require(config, "ADMIN_PASSWORD")
    payload = json.loads(payload_path.read_text())

    login = request_json(
        f"{base_url}/admin/auth/login",
        method="POST",
        data={"username": username, "password": password},
    )
    token = login["data"]["token"]

    existing_exact = find_existing_email(base_url, token, payload["email"])
    allow_target_replace = is_truthy(config.get("ALLOW_TARGET_ID_REPLACE", ""))

    action = "updated_exact_email"
    if existing_exact:
        email_id = int(existing_exact["id"])
        update_response = update_email_account(base_url, token, email_id, payload)
    elif email_id is None:
        action = "created_new_email"
        update_response = create_email_account(base_url, token, payload)
        email_id = int(update_response["id"])
    else:
        target_detail = request_json(
            f"{base_url}/admin/emails/{email_id}",
            headers={"Authorization": f"Bearer {token}"},
        )["data"]
        target_email = str(target_detail.get("email", "")).strip().lower()
        payload_email = payload["email"].strip().lower()

        if target_email == payload_email:
            action = "updated_target_id"
            update_response = update_email_account(base_url, token, email_id, payload)
        elif allow_target_replace:
            action = "replaced_target_id"
            update_response = update_email_account(base_url, token, email_id, payload)
        else:
            action = "created_new_email"
            update_response = create_email_account(base_url, token, payload)
            email_id = int(update_response["id"])

    summary = {
        "updated": True,
        "action": action,
        "emailId": email_id,
        "email": update_response["email"],
        "status": update_response["status"],
        "updatedAt": update_response.get("updatedAt"),
    }

    if args.verify:
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

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
