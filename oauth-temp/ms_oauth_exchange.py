#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f'Missing required env: {name}')
    return value


def main() -> int:
    if len(sys.argv) != 3:
        print('Usage: ms_oauth_exchange.py <callback_url> <output_json_path>', file=sys.stderr)
        return 2

    callback_url = sys.argv[1]
    output_path = Path(sys.argv[2])
    client_id = require_env('CLIENT_ID')
    client_secret = require_env('CLIENT_SECRET')
    redirect_uri = require_env('REDIRECT_URI')
    expected_state = os.environ.get('EXPECTED_STATE')

    query = parse_qs(urlparse(callback_url).query)
    code = query.get('code', [''])[0]
    state = query.get('state', [''])[0]
    if not code:
        raise SystemExit('Callback URL missing code')
    if expected_state and state != expected_state:
        raise SystemExit(f'State mismatch: expected {expected_state}, got {state}')

    body = urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }).encode()
    request = Request(TOKEN_URL, data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode())
    except HTTPError as error:
        payload = error.read().decode()
        print(f'exchange_status={error.code}')
        print(payload)
        return 1

    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print('exchange_status=200')
    print(f'saved={output_path}')
    print(f'scope={payload.get("scope")}')
    print(f'has_refresh_token={bool(payload.get("refresh_token"))}')
    print(f'has_access_token={bool(payload.get("access_token"))}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
