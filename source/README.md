# Dimensions Toypad AIO 3.3.11 — Full Source Distribution

Everything needed to rebuild the AIO plugin from scratch: plugin backend,
plugin frontend, RPCS3 fork patches, protocol spec, packaging documentation.

## What's in the box

```
dimensions-toypad-source-3.3.11/
├── README.md                  ← you are here
├── plugin/                    ← the Decky plugin
│   ├── main.py                ← Python backend (source of truth)
│   ├── src/index.tsx          ← TypeScript frontend
│   ├── dist-reference-index.js← the shipping bundle, for byte-compare
│   ├── package.json           ← npm + Decky tooling
│   ├── tsconfig.json
│   ├── rollup.config.mjs
│   ├── plugin.json            ← Decky manifest
│   ├── AIO-MANIFEST.json      ← release manifest with SHA + changelog
│   └── assets/
│       └── fetch-upstream-source.sh
├── rpcs3-patch/               ← what turns upstream fork → colour-forwarding fork
│   └── apply-color-forwarding.sh   ← idempotent, whitespace-tolerant sed patch
├── protocol/                  ← the LEGO Dimensions Toypad Event Protocol v1
│   ├── SPEC.md
│   ├── README.md
│   ├── LICENSE                ← 0BSD; anyone can copy
│   ├── conformance/test-vectors.md
│   └── reference/
│       ├── cpp/{toypad_event.hpp, example_emulator.cpp, example_client.cpp}
│       └── python/toypad_client.py
└── docs/
    ├── BUILDING-RPCS3.md      ← Deck-specific fork build (all the gotchas)
    ├── BUILDING-APPIMAGE.md   ← packaging with Qt 6.8.3 + ICU 74
    ├── BUILDING-PLUGIN.md     ← npm build for the frontend
    ├── INSTALLING.md          ← install path on the Deck
    ├── ARCHITECTURE.md        ← how the pieces fit together
    └── PATCH-NOTES.md         ← what the RPCS3 patch actually does
```

## The short version

1. **Build the RPCS3 fork with colour forwarding** — `docs/BUILDING-RPCS3.md`.
   About 90 minutes on a Deck if you build fresh; a few minutes to incremental-
   rebuild after a small edit.
2. **Package the AppImage** — `docs/BUILDING-APPIMAGE.md`. About 5 minutes.
3. **Build the plugin frontend** — `docs/BUILDING-PLUGIN.md`. About 30 seconds
   once `npm install` has run.
4. **Install** — `docs/INSTALLING.md`. Copy the plugin to `~/homebrew/plugins`
   and restart the Decky service.

## What each component does

**RPCS3 fork** — modified LEGO Dimensions toypad emulation. Two things
happen on top of upstream: (a) a TCP listener on `127.0.0.1:9191` accepts
LOAD/REMOVE/MOVE commands from external companion apps; (b) when the game
issues a LED colour or flash command, the emulator broadcasts an event
frame on the same socket per the protocol in `protocol/SPEC.md`. Both are
strictly additive - the USB emulation path the game sees is unchanged.

**Plugin backend (main.py)** — Python running under Decky Loader.
Auto-detects the game/library, serves the LegoToypad v1.5 phone UI on port
8781, sends LOAD/REMOVE/MOVE commands to the RPCS3 listener, and keeps a
persistent client on the listener socket to receive LED colour events.

**Plugin frontend (src/index.tsx)** — the Decky QAM panel. Setup checks,
pad-slot grid, LED colour visualisation. Compiles to `dist/index.js` which
is what Decky Loader actually loads.

**Protocol spec** — 30 lines of wire format so future emulators (Cemu,
shadPS4) can implement the same interface and share the same clients.

## Why the source distribution exists

The plugin ships as a runtime-only AIO zip with a bundled AppImage; that
zip is what users install, and it deliberately doesn't include the tools
needed to modify it. This distribution is what lets a maintainer:

- Change plugin behaviour and rebuild `dist/index.js`.
- Apply the RPCS3 patch to a fresh fork clone (e.g. after a fork rebase).
- Rebuild the AppImage with different settings, then swap it into the
  plugin.
- Ship those changes as a new AIO.

## License

- Plugin (Python + TypeScript): **GPL-2.0-only** (matches upstream Decky
  plugins). See `plugin/COPYING.GPL-2.0` (fetched by the release script).
- RPCS3 patch (rpcs3-patch/): **GPL-2.0-only** to match RPCS3 itself.
- Protocol spec + reference code (protocol/): **0BSD** - freely copyable
  into any emulator regardless of licence.

## Version

- **AIO 3.3.11** — plugin bumped from 3.3.10 for recency-based per-pad /
  broadcast LED colour resolution. AppImage is byte-identical to 3.3.10
  (SHA `1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71`).
- Fork commit: `797f1e417f736a04e43319f27812228c4c8dbf6e`
  (RPCS3-Seamless-Toypad-Build)
- Phone UI: LegoToypad v1.5 (harrysof/LegoToypad), unmodified

## Support

The plugin runs against the specific fork/patch combination documented
above. If you swap emulators or fork versions, expect the AppImage SHA
check to fail. That's by design - the manifest hashes the exact artefact
we build against. Regenerate `BUNDLED_RPCS3_SHA256` in `main.py` after any
rebuild.
