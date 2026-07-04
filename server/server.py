#!/usr/bin/env python3
"""
Pi Stream Deck — Backend Server
Serves the web UI and manages:
  - WebSocket connections from the browser UI (/ws/ui)
  - WebSocket connection from the desktop agent (/ws/agent)
  - Token-based auth for agent connections
  - WiFi management via nmcli
  - Agent download page
"""

import asyncio
import json
import logging
import os
import secrets
import signal
import subprocess
from pathlib import Path

from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('streamdeck')

WEB_DIR    = Path(__file__).parent.parent / 'web'
DATA_DIR   = Path(__file__).parent / 'data'
TOKEN_FILE = DATA_DIR / 'agent_token.txt'
PORT       = 7001
HOST       = '0.0.0.0'

DATA_DIR.mkdir(exist_ok=True)

# ── Token management ─────────────────────────────────────────

def load_or_create_token() -> str:
    if TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text().strip()
        if tok:
            return tok
    tok = secrets.token_urlsafe(24)
    TOKEN_FILE.write_text(tok)
    return tok

AGENT_TOKEN = load_or_create_token()
log.info(f'Agent token: {AGENT_TOKEN}')

# ── State ─────────────────────────────────────────────────────

ui_clients: set[web.WebSocketResponse] = set()
agent_ws: web.WebSocketResponse | None = None
config_cache: dict = {}


# ── Helpers ───────────────────────────────────────────────────

async def broadcast_ui(msg: dict):
    data = json.dumps(msg)
    dead = set()
    for ws in list(ui_clients):
        try:
            if not ws.closed:
                await ws.send_str(data)
            else:
                dead.add(ws)
        except Exception:
            dead.add(ws)
    ui_clients.difference_update(dead)


async def send_agent(msg: dict) -> bool:
    global agent_ws
    if agent_ws and not agent_ws.closed:
        try:
            await agent_ws.send_str(json.dumps(msg))
            return True
        except Exception:
            agent_ws = None
    return False


async def notify_ui_agent_status(connected: bool, agent_info: dict | None = None):
    msg = {'type': 'agent_status', 'connected': connected}
    if agent_info:
        msg['agent_info'] = agent_info
    await broadcast_ui(msg)


# ── WebSocket: UI clients ─────────────────────────────────────

def _regenerate_token() -> str:
    global AGENT_TOKEN
    AGENT_TOKEN = secrets.token_urlsafe(24)
    TOKEN_FILE.write_text(AGENT_TOKEN)
    log.info(f'Token regenerated: {AGENT_TOKEN}')
    return AGENT_TOKEN


async def ws_ui_handler(request):
    ws = web.WebSocketResponse(heartbeat=15)
    await ws.prepare(request)
    ui_clients.add(ws)
    log.info(f'UI client connected (total={len(ui_clients)})')

    await ws.send_str(json.dumps({
        'type': 'agent_status',
        'connected': agent_ws is not None and not agent_ws.closed,
    }))

    # Always send token to UI immediately on connect
    await ws.send_str(json.dumps({'type': 'token_info', 'token': AGENT_TOKEN}))

    if config_cache:
        await ws.send_str(json.dumps({'type': 'config_push', 'config': config_cache}))

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue

                mtype = data.get('type')

                if mtype == 'button_press':
                    sent = await send_agent(data)
                    if not sent:
                        await ws.send_str(json.dumps({
                            'type': 'button_feedback',
                            'idx': data.get('idx', -1),
                            'success': False,
                        }))

                elif mtype == 'config_sync':
                    config = data.get('config', {})
                    config_cache.update(config)
                    await send_agent({'type': 'config_push', 'config': config_cache})

                elif mtype == 'token_request':
                    # UI asking for the current token (shown in settings)
                    await ws.send_str(json.dumps({
                        'type': 'token_info',
                        'token': AGENT_TOKEN,
                    }))

                elif mtype == 'token_regenerate':
                    new_tok = _regenerate_token()
                    if agent_ws and not agent_ws.closed:
                        await agent_ws.close()
                    await broadcast_ui({'type': 'token_info', 'token': new_tok})

            elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break
    finally:
        ui_clients.discard(ws)
        log.info(f'UI client disconnected (total={len(ui_clients)})')

    return ws


