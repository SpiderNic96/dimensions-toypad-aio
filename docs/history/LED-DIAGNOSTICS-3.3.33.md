# LED diagnostics 3.3.33

This build adds a bounded listener-side event history sourced from the 30-byte
GET_LED snapshots returned by the bundled RPCS3 Toypad listener.

The diagnostics show, per changed snapshot:
- sequence and timestamp
- LED serial and serial delta
- centre/left/right RGB
- mode (off/colour/flash/fade as decoded by the listener)
- Toypad timing ticks and derived milliseconds
- flash count / fade count and speed where present
- previous RGB -> current RGB when available
- raw 30-byte RX payload

Important boundary: this is the Decky listener's GET_LED stream. It does not
claim to expose the game's private C0-C8 command packets, which are interpreted
inside RPCS3 before GET_LED exposes the LED state.

The bundled RPCS3 AppImage is unchanged.
