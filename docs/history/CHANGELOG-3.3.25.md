# 3.3.25 — LED runtime + corrected Toypad modal merge

Base: Dimensions Toypad AIO 3.3.20 LED runtime correction.

Preserved from 3.3.20:
- bundled RPCS3-Toypad-x86_64.AppImage
- LED runtime / colour-forwarding runtime
- main.py backend
- phone remote
- launcher and tag-library architecture
- all non-modal package assets and documentation

Merged from 3.3.24 ONLY where applicable to the Toypad modal UI:
- corrected ModalRoot close/back routing
- 250 ms navigation lock preventing one B press from skipping modal levels
- centred full-viewport modal presentation with a single Toypad shell
- Decky ModalRoot wrapper chrome neutralisation
- modal franchise grid controller navigation (`flow-children: grid`)
- scroll-result containers made controller-focusable
- occupied-pad selection opens the picker instead of immediately removing the figure
- corrected franchise tile box sizing for five-column layout

Intentionally NOT imported from 3.3.24:
- LED diagnostic section
- 3.3.24 backend/main.py changes
- 3.3.24 AppImage
- unrelated 3.3.24 setup/diagnostic UI

Runtime AppImage SHA-256:
c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b

The resulting dist/index.js passes `node --check`.
