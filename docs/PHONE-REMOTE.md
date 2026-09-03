# Phone Remote

## Automatic setup

The Dimensions Toypad AIO uses the upstream **LegoToypad v1.5** phone web UI. It is not a newly designed replacement UI.

On first-run setup:

1. The plugin verifies the bundled RPCS3 AppImage.
2. The plugin obtains the LegoToypad v1.5 tag library if the local library is absent.
3. The same upstream archive supplies `Web/` and `Assets/`.
4. The plugin starts the local HTTP server.
5. Decky reports the LAN URL for the phone browser.

No separate phone application, Node/npm installation, or manual web-server setup is required.

## Existing installations

If tags already exist but the Web/Assets payload is missing, the setup process downloads only `Web/` and `Assets/`. It does not replace the existing tag library.

The destructive library refresh is an explicit user action and requires confirmation.

## Runtime

The phone web UI talks to the Decky backend's local API. The backend translates load/remove/move commands into the RPCS3 Seamless Toypad listener protocol on loopback.

The physical ToyPad is not required for this emulated workflow.
