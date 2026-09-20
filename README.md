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

### Recompiled Backend
- If you are playing the native Linux Recompiled version of LEGO Dimensions, the plugin detects the backend automatically. 
- Ensure you launch the Recompiled executable through Steam (Gaming Mode) so the Decky Loader overlay can hook into the rendering pipeline.

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
