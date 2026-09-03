# 3.3.36 — Live LED + Modal Geometry Fix

## LED
- ToypadModal now polls the live GET_LED-derived state continuously (100 ms).
- The visible C/L/R pad renderer therefore consumes the same live state exposed by diagnostics.
- Existing frame-driven interpolation remains in place; no artificial colour sequence is introduced.

## Modal geometry
- The modal stage is fixed to the Steam Deck viewport and cannot be translated by parent QAM scrolling.
- Stable viewport sizing prevents initial right-shift and scroll-induced whole-modal movement.
- Shell paint containment was removed so LED glow/focus effects are not clipped.

## Safety
- No RPCS3 AppImage changes.
- No listener/socket/parser changes.
- No controller navigation changes.
- Diagnostics remain read-only.