# ── WebSocket: Desktop agent ──────────────────────────────────

async def ws_agent_handler(request):
    global agent_ws

    # Token auth via query param or header
    token = (
        request.rel_url.query.get('token') or
        request.headers.get('X-StreamDeck-Token', '')
    )
    if token != AGENT_TOKEN:
        log.warning(f'Agent connection rejected — bad token from {request.remote}')
        raise web.HTTPUnauthorized(reason='Invalid token')

    ws = web.WebSocketResponse(heartbeat=15)
    await ws.prepare(request)

    if agent_ws and not agent_ws.closed:
        await agent_ws.close()

    agent_ws = ws
    agent_info = {
        'host': request.remote,
        'platform': request.headers.get('X-Platform', 'unknown'),
        'hostname': request.headers.get('X-Hostname', ''),
    }
    log.info(f'Desktop agent connected: {agent_info}')
    await notify_ui_agent_status(True, agent_info)

    if config_cache:
        await ws.send_str(json.dumps({'type': 'config_push', 'config': config_cache}))

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue

                mtype = data.get('type')

                if mtype == 'button_feedback':
                    await broadcast_ui(data)
                elif mtype == 'config_push':
                    config = data.get('config', {})
                    config_cache.update(config)
                    await broadcast_ui({'type': 'config_push', 'config': config_cache})
                elif mtype == 'status':
                    log.info(f'Agent status: {data.get("message", "")}')

            elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                break
    finally:
        if agent_ws is ws:
            agent_ws = None
        log.info('Desktop agent disconnected')
        await notify_ui_agent_status(False)

    return ws


# ── REST: Health ──────────────────────────────────────────────

async def health_handler(request):
    return web.json_response({
        'status': 'ok',
        'ui_clients': len(ui_clients),
        'agent_connected': agent_ws is not None and not agent_ws.closed,
    })


# ── REST: WiFi ────────────────────────────────────────────────

def run_cmd(cmd: list[str], timeout: int = 15) -> tuple[str, str, int]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.stderr.strip(), r.returncode
    except subprocess.TimeoutExpired:
        return '', 'timeout', 1
    except Exception as e:
        return '', str(e), 1


async def wifi_status_handler(request):
    loop = asyncio.get_running_loop()

    # Get active connection
    stdout, _, rc = await loop.run_in_executor(
        None, lambda: run_cmd(['nmcli', '-t', '-f', 'ACTIVE,SSID,SIGNAL,SECURITY',
                                'dev', 'wifi']))
    networks = []
    current_ssid = ''
    for line in stdout.splitlines():
        parts = line.split(':')
        if len(parts) >= 2:
            active = parts[0] == 'yes'
            ssid   = parts[1] if len(parts) > 1 else ''
            signal = parts[2] if len(parts) > 2 else '0'
            sec    = parts[3] if len(parts) > 3 else ''
            if ssid:
                networks.append({'ssid': ssid, 'signal': signal, 'security': sec, 'active': active})
            if active:
                current_ssid = ssid

    return web.json_response({'current': current_ssid, 'networks': networks})


async def wifi_scan_handler(request):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: run_cmd(['nmcli', 'dev', 'wifi', 'rescan']))
    return await wifi_status_handler(request)


