# 3.3.37 — Frame-driven LED performance fix

- Keeps 3.3.36 as the UI/LED/diagnostics baseline.
- Replaces ten independent React/requestAnimationFrame LED loops (per cell + per zone) with one Toypad-level animation loop.
- Animation updates CSS custom properties directly on one DOM root instead of calling React state setters every animation frame.
- Retains received GET_LED RGB as authoritative and interpolates visually without synthetic colour sequences.
- Diagnostics remain available but refresh at 750 ms because they are read-only and do not need to repaint the full modal at 4 Hz.
- No listener, socket, parser, RPCS3 AppImage, controller, tag library, or interaction changes.
