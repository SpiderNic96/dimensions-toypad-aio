# LEGO Dimensions Toypad Event Protocol — v1

**Status:** draft
**Editors:** NeverCookFirst
**Contact:** open an issue at https://github.com/NeverCookFirst/lego-toypad-protocol

A minimal wire protocol that lets an external UI observe what a LEGO
Dimensions toypad emulator has been told by the game — most importantly,
the RGB colours the game asks the toypad to display. Without this, the
game's Locate Keystone puzzle is unsolvable past the first few levels,
because the emulator drops the colour commands on the floor. See
RPCS3 issue #15882 for context.

The spec is deliberately tiny. Any emulator that already speaks the LEGO
toypad USB protocol can add outbound event forwarding in roughly 40 lines
of native code. Any UI can consume it in about the same. Both sides can be
implemented and merged independently — this document is what makes them
interoperable.


## 1. Design goals

- **Small enough to merge.** A maintainer of an unrelated project should
  read this document in ten minutes and think "yes, I'll take a PR."
- **No dependencies.** Raw TCP, fixed-length header, byte-for-byte
  layout. No JSON, no protobuf, no framing library.
- **Additive.** New event types can be introduced without breaking old
  clients: unknown types carry an explicit length so parsers skip them.
- **One-way push.** The emulator is the server, the UI is the client,
  and events flow only from emulator to client. No request/response,
  no polling, no state synchronisation dance.
- **Emulator-agnostic.** Nothing in this document assumes RPCS3, Cemu,
  shadPS4 or any particular runtime.


## 2. Transport

- **Protocol:** TCP.
- **Default port:** 9191.
- **Bind:** loopback (`127.0.0.1`) by default. Emulators MAY offer a
  configuration option to bind to `0.0.0.0`; they MUST NOT bind non-locally
  by default.
- **Concurrency:** an emulator MUST accept at least one concurrent client.
  It SHOULD accept several — typical usage is one Decky panel and one phone
  UI at the same time. Events are fanned out to every connected client;
  each client receives the same bytes in the same order.
- **Backpressure:** if a client stops reading, the emulator MAY drop the
  slowest client after a small write buffer fills. This keeps a stuck UI
  from stalling the emulator's USB polling loop. A dropped client SHOULD be
  logged; it is NOT an emulator error.
- **Byte order:** little-endian on the wire for every multi-byte integer.


## 3. Frame format

Every event on the wire is one frame, and every frame has the same
5-byte header followed by a variable-length payload.

```
offset  size  field         description
------  ----  -----------   -----------------------------------------------
  0     1     magic         Always 0x55. Distinguishes toypad event frames
                            from stray bytes, enables resync.
  1     1     version       Protocol version. This document defines 0x01.
                            Frames with an unknown version MUST be skipped
                            using payload_len, not dropped-and-disconnect.
  2     1     event_type    See section 4.
  3     1     pad           Pad index the event refers to.
                              0x00 = center
                              0x01 = left
                              0x02 = right
                              0xFF = all pads (broadcast)
                            Reserved values MUST be skipped by clients that
                            don't understand them.
  4     1     payload_len   Number of payload bytes that follow. May be 0.
                            Maximum 250 in v1 (headers stay under 256).
  5     N     payload       event-type-specific bytes; see section 4.
```

**No trailer, no checksum.** TCP handles integrity; the framing exists so
a client that connects mid-stream can resync on the next `0x55`.


## 4. Event types

### 4.1 Colour — `event_type = 0x01`

The game has asked the pad to display a solid RGB colour. This is the
Locate Keystone hint colour, among other uses.

```
payload_len = 3
payload     = [ r, g, b ]     each 0..255, sRGB
```

### 4.2 Flash — `event_type = 0x02`

The game has asked the pad to alternate between colour and off.

```
payload_len = 6
payload     = [ on_ms, off_ms, count, r, g, b ]

  on_ms   uint8   ms lit          (game's own value, unscaled)
  off_ms  uint8   ms dark
  count   uint8   number of on/off cycles; 0xFF = indefinite
  r,g,b   uint8   colour of the on phase
```

Clients that don't want to run their own timer MAY simply render this
as the given colour continuously; the puzzle's colour information is
what matters, not the exact flash cadence.

