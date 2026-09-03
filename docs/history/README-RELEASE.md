# 3.3.20 LED runtime release

This package is the targeted LED runtime correction. It uses the real NeverCookFirst RPCS3 v1.2 LED-mirroring Linux build rather than attempting to emulate the missing LED implementation in the Decky plugin.

Install the ZIP as the Dimensions Toypad Decky plugin. The bundled AppImage is authoritative.

After launch, the Setup diagnostic should show `reader: connected + N frames`; N should increase when the game changes the Toypad LED state.
