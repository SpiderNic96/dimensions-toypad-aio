# 3.3.37.1 — PadZone crash hotfix

- Fixes the 3.3.37 `ReferenceError: slot is not defined` crash when opening the Toypad.
- The `PadZone` renderer now uses its existing `zone` prop when resolving live LED CSS variables.
- No changes to the bundled RPCS3 AppImage, listener, socket path, LED parsing, colour decoding, or performance renderer.
- Based directly on the tested 3.3.37 PERFORMANCE-FIX package.
