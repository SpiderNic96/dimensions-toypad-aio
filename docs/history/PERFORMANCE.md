# Performance Notes — 3.3.18

## Overlay architecture

The Toypad is now rendered and controlled from one overlay component. The sidebar does not maintain a second live Toypad/LED polling loop. This removes duplicate state work introduced by the modal refactor.

## LED updates

The backend prefers the emulator's `GET_LED` snapshot when available. The poll runs independently of React view changes, while the frontend only updates React state when the snapshot actually changes. Flash/fade animation is handled by the rendered LED layer rather than restarting an animation on every transport poll.

## Timing

Toypad LED timing fields are treated as ticks, approximately 40 ms per tick. Raw ticks are retained for diagnostics.

## 3.3.37 performance changes

The modal no longer runs a separate React animation loop for every illuminated cell and zone. One Toypad-level `requestAnimationFrame` loop updates CSS custom properties directly on the modal root. This keeps the exact received RGB state while avoiding hundreds of React state updates per second during fades.

The live GET_LED modal poll remains 100 ms because it is the authoritative transport snapshot. Diagnostics are independent and refresh at 750 ms to avoid unnecessary full-panel reconciliation.

## Acceptance checks

- Opening/closing the overlay repeatedly must not increase listener count, timers, or polling loops.
- Browsing/searching while LEDs animate must not restart an unchanged flash/fade.
- The sidebar must not render the seven-slot Toypad while the overlay is active.
- The bundled RPCS3 AppImage SHA256 must remain `1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71`.
