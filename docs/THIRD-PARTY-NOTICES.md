# Third-Party Notices

`Dimensions Toypad` redistributes, patches, or fetches software from several
upstream projects. Every licence below was **read from the LICENSE file in the
actual source tree**, the npm registry metadata, or the upstream repository's
recorded licence — not assumed.

---

## Summary

| Component | Licence | Copyright | How we distribute it | Obligation |
|---|---|---|---|---|
| **RPCS3** (modified) | **GPL-2.0** | RPCS3 contributors | patched binary, release attachment, fetched at setup | written offer + complete corresponding source |
| **Xenia Canary** (modified) | **BSD-3-Clause** | (c) 2015 Ben Vanik | patched AppImage, fetched at setup | copyright notice, conditions, disclaimer; no endorsement |
| **Cemu** (modified) | **MPL-2.0** | Cemu contributors | **not shipped in this release** | **modified files** disclosed under MPL-2.0 when shipped |
| **LegoToypad** | **MIT** | (c) 2026 Sofiane Belkacem Nacer | tags, artwork, web UI fetched at setup | copyright + permission notice |
| **shadPS4 Toypad Bridge** | **MIT** | (c) 2026 NeverCookFirst | protocol reference only | copyright + permission notice if code is reused |
| **react-icons** | MIT | react-icons contributors | bundled in `dist/index.js` | copyright + permission notice |
| **@decky/api** | LGPL-2.1 | Decky Loader contributors | shim bundled in `dist/index.js` | notice + licence text; source offered (this repo) |
| **@decky/ui** | LGPL-2.1 | Decky Loader contributors | build-time; components provided by the loader at runtime | notice + licence text; source offered (this repo) |
| **@decky/rollup** | BSD-3-Clause | Decky Loader contributors | build tool only, not distributed | — |
| **Decky Loader** (runtime) | GPL-2.0 | Decky Loader contributors | **not distributed** — the user installs it | — |

---

## RPCS3 — GPL-2.0

The distributed `rpcs3-v0.0.42-7-6905c5ad_linux64.AppImage` is a **modified**
RPCS3 build with an emulated LEGO Dimensions toypad and a loopback TCP listener
added. It is published as a release attachment and downloaded by the plugin at
setup time; it is never committed to this repository.

GPL-2.0 §3(b) requires that we accompany the binary with a written offer for the
complete corresponding source. That offer is `docs/SOURCE-OFFER.md`, and
`source/fetch-upstream-source.sh` clones the exact commit it names.

**The commit named must be the commit that built the shipped binary.** A previous
release named a different one; the fetch script now hashes the AppImage beside it
and refuses to run on a mismatch.

Full licence text: `docs/COPYING.GPL-2.0`.

### Our modifications

Changes to RPCS3 source are themselves GPL-2.0 and are published in the fork,
not held privately. Currently: none by this project — the toypad work is
upstream in `harrysof/RPCS3-Seamless-Toypad-Build`.

---

## Xenia Canary — BSD-3-Clause

```
Copyright (c) 2015, Ben Vanik.
All rights reserved.
```

Redistribution in binary form must reproduce the copyright notice, the list of
conditions, and the disclaimer in the documentation or other materials provided
with the distribution. **This file satisfies that**, together with
`LICENSES/BSD-3-Clause-Xenia.txt`.

Third clause: neither the project name nor its contributors' names may be used
to endorse or promote derived products without prior written permission. So the
plugin must not imply Xenia project endorsement — the backend is described as
"Xenia Canary (modified)", never as "official".

BSD-3 does not require source disclosure, but our patches are published anyway:
`SpiderNic96/Xenia-Seamless-Toypad-Build`, branch `linux-toypad`.

---

## Cemu — MPL-2.0

**MPL-2.0 is file-level copyleft, and this is the obligation most easily missed.**
Any Cemu **source file we modify** must be made available under MPL-2.0. Files we
do not touch are unaffected, and MPL does not reach the plugin — it is a separate
work over a network socket.

Cemu is **not shipped in this release** (no upstream Linux build exists yet). If
a later release adds it and this project has modified Cemu files, the modified
files must be published and retain their MPL-2.0 headers. Currently: none — the
toypad work is upstream in `harrysof/Cemu-2.6-Remote-Toypad-Build`.

Full text: `LICENSES/MPL-2.0-Cemu.txt`.

---

## LegoToypad — MIT

```
MIT License
Copyright (c) 2026 Sofiane Belkacem Nacer
```

**Redistribution is permitted**, including the tag `.bin` files, character
artwork, and the `Web/` remote UI that the plugin serves verbatim. MIT requires
only that the copyright notice and permission notice accompany copies —
satisfied by this file plus `LICENSES/MIT-LegoToypad.txt`.

This project's protocol understanding and pad geometry derive from LegoToypad's
implementation. See `docs/CREDITS.md`.

> The LEGO Group's trademarks and character designs are not licensed by this
> project or by LegoToypad. Artwork depicting LEGO characters is redistributed
> for interoperability with software the user already owns. This project is
> unaffiliated with and unendorsed by the LEGO Group or Warner Bros.

---

## shadPS4 Seamless Toypad Bridge — MIT

```
MIT License
Copyright (c) 2026 NeverCookFirst
```

Not currently redistributed. `shadPS4ToypadBridge.cs` is the reference
implementation for **GET_LED wire protocol v2** (40-byte snapshots). If any of
its code or structure is reused, the copyright and permission notice must ship
with it — `LICENSES/MIT-shadPS4-Bridge.txt`.

---

## react-icons — MIT

Bundled into `dist/index.js` at build time (`FaCubes`, `GenIcon`, `IconBase`).
Notice: `LICENSES/MIT-react-icons.txt`.

---

## Decky Loader and the `@decky/*` packages — verified 2026-09-03

Verified against the npm registry and the upstream repository, not guessed:

- **Decky Loader** (the runtime the user installs) is **GPL-2.0**
  (`SteamDeckHomebrew/decky-loader`). This project does not distribute it.
- **`@decky/api`** is **LGPL-2.1**. A small shim is bundled into
  `dist/index.js` at build time.
- **`@decky/ui`** is **LGPL-2.1**. Its components are provided by the loader at
  runtime; references remain external in the bundle.
- **`@decky/rollup`** is **BSD-3-Clause** and is a build tool only — nothing
  from it ships.

LGPL-2.1 obligations for the bundled shim are met two ways: the loader lets
users replace the plugin's `dist/index.js` with their own build, and this
repository provides the complete corresponding source (`src/`, build config,
and these notices) so anyone can relink. Licence texts:
`LICENSES/LGPL-2.1-decky.txt`.

---

## The plugin itself

`main.py`, `dist/index.js`, `src/`, the launcher scripts and the
desktop-shortcut generator are original work by MetalNic96 (SpiderNic96),
released under the **MIT License** — see `LICENSE`.

The plugin communicates with every emulator over a loopback TCP socket and
links against none of them, so it is not a derivative work of RPCS3, Xenia or
Cemu. Distributing a GPL binary alongside it (as a separate, hash-verified
download) does not impose GPL on the plugin.

---

## Not covered by any of the above

The LEGO Dimensions game, its title updates, DLC, and NFC tag data are the
property of their respective owners. **This project distributes no game code or
game assets.** Users supply their own legally obtained copies.
