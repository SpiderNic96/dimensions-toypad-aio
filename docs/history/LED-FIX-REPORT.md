# LED Fix Report — 3.3.20

## Definitive source finding

The previous bundled runtime was:

- commit `797f1e417f736a04e43319f27812228c4c8dbf6e`
- SHA-256 `1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71`

That commit predates NeverCookFirst's LED mirroring commit `dfe6a7e4bdc17cec31097aec4cb248679bcc023b`, merged as `6905c5ad`. The LED feature was therefore not actually present in the bundled binary.

## Current runtime

3.3.20 bundles the x64 clang Linux AppImage built from `6905c5ad`:

`c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b`

The corresponding upstream workflow run successfully produced the Linux x64 clang artifact.

## Current LED contract

The runtime parses the game's HID LED commands and exposes:

`04 00 00 00 00` → `4C serial 03` + 3 × 9-byte region records.

Region mapping in the actual RPCS3 implementation is 1=center, 2=left, 3=right.

## What remains to be physically tested

- AppImage launch on the Steam Deck
- listener bind on 127.0.0.1:9191
- serial changes while LEGO Dimensions drives the LEDs
- Benny hacking sequence specifically
- flash/fade timing
- Decky C/L/R visual result

Source/build inspection is not claimed as physical Deck verification.
