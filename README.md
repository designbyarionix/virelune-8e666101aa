# Virelune

The complete browser game project and Windows LAN implementation.

- `web/` contains the currently deployed static browser build, including packaged maps, models, textures, audio and vendor libraries.
- `local/` contains the local browser build and the latest WebSocket LAN implementation. It includes the static HTTP server, WebSocket gateway and room worker.

## Run the browser build

Run `python -m http.server 8080 --directory web` from the repository root and open http://localhost:8080.

## Run Windows LAN

Provide the original local game resources in `local/nnk`, or specify their location with `python local/serve.py --assets "path/to/nnk" --lan --port 8766`.

The `local/Start NNK LAN.cmd` launcher installs its pinned Python dependency into the local `.lan-deps` directory on first launch. It starts HTTP on port 8766 and WebSocket on port 8767. Players join the LAN URL printed by the server, enter a name and choose a character. Rooms use Chunin Finals and hold up to eight players.

Room state is in memory. The relay uses binary state deltas and a 20 Hz target tick, with per-player interest filtering. The browser runs movement, collision and combat simulation.

The files in `local/README.md` describe controls and the reconstruction.
