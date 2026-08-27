# Reproducibility and release identity

## Authoritative 3.3.11 runtime

The supplied AIO manifest identifies:

- plugin version: `3.3.11`
- RPCS3 source fork: `https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build`
- RPCS3 commit: `797f1e417f736a04e43319f27812228c4c8dbf6e`
- bundled AppImage SHA-256: `1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71`
- bundled AppImage size: `258210296` bytes
- LegoToypad source target: `v1.5`
- runtime policy: bundled-only, no silent RPCS3 fallback

The manifest itself is at `source/plugin/AIO-MANIFEST.json`.

## Important distinction

There are three different meanings of "same":

1. **Reference runtime:** the supplied AppImage and AIO ZIP are the known-good artifacts from the 3.3.11 input files.
2. **Repackaged runtime:** rebuilding the ZIP from the exact supplied files should preserve file content, but normal ZIP metadata can change, so the outer ZIP's SHA-256 need not match.
3. **Source rebuild:** compiling the RPCS3 fork from source is expected to produce the same functional code, but exact binary identity is not guaranteed unless the complete toolchain, build inputs, timestamps, dependencies, and packaging process are reproduced exactly.

The project therefore records both the reference hashes and the source/build recipe rather than falsely claiming bit-for-bit source reproducibility.
