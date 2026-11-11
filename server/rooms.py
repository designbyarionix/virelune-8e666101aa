"""Serve the browser build and its four-digit multiplayer rooms."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Timer
from urllib.parse import urlsplit
import argparse
import json
import math
import os
import re
import secrets
import time
import webbrowser

ROOM_TTL = 90
PEER_TTL = 8
CAPACITY = 10
HEROES = {"naruto", "sasuke", "kakashi", "sakura", "anbu"}
ROOM_CODE = re.compile(r"[0-9]{4}")
TOKEN = re.compile(r"[a-f0-9]{32}")


def finite(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum


class Arena:
    def __init__(self):
        self.rooms = {}
        self.lock = Lock()

    def prune(self, now):
        for code, room in list(self.rooms.items()):
            room["peers"] = {key: peer for key, peer in room["peers"].items()
                             if now - peer["seen"] <= PEER_TTL}
            if not room["peers"] and now - room["seen"] > ROOM_TTL:
                del self.rooms[code]

    def list_rooms(self):
        with self.lock:
            self.prune(time.monotonic())
            return [{"code": code, "players": len(room["peers"]), "capacity": CAPACITY}
                    for code, room in sorted(self.rooms.items())]

    def create(self):
        with self.lock:
            now = time.monotonic()
            self.prune(now)
            if len(self.rooms) >= 100:
                return 503, {"error": "Room limit reached. Try again shortly."}
            while True:
                code = f"{secrets.randbelow(10000):04d}"
                if code not in self.rooms:
                    self.rooms[code] = {"seen": now, "peers": {}}
                    return 201, {"code": code}

    def update(self, data):
        code, token = data.get("room"), data.get("token")
        hero, name = data.get("hero"), data.get("name")
        position, yaw, pose = data.get("position"), data.get("yaw"), data.get("pose")
        if (not isinstance(code, str) or not ROOM_CODE.fullmatch(code)
                or not isinstance(token, str) or not TOKEN.fullmatch(token)
                or not isinstance(hero, str) or hero not in HEROES
                or not isinstance(name, str) or not name.strip() or len(name) > 24
                or not isinstance(position, list) or len(position) != 3
                or not all(finite(value, -50000, 50000) for value in position)
                or not finite(yaw, -1000000, 1000000)
                or not isinstance(pose, str) or not re.fullmatch(r"[a-zA-Z0-9_ -]{1,64}", pose)):
            return 400, {"error": "Invalid arena session."}
        now = time.monotonic()
        with self.lock:
            self.prune(now)
            room = self.rooms.get(code)
            if room is None:
                return 404, {"error": "Room not found. Refresh the room list."}
            peers = room["peers"]
            peer = peers.get(token)
            if peer is None:
                if len(peers) >= CAPACITY:
                    return 409, {"error": "This room is full."}
                used_slots = {member["slot"] for member in peers.values()}
                peer = {"slot": next(i for i in range(CAPACITY) if i not in used_slots),
                        "hits": [], "last_hit": 0}
                peers[token] = peer
            state = {"hero": hero, "name": name.strip(), "position": position, "yaw": yaw % math.tau,
                     "pose": pose, "time": round(now * 1000)}
            for field, lower, upper in (("offset", -128, 128), ("hp", 0, 100), ("action", 0, 1e9)):
                if finite(data.get(field), lower, upper):
                    state[field] = data[field]
            state["once"] = data.get("once") is True
            rotation = data.get("rotation")
            if isinstance(rotation, list) and len(rotation) == 4 and all(finite(v, -1, 1) for v in rotation):
                state["rotation"] = rotation
            peer.update(state=state, seen=now)
            room["seen"] = now
            hit = data.get("hit")
            if isinstance(hit, dict) and isinstance(hit.get("target"), str):
                target = peers.get(hit["target"])
                damage = hit.get("damage")
                if (target is not None and target is not peer and now - peer["last_hit"] >= .12
                        and finite(damage, 1, 65) and len(target["hits"]) < 24
                        and math.dist(position, target["state"]["position"]) <= 1300):
                    target["hits"].append({"from": token, "damage": damage})
                    peer["last_hit"] = now
            hits, peer["hits"] = peer["hits"], []
            return 200, {"slot": peer["slot"], "time": state["time"], "hits": hits,
                         "players": {key: member["state"] for key, member in peers.items() if key != token}}


class Handler(SimpleHTTPRequestHandler):
    def reply(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == "/arena/rooms":
            self.reply(200, {"rooms": self.server.arena.list_rooms()})
            return
        super().do_GET()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/arena/rooms":
            self.reply(*self.server.arena.create())
        elif path == "/arena":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError
            except (ValueError, UnicodeError):
                self.reply(400, {"error": "Invalid arena request."})
                return
            self.reply(*self.server.arena.update(data))
        else:
            self.reply(404, {"error": "Unknown endpoint."})

    def log_request(self, code="-", size="-"):
        if urlsplit(self.path).path != "/arena" or code != 200:
            super().log_request(code, size)


def main():
    root = Path(__file__).resolve().parent.parent
    default = root / ("web" if (root / "web").is_dir() else "dist")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8769)))
    parser.add_argument("--web", type=Path, default=default)
    parser.add_argument("--open", action="store_true", help="Open the local game in a browser")
    args = parser.parse_args()
    server = ThreadingHTTPServer(
        (args.host, args.port), lambda *a, **kw: Handler(*a, directory=args.web, **kw))
    server.arena = Arena()
    print(f"Arena server listening on http://{args.host}:{args.port}", flush=True)
    if args.open:
        Timer(0.25, webbrowser.open, args=(f"http://127.0.0.1:{args.port}/",)).start()
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
