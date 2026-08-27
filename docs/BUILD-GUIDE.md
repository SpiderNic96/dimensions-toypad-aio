# Complete build guide

## Plugin

From `source/plugin`:

```bash
npm install
npm run build
node --check dist/index.js
```

The result is `source/plugin/dist/index.js`.

## RPCS3

The source distribution documents a Fedora 41 toolchain and the exact fork commit:

```text
https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build
797f1e417f736a04e43319f27812228c4c8dbf6e
```

Apply the three-file colour-forwarding patch:

```bash
ROOT=/path/to/rpcs3-workspace \
  sh source/rpcs3-patch/apply-color-forwarding.sh
```

Then configure with Ninja using the flags in `source/docs/BUILDING-RPCS3.md`, notably `USE_NATIVE_INSTRUCTIONS=OFF`, `BUILD_LLVM=ON`, and `STATIC_LINK_LLVM=ON` for the documented portable Deck build.

The AppImage packaging steps are in `source/docs/BUILDING-APPIMAGE.md`.

## AIO assembly

The installable runtime tree is:

```text
dimensions-toypad/
├── main.py
├── dist/index.js
├── plugin.json
├── AIO-MANIFEST.json
├── assets/
└── rpcs3/RPCS3-Toypad-x86_64.AppImage
```

Use the exact bundled AppImage after the source build or package it separately, then zip the runtime directory.

## Verification

Always record:

- AppImage SHA-256
- AppImage byte size
- RPCS3 commit
- plugin version
- source revision of LegoToypad
- whether the binary matched the reference hash
- physical Deck acceptance tests separately from source/build checks
