# Dimensions Toypad for Steam Deck (Decky Loader)

A Decky Loader plugin providing a complete digital Toy Pad for LEGO Dimensions on the Steam Deck. This plugin supports RPCS3, CEMU, shadPS4, and the Recompiled versions of the game.

## Features
- **Decky UI Modal**: A fully interactive interface natively integrated into the Steam Deck UI. Accessible via the Quick Access Menu or a custom hotkey.
- **Phone Remote Sync (Web App Extended)**: Serve the digital toypad over your local network to your phone or another device, with live LED synchronization.
- **In-Game Overlay**: Visual overlay of the toypad directly in-game.
- **LED State Sync**: The plugin reads the game's requested LED states and mirrors them to the Decky Modal, the in-game overlay, and the phone web app.
- **Custom Bin Support**: Drop `.bin` tag files into the `custom_tags` folder to load unsupported or customized vehicles/characters.
- **Vehicle Upgrades (Persistence)**: Supports saving vehicle upgrade tags back to the `.bin` files automatically.

## Setup Instructions

### Steam Deck Installation
1. Install [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).
2. Download the `dimensions-toypad-release.zip` from the Releases page.
3. Unzip the contents into `/home/deck/homebrew/plugins/dimensions-toypad/`.
4. Restart the plugin loader: `sudo systemctl restart plugin_loader` (or reboot your Deck).

### Desktop Mode Setup
While Decky plugins are designed for Gaming Mode, the background server (which handles the phone web app and overlay) can be run in Desktop Mode for testing or secondary usage. Simply execute `main.py` using Python 3 after ensuring all dependencies in `package.json` are satisfied.

## Emulator Configuration

### RPCS3
- Ensure the Toypad setting in RPCS3 is enabled and set to the default port. The plugin communicates via TCP.
- The emulator will automatically connect to the plugin's background daemon.

### CEMU
- **Requirements**: You need the Base Game, the Update Data, and all DLC installed.
- Configure CEMU's USB input settings to map to the emulated Toypad.
- **Note**: Ensure the game version is fully updated, otherwise certain Year 2 characters may not load correctly on the pad.

### shadPS4
- **System Modules**: ShadPS4 requires specific decrypted system modules to communicate with USB devices (like the Toypad). Ensure you have the required `libusb` and `libScePad` equivalents dumped from a PS4 and placed in your shadPS4 `sys_modules` folder.
- The plugin handles the TCP translation layer automatically.

### Recompiled Backend (by nevercookfirst)
- The Recompiled version of LEGO Dimensions is Windows-native. To run it on the Steam Deck, you must use a compatibility layer like Proton (by adding it as a Non-Steam Game) or configure it through Lutris/Wine.
- The plugin detects the Recompiled backend automatically.
- **Important**: You must launch the game through Steam (Gaming Mode) for the Decky Loader UI overlay to successfully hook into the rendering pipeline.

## Usage
- **Hotkey**: By default, pressing Volume Up + Volume Down together will open the Toypad modal in-game. Pressing it again will close it. 
- **Navigation**: Use the D-Pad to scroll through characters and the franchises grid. Press `A` on a pad slot to select it, then select a character to place them.
- **Clearing/Moving**: Use the top Action Bar to Clear all characters, Move them between slots, or mark favorites.

## Known Issues
- **Decky Loader Background Blur Quirk**: If you leave the Toypad modal open in-game and press the Steam button to return to the homescreen, Decky Loader may lose context of the modal. When you close it later, the background blur might get "stuck". **To avoid this**, always close the Toypad modal using the hotkey or the 'B' button before navigating back to the Steam homescreen.
- **LED Persistence on Exit**: Emulators like RPCS3 do not explicitly send a "turn off" command to the Toypad when returning to the game list menu. The LEDs may remain frozen in their last known state until the emulator is fully closed.

## Technical Documentation
For detailed information on how the backends interact, how to build from source, and architecture details, please see [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Credits
- **MetalNic96**: Original plugin author.
- **Harrysof**: Phone remote web app implementation.
- Various contributors to the LEGO Dimensions emulation community.

### Advanced Configuration & Shortcuts

#### CEMU Graphic Packs & Mods
- To prevent known crashes in the CEMU version of LEGO Dimensions, you must enable the **Crash Fix Graphic Pack**.
- Download the community Graphic Packs through CEMU's built-in downloader and check the box under the LEGO Dimensions entry.
- Ensure the game's **Base**, **Update**, and **DLC** folders are merged or installed correctly via CEMU's title manager to prevent missing assets.

#### Emulator Steam Shortcuts
- When adding emulators (RPCS3, CEMU, shadPS4) or the Recompiled Windows executable to Steam:
  1. Go to Desktop Mode -> Open Steam -> Add a Game -> Add a Non-Steam Game.
  2. Browse to the emulator's executable (or the Recompiled `.exe`).
  3. If adding the Windows Recompiled port or the Windows version of CEMU, right-click the shortcut in Steam -> Properties -> Compatibility -> Force the use of **Proton Experimental** or **Proton GE**.
  4. Launch via Gaming Mode to ensure Decky Loader can inject the Toypad Modal UI.

### Custom Bin Files
- You can add your own unreleased characters, custom builds, or third-party vehicle tags by placing the raw `.bin` files into your Deck's persistent storage.
- **Directory**: `~/.local/share/dimensions-toypad/custom/` (You may need to create this directory).
- Simply drop a 180-byte `.bin` file here. It will automatically populate in a "Custom" section in the Toypad UI.
- **Optional Metadata**: Alongside your `.bin`, you can add a `.png`/`.webp` image with the exact same filename for the portrait, and a `.json` file containing metadata like `{"name": "My Custom Character", "franchise": "DC Comics"}`.
- *Note: Files are stored here so they survive Decky plugin updates or reinstalls!*


### shadPS4: Game Extraction & EBOOT Decryption on Linux
To play the PS4 version of LEGO Dimensions via shadPS4 on your Steam Deck or Linux desktop, you cannot simply load a raw `.pkg` file. You must extract it and provide a decrypted EBOOT.
1. **Dumping the Game**: You must dump your legally owned copy of LEGO Dimensions from a jailbroken PS4. Use a dumping payload (like Itemzflow or ftpdump) to ensure the `eboot.bin` and all `.prx` modules are dumped in their **decrypted** state.
2. **PKG Extraction (Linux)**: If you have a `.pkg` file, you can extract it on Linux using open-source tools like [ps4-pkg-unpacker](https://github.com/Red-Prig/ps4-pkg-unpacker) or `unpkg`. 
   - Command line example: `./ps4-pkg-unpacker -x your_game.pkg output_dir/`
3. **Decrypted EBOOT**: The raw `.pkg` contains an encrypted `eboot.bin`. **shadPS4 cannot run encrypted EBOOTs.** You must replace the extracted `eboot.bin` with the decrypted payload dumped from your PS4's memory.
4. **Directory Structure**: Ensure your final directory contains the decrypted `eboot.bin` alongside the `sce_sys/` and `sce_module/` directories. Point shadPS4's game directory setting directly to this folder.

#### shadPS4 Cheats / Patches
- **Note**: This plugin does *not* support toggling shadPS4 cheat files (like 60FPS patches). This is because shadPS4 relies on its Qt GUI to parse and implement cheat memory offsets. You must manage your cheats manually via the shadPS4 desktop GUI. Implementing this in the plugin would require writing a custom patch parser in the Python backend.
