# 3.3.40 — Colour-independent flash, adaptive poll

## Why keystone flashes showed and swap/build flashes did not

The flash effect animated **opacity on a glow layer whose colour is the LED
colour**. That works for a red or green keystone pulse against a dark tile. It
is invisible by construction when the flash colour matches what is behind it:

- flash of **black** -> animating a black glow over a dark tile -> nothing
- flash of **white** on an already-white pad -> nothing

So the transport was never the problem. Flash frames were arriving and being
rendered into something that could not be seen.

### Fix

A companion keyframe now modulates **tile brightness** rather than glow opacity,
applied to the cell root instead of the glow:

```
brightness(1) -> brightness(.34)
```

Brightness modulation is colour-independent, so a flash of any colour is
visible - black, white, or saturated. The original opacity keyframe is kept, so
coloured flashes look exactly as they did; the brightness pulse rides alongside
it.

Both share the game's own `on`/`off` timing and `count`, and both end on the lit
frame via `animation-fill-mode: forwards`.

## Adaptive polling

The fork's listener handles one command per client connection, so the reader
cannot hold a socket open - it reconnects for every request. At a fixed 120ms
that is roughly **8 TCP connect/close cycles per second, forever**, and the
overwhelming majority return an unchanged snapshot.

The poll now ramps toward 400ms after a second of genuine quiet, and snaps
straight back to 120ms the instant a snapshot changes.

| | Before | After |
|---|---|---|
| Connects/sec at idle | 8.3 | 2.5 |
| Latency during an active sequence | 120ms | 120ms |
| Worst-case latency to notice a new event | 120ms | 400ms, then 120ms |

The ramp only starts after 8 consecutive unchanged polls, so a gap between two
frames of one animation never slows the sequence. `poll_delay_ms` is exposed in
the diagnostics.

## Explicitly unchanged

- LED white-point calibration from 3.3.39
- Bundled RPCS3 AppImage and SHA-256
- GET_LED protocol, 30-byte decoder, 40ms tick, pad mapping
- Fade rendering, diffusion, modal layout, controller handling
- Tag `.bin` library handling

## Still unverified

Whether LEGO Dimensions sends any LED command at all on figure placement. The
Toy Pad has no autonomous lighting - it is an NFC reader whose lights are driven
entirely by the host - so if the game sends nothing, there is nothing to render.
Watch `changed` in the diagnostics at the moment of placement to settle it.
