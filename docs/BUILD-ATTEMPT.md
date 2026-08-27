# Source-build attempt — 2026-08-27

This document records an actual build attempt against the supplied source package rather than claiming a build that did not occur.

## Environment detected

- Node.js: `v22.16.0`
- npm: `10.9.2`
- TypeScript (`tsc`): `5.8.3`
- CMake: `3.31.6`
- Ninja: `1.12.1`
- `distrobox`: not installed
- GitHub host networking from the container: unavailable (DNS resolution failed)

## Checks that passed

```text
Python main.py syntax       PASS
JavaScript reference check PASS
AIO manifest JSON           PASS
Reference AppImage SHA-256 1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71
```

`py_compile` passed for `source/plugin/main.py`.
`node --check` passed for `source/plugin/dist-reference-index.js`.
The supplied AppImage hash matches the current `source/plugin/AIO-MANIFEST.json`.

## Plugin source build attempt

The documented command was started:

```bash
cd source/plugin
npm install --no-audit --no-fund
```

The attempt timed out twice before dependency installation completed. No `node_modules` tree was created, so Rollup could not be invoked honestly. This is recorded as **BLOCKED — package registry/network unavailable or unreachable in the build container**, not as a successful build.

## RPCS3 source build attempt

The documented source fetch was attempted:

```bash
git clone --filter=blob:none --no-checkout \
  https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build.git
```

It failed immediately because the build container could not resolve `github.com`.

The Fedora 41/Distrobox build described by `source/docs/BUILDING-RPCS3.md` therefore could not be executed in this environment. No claim is made that the supplied AppImage was source-rebuilt here.

## What was still reproduced

The reference AIO was successfully unpacked and verified as a coherent install artifact. A local repack step is provided in `scripts/repack-reference-aio.sh`; it reconstructs the AIO ZIP from the exact supplied files for artifact-shape testing.

## Next authoritative source-build path

Run the supplied RPCS3 build recipe in Fedora 41 (or in the project's GitHub Actions workflow) at commit `797f1e417f736a04e43319f27812228c4c8dbf6e`, apply `source/rpcs3-patch/apply-color-forwarding.sh`, build, package, then compare the resulting AppImage against the manifest SHA. A mismatch is informative and does not by itself mean the source build is wrong.