### 4.3 Tag placed — `event_type = 0x03`

Included for parity with emulators that want to publish tag events on
the same channel. Optional; a colour-only implementation is conformant.

```
payload_len = 11
payload     = [ slot, uid[7], tag_id_lo, tag_id_hi, tag_kind ]

  slot     uint8   pad slot (0..6 depending on pad)
  uid      7 bytes NTAG-215 UID as read from the physical tag or dump
  tag_id   uint16  little-endian, matches the ID used by Berny23's tools
  tag_kind uint8   0 = minifig, 1 = vehicle/gadget
```

### 4.4 Tag removed — `event_type = 0x04`

```
payload_len = 1
payload     = [ slot ]
```

### 4.5 Tag moved — `event_type = 0x05`

```
payload_len = 2
payload     = [ from_slot, to_slot ]
```

### 4.6 Reserved

Event types `0x06`–`0x7F` are reserved for future spec versions. Event
types `0x80`–`0xFF` are available for vendor extensions and MUST NOT be
allocated by this spec.


## 5. Optional handshake

Clients that want to know which emulator they're talking to MAY send a
single ASCII line immediately after connecting:

```
HELLO\n
```

Emulators that recognise this SHOULD respond with a single ASCII line
before their first binary frame:

```
TOYPAD/1 <emulator_name>/<emulator_version>\n
```

For example:

```
TOYPAD/1 rpcs3-seamless-toypad/0.0.42\n
TOYPAD/1 cemu/2.6-remote-toypad\n
```

Clients that do not send `HELLO\n` MUST NOT expect this line and MUST
begin parsing binary frames from the first byte received. Emulators that
do not implement the handshake ignore the `HELLO\n` bytes and start
pushing frames when they have one to push.


## 6. Client behaviour

- Read at least 5 bytes for the header, then `payload_len` more bytes
  for the payload, then repeat.
- If the first byte is not `0x55`, discard bytes one at a time until it
  is. This is how mid-stream connects resync.
- If `version != 0x01`, skip `5 + payload_len` bytes and continue. Do
  NOT disconnect on unknown versions.
- If `event_type` is unknown, skip `5 + payload_len` bytes and continue.
- Treat the socket as event-driven; do not poll.


## 7. Emulator behaviour

- Emit a Colour event whenever the game issues a set-colour USB command,
  even if the RGB triple is the same as the last one.
- Emit a Flash event whenever the game issues a flash-colour USB
  command.
- Emit tag events at whatever point the emulator already commits a
  state change to its own internal model; do not invent an ordering.
- Never block the USB emulation path on a slow socket write.


## 8. Conformance

An implementation is conformant if:

1. It emits or accepts frames whose bytes match the golden vectors in
   `conformance/test-vectors.md`.
2. Unknown versions and event types are skipped, not dropped-and-close.
3. The default bind address is loopback.

An emulator MAY omit tag events (0x03, 0x04, 0x05) and still be
conformant for the colour-only use case. It MUST NOT omit colour events
if it implements this spec at all — the reason the spec exists is
Locate Keystone.


## 9. Non-goals

- **Persistent state.** This is a live event stream. If a UI reconnects,
  it starts fresh.
- **Bidirectional control.** Placing a figure, removing it, moving it —
  those use a separate protocol handled by the emulator's existing
  toypad-emulation implementation. This spec is one-way: emulator → UI.
- **Discovery.** No mDNS, no broadcast. Clients know the address (usually
  loopback) or they don't work.
- **Authentication.** Loopback is the security boundary. Emulators binding
  to a network interface are responsible for whatever they choose to do
  about that; the spec has no opinion.


## 10. Reference material

- `reference/cpp/toypad_event.hpp` — header-only C++, drop into any
  emulator project. Same file used by all three reference emulator
  implementations.
- `reference/cpp/example_emulator.cpp` — minimal integration showing
  where the emit calls go.
- `reference/cpp/example_client.cpp` — minimal client that parses and
  prints every event.
- `reference/python/toypad_client.py` — asyncio client for phone
  UIs / plugin backends.
- `conformance/test-vectors.md` — byte-exact golden frames.


## 11. Changelog

- **v1 (draft):** initial spec — Colour, Flash, Tag placed/removed/moved,
  optional HELLO handshake.
