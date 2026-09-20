# Technical Documentation & Architecture

This document describes how the various components of the Dimensions Toypad plugin interact, how the backends are structured, and how to build the project from source.

## Component Architecture

1. **Decky Plugin Frontend (React/TypeScript)**
   - The UI is built using `@decky/ui` components.
   - It communicates with the Python backend via Decky's `callable()` bridge.
   - **File:** `index.js` (Compiled from source).

2. **Python Backend Daemon**
   - **File:** `main.py`
   - Handles the TCP server for emulators to connect to.
   - Parses the proprietary Toypad protocol.
   - Maintains the master state of the pad (which tags are on which slots).

3. **Phone Remote (Web App Extended)**
   - A separate HTTP server (`web.py`) serves the HTML/JS frontend located in `assets/Web/`.
   - The web app polls or uses WebSockets to sync the pad state and LED colors from the Python daemon.

4. **In-Game Overlay**
   - **File:** `toypad-overlay` (compiled C binary) and `overlay.py`.
   - Hooks into the game's rendering context to draw the toypad state visually on screen.

## Backend Interactions

### RPCS3 / CEMU / shadPS4
- These emulators expect a physical USB connection or a TCP connection simulating the Disney Infinity / Skylanders / LEGO Dimensions portal.
- The Python backend spins up a TCP socket on the default port. The emulators are configured to route Toypad traffic to `127.0.0.1:<PORT>`.
- The backend parses the raw byte packets (e.g., `get_led()` or `read_tag()`) and responds with the mocked NFC tag data corresponding to the characters the user selected in the UI.

### LEGO Dimensions Recompiled
- The native recompiled port has deeper hooks. Instead of just simulating a USB protocol over TCP, the Python backend communicates directly with the Recompiled game's memory/IPC hooks if configured.
- When compiling the Recompiled game from the latest git on the Steam Deck, you must run it in **Gaming Mode** for Decky Loader to inject the React Modal correctly. Running the Recompiled game in Desktop Mode will still work with the Phone App, but the Decky Modal will be unavailable.

## LED State Sync
1. The emulator sends an LED change packet to the Python backend.
2. The Python backend decodes the RGB values and brightness.
3. The backend updates its internal `leds` dictionary.
4. The Decky React Frontend, Phone Web App, and C Overlay all poll/receive this state and update their UI elements to match the exact RGB/Brightness requested by the game engine.

## Building from Source

This repository contains a GitHub Actions workflow (`.github/workflows/build.yml`) that automates the release process.

### Manual Build
Since the plugin relies on pre-compiled JavaScript (`index.js`), building simply requires zipping the directory while excluding development files.

```bash
mkdir -p dist
cp index.js dist/index.js
# Zip the directory structure
zip -r dimensions-toypad-release.zip . -x "*.git*" "data/favourites.json" "data/recent.json"
```

## Custom Bin Files & Upgrades
- **Loading:** Place raw NFC `.bin` dumps of characters or vehicles into the `custom_tags/` directory. The `gamescan.py` script indexes these on startup.
- **Upgrades:** When the game writes upgrade data to a vehicle tag, the Python backend captures the write payload and patches the `.bin` file on disk. This ensures your vehicle upgrades persist across reboots.
