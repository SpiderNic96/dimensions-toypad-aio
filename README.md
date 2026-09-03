# Dimensions Toypad

LEGO Dimensions Toy Pad emulation for the Steam Deck as a Decky Loader plugin, with multi-backend emulator support (RPCS3 and Xenia Canary).

> [!WARNING]
> **Hardware Status: UNTESTED ON PHYSICAL HARDWARE**
> This release (v3.4.1) represents a comprehensive overhaul featuring multi-backend architecture, protocol updates, rebuilt TypeScript source, and significant feature additions. While all backend Python and frontend TypeScript/React components have passed clean compilation and static verification, **this version has not yet been validated on a physical Steam Deck**. Testing on real Deck hardware is pending. Please file issues and feedback on the issue tracker.

---

## Documentation

- **Installation Guide:** [`docs/INSTALL.md`](docs/INSTALL.md)
- **Full Changelog:** [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- **Building & Protocol Reference:** [`docs/BUILD.md`](docs/BUILD.md)
- **Written Source Offer (GPL):** [`docs/SOURCE-OFFER.md`](docs/SOURCE-OFFER.md)
- **Third-Party Notices & Licenses:** [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md)
- **Phone Remote Usage:** [`docs/PHONE-REMOTE.md`](docs/PHONE-REMOTE.md)

---

## What's New in v3.4.1 (Changes from Last Public Release)

### 1. Multi-Backend Architecture
* **Xenia Canary Support**: Full integration with the Xbox 360 backend alongside RPCS3 (PS3). Automatically enforces `license_mask = -1` in Linux Xenia configurations for title launch compatibility.
* **Backend Abstraction & Runtime Switcher**: Switch between active backends directly within the Decky Quick Access Menu (QAM) under *Setup & Preferences*. Extensible foundation for future backends (Cemu, shadPS4).

### 2. Legal & Licensing Compliance
* **Definitive GPL Compliance**: Accompanying written offer ([`docs/SOURCE-OFFER.md`](docs/SOURCE-OFFER.md)) and complete corresponding source fetcher ([`source/fetch-upstream-source.sh`](source/fetch-upstream-source.sh)) aligned to authoritative binary commit `6905c5ad` and verified SHA-256 (`c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b`).
* **Clean Component Separation**: Plugin source (`main.py`, `src/`) clearly demarcated under the MIT license; Decky Loader shim and UI bindings documented under LGPL-2.1; emulator licenses comprehensively disclosed in [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md) and [`LICENSES/`](LICENSES/).

### 3. Protocol & LED Pipeline Enhancements (P1–P7)
* **P1 sRGB Gamma Correction**: Implemented standard display gamma encoding over hardware-calibrated white points `(255, 110, 24)`, eliminating muddy/dim tones in favor of vibrant, true-to-game hues.
* **P2 GET_LED Protocol v2**: Native 40-byte snapshot decoding capturing initial transition colors (`from_r`, `from_g`, `from_b`), with seamless fallback to legacy 30-byte v1 snapshots.
* **P3 True Cross-Fade Rendering**: Smooth frame-interpolated color transitions replacing abrupt snap fades.
* **P4 Command Gap Timing**: Adaptive timing safeguards preventing emulator socket buffer flooding.
* **P5 Command Gating**: In-flight command locking pauses polling during tag placement, movement, and removal.
* **P7 High-Res Figure Artwork**: Support for full-body `_full.png` artwork, uncropped display cards, and head-icon fallbacks.

### 4. New Quality-of-Life Features (F1–F8)
* **F1 LegoToypad v1.8 Naming Compatibility**: Parses upstream v1.8 `Owner - Build. Name.bin` vehicle files, correctly extracting character ownership and build numbers.
* **F2 Favourites Shelf**: Press `X` (or click the star icon) on any figure to favourite it. Favourites appear pinned in a dedicated category at the top of the grid.
* **F3 Vehicle Multi-Build Selector**: Vehicle families are grouped into single cards that expand into a dedicated drawer for selecting Builds 1, 2, or 3.
* **F4 Recents Tracking**: Recently loaded characters and vehicles are automatically pinned to a "Recents" category for rapid summoning.
* **F5 Synthetic LED Demo Mode**: Test and validate pad lighting animations, colors, and white-point calibrations directly from the Toypad overlay without launching a game.
* **F6 Custom Pad Skins**: Cycle between visual pad styles (`Default`, `Plain`, `Old`).
* **F7 Sound Effects Preference**: Configurable sound feedback toggle.
* **F8 Confirm Button Swap**: Configurable swap of A/B button behavior in modal pickers.

### 5. Rebuilt Frontend Source (`src/index.tsx`)
* Fully reconstructed, human-readable TypeScript/React source code matching the shipped distribution.
* Zero build errors and full Rollup packaging pipeline (`npm run build`).

---

## Licensing

* **Dimensions Toypad Plugin**: [MIT License](LICENSE) (c) MetalNic96 (SpiderNic96).
* **Bundled RPCS3 AppImage**: [GPL-2.0](docs/COPYING.GPL-2.0). Source offer provided in [`docs/SOURCE-OFFER.md`](docs/SOURCE-OFFER.md).
* **Xenia Canary (Modified)**: [BSD-3-Clause](LICENSES/BSD-3-Clause-Xenia.txt).
* **LegoToypad Library & Assets**: [MIT License](LICENSES/MIT-LegoToypad.txt) (c) Sofiane Belkacem Nacer.
