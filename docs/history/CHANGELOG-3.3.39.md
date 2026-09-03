# 3.3.39 — LED white-point calibration

Single change. Nothing else touched.

## The colours were never sRGB

The game does not send display colour over GET_LED. It drives the Toypad's
physical RGB LED against a **per-channel calibration white point**, so what
arrives on the wire is drive levels, not screen values.

That white point is **(255, 110, 24)**. Rendering those bytes straight to a
screen is why everything read orange or muddy.

Portal chamber 2 was the case that exposed it — the three sections should be
yellow, turquoise and light magenta:

| Raw on wire | Rendered before | Actually means |
|---|---|---|
| `255,110,0`  | orange      | `#ffff00` yellow    |
| `0,110,24`   | dark green  | `#00ffff` turquoise |
| `255,0,24`   | red         | `#ff00ff` magenta   |

Normalised against the white point the channel ratios come out exactly
`[1,1,0]`, `[0,1,1]`, `[1,0,1]` — the three secondary colours, which is what
the game intended all along.

## It also explains the "orange" power-on glow

| Raw | Ratios | Actually |
|---|---|---|
| `153,66,14` | `[0.60, 0.60, 0.58]` | `#999995` — **white at 60%** |
| `63,27,5`   | `[0.25, 0.25, 0.21]` | `#3f3f35` — white at 25% |

The idle illumination was never orange. It was neutral white, skewed by the
uncorrected green and blue channels.

## The fix

`getLedRgb` now divides each channel by its calibration maximum before the
value reaches the renderer:

```js
const LED_WHITE_POINT = { r: 255, g: 110, b: 24 };
```

Applied at the single point where wire colour becomes display colour, so fade
interpolation, flash presentation and diffusion all inherit it unchanged.

Verified against every frame captured in testing, plus clamping (`255,255,255`
stays `#ffffff`, no overflow) and `off` (`0,0,0` stays black).

## Explicitly unchanged

- Bundled RPCS3 AppImage and SHA-256
- GET_LED protocol, 30-byte decoder, 40ms tick
- Frame-driven renderer, fade/flash/diffusion presentation
- Pad mapping, modal layout, diagnostics, controller handling
