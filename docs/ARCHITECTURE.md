# System architecture

## Runtime graph

```text
LEGO Dimensions (PS3)
        |
        | USB Toypad commands / responses
        v
Patched RPCS3 fork
  |              |
  |              +--> TCP 127.0.0.1:9191
  |                         |
  |                         +--> Decky colour reader
  |                         +--> phone/companion clients
  |
  +--> ordinary RPCS3 emulation path

Decky backend (main.py)
  |  |
  |  +--> generates/maintains Steam launcher chain
  |  +--> verifies bundled AppImage SHA-256
  |  +--> hosts LegoToypad v1.5 phone UI on :8781
  |  +--> sends LOAD / MOVE / REMOVE operations
  |  +--> resolves live per-pad/broadcast LED state
  |
  +--> Decky QAM frontend (dist/index.js)
            |
            +--> setup checks
            +--> LED diagnostics
            +--> 7-slot pad grid
            +--> figure selection and pad operations

Phone browser
  |
  +--> LegoToypad v1.5 Web UI
          |
          +--> backend JSON/API
                  |
                  +--> RPCS3 Toypad listener
```

## Why it works this way

The emulator remains authoritative for the game's Toypad state. The Decky plugin is an orchestration and visualization layer: it does not emulate the USB protocol itself.

The socket protocol creates a narrow boundary between native C++ and Python/JavaScript. That keeps the colour/flash forwarding code small and leaves the UI free to evolve.
