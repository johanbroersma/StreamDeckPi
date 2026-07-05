#!/usr/bin/env python3
"""
unifi_door.py — UniFi Access door control CLI
Usage:
  python3 unifi_door.py list                        # discover door IDs
  python3 unifi_door.py unlock --door-id <ID>
  python3 unifi_door.py lock   --door-id <ID>

Config is read from .env in the same directory, or from environment variables:
  UNIFI_HOST        Controller IP (default: 192.168.1.10)
  UNIFI_PORT        Controller port (default: 12445)
  UNIFI_API_TOKEN   Bearer token from Access app Settings > General > Advanced
  DOOR_ID           Default door ID used if --door-id is not supplied
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests
import urllib3

# ── Unlock endpoint note ──────────────────────────────────────
# UniFi Access API docs (v1) show two possible paths for a remote unlock:
#   • /api/v1/developer/doors/{id}/unlock
#   • /api/v1/developer/doors/{id}/remote_unlock
# If unlock returns 404, change UNLOCK_PATH below to 'remote_unlock'
# and check the exact endpoint in the API documentation downloaded
# from the Access app (Settings > General > Advanced > API Documentation).
UNLOCK_PATH = 'unlock'

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ── Config ────────────────────────────────────────────────────

def _load_env():
    """Minimal .env loader — dotenv may not be installed on the Pi."""
    env_file = Path(__file__).parent / '.env'
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, _, val = line.partition('=')
        key = key.strip()
        val = val.strip().strip('"\'')
        if key and key not in os.environ:
            os.environ[key] = val


_load_env()

UNIFI_HOST      = os.getenv('UNIFI_HOST', '192.168.1.10')
UNIFI_PORT      = os.getenv('UNIFI_PORT', '12445')
UNIFI_API_TOKEN = os.getenv('UNIFI_API_TOKEN', '')
DEFAULT_DOOR_ID = os.getenv('DOOR_ID', '')

BASE_URL = f'https://{UNIFI_HOST}:{UNIFI_PORT}/api/v1/developer'


# ── HTTP session ──────────────────────────────────────────────

def make_session() -> requests.Session:
    s = requests.Session()
    s.verify = False  # self-signed cert on UniFi controller
    s.headers.update({
        'Authorization': f'Bearer {UNIFI_API_TOKEN}',
        'Content-Type':  'application/json',
    })
    return s


# ── Response handling ─────────────────────────────────────────

def handle_response(resp: requests.Response, action: str) -> bool:
    try:
        body = resp.json()
    except Exception:
        body = {}

    msg  = body.get('msg', body.get('message', ''))
    code = body.get('code', '')

    if resp.status_code == 200:
        print(f'✓  {action}' + (f': {msg}' if msg else ''))
        return True

    if resp.status_code == 404:
        print(f'✗  {action}: 404 Not Found')
        if 'unlock' in action.lower():
            print(f'   The unlock endpoint may use a different path segment.')
            print(f'   Currently configured: UNLOCK_PATH = {UNLOCK_PATH!r}')
            print(f'   If this fails, edit UNLOCK_PATH in unifi_door.py to "remote_unlock"')
            print(f'   and verify the exact path in the Access app API documentation.')
        return False

    if resp.status_code == 401:
        print(f'✗  {action}: 401 Unauthorized — check UNIFI_API_TOKEN in .env')
        return False

    detail = msg or code or str(body) or ''
    print(f'✗  {action}: HTTP {resp.status_code}' + (f' — {detail}' if detail else ''))
    return False


# ── Commands ──────────────────────────────────────────────────

def cmd_list(session: requests.Session) -> None:
    try:
        resp = session.get(f'{BASE_URL}/doors', timeout=8)
    except requests.ConnectionError:
        print(f'✗  Cannot connect to {UNIFI_HOST}:{UNIFI_PORT} — check UNIFI_HOST/UNIFI_PORT in .env')
        sys.exit(1)
    except requests.Timeout:
        print('✗  Request timed out')
        sys.exit(1)

    if resp.status_code != 200:
        handle_response(resp, 'list doors')
        sys.exit(1)

    try:
        raw = resp.json()
        doors = raw.get('data', raw) if isinstance(raw, dict) else raw
    except Exception:
        print('✗  Unexpected response format')
        sys.exit(1)

    if not doors:
        print('No doors found.')
        return

    print(f'\n{"Door ID":<38}  {"Name"}')
    print('─' * 65)
    for door in doors:
        did  = door.get('id') or door.get('device_id') or door.get('unique_id') or '?'
        name = door.get('name') or door.get('alias') or door.get('location_name') or '?'
        print(f'{did:<38}  {name}')
    print()
    print('Copy the ID of your office door into .env as DOOR_ID=<value>')
    print('or pass it with --door-id when running lock/unlock.')


def cmd_lock(session: requests.Session, door_id: str) -> bool:
    # NOTE: The UA Ultra developer API (v1) does not appear to support a PUT /lock
    # command — the door auto-relocks after the momentary unlock window expires.
    # The lock PUT returns 404 on tested firmware. This command is kept here for
    # completeness and future firmware versions.
    try:
        resp = session.put(f'{BASE_URL}/doors/{door_id}/lock', timeout=8)
    except requests.ConnectionError:
        print(f'✗  Cannot connect to {UNIFI_HOST}:{UNIFI_PORT}')
        sys.exit(1)
    except requests.Timeout:
        print('✗  Request timed out')
        sys.exit(1)
    ok = handle_response(resp, f'Lock door {door_id}')
    if not ok and resp.status_code == 404:
        print('   Note: Lock via API is not supported on UA Ultra firmware tested.')
        print('   The door auto-relocks after the momentary unlock window expires.')
    return ok


def cmd_unlock(session: requests.Session, door_id: str) -> bool:
    try:
        resp = session.put(f'{BASE_URL}/doors/{door_id}/{UNLOCK_PATH}', timeout=8)
    except requests.ConnectionError:
        print(f'✗  Cannot connect to {UNIFI_HOST}:{UNIFI_PORT}')
        sys.exit(1)
    except requests.Timeout:
        print('✗  Request timed out')
        sys.exit(1)

    ok = handle_response(resp, f'Unlock door {door_id}')

    # Auto-retry with the alternative path if we got 404
    if not ok and resp.status_code == 404 and UNLOCK_PATH == 'unlock':
        print('   Retrying with "remote_unlock" path…')
        try:
            resp2 = session.put(f'{BASE_URL}/doors/{door_id}/remote_unlock', timeout=8)
        except Exception:
            return False
        ok2 = handle_response(resp2, f'Unlock door {door_id} (remote_unlock)')
        if ok2:
            print('   ✓  Success with remote_unlock. Update UNLOCK_PATH = "remote_unlock" in unifi_door.py')
        return ok2

    return ok


# ── Entry point ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='UniFi Access door control',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest='command', required=True)

    sub.add_parser('list', help='List all doors and their IDs')

    for name in ('lock', 'unlock'):
        p = sub.add_parser(name, help=f'{name.capitalize()} a door')
        p.add_argument(
            '--door-id', default=DEFAULT_DOOR_ID, metavar='ID',
            help='Door ID (or set DOOR_ID= in .env)',
        )

    args = parser.parse_args()

    if not UNIFI_API_TOKEN:
        print('✗  UNIFI_API_TOKEN not set — add it to .env or export the variable.')
        sys.exit(1)

    session = make_session()

    if args.command == 'list':
        cmd_list(session)
    else:
        door_id = (args.door_id or '').strip()
        if not door_id:
            print('✗  No door ID supplied. Use --door-id <ID> or set DOOR_ID= in .env')
            sys.exit(1)
        if args.command == 'lock':
            sys.exit(0 if cmd_lock(session, door_id) else 1)
        else:
            sys.exit(0 if cmd_unlock(session, door_id) else 1)


if __name__ == '__main__':
    main()
