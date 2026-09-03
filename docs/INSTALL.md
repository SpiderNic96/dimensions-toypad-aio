# Installing Dimensions Toypad

## What you need

- Steam Deck with **Decky Loader** installed
- A legally obtained LEGO Dimensions PS3 disc image
- Roughly 1 GB free for the plugin and bundled emulator

The bundled RPCS3 AppImage ships inside this archive. You do **not** need a separate RPCS3 install.

## Install

1. Switch to **Desktop Mode**.
2. Extract this archive. You should get a single `dimensions-toypad/` folder.
3. Copy that folder into:

   ```
   ~/homebrew/plugins/
   ```

   Final path: `~/homebrew/plugins/dimensions-toypad/`

4. Make the emulator executable:

   ```
   chmod +x ~/homebrew/plugins/dimensions-toypad/rpcs3/RPCS3-Toypad-x86_64.AppImage
   ```

5. Restart Decky, or reboot.

   **Restarting Decky matters.** A frontend-only refresh leaves the old `main.py` running, and backend changes will not take effect.

## First run

Open **STEAM → Decky (plug icon) → Dimensions Toypad → Setup & phone remote → Set everything up**.

Setup will:

- Verify the bundled RPCS3
- Download the tag library (the `.bin` files that identify each figure)
- Find your game files
- Write the Steam launcher shortcut
- Write a Desktop Mode shortcut for RPCS3

If a step fails, the panel names which one. You can rerun setup as many times as you like — it is idempotent.

## Game files

The plugin does not supply the game. Point it at your own dump. If setup reports the game as missing, place your files where the Setup panel indicates and rerun.

## Playing

Launch **LEGO Dimensions** from your Steam library. The shortcut starts the bundled RPCS3 directly in Game Mode, always fullscreen.

Everything else about RPCS3 — vblank, resolution scale, output scaling, sharpening — is yours to set. Open **RPCS3 (Dimensions Toypad)** from the Desktop Mode application menu to configure it globally or per-game. The plugin will not overwrite your choices.

## Using the Toypad

Open the overlay from the sidebar with **Open toypad overlay**, or bind a hotkey.

- Select an empty pad → franchise grid → pick a character
- Select an occupied pad → picker for that slot; the figure only leaves when you choose a replacement
- **Move** — select the figure, then the destination; occupied destinations swap
- **Remove**, **Clear all**
- **B** steps back one level: figures → franchises → pad → closed

## Hotkey

Steam holds an exclusive grab on the controller, so face, shoulder and back buttons never reach the plugin. **Only the volume keys are reachable**, because they sit on a separate input device.

Setup → Hotkey → **Set hotkey chord**, then hold **Volume Down + Volume Up**. The volume step still fires — that is the trade.

## Toggles

- **LED lighting** (overlay) — off stops all lighting traffic. Placing, moving, swapping and removing figures work exactly the same either way.
- **LED diagnostics** (sidebar) — recording only. The pad still receives every colour with this off. Turn it on when troubleshooting.

## Phone remote

See `PHONE-REMOTE.md`.

## Troubleshooting

**Nothing lights up.** Check the LED diagnostics line. `connected: false` means RPCS3 is not running or has not attached the toypad yet — get past the intro. `connected: true` with `changed` not advancing means the game is not sending LED commands for what you are doing, which is often correct.

**Hotkey does nothing.** Check `evdev` in the Hotkey section. `key events 0` with nodes open is Steam's grab — use volume keys.

**Colours look wrong.** The plugin corrects for the pad's calibration white point. If a colour looks obviously skewed, enable diagnostics and capture the raw hex.
