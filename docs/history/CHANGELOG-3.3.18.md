# Dimensions Toypad AIO 3.3.18 — Overlay Consolidation, Accurate LED Timing & Navigation Repair

This release keeps the 3.3.x AIO UI/features and fixes the modal refactor issues without rebuilding the bundled RPCS3 AppImage. The AppImage SHA256 remains the existing bundled hash.

## LED timing verification

The current NeverCookFirst RPCS3 listener describes the LED snapshot timing fields as Toypad ticks, approximately 40 ms each. Harry's current LegoToypad source also models the fields as `onTicks`, `offTicks`, and `speedTicks`, rather than milliseconds. An independent Lego Dimensions implementation similarly names the fields `TickOn`, `TickOff`, and `TickCount`.

Therefore 3.3.18 treats the wire values as ticks and uses **40 ms/tick** for rendering/diagnostics. The previous 62.5 ms (1/16 second) interpretation is removed. The raw tick counts remain exposed as `rawOn`, `rawOff`, and `rawSpeed`.

This is intentionally a rendering conversion: the wire values stay untouched.

## Toypad architecture

- The overlay is the single authoritative interactive Toypad.
- The sidebar no longer renders a second Toypad or runs a second LED/state loop.
- Existing setup, hotkey, phone-remote and configuration features remain available from the sidebar.

## Modal/navigation fixes

- B/Escape now walks the modal navigation stack and only closes the overlay at the root.
- Redundant visible background/box layers are removed.
- Franchise tiles use a stable five-column grid aligned to the search field.
- Search/franchise/roster lists no longer use nested Focusable scrolling containers that caused jumping icons.

## Toypad actions

- Move swaps an occupied destination rather than overwriting it.
- Clear All returns and applies the backend pad state so the visual model cannot remain stale.
- Back to the Future owns the DeLorean; it is no longer included in the synthetic Starters roster.

## LED rendering

The renderer follows the emulator/game model of three physical LED regions: left, centre and right. It supports: structure-aware solid colours, flash/strobe with game timing, fade animation, explicit OFF states, and all-region updates. A pale powered white/blue base glow is used only when no game override is active; an explicit OFF command suppresses it.

LED state is read through one authoritative backend reader. The reader prefers the newer `GET_LED` snapshot when supported and falls back to the legacy push stream. Unchanged snapshots do not mutate timestamps, preventing CSS animations from restarting at every poll.

## Hotkeys

Hotkey capture now explicitly instructs the user to release existing buttons before holding the new chord. Diagnostics explain the Steam Input/evdev ownership problem and the keyboard-mapped fallback path.

## Compatibility

No RPCS3 rebuild is required. The bundled AppImage remains byte-for-byte unchanged; the plugin is the component modified in this release.
