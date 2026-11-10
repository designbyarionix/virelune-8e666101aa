"""WebSocket transport for the LAN room worker."""
from argparse import ArgumentParser
import asyncio
from contextlib import suppress
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent / '.lan-deps'))
from websockets.asyncio.server import serve
from arena_rooms import read_frame, wait_for_parent, write_frame


async def run_gateway(port, room_port, http_port):
    async def handle(socket):
        try:
            origin = urlsplit(socket.request.headers.get('Origin', ''))
            host = urlsplit('//' + socket.request.headers.get('Host', ''))
            valid = (socket.request.path == '/arena-ws' and origin.scheme == 'http'
                     and origin.hostname == host.hostname and origin.port == http_port)
        except ValueError:
            valid = False
        if not valid:
            await socket.close(1008, 'Invalid arena origin')
            return

        try:
            reader, writer = await asyncio.open_connection('127.0.0.1', room_port)
        except OSError:
            await socket.close(1013, 'Room worker unavailable')
            return

        async def upstream():
            async for message in socket:
                write_frame(writer, message.encode() if isinstance(message, str) else message)
                await writer.drain()

        async def downstream():
            while True:
                data = await read_frame(reader)
                await socket.send(data.decode() if data.startswith(b'{') else data)

        tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()

    async with serve(handle, '0.0.0.0', port, max_size=2048, max_queue=8,
                     compression=None, ping_interval=15, ping_timeout=10) as gateway:
        print(gateway.sockets[0].getsockname()[1], flush=True)
        await wait_for_parent()


if __name__ == '__main__':
    parser = ArgumentParser()
    parser.add_argument('port', type=int)
    parser.add_argument('room_port', type=int)
    parser.add_argument('http_port', type=int)
    args = parser.parse_args()
    asyncio.run(run_gateway(args.port, args.room_port, args.http_port))
