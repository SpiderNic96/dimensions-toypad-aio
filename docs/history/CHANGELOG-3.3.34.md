# 3.3.34 — LED visual restore

- Restores the live LED visual renderer alongside the GET_LED diagnostics from 3.3.33.
- Keeps the known-good GET_LED snapshot parser and bundled RPCS3 AppImage unchanged.
- Makes the received RGB state visibly illuminate each physical pad region using layered diffusion, a soft white diffuser core, and restrained edge spill.
- Flash/fade timing remains driven by the received Toypad tick values.

## Evidence from 3.3.33
The recorded GET_LED stream shows the emulator-side LED state changing during gameplay (including blue/cyan and red/orange transitions) across the centre/left/right regions. The 3.3.34 change therefore targets presentation only; it does not alter packet decoding.
