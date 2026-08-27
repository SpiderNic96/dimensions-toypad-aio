# Installing the AIO on a Steam Deck

Once you have a `dimensions-toypad-AIO-3.3.11.zip`, this is how it lands
on the Deck.

## Requirements

- Decky Loader already installed. See https://decky.xyz for the loader.
- SSH access to the Deck (or the desktop-mode Files app).

## Fresh install

From the Deck, in a terminal:

```bash
cd ~/homebrew/plugins
sudo rm -rf dimensions-toypad
sudo unzip -q ~/Downloads/dimensions-toypad-AIO-3.3.11.zip
sudo chown -R deck:deck dimensions-toypad
sudo systemctl restart plugin_loader.service
```

## Upgrade from an earlier AIO version

Same procedure - the `rm -rf` above deletes state; if you want to preserve
per-plugin settings, back up `~/homebrew/plugins/dimensions-toypad/settings.json`
first.

## What actually gets installed

```
~/homebrew/plugins/dimensions-toypad/
├── main.py                     ← backend
├── dist/index.js               ← frontend bundle
├── plugin.json                 ← Decky manifest
├── AIO-MANIFEST.json           ← release identity
├── assets/                     ← optional support scripts
└── rpcs3/
    └── RPCS3-Toypad-x86_64.AppImage
```

The AppImage is ~180 MB, so the whole plugin is ~200 MB on disk. That
is by design - the emulator is bundled to avoid dependency drift.

## First-run behaviour

When Decky Loader picks up the plugin (after the `systemctl restart`):

1. Backend scans for the game (`/home/deck/lego/game/PS3_GAME/USRDIR/EBOOT.BIN` by default),
   tag library (`/home/deck/LegoToypad-src/All Bin Files/`), and Steam
   launcher (`/home/deck/toypad/play-dimensions.sh`). If any are missing
   you'll see red ticks in the Setup panel.
2. Phone-remote web server starts on port 8781, serving the unmodified
   LegoToypad v1.5 UI plus our synthetic "Starters" franchise.
3. Colour reader task connects to `127.0.0.1:9191` (won't succeed until
   the game is launched via the plugin's Steam launcher).

## Launching the game

Two ways:

- **Steam Game Mode:** the plugin auto-registers a Steam shortcut called
  "LEGO Dimensions". Launch from your library. This is the recommended
  path.
- **Desktop:** `bash ~/toypad/play-dimensions.sh` runs the AppImage
  directly.

Either way, the Setup panel's LEDs diagnostic row should tick over from
`reader: waiting` to `reader: connected + N frames` within a few seconds
of the game starting.

## Uninstall

```bash
sudo rm -rf ~/homebrew/plugins/dimensions-toypad
sudo systemctl restart plugin_loader.service
```

Also revoke the Steam launcher shortcut manually from Steam if you don't
want it lingering.

## Troubleshooting

- **Plugin doesn't appear in Decky.** Check `journalctl -u plugin_loader -n 100`
  for import errors. Usually a permissions problem - re-run the
  `chown -R deck:deck` step.
- **Setup says "Bundled RPCS3 unavailable".** The AppImage isn't
  executable or is corrupt. `chmod +x rpcs3/RPCS3-Toypad-x86_64.AppImage`
  and re-check.
- **LEDs stay grey during play.** The colour reader isn't connected.
  Check the "reader:" text in the LEDs row - if it says an error, that's
  the cause. Common: game running under a different user/env so the
  socket isn't reachable.
- **Phone remote URL shows "Loopback only - connect to Wi-Fi".** Deck is
  offline. Once Wi-Fi is connected, the panel updates on next refresh.
