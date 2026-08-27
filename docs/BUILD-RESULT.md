# Build / reproduction result

Date: 2026-08-27

## Reference artifact

The supplied AIO archive was unpacked successfully. Its bundled AppImage was independently hashed and matched the current 3.3.11 manifest:

`1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71`

## Packaging reproduction

The supplied AIO was repackaged locally from its exact extracted contents.

- original AIO outer SHA-256: `7a57a02a8b6133fed712842ee7b60e2eb7514cd71333811be0c71d73a75a351f`
- repackaged outer SHA-256: see the local build log / command output
- file count: 20 regular files in the ZIP
- all extracted file contents: **identical**

The outer ZIP hash is expected to differ because ZIP container metadata is rewritten during repackaging.

## Source compilation

A true source compilation was attempted but could not be completed in this environment:

- plugin dependencies could not be installed because npm registry access timed out
- the RPCS3 source repository could not be cloned because `github.com` DNS resolution failed
- the prescribed Fedora 41/Distrobox environment is not installed here

Therefore this repository does **not** claim that the 3.3.11 AppImage was rebuilt from source locally.

## Intended CI build

`.github/workflows/build-plugin.yml` builds the Decky frontend from TypeScript/React.

`.github/workflows/build-rpcs3-appimage.yml` performs the RPCS3 source checkout, applies the recorded colour-forwarding patch, and builds inside Fedora 41 using the source recipe as the starting point.

`.github/workflows/repro-aio.yml` performs deterministic packaging-shape verification against the supplied reference AIO.
