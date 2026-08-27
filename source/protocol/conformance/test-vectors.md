# Conformance test vectors

Every implementation of the LEGO Dimensions Toypad Event Protocol v1
must be able to produce (as an emulator) or consume (as a client) these
exact byte sequences. Bytes are given in hex, one frame per row, with
`|` marking the boundary between the 5-byte header and its payload.

Reproduce these locally by feeding the same inputs to
`reference/cpp/toypad_event.hpp` — if your bytes differ, one side has a
bug.


## Colour events (event_type = 0x01)

| Description                       | Bytes                              |
| ---                               | ---                                |
| centre pad, pure red              | `55 01 01 00 03 | FF 00 00`        |
| centre pad, pure green            | `55 01 01 00 03 | 00 FF 00`        |
| centre pad, pure blue             | `55 01 01 00 03 | 00 00 FF`        |
| centre pad, black (LEDs off)      | `55 01 01 00 03 | 00 00 00`        |
| left pad, keystone yellow (#FFC93C) | `55 01 01 01 03 | FF C9 3C`     |
| right pad, sky blue (#87CEEB)     | `55 01 01 02 03 | 87 CE EB`        |
| broadcast, magenta                | `55 01 01 FF 03 | FF 00 FF`        |


## Flash events (event_type = 0x02)

| Description                                         | Bytes                                        |
| ---                                                 | ---                                          |
| centre pad, red 100ms on / 100ms off × 10           | `55 01 02 00 06 | 64 64 0A FF 00 00`         |
| left pad, green 200ms/200ms indefinite (count=0xFF) | `55 01 02 01 06 | C8 C8 FF 00 FF 00`         |
| broadcast, cyan solid-appearing (fast 20/5)         | `55 01 02 FF 06 | 14 05 FF 00 FF FF`         |


## Tag events

| Description               | Bytes                                              |
| ---                       | ---                                                |
| tag placed, centre, slot 3, UID all zeros, id=1000, minifig | `55 01 03 00 0B | 03 00 00 00 00 00 00 00 E8 03 00` |
| tag placed, left,  slot 0, UID all 0xFF, id=257, vehicle    | `55 01 03 01 0B | 00 FF FF FF FF FF FF FF 01 01 01` |
| tag removed, centre slot 2 | `55 01 04 00 01 | 02`                             |
| tag moved, left, 1 -> 4    | `55 01 05 01 02 | 01 04`                          |


## Unknown / forward-compat cases

A conformant client processes these without disconnecting; a conformant
emulator never emits them.

| Description                          | Bytes                              | Client behaviour        |
| ---                                  | ---                                | ---                     |
| unknown version (0x99), 4-byte payload | `55 99 01 00 04 | DE AD BE EF`   | skip 9 bytes, continue  |
| unknown event type (0x77) v1         | `55 01 77 00 02 | 12 34`           | skip 7 bytes, continue  |
| stray bytes before a valid frame     | `DE AD BE 55 01 01 00 03 | 01 02 03` | resync on MAGIC, emit color(1,2,3) |


## Handshake

Emulator that implements it:

```
client → HELLO\n
server → TOYPAD/1 rpcs3-seamless-toypad/0.0.42\n
server → <binary frames as they occur>
```

Emulator that doesn't:

```
client → HELLO\n
server → <binary frames as they occur, HELLO bytes discarded>
```

Clients must handle both — see `reference/python/toypad_client.py`
`connect(hello=True)` for the reference implementation.


## Running the vectors

The reference C++ header is small enough to test manually. A minimal
harness:

```cpp
#include "toypad_event.hpp"
#include <cstdio>

int main() {
    std::vector<std::uint8_t> out;
    toypad_event::encode_color(out, toypad_event::Pad::Center, 0xFF, 0xC9, 0x3C);
    for (auto b : out) std::printf("%02X ", b);
    std::puts("");
}
```

expected output: `55 01 01 00 03 FF C9 3C`
