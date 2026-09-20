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

### LEGO Dimensions Recompiled (by nevercookfirst)
- The Recompiled port is a Windows-native application. To run it on the Steam Deck, it requires a compatibility layer like Proton (added as a Non-Steam Game) or Lutris/Wine.
- The Python backend detects the Recompiled game and communicates with it (simulating the USB protocol over TCP or via direct hooks if configured).
- When setting up the Recompiled game from the latest git, you must run it in **Gaming Mode** (via Steam) for Decky Loader to inject the React Modal correctly. Running the game in Desktop Mode will still allow the Phone App to connect, but the Decky Modal will be unavailable.

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


## Feature Deep Dives

### Anomaly Modloader (shadPS4)
- **Sourcing**: The plugin dynamically fetches the `anomaly.prx` from the official GitHub release (connorh315/anomaly).
- **Verification**: It verifies the PRX magic bytes (`4F 15 3D 1D`) before writing to disk to prevent corrupted module injections that silently crash shadPS4.
- **Integration**: Unlike standard PS4 loading where modules go to `sce_module/`, shadPS4 auto-loads custom modules via `custom_modules/<GAME_SERIAL>/`. The plugin actively places `anomaly.prx` there, and provisions a `mods/` folder in the game directory.
- **Toggling**: Mod toggles are implemented by cleanly moving `.DAT`/`.HDR` pairs into a `mods/.disabled/` subfolder, ensuring the user's files are never permanently deleted but remain hidden from the game's virtual filesystem.

### Web App Extended (Phone Sync)
- **Integration**: Inspired by Harrysof's LegoToypad web implementation, the plugin runs a localized HTTP server (`web.py`) on your Deck.
- **Serving**: The frontend HTML/JS/CSS assets are mapped and served directly from `assets/Web/`.
- **Sync**: The web app uses standard polling/WebSocket connections to constantly ask the Python daemon (`main.py`) for the current pad state and LED colors. Whenever the emulator modifies the LED state, the daemon broadcasts it to the phone interface simultaneously.

### Game Shortcut Creation
- **Mechanism**: The plugin includes `shortcuts.py`, which is capable of writing directly to Steam's binary `shortcuts.vdf` file.
- **Implementation**: It parses the binary VDF file (bypassing the need for external `vdf` libraries on the Deck), looks up Steam's internal ID generator, and injects the AppImage/Flatpak execution parameters for RPCS3, CEMU, and shadPS4 directly.
- **Safety**: It inherently checks if the Steam client is currently running and refuses to write if it is, because Steam overwrites `shortcuts.vdf` on exit.

### Tri-Render LED Sync (Modal, Overlay, Phone)
1. **The Source**: The emulator (via TCP) sends an exact RGB value and brightness payload (e.g., `0x80`, `R`, `G`, `B`) intended for the physical Toypad hardware.
2. **The Backend**: `main.py` stores this in a live `leds` dictionary for each of the 3 pads (Center, Left, Right).
3. **Decky Modal**: The React frontend (`index.js`) continuously queries the daemon and injects the color code into the React components' CSS gradient properties for the pad backgrounds.
4. **Phone App**: `web.py` transmits the exact same hex conversions to the phone browser, applying them via DOM manipulation.
5. **C++ Overlay**: The `toypad-overlay` binary hooks into the game screen and reads the pad state directly via an IPC mechanism (shared memory/pipes), drawing the exact RGB colors atop the game engine's framebuffer.

### Tag Management (Clear, Move, Favourite)
- **Favorites**: When you favorite a character, its `stableId` is written to `favourites.json` within the plugin's data directory. The UI then flags this specific `stableId` with a visual accent (a heart/star).
- **Move/Swap**: Accomplished entirely via the Python dictionary tracking slot occupancy. Moving a tag triggers a virtually simulated physical "Tag Removed" event followed by a "Tag Placed" event on the new slot, forcing the emulator to safely de-spawn and re-spawn the character in-game without corruption.
- **Clear All**: Iterates over all occupied slots and fires sequential "Tag Removed" packets to the emulator, emptying the physical simulated state.
