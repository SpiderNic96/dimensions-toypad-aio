# Installing Dimensions Toypad

## What you need

- Steam Deck with **Decky Loader** installed, **Developer Mode** enabled in
  Decky's settings (Decky → Settings → General → Developer Mode) — required
  for any plugin installed outside the official plugin store, including this one
- A legally obtained game dump for whichever backend you choose (LEGO
  Dimensions PS3 disc image for RPCS3, or the Xbox 360 version for Xenia)
- Roughly 100–200 MB free for the plugin and the emulator AppImage it fetches;
  no emulator is bundled in this archive

## Install

1. Switch to **Desktop Mode**.
2. Extract this archive. You should get a single `dimensions-toypad/` folder.
3. Copy that folder into:

   ```
   ~/homebrew/plugins/
   ```

   Final path: `~/homebrew/plugins/dimensions-toypad/`

4. Restart Decky, or reboot.

   **Restarting Decky matters.** A frontend-only refresh leaves the old `main.py` running, and backend changes will not take effect.

## First run

Open **STEAM → Decky (plug icon) → Dimensions Toypad → Setup & phone remote**.
Pick a backend (RPCS3 or Xenia) and run **Set everything up**.

Setup will:

- Download and SHA-256-verify the chosen backend's AppImage — never bundled,
  never trusted on "latest" alone, refused outright if the hash doesn't match
  what the plugin has pinned
- Download the tag library (the `.bin` files that identify each figure)
- Find your game files
- Write the Steam launcher shortcut(s) for that backend

If a step fails, the panel names which one. You can rerun setup as many times as you like — it is idempotent. You can install and switch between both backends from the same Setup panel.

## Game files

The plugin does not supply the game. Point it at your own dump. If setup reports the game as missing, place your files where the Setup panel indicates and rerun.

## Playing

Launch **LEGO Dimensions (RPCS3)** or **LEGO Dimensions (Xenia)** from your Steam library, depending on which backend's shortcut you created in Setup. Each starts that backend directly in Game Mode, in its own isolated config — the two never share settings or collide with a standalone install of either emulator.

Everything else about the emulator is yours to set. Open the matching Desktop Mode shortcut (created in Setup) to configure it globally or per-game — RPCS3's Qt UI is mouse-oriented, Xenia's is controller-navigable. The plugin will not overwrite your choices.

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