async def wifi_connect_handler(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest()

    ssid     = body.get('ssid', '').strip()
    password = body.get('password', '').strip()

    if not ssid:
        raise web.HTTPBadRequest(reason='ssid required')

    loop = asyncio.get_running_loop()

    if password:
        cmd = ['nmcli', 'dev', 'wifi', 'connect', ssid, 'password', password]
    else:
        cmd = ['nmcli', 'dev', 'wifi', 'connect', ssid]

    stdout, stderr, rc = await loop.run_in_executor(None, lambda: run_cmd(cmd, timeout=30))

    if rc == 0:
        return web.json_response({'ok': True, 'message': f'Connected to {ssid}'})
    else:
        return web.json_response({'ok': False, 'error': stderr or stdout}, status=400)


async def wifi_disconnect_handler(request):
    loop = asyncio.get_running_loop()
    _, _, rc = await loop.run_in_executor(
        None, lambda: run_cmd(['nmcli', 'dev', 'disconnect', 'wlan0']))
    return web.json_response({'ok': rc == 0})


# ── REST: Backlight ───────────────────────────────────────────

BACKLIGHT_PATH = Path('/sys/class/backlight/rpi_backlight/brightness')

async def backlight_handler(request):
    try:
        data   = await request.json()
        pct    = max(10, min(100, int(data.get('brightness', 100))))
        raw    = int(pct * 255 / 100)
        if BACKLIGHT_PATH.exists():
            BACKLIGHT_PATH.write_text(str(raw))
        return web.json_response({'ok': True, 'brightness': pct})
    except Exception as e:
        return web.json_response({'ok': False, 'error': str(e)}, status=400)


# ── REST: Agent info (for download page) ─────────────────────

async def agent_info_handler(request):
    hostname = os.uname().nodename
    stdout, _, _ = run_cmd(['hostname', '-I'])
    ips = stdout.split()
    return web.json_response({
        'hostname': hostname,
        'ips': ips,
        'port': PORT,
        'token': AGENT_TOKEN,
        'mdns': f'{hostname}.local',
    })


# ── Static / index ────────────────────────────────────────────

async def index_handler(request):
    return _serve_html(WEB_DIR / 'index.html')


async def download_handler(request):
    return _serve_html(WEB_DIR / 'download' / 'index.html')


def _serve_html(path: Path):
    if path.exists():
        return web.FileResponse(path, headers={'Cache-Control': 'no-store'})
    return web.Response(text='Not found', status=404)


# ── Camera RTSP → MJPEG proxy ─────────────────────────────────

async def camera_stream_handler(request):
    url = request.rel_url.query.get('url', '')
    if not url:
        raise web.HTTPBadRequest(reason='Missing url parameter')

    response = web.StreamResponse(headers={
        'Content-Type':  'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
    })
    await response.prepare(request)

    proc = await asyncio.create_subprocess_exec(
        'ffmpeg',
        '-rtsp_transport', 'tcp',
        '-i', url,
        '-f', 'mjpeg',
        '-q:v', '5',
        '-vf', 'fps=15,scale=800:-1',
        'pipe:1',
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    try:
        buf = b''
        while True:
            chunk = await proc.stdout.read(8192)
            if not chunk:
                break
            buf += chunk
            while True:
                start = buf.find(b'\xff\xd8')
                if start == -1:
                    buf = b''
                    break
                end = buf.find(b'\xff\xd9', start + 2)
                if end == -1:
                    buf = buf[start:]
                    break
                frame = buf[start:end + 2]
                buf = buf[end + 2:]
                try:
                    await response.write(
                        b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
                    )
                except Exception:
                    return response
    except asyncio.CancelledError:
        pass
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        await proc.wait()

    return response


# ── App setup ─────────────────────────────────────────────────

def create_app():
    app = web.Application()

    # WebSocket
    app.router.add_get('/ws/ui',           ws_ui_handler)
    app.router.add_get('/ws/agent',        ws_agent_handler)

    # REST
    app.router.add_get('/health',          health_handler)
    app.router.add_get('/api/agent-info',  agent_info_handler)
    app.router.add_post('/api/backlight',  backlight_handler)
    app.router.add_get('/api/wifi/status', wifi_status_handler)
    app.router.add_get('/api/wifi/scan',   wifi_scan_handler)
    app.router.add_post('/api/wifi/connect',    wifi_connect_handler)
    app.router.add_post('/api/wifi/disconnect', wifi_disconnect_handler)
    app.router.add_get('/api/camera/stream',    camera_stream_handler)

    # Static files
    if WEB_DIR.exists():
        app.router.add_get('/',          index_handler)
        app.router.add_get('/download',  download_handler)
        app.router.add_get('/download/', download_handler)
        app.router.add_static('/', WEB_DIR, show_index=False, follow_symlinks=True)

    return app


async def main():
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT)
    await site.start()
    log.info(f'Stream Deck Pi server on http://{HOST}:{PORT}  token={AGENT_TOKEN}')

    loop = asyncio.get_running_loop()
    stop = loop.create_future()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: stop.set_result(None) if not stop.done() else None)

    await stop
    log.info('Shutting down…')
    await runner.cleanup()


if __name__ == '__main__':
    asyncio.run(main())
