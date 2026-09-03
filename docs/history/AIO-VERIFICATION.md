# Dimensions Toypad AIO 3.3.7 — Verification

## Runtime policy

The AIO has one authoritative RPCS3 runtime:

`rpcs3/RPCS3-Toypad-x86_64.AppImage`

There is no runtime fallback to PATH, system RPCS3, Distrobox, a development build, or another AppImage.

## Bundled RPCS3 artifact

- SHA-256: `12e69118cf40d66155208e5e7cd51b4f34e680f13c505d9fc05d594b179ff29f`
- Size: `183638520` bytes
- Source commit: `797f1e417f736a04e43319f27812228c4c8dbf6e`
- Reported version: `RPCS3 0.0.42-5-797f1e41 Alpha`

## Static/runtime checks completed for this build artifact

- Python backend syntax check: PASS
- JavaScript bundle syntax check: PASS
- Bundled AppImage exists: PASS
- Bundled AppImage executable: PASS
- Bundled AppImage SHA-256 matches manifest: PASS
- Bundled AppImage launches with `APPIMAGE_EXTRACT_AND_RUN=1` in the build environment: PASS
- Bundled AppImage reports RPCS3 `0.0.42-5-797f1e41 Alpha` with an offscreen Qt platform in the build environment: PASS
- Backend RPCS3 resolver returns only the bundled AppImage: PASS
- Generated launcher uses `play-dimensions.sh -> run-both.sh -> bundled AppImage --no-gui EBOOT.BIN`: PASS by source/generated-script inspection
- Game Mode launcher detects the existing Gamescope session using environment/process-tree checks and does not nest Gamescope: PASS by source inspection
- Bundled AppImage uses XCB through Gamescope on SteamOS/Bazzite: PASS by source inspection

## Deck acceptance tests still required after installation

NOT TESTED in this build environment:

- Fresh Decky installation in Game Mode
- Physical Steam shortcut launch
- Actual Game Mode gamescope presentation
- Existing save/config preservation after this plugin update
- External USB/Bluetooth controller after this plugin update
- Toypad listener waiting -> connected transition on a physical Deck
- Tag navigation/focus appearance on the physical Deck
- Dark logo readability on the physical Deck
- Phone WebUI after fresh install/update
- 60 FPS ON/OFF against the physical RPCS3 configuration
- LEGO Dimensions direct game launch without the RPCS3 GUI

The AIO must not be considered release-complete until those Deck tests pass.

## Cross-distro download/TLS fix

- Tag/WebUI downloads no longer depend on Decky's Python `urllib` default CA lookup.
- The plugin first uses the host `curl` trust store, then tries explicit system CA bundles and `certifi` through Python.
- TLS certificate verification is never disabled.
- This is intended to cover SteamOS/Deck and Bazzite/Legion Go Decky environments where Python reports `CERTIFICATE_VERIFY_FAILED` despite the host OS having working HTTPS.
