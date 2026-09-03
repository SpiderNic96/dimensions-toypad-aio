# Dimensions Toypad — Changelog

Consolidated history from the v3.3.11 GitHub release to current.

---

## 3.3.41 — Toggles, packaging, config ownership

**Added**
- **LED lighting toggle** in the overlay. Off stops all `GET_LED` traffic and clears the live colour state; on resets the serial gate so the very next snapshot is accepted rather than suppressed as unchanged. Figure placing, moving, swapping and removal use a different command path on the same socket and are unaffected in either position.
- **LED diagnostics toggle** in the sidebar. Recording only — `pad_colors` is written before the diagnostics gate, so the pad receives every colour with diagnostics off. Only the history and its hex strings stop.
- **Desktop Mode shortcut** to the bundled RPCS3 (`~/.local/share/applications/dimensions-toypad-rpcs3.desktop`), so the emulator's own settings are reachable and remain yours to configure.

**Removed**
- The RPCS3 display profile (vblank 120, 140% render scale, bilinear, CAS 50). RPCS3's global and per-game configuration is now entirely user-owned. The **only** RPCS3 setting the plugin still touches is `Start games in fullscreen mode`, re-asserted by the launcher so the Steam shortcut cannot come up windowed.
- "Open RPCS3 interface" button from the sidebar — superseded by the desktop shortcut.

**Packaging**
- Release archive reduced to the AppImage, the plugin, and a `docs/` folder.
- Separate full repository archive published alongside it.

## 3.3.40 — Colour-independent flash, adaptive poll

Flash animated opacity on a glow layer tinted with the LED colour, so a flash whose colour matched its background animated something invisible — black-on-dark and white-on-white produced no pulse. That is why coloured keystone flashes showed and swap/build flashes did not.

A companion keyframe now modulates tile **brightness** (1.0 → 0.34) on the cell root, which is colour-independent. The original opacity keyframe is retained so coloured flashes are unchanged.

Adaptive polling: the listener needs one connection per request, so a fixed 120 ms poll meant ~8 TCP connect/close cycles per second, almost all returning unchanged snapshots. Idle now ramps to 400 ms after 8 consecutive unchanged polls and snaps back to 120 ms on any change — 2.5 connects/sec at idle, with no latency change during an active sequence.

## 3.3.39 — LED white-point calibration

The game does not send display sRGB over `GET_LED`. It drives the physical RGB LED against a per-channel calibration white point of **(255, 110, 24)**. Painting those drive levels straight to a screen is why every colour read orange or muddy.

| Raw on wire | Rendered before | Actually means |
|---|---|---|
| `255,110,0` | orange | `#ffff00` yellow |
| `0,110,24` | dark green | `#00ffff` turquoise |
| `255,0,24` | red | `#ff00ff` magenta |
| `153,66,14` | orange | `#999995` white at 60% |

Normalised, the Portal chamber ratios come out exactly `[1,1,0]`, `[0,1,1]`, `[1,0,1]` — the three secondary colours. It also revealed the "power-on orange" glow was always neutral white.

## 3.3.38 — Live LED state clear on disconnect

Clear live per-pad and broadcast LED state when the listener drops, and reset the snapshot serial gate so the first snapshot after reconnect is accepted even if RPCS3 reuses the previous serial.

## 3.3.37 / 3.3.37.1 — Frame-driven renderer

One Toypad-level `requestAnimationFrame` loop updates CSS custom properties on the modal root, instead of a React animation loop per illuminated cell and zone. `PadZone` crash fix.

## 3.3.33–3.3.36 — GET_LED transport

Bounded diagnostic history of changed `GET_LED` snapshots; 30-byte snapshot decoder; 40 ms Toypad tick conversion.

## 3.3.20–3.3.25 — LED listener

Migration from the passive colour-command stream to the `GET_LED` request/response contract.

## 3.3.19 — LED model, Move, and interaction fixes

- **LED model corrected at the root.** 3.3.11 kept broadcast and per-pad colour apart and resolved by recency; because the game holds its base colour by re-broadcasting continuously, every per-pad hint was erased milliseconds after arriving. A broadcast now writes into pads 0/1/2, and a per-pad command owns that pad until something is addressed to it again.
- **Move swaps instead of overwriting.** `pads[src] = None` had dropped the only reference to whoever stood on the destination.
- Tapping an occupied pad opens the picker instead of erasing; the outgoing figure leaves only when a replacement is chosen.
- Franchise grid navigation fixed (`flow-children` was `horizontal`, making Steam treat a wrapping flex as one row).
- Background panel chrome stripped with `!important` on a re-assert ladder.
- Hotkey: only volume keys are bindable, confirming Steam's exclusive controller grab.

## 3.3.18 — Two panels, four tiles, and B

- `ModalRoot` draws its own box; the modal now walks its ancestor chain and strips chrome from every non-fullscreen box above it, skipping the full-viewport backdrop.
- Franchise tiles were four per row because padding and border escape the flex basis without `box-sizing: border-box` — 130 px against a 120 px budget.
- B stepped out instead of back. Every exit now routes through one guarded handler with a 250 ms lock: figures → franchises → pad → closed.

## 3.3.17 — evdev hotkey, franchise grid

`SteamClient.Input` cannot supply chords: `RegisterForControllerStateChanges` does not exist on current SteamOS, and the APIs that do exist hand back a bare integer. Detection moved to `/dev/input/event*` in `main.py`. Franchise grid replaced the flat list — five tiles across, scrollable, using existing franchise artwork.

## 3.3.16 — Starters artwork, LED sampling

Starters artwork bundled at `assets/logos/Starters.jpg`. Logo precedence: tag library → plugin bundle → `~/toypad/logos/`. LED sampling raised to 150 ms.

## 3.3.14 / 3.3.15 — Interactive overlay

`routerHook.addGlobalComponent` renders a component but never gives it gamepad focus — the overlay was a picture, not a UI. Replaced with `showModal` + `ModalRoot`. Search, franchise browsing, move, remove and clear all moved into the overlay.

## 3.3.12 / 3.3.13 — Pad redesign and LED timing

- Per-pad LED colours never resolved: both halves keyed the lookup off `SLOTS['pad']` (an int) instead of `SLOTS['zone']` (the section name), so the lookup always missed and fell back to broadcast.
- Figure names were shredded to one or two characters per line in the narrow cells; the portrait became the tile.
- Flash timing taken from the game — event `0x02` always carried `[on_ms, off_ms, count]`, and the first three bytes were being discarded.
- Focus lands on content rather than the last button.

## 3.3.11 — Baseline

Starting point for this history.
