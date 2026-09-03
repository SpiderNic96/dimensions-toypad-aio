# Dimensions Toypad — Changelog

Consolidated history from the v3.3.11 GitHub release to current.

---

## 3.4.2 — Overlay no longer crops its own controls

First on-hardware look at the deployed overlay: the pad itself renders
correctly (3/1/3 geometry, circular centre, wider lower row, focus ring), but
everything under it was being cut off - the Move / Remove / Clear all / Close
row in pad mode, and the franchise grid in the picker.

`PadGrid` is width-driven (`width: 100%` plus a 700:397 `aspect-ratio`), so at
the shell's full 792px interior it claimed ~450px of height before anything
else got a say, and the shell's `overflow: hidden` silently cropped the rest.

- The pad is now the element that gives way, not the controls: its width is
  capped by the vertical room actually left over (`48vh` in pad
  mode, `38vh` in the picker modes, converted back into a width
  through the pad's own aspect ratio), so it shrinks rather than pushing the
  controls out of the shell.
- The four scrolling result regions are now real flex items
  (`flex: 1 1 auto; min-height: 0`) instead of fixed `40vh`/`46vh` blocks, so
  they shrink into the space available instead of spilling past the shell edge.
- `package-lock.json` version resynced (it was still pinned at 3.3.41).

---

## 3.4.1 — Multi-backend, licensing compliance, protocol fixes P1–P7, features F1–F8

> **Note:** Untested on physical Steam Deck hardware. Verification on real Deck hardware is pending.

**Remediation pass (post-feature-work correctness fixes)**

The feature work below (P1–P7, F1–F8) shipped in an earlier pass; the
multi-backend claim wasn't actually wired up until this one:

- Backend AppImages are fetched and hash-verified at setup time
  (`install_backend`), never bundled — each backend gets its own
  isolated config/cache/content root, so RPCS3 and Xenia coexist
  without colliding with a standalone install of either.
- Real pad geometry ported from `PAD_CELLS` (700×397, not 350×400).
- Per-backend Game Mode/Desktop launchers and shortcuts, replacing a
  single RPCS3-only launcher chain that had no Xenia path at all.
- `src/index.tsx`'s decompiled `SP_JSX` runtime calls converted to
  real JSX and split into modules (`api.ts`, `led.ts`, `Pad.tsx`,
  `Picker.tsx`, `types.ts`).
- `COMMAND_GAP` split into MOVE vs. simple-command gaps; UI strings
  made backend-aware instead of hardcoded to RPCS3.
- RPCS3 `release_api` repinned to the AppImage already built from a
  commit that's byte-identical to harrysof's v0.3 source (confirmed
  by full source diff) — harrysof's own release only ships a Windows
  build, so the working Linux AppImage is hosted on this repo's own
  `backends` release instead.
- `dist/index.js` rebuilt — the committed bundle predated all of the
  above and had drifted from `src/`.

**Multi-Backend**
- Integrated Xenia Canary alongside RPCS3.
- Enforced `license_mask = -1` for Linux Xenia setups.
- Runtime backend switching in Quick Access Menu Setup panel.

**Licensing & Integrity**
- Written GPL source offer and fetch script aligned to commit `6905c5ad` and verified SHA-256 (`c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b`).
- Clean separation of plugin (MIT), Decky shims (LGPL-2.1), and emulator components.

**Protocol & Rendering Patches**
- **P1**: sRGB display gamma encoding over hardware-calibrated white point.
- **P2**: GET_LED v2 protocol reader (40-byte snapshot with initial color decoding) + v1 fallback.
- **P3**: True cross-fade color interpolation for smooth transitions.
- **P4**: Command gap timing safeguards.
- **P5**: Polling pause during in-flight tag commands.
- **P7**: Full-body artwork detection (`_full.png`) with icon fallback and uncropped display cards.

**New Features**
- **F1**: Vehicle build filename parsing for LegoToypad v1.8 (`Owner - Build. Name.bin`).
- **F2**: Favourites shelf pinned to top of grid with quick-toggle (`X` / star button).
- **F3**: Multi-build selector drawer for vehicle families (Builds 1, 2, 3).
- **F4**: Recents category for rapid summoning of previously placed figures.
- **F5**: Synthetic LED demo loop in Toypad overlay to test colors and animations without launching the game.
- **F6**: Pad skins (Default, Plain, Old).
- **F7**: Sound effects preference toggle.
- **F8**: Confirm button swap option (A/B swap).

**Rebuilt Source**
- Clean reconstruction of `src/index.tsx` matching all functionality. Builds cleanly via Rollup.

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
