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

### shadPS4 Setup Automation (`shadps4_setup.py`)
- **Automated Configuration**: shadPS4 configuration is handled seamlessly by `shadps4_setup.py`. It bypasses the Qt GUI entirely and writes directly to `config.json` (noting that legacy `config.toml` files are ignored by modern shadPS4 builds).
- **USB Device Binding**: It specifically forces the `usb_device_backend` integer to `3`, which correctly corresponds to the internal `DimensionsToypad` enumerator in shadPS4's C++ source code. Without this specific integer mapping, shadPS4 will never open TCP port 9191 to listen for the plugin.
- **EBOOT Extraction**: shadPS4 mandates decrypted `eboot.bin` files. While the plugin automates emulator configuration, the user must manually extract `.pkg` archives using Linux CLI tools (e.g., `ps4-pkg-unpacker`) and provide a console-decrypted `eboot.bin` alongside the `sce_sys` and `sce_module` dependencies.

### shadPS4 Cheat File Limitations
- **Current Limitation**: The plugin cannot natively read, toggle, or implement shadPS4 cheat files (such as 60FPS patches or memory modifications).
- **The Why**: shadPS4 handles cheats by parsing specific patch files at runtime via its Qt GUI layer. Unlike basic emulator settings (which are stored cleanly in `config.json`), cheat toggles often require the Qt GUI to parse the memory offsets and inject them, or they require writing complex structures that the current Python backend is not programmed to safely parse and serialize.
- **The Workaround**: To manage cheats, you must launch shadPS4 in Desktop Mode using its standard Qt GUI, apply your cheats there, and then boot back into Gaming Mode.
- **Future Implementation Needs**: For the Decky plugin to support a cheat file selector/implementor for shadPS4, the `shadps4_setup.py` script would need to be rewritten to include a full parser for shadPS4's patch file format. It would then need to expose a list of discovered cheats over the Decky IPC bridge to `index.js`, where a new React UI component would allow the user to toggle them, and finally write those toggled states back to whatever configuration file shadPS4 expects before boot.


## Exhaustive Step-by-Step Emulator Setup Guides

### 1. CEMU (Wii U)
1. **Base Game**: Obtain your base game files (unpacked folder format containing `code`, `content`, and `meta` directories).
2. **Update & DLC**: You must install the latest Update Patch and the DLC packs to use Year 2 characters.
3. **Installation**: 
   - Open the CEMU Desktop GUI.
   - Go to **File** -> **Install game title, update or DLC**.
   - Navigate to your Update folder and select its `meta.xml`. Wait for the success prompt.
   - Repeat this process for the DLC folder's `meta.xml`.
4. **Crash Fix**: Navigate to **Options** -> **Graphic Packs**. Download the latest community packs, expand LEGO Dimensions, and explicitly enable the **Crash Fix** to prevent random gameplay freezing.
5. **Toypad Hook**: Ensure your Toypad settings in CEMU's input/USB configuration are mapped to the localhost plugin (`127.0.0.1:9191`).

### 2. RPCS3 (PS3)
1. **Base Game**: Place your extracted PS3 game folder (e.g., `BLES02146`) into RPCS3's virtual HDD (`dev_hdd0/disc/` or `dev_hdd0/game/`).
2. **Update & DLC**: 
   - Go to **File** -> **Install Packages/Raps/Edats**.
   - Select your Game Update `.pkg` file.
   - Select your DLC `.pkg` files.
   - Select your `.rap` license files (required for DLC decryption).
3. **Configuration**: Right-click LEGO Dimensions in the game list -> **Create Custom Configuration**.
4. **Toypad Hook**: Go to the **Advanced** tab. Under **USB Devices**, find the drop-down and select **LEGO Dimensions Toypad**. Ensure it is communicating on the default port `9191`.

### 3. shadPS4 (PS4)
1. **PKG Extraction**: Dump your Base Game, Update, and DLC `.pkg` files from your console. Use `ps4-pkg-unpacker` to extract them on your Deck/Linux machine.
2. **Merging**: Extract the Base Game first. Then extract the Update `.pkg` and merge/overwrite those files directly into the Base Game directory. DLC files must be extracted to shadPS4's expected `dlc/` directory structure.
3. **EBOOT Decryption**: You *must* replace the encrypted `eboot.bin` found in the PKG with a fully decrypted EBOOT dumped directly from your PS4's memory via a payload like Itemzflow.
4. **Sysmodules**: ShadPS4 requires decrypted system modules to communicate with USB devices. Dump `libusb` and `libScePad` from your PS4 and place them into your shadPS4 `user/sys_modules/` folder.
5. **Patches & Cheats**: Place community patches (like 60FPS or resolution unlocks) into the shadPS4 `patches/` folder. You must open the shadPS4 Qt GUI in Desktop Mode to manually toggle these patches on.

### 4. Dimensions Recompiled (Native PC / Windows)
1. **Installation**: Follow the official Dimensions Recompiled setup guide to extract your Xbox 360 game data and install the `legodimensions.exe` game on your Steam Deck. 
2. **Shortcut Creation (Automatic)**:
   - Do **NOT** add the game manually via Desktop Mode!
   - Open the Decky Plugin in Gaming Mode, go to Settings -> **Add shortcut for Dimensions Recompiled**.
   - The plugin's background scanner will automatically locate your `legodimensions.exe` across both your internal SSD and SD cards.
   - Simply select the executable from the pop-up list.
3. **Auto-Patching Magic**: When the plugin creates your shortcut, it seamlessly patches your game's `legodimensions.toml` configuration file. It converts the installer's hardcoded Windows paths (e.g., `C:\Games\...`) into universal Linux/Proton paths mapped to the `Z:\` drive. This completely eliminates the notorious `--game_data_root does not exist` crash!
4. **Save Migration**: If migrating a PS4 save via DimensionsSaveConverter, launch the Recompiled game once to create a blank save (Slot 1). Then point the converter's output directly into the newly generated `00000001` folder inside your `content` directory.
5. **Playing**: Simply launch the newly created "Dimensions Recompiled" shortcut directly from your Steam library in Gaming Mode. The Decky plugin handles all custom tag spawning, LED sync, and file abstraction natively over Proton without any extra configuration needed!