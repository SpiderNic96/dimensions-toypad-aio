# 3.3.33 — LED event diagnostics

- Added a bounded listener diagnostic stream of changed GET_LED snapshots.
- Each entry exposes serial/delta, C/L/R RGB, mode, Toypad tick timing, count and raw 30-byte RX.
- Added previous RGB comparison so fade-state endpoints can be inspected as FROM → TO.
- Diagnostics are explicitly labelled as the listener GET_LED stream, not raw game C0-C8 traffic.
- Kept the bundled RPCS3 AppImage byte-for-byte unchanged.
