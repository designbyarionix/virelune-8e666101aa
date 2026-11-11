# Arena rooms

On Windows, run `Start Rooms.cmd`. From any terminal with Python 3.10+, run `python server/rooms.py --open` at the repository root. Enter a name, open **Rooms**, and select **Create room**. A second browser tab can join from the room list or by entering the four-digit code.

For a shared network or a persistent host, run `python server/rooms.py --host 0.0.0.0`. The process serves the game and room endpoints together on `PORT` (8769 by default). Keep one replica because the relay holds rooms in process memory. On a public host, put it behind HTTPS. The room list shows all active rooms on that host. Codes are join identifiers.

A static deployment needs a same-origin reverse proxy for `/arena` and `/arena/rooms` to use this service. Without the service, training works and the room list reports that the server is offline.
