from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen
import errno
import json
import subprocess
import sys
import socket
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
DEFAULT_NNK = ROOT / "nnk"
EXTENSIONS = {".bsp", ".wad", ".txt", ".3ds", ".dds", ".mdl", ".png", ".tga", ".bmp", ".wav", ".spr", ".xpr", ".mp3"}
ASSET_DIRS = {"maps", "models", "gfx", "sound", "sprites", "media"}


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        super().setup()

    def __init__(self, *args, assets, **kwargs):
        self.assets = assets
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = urlsplit(self.path)
        if self.server.ws_port and path.path == '/arena-status':
            body = json.dumps({'mode': 'lan', 'map': 'chuninfinals', 'capacity': 8,
                               'protocol': 2, 'wsPort': self.server.ws_port}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.server.ws_port and path.path in ('/', '/index.html') and not path.query:
            self.send_response(302)
            self.send_header('Location', '/?local&lan')
            self.send_header('Content-Length', '0')
            self.end_headers()
        else:
            super().do_GET()

    def translate_path(self, path):
        request_path = unquote(urlsplit(path).path)
        if not request_path.startswith("/assets/"):
            if request_path in {"/", "/index.html", "/style.css", "/game.js", "/assets.js", "/rules.js", "/hud.js", "/arena-net.js", "/menu.webp", "/arena-title.webp"}:
                return super().translate_path(path)
            if request_path.startswith(("/voltage/", "/storm/")):
                asset = (ROOT / request_path.lstrip("/")).resolve()
                if asset.parent in {ROOT / "voltage", ROOT / "storm"} and asset.is_file():
                    return str(asset)
            if request_path.startswith("/touch-icons/"):
                icon = (ROOT / request_path.lstrip("/")).resolve()
                if icon.parent == ROOT / "touch-icons" and icon.is_file():
                    return str(icon)
            if request_path.startswith("/vendor/"):
                vendor = ROOT / "vendor"
                candidate = (ROOT / request_path.lstrip("/")).resolve()
                if candidate.is_relative_to(vendor) and candidate.is_file():
                    return str(candidate)
            return str(ROOT / "__unavailable__")

        rel = PurePosixPath(request_path.removeprefix("/assets/"))
        invalid = str(ROOT / "__unavailable__")
        if not rel.parts or any(part in {"..", "."} or ":" in part or "\\" in part for part in rel.parts):
            return invalid
        if rel.parts == ("listenserver.cfg",):
            config = (self.assets / rel.name).resolve()
            return str(config) if config.is_relative_to(self.assets) and config.is_file() else invalid
        if len(rel.parts) == 1 and rel.name.lower() not in {"narutowad.wad", "nnk_rooftop.wad"}:
            return invalid
        if len(rel.parts) > 1 and rel.parts[0].lower() not in ASSET_DIRS:
            return invalid
        if rel.suffix.lower() not in EXTENSIONS:
            return invalid
        resolved = self.assets.joinpath(*rel.parts).resolve()
        return str(resolved) if resolved.is_relative_to(self.assets) and resolved.is_file() else invalid

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def start_component(name, *args):
    process = subprocess.Popen([sys.executable, str(ROOT / name), *map(str, args)],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        line = process.stdout.readline()
        if not line.strip().isdigit():
            raise RuntimeError(f'{name} не стартира')
        return process, int(line)
    except BaseException:
        process.terminate()
        process.wait()
        process.stdin.close()
        raise
    finally:
        process.stdout.close()


if __name__ == "__main__":
    parser = ArgumentParser(description="Local NNK Web arena")
    parser.add_argument("--assets", type=Path, default=DEFAULT_NNK)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument('--lan', action='store_true', help='Enable multiplayer on your local network')
    parser.add_argument('--ws-port', type=int, default=8767)
    options = parser.parse_args()
    bind_address = '0.0.0.0' if options.lan else '127.0.0.1'
    handler = partial(Handler, assets=options.assets.resolve())
    try:
        httpd = LocalServer((bind_address, options.port), handler)
    except OSError as error:
        if not options.port or (error.errno != errno.EADDRINUSE and getattr(error, "winerror", None) not in {10013, 10048}):
            raise
        if options.lan:
            url = f"http://127.0.0.1:{options.port}"
            try:
                with urlopen(url + '/arena-status', timeout=1) as response:
                    active = json.load(response).get('protocol') == 2
            except (OSError, ValueError, AttributeError):
                active = False
            if not active:
                raise SystemExit(f"Порт {options.port} е зает.")
            if not options.no_browser:
                webbrowser.open(url + '/?local&lan')
            raise SystemExit(0)
        httpd = LocalServer((bind_address, 0), handler)
        print("The previous port is occupied. Starting this build on a free port.", flush=True)
    httpd.ws_port = None
    components = []
    try:
        if options.lan:
            worker, worker_port = start_component('arena_rooms.py')
            components.append(worker)
            gateway, httpd.ws_port = start_component('arena_gateway.py', options.ws_port, worker_port, httpd.server_port)
            components.append(gateway)
        if options.lan:
            try:
                addresses = sorted({row[4][0] for row in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
                                    if not row[4][0].startswith('127.')})
            except OSError:
                addresses = []
            for address in addresses or ['<host IPv4>']:
                print(f"LAN: http://{address}:{httpd.server_port}/?local&lan", flush=True)
        url = f"http://127.0.0.1:{httpd.server_port}/?local" + ('&lan' if options.lan else '')
        print(f"NNK Web is available at {url}", flush=True)
        if not options.no_browser:
            threading.Timer(.4, lambda: webbrowser.open(url)).start()
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        for process in reversed(components):
            process.stdin.close()
            process.terminate()
            process.wait()
