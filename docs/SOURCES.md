# Dimensions Toypad AIO — Source & Provenance

## 1. Bundled RPCS3

Project:
https://github.com/RPCS3/rpcs3

Patched fork used for the distributed binary:
https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build

Exact commit:
`797f1e417f736a04e43319f27812228c4c8dbf6e`

Bundled file:
`rpcs3/RPCS3-Toypad-x86_64.AppImage`

SHA-256:
`12e69118cf40d66155208e5e7cd51b4f34e680f13c505d9fc05d594b179ff29f`

Size:
`183638520` bytes

The RPCS3 upstream project states that most files are GPL-2.0-only and that individual files may carry different licensing notices. The upstream source tree is therefore authoritative for file-level licensing.

## 2. LegoToypad

Project:
https://github.com/harrysof/LegoToypad

Version/source target:
`v1.5`

The Decky plugin downloads tag data, artwork and web UI material from the LegoToypad v1.5 source when required. The tag library is deliberately not baked into the AIO package.

## 3. Decky Loader

Project:
https://github.com/SteamDeckHomebrew/decky-loader

Decky Loader is the Steam Deck plugin framework. It is not redistributed as part of this AIO package.

## 4. Plugin source in this AIO

The current package includes the backend source:

- `main.py`
- `package.json`
- `plugin.json`
- built frontend: `dist/index.js`

The compiled frontend is included for installation. A future standalone source release should retain the original TypeScript/React source tree as well if it is maintained separately from this packaged artifact.

## 5. Upstream history relevant to the Toypad bridge

The RPCS3 fork history records:

- NeverCookFirst — initial RPCS3 Seamless Toypad Build commits.
- harrysof — merged Toypad-related changes, including move pickup delay/build integration.

The LegoToypad v1.5 history records:

- harrysof — original LegoToypad application and continuing development.
- NeverCookFirst — contributions merged into v1.5, including pad shortcuts/story mode/rebinding work.

These are source-history facts, not a claim that every upstream line of code was authored by one person.

## 6. Exact-source retrieval

For reproducibility, `SOURCE/fetch-upstream-source.sh` can retrieve the exact upstream source revisions when network access is available. This release records the exact revisions so that the distributed binary can be independently matched to source.
