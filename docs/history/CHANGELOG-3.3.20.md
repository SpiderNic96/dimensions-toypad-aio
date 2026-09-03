# 3.3.20 — LED runtime correction

## The important change

3.3.19 corrected the plugin reader, but the bundled AppImage was still identified as RPCS3 commit `797f1e41`, which predates the upstream LED mirroring implementation. The old AppImage therefore could not provide the LED source the reader expected.

3.3.20 replaces that runtime with the actual NeverCookFirst v1.2 Linux x64 clang build at commit `6905c5ad`.

## LED path now

```
LEGO Dimensions
    ↓
RPCS3 HID 0xC0–0xC8
    ↓
RPCS3 per-region LED state
    ↓
TCP GET_LED (0x04)
    ↓
30-byte 0x4C snapshot
    ↓
Decky reader
    ↓
C / L / R renderer
```

This is the same LED state model used by the current Windows RPCS3 build and Harry's Cemu implementation.

## Safety

- No HELLO handshake.
- No system RPCS3 fallback.
- Existing tag/phone/launcher architecture retained.
- Existing 40ms Toypad-tick rendering remains in place.
