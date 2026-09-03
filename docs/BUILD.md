# Building from source

## Layout

```
dimensions-toypad/
├── main.py            Python backend (Decky plugin API)
├── dist/index.js      Built frontend bundle
├── plugin.json        Decky manifest
├── package.json       Frontend metadata
├── assets/logos/      Bundled franchise artwork
├── rpcs3/             Bundled patched RPCS3 AppImage
└── docs/              Changelog, install guide, this file
```

## Backend

`main.py` needs no build step — Decky loads it directly. It targets the Python shipped with Decky Loader and imports only the standard library plus `decky`.

Validate before shipping:

```bash
python3 -c "import ast; ast.parse(open('main.py').read())"
```

## Frontend

`dist/index.js` is a Rollup bundle of the Decky frontend template, using `@decky/ui` and `@decky/api` as externals (`DFL`, `SP_REACT`, `SP_JSX` at runtime).

If you have the TypeScript source:

```bash
npm install
npm run build
```

If you only have the bundle — as in this archive — edit `dist/index.js` directly. It is unminified and readable. Syntax-check with:

```bash
node --input-type=module -e "
import {readFileSync} from 'fs';
const s = readFileSync('dist/index.js','utf8');
new Function(s.replace(/^import .*$/gm,'').replace(/^export .*$/gm,''));
console.log('ok');
"
```

## RPCS3

The bundled AppImage is a patched build providing the Toypad listener. It is **not** built by this repository. See `SOURCE-CODE-STATUS.md` and `SOURCE/fetch-upstream-source.sh` for the upstream commit and how to fetch it.

Verify the shipped binary against the manifest:

```bash
sha256sum rpcs3/RPCS3-Toypad-x86_64.AppImage
grep rpcs3_sha256 AIO-MANIFEST.json
```

## Protocol reference

The plugin speaks to the patched RPCS3 over TCP on `127.0.0.1:9191` — RPCS3's `DimensionsListener.cpp` binds a fixed port and reads no environment variable, so this is not configurable. The listener handles **one command per client connection**, so every request opens a fresh connection.

**Outbound** — figure LOAD / REMOVE / MOVE frames.

**Inbound** — `GET_LED` request `04 00 00 00 00`, answered with a 30-byte snapshot:

```
byte 0      header (0x4c)
byte 1      serial — advances when LED state changes
byte 2      region count (3)
bytes 3+    three 9-byte records:
            pad, mode, r, g, b, on, off, count, speed
```

Pad IDs follow the hardware convention: `0` = all, `1` = centre, `2` = left, `3` = right. Durations are in ticks of approximately 40 ms.

RGB values are **LED drive levels, not sRGB**. The game drives against a per-channel white point of `(255, 110, 24)`; divide by it to recover display colour. See the 3.3.39 changelog entry.

## Packaging a release

```bash
zip -r -y -X dimensions-toypad-AIO-<version>.zip dimensions-toypad
```

`-y` preserves symlinks, `-X` drops extra attributes. Confirm the AppImage keeps its executable bit.

## Licensing

RPCS3 is GPL-2.0 — see `COPYING.GPL-2.0`, `SOURCES.md`, `SOURCE-OFFER.md` and `THIRD-PARTY-NOTICES.md`. The written offer for corresponding source must ship with any redistribution.
