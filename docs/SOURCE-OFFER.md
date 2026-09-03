# Source Offer

`Dimensions Toypad` distributes a modified build of **RPCS3**, which is licensed
under the **GNU General Public License, version 2**. This file is the written
offer required by GPL-2.0 §3(b).

The RPCS3 AppImage is **not** bundled in the plugin zip or committed to this
repository. It is published as a release attachment on this repository's
`backends` release, downloaded by the plugin at setup time, and refused if its
SHA-256 does not match the value below.

---

## The distributed binary

| Field | Value |
|---|---|
| File | `rpcs3-v0.0.42-7-6905c5ad_linux64.AppImage` |
| Distributed at | https://github.com/SpiderNic96/dimensions-toypad-aio/releases/download/backends/rpcs3-v0.0.42-7-6905c5ad_linux64.AppImage |
| Size | 93,840,381 bytes |
| SHA-256 | `c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b` |
| Version string | `0.0.42-7-6905c5ad` (toypad build 2026-08-27) |

Verify for yourself after download:

```sh
sha256sum rpcs3-v0.0.42-7-6905c5ad_linux64.AppImage
```

The value printed must match `c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b`
exactly. If it does not, this offer does not describe the binary you have, and
you should report it as a bug rather than rely on the source reference below.

## The corresponding source

| Field | Value |
|---|---|
| Upstream repository | https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build |
| Exact commit | `6905c5ad82805af216a8addad40ee7dcea49f66b` |
| Branch / tag at build time | `master` |
| Build workflow run | https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build/actions/runs/33050774919 |

That commit is the **complete corresponding source** for the binary above. It
is the tree that was compiled to produce it — not merely a nearby revision.
(Its content is identical to `harrysof/RPCS3-Seamless-Toypad-Build` tag `v0.3`,
commit `dfe6a7e4b`, which NeverCookFirst merged as `6905c5ad`.)

`source/fetch-upstream-source.sh` clones it at exactly that commit, and
verifies the AppImage's hash first if one is present beside it.

## Your rights under the GPL

You may obtain, modify and redistribute the source for the distributed RPCS3
build under GPL-2.0. The full licence text is included as
`docs/COPYING.GPL-2.0`.

If the automated fetch script is unavailable to you, a copy of the corresponding
source will be provided on request through the project's issue tracker, on a
physical medium if required, for no more than the cost of distribution. This
offer is valid for at least three years from the date this binary was
distributed.

## What is and is not covered by this offer

- **Covered** — the distributed RPCS3 AppImage and its complete corresponding
  source.
- **Not covered** — the plugin itself (`main.py`, `dist/index.js`, `src/`),
  which is a separate work communicating with RPCS3 over a loopback TCP socket,
  and the LegoToypad tag library and artwork, which carry their own terms. See
  `docs/THIRD-PARTY-NOTICES.md` and `docs/CREDITS.md`.

## Other bundled or fetched components

| Component | Upstream | Pinned ref | Notes |
|---|---|---|---|
| RPCS3 (modified) | https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build | `6905c5ad82805af216a8addad40ee7dcea49f66b` | GPL-2.0, release attachment, hash-verified at setup |
| LegoToypad tag library | https://github.com/harrysof/LegoToypad | `v1.8` | fetched at setup |
| Xenia Canary (modified) | https://github.com/SpiderNic96/Xenia-Seamless-Toypad-Build | `52aabc6c6b71cc7b0810975541839784787e1332` | BSD-3-Clause, fetched from that fork's releases |
| Cemu (modified) | — | — | **Not shipped in this release** — no upstream Linux build exists yet |

Optional backends are downloaded at setup time and hash-verified before use.
Each is redistributed under its own licence; see `docs/THIRD-PARTY-NOTICES.md`.
