# 3.3.38 — Live LED state clear on disconnect

## Fix
- Preserve the 3.3.37 frame-driven LED renderer and 3.3.37.1 `PadZone` crash fix unchanged.
- When the RPCS3 GET_LED listener loses its connection, clear the live per-pad/broadcast LED state immediately.
- Reset the snapshot serial gate so the first GET_LED snapshot after reconnect is accepted even if RPCS3 reuses the previous serial value.
- Keep the bounded LED diagnostic history intact; disconnect only invalidates the current renderer state.

## Explicitly unchanged
- Bundled RPCS3 AppImage and SHA-256.
- GET_LED request/response protocol and 30-byte snapshot decoder.
- 40 ms Toypad tick conversion.
- Controller / Toypad interaction.
- Frame-driven renderer, CSS variables, diffusion and fade/flash presentation.
- Modal layout and diagnostics.
- Performance configuration/runtime. Performance investigation deferred to a later build/test.
