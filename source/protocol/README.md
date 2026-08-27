# LEGO Dimensions Toypad Event Protocol

A tiny wire protocol that lets external UIs observe what a LEGO
Dimensions toypad emulator has been told by the game — most importantly
the RGB colours the game uses to hint at Locate Keystone answers.

Without this, the puzzle is unsolvable past the first few levels because
every existing emulator drops the colour commands on the floor. See
[RPCS3 issue #15882](https://github.com/RPCS3/rpcs3/issues/15882) for
background.

The spec is small on purpose: **~30 lines of wire format**, roughly 40
lines of native code to add to any emulator, and about the same to
consume from any UI. Everything else — a phone remote, a Steam Deck
panel, a discord bot, whatever — is just a socket client.

> **Not implemented in any emulator yet.** This repository publishes the
> spec and reference code first, on the assumption that clean documented
> primitives make PRs to RPCS3, Cemu, and shadPS4 easier to merge than
> ad-hoc patches invented in isolation. Contributions to those projects
> are the actual goal.


## Read the spec

- [`SPEC.md`](SPEC.md) — the protocol document. Ten-minute read.
- [`conformance/test-vectors.md`](conformance/test-vectors.md) —
  byte-exact golden frames every implementation must produce or accept.


## Use the reference code

Header-only C++ for emulators:

- [`reference/cpp/toypad_event.hpp`](reference/cpp/toypad_event.hpp) —
  encoders + parser. Depends only on the C++17 standard library.
- [`reference/cpp/example_emulator.cpp`](reference/cpp/example_emulator.cpp)
  — the ~10-line diff an emulator's toypad code needs.
- [`reference/cpp/example_client.cpp`](reference/cpp/example_client.cpp)
  — a print-every-event socket client for testing.

Python for backends and bridges:

- [`reference/python/toypad_client.py`](reference/python/toypad_client.py)
  — asyncio client, standard library only. Suitable for Decky plugins,
  Flask apps, or a WebSocket bridge to a phone UI.

Both reference implementations are verified against the same conformance
vectors.


## Contributing to emulators

The reason this repo exists. If you maintain (or want to help patch) any
of these:

- **RPCS3** — start from
  [PR #15763](https://github.com/RPCS3/rpcs3/pull/15763) (the original
  Dimensions Manager). Add the emit calls at the "unimplemented commands"
  branch around `Emu/Io/Dimensions.cpp:589`.
- **Cemu** — the toypad handler lives under `src/Cafe/OS/libs/nsyshid/`
  and uses `boost::asio`. Same header, same calls.
- **shadPS4** — no toypad emulation exists yet; this would be a greenfield
  contribution alongside the USB HID handler.

File issues or draft PRs against this repo if you're planning work on any
of them, so we don't duplicate effort.


## Non-goals

See [`SPEC.md` § 9](SPEC.md#9-non-goals). In short: no state persistence,
no bidirectional control, no discovery. Loopback is the security boundary.


## Licence

Spec text and reference code: [0BSD](LICENSE) — copy freely, no
attribution required. The point is for this to end up inside GPL,
BSD, MIT and proprietary projects without friction.
