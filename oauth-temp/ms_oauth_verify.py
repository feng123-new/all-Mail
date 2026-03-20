#!/usr/bin/env python3
import base64
import json
import os
import socket
import ssl
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f'Missing required env: {name}')
    return value


def post_form(data: dict[str, str]) -> tuple[int, dict]:
    body = urlencode(data).encode()
    request = Request(TOKEN_URL, data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(request, timeout=60) as response:
            return response.getcode(), json.loads(response.read().decode())
    except HTTPError as error:
        payload = error.read().decode()
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = {'raw': payload}
        return error.code, parsed


def decode_jwt_claims(token: str) -> dict:
    parts = token.split('.')
    if len(parts) != 3:
        return {}
    payload = parts[1] + '=' * (-len(parts[1]) % 4)
    return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())


def main() -> int:
    if len(sys.argv) != 2:
        print('Usage: ms_oauth_verify.py <token_json_path>', file=sys.stderr)
        return 2

    payload = json.loads(Path(sys.argv[1]).read_text())
    client_id = require_env('CLIENT_ID')
    client_secret = require_env('CLIENT_SECRET')
    refresh_token = payload.get('refresh_token')
    access_token = payload.get('access_token')
    id_token = payload.get('id_token', '')

    if not refresh_token or not access_token:
        raise SystemExit('Token payload missing refresh_token or access_token')

    initial_claims = decode_jwt_claims(access_token)
    print('initial_aud=' + str(initial_claims.get('aud')))
    print('initial_scp=' + str(initial_claims.get('scp')))

    old_status, old_payload = post_form({
        'client_id': client_id,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    })
    print('old_refresh_status=' + str(old_status))
    print('old_refresh_error=' + str(old_payload.get('error')))

    patched_status, patched_payload = post_form({
        'client_id': client_id,
        'client_secret': client_secret,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    })
    print('patched_refresh_status=' + str(patched_status))
    if patched_status != 200:
        print(json.dumps(patched_payload, ensure_ascii=False, indent=2))
        return 1

    patched_access_token = patched_payload.get('access_token', '')
    patched_claims = decode_jwt_claims(patched_access_token)
    print('patched_aud=' + str(patched_claims.get('aud')))
    print('patched_scp=' + str(patched_claims.get('scp')))

    identity_claims = decode_jwt_claims(id_token) if id_token else {}
    email = identity_claims.get('preferred_username') or identity_claims.get('email') or identity_claims.get('upn')
    print('detected_email=' + str(email))
    if not email:
        print('imap_test=skipped_no_email_claim')
        return 0

    socket.setdefaulttimeout(20)
    import imaplib
    auth_string = f'user={email}\x01auth=Bearer {patched_access_token}\x01\x01'.encode()
    xoauth2 = base64.b64encode(auth_string)
    client = imaplib.IMAP4_SSL('outlook.office365.com', 993, ssl_context=ssl.create_default_context(), timeout=20)
    try:
        typ, response = client.authenticate('XOAUTH2', lambda _: xoauth2)
        print('imap_auth_type=' + str(typ))
        print('imap_auth_response=' + str(response))
        list_type, mailboxes = client.list()
        print('imap_list_type=' + str(list_type))
        print('imap_list_count=' + str(len(mailboxes or [])))
    finally:
        try:
            client.logout()
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
