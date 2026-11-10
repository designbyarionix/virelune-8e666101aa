"""LAN room protocol. The WebSocket gateway forwards length-prefixed messages to this worker."""
import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
import json
import math
import re
import struct
import sys
import time

HEROES = {'naruto', 'sasuke', 'kakashi', 'sakura', 'anbu'}
ROOM_SIZE = 8
MAX_ROOMS = 64
RADIUS = 1400
INTEREST_LIMIT = 40
STATE = struct.Struct('<hhhIBbBBBB')
GROUPS = ((1, 0, 6), (2, 6, 11), (4, 11, 13), (8, 13, 16))
ENTRY = struct.Struct('<HB')
HEADER = struct.Struct('<BI')


async def read_frame(reader):
    size, = struct.unpack('<H', await reader.readexactly(2))
    if not 0 < size <= 2048:
        raise ValueError('Invalid frame length')
    return await reader.readexactly(size)


def write_frame(writer, data):
    writer.write(struct.pack('<H', len(data)) + data)


def control(**fields):
    return json.dumps(fields, separators=(',', ':'), ensure_ascii=False).encode()


async def wait_for_parent():
    await asyncio.to_thread(sys.stdin.buffer.read, 1)


@dataclass(eq=False)
class Peer:
    id: int
    slot: int
    token: str
    hero: str
    name: str
    writer: asyncio.StreamWriter
    state: bytes = b''
    position: tuple = (0, 0, 0)
    visible: dict = field(default_factory=dict)
    hits: list = field(default_factory=list)
    last_hit: float = -math.inf
    last_state: float = -math.inf


class Room:
    def __init__(self, name, rooms):
        self.name = name
        self.rooms = rooms
        self.peers = {}
        self.next_id = 0
        self.started = time.perf_counter()
        self.task = asyncio.create_task(self.run())

    def add(self, token, hero, name, writer):
        old = next((peer for peer in self.peers.values() if peer.token == token), None)
        if old:
            self.peers.pop(old.id)
            old.writer.close()
        if len(self.peers) >= ROOM_SIZE:
            raise ValueError('Стаята е пълна')
        slots = {peer.slot for peer in self.peers.values()}
        slot = next(i for i in range(ROOM_SIZE) if i not in slots)
        self.next_id = self.next_id % 65535 + 1
        while self.next_id in self.peers:
            self.next_id = self.next_id % 65535 + 1
        peer = Peer(self.next_id, slot, token, hero, name, writer)
        self.peers[peer.id] = peer
        return peer

    def receive(self, peer, data):
        if self.peers.get(peer.id) is not peer:
            return
        now = time.perf_counter()
        if data[0] == 1 and len(data) == 1 + STATE.size:
            if now - peer.last_state < .015:
                return
            state = data[1:]
            x, y, z, _, _, _, hp, _, _, flags = STATE.unpack(state)
            if hp > 100 or flags & ~1 or max(abs(x), abs(y), abs(z)) > 16000:
                raise ValueError('Invalid player state')
            peer.state = state
            peer.position = (x, y, z)
            peer.last_state = now
        elif data[0] == 2 and len(data) == 4:
            target_id, damage = struct.unpack_from('<HB', data, 1)
            target = self.peers.get(target_id)
            if (target and target is not peer and peer.state and target.state
                    and now - peer.last_hit >= .12 and 0 < damage <= 65
                    and len(target.hits) < 24 and math.dist(peer.position, target.position) <= 1300):
                target.hits.append((peer.id, damage))
                peer.last_hit = now
        else:
            raise ValueError('Invalid player packet')

    def tick(self):
        stamp = int((time.perf_counter() - self.started) * 1000) & 0xffffffff
        for peer in list(self.peers.values()):
            if not peer.state or peer.writer.is_closing():
                continue
            if peer.writer.transport.get_write_buffer_size() > 16384:
                peer.writer.close()
                continue
            nearby = []
            for other in self.peers.values():
                if other is peer or not other.state or other.writer.is_closing():
                    continue
                distance = math.dist(peer.position, other.position)
                if distance <= RADIUS:
                    nearby.append((distance, other.id, other))
            visible = {other.id: other for _, _, other in sorted(nearby)[:INTEREST_LIMIT]}
            enter = [[pid, other.hero, other.name] for pid, other in visible.items() if pid not in peer.visible]
            leave = [pid for pid in peer.visible if pid not in visible]
            if enter or leave:
                write_frame(peer.writer, control(enter=enter, leave=leave))
            packet = bytearray(HEADER.pack(16, stamp))
            for pid, other in visible.items():
                previous = peer.visible.get(pid)
                mask = 0
                payload = bytearray()
                for flag, start, end in GROUPS:
                    part = other.state[start:end]
                    if previous is None or part != previous[start:end]:
                        mask |= flag
                        payload.extend(part)
                if mask:
                    packet.extend(ENTRY.pack(pid, mask))
                    packet.extend(payload)
            for source, damage in peer.hits:
                packet.extend(ENTRY.pack(source, 16))
                packet.append(damage)
            if len(packet) > HEADER.size:
                write_frame(peer.writer, packet)
            peer.visible = {pid: other.state for pid, other in visible.items()}
            peer.hits.clear()

    async def run(self):
        try:
            deadline = time.perf_counter()
            while self.peers:
                self.tick()
                deadline = max(deadline + .05, time.perf_counter())
                await asyncio.sleep(max(0, deadline - time.perf_counter()))
        finally:
            if self.rooms.get(self.name) is self:
                self.rooms.pop(self.name, None)


def parse_join(data):
    join = json.loads(data)
    if not isinstance(join, dict):
        raise ValueError('Invalid join')
    room, token, hero, name = (join.get(k) for k in ('room', 'token', 'hero', 'name'))
    if not all(isinstance(v, str) for v in (room, token, hero, name)):
        raise ValueError('Invalid join')
    if (not re.fullmatch(r'[a-z0-9-]{0,24}', room)
            or not re.fullmatch(r'[a-f0-9]{32}', token) or hero not in HEROES
            or not 1 <= len(name) <= 24 or not name.isprintable() or not name.strip()):
        raise ValueError('Invalid join')
    return room, token, hero, name.strip()


async def run_worker():
    rooms = {}

    async def connection(reader, writer):
        room = peer = None
        try:
            data = await asyncio.wait_for(read_frame(reader), 5)
            room_name, token, hero, name = parse_join(data)
            if not room_name:
                room_name = next((r.name for r in rooms.values()
                                  if r.name.startswith('arena-') and len(r.peers) < ROOM_SIZE), '')
                if not room_name:
                    room_name = next((f'arena-{i}' for i in range(1, MAX_ROOMS + 1)
                                      if f'arena-{i}' not in rooms), '')
            if not room_name or (room_name not in rooms and len(rooms) >= MAX_ROOMS):
                raise ValueError('Сървърът е пълен')
            room = rooms.get(room_name)
            if not room:
                room = rooms[room_name] = Room(room_name, rooms)
            peer = room.add(token, hero, name, writer)
            write_frame(writer, control(room=room.name, slot=peer.slot, id=peer.id))
            await writer.drain()
            while True:
                room.receive(peer, await read_frame(reader))
        except ValueError as error:
            with suppress(OSError):
                write_frame(writer, control(error=str(error)))
                await writer.drain()
        except (OSError, asyncio.IncompleteReadError, TimeoutError):
            pass
        finally:
            if room and peer and room.peers.get(peer.id) is peer:
                room.peers.pop(peer.id)
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()

    async with await asyncio.start_server(connection, '127.0.0.1', 0) as server:
        print(server.sockets[0].getsockname()[1], flush=True)
        await wait_for_parent()


if __name__ == '__main__':
    asyncio.run(run_worker())
