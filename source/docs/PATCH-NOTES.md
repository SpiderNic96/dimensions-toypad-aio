# RPCS3 patch notes — what `apply-color-forwarding.sh` actually does

The script edits exactly three files in the fork tree:

- `rpcs3/Emu/Io/DimensionsListener.h`
- `rpcs3/Emu/Io/DimensionsListener.cpp`
- `rpcs3/Emu/Io/Dimensions.cpp`

Every edit is idempotent (re-running the script detects existing changes)
and creates `.orig` backups on first run.

## Change 1 — `DimensionsListener.h`

Adds one new public function, plus the includes it needs:

```cpp
#include <cstddef>
#include <cstdint>

// Push a raw byte sequence to every connected companion app. Used by the
// USB command handler to forward outbound events (colour, flash, tag
// state) per the LEGO Dimensions Toypad Event Protocol v1.
void dimensions_listener_broadcast(const std::uint8_t* data, std::size_t len);
```

## Change 2 — `DimensionsListener.cpp`

Three additions:

**(a)** A thread-safe client registry:

```cpp
std::mutex g_clients_mu;
std::vector<socket_t> g_clients;
void register_client(socket_t s);
void unregister_client(socket_t s);
```

**(b)** A non-blocking broadcast helper that uses `MSG_DONTWAIT` on POSIX
and drops any client whose send blocks (colour events fire on a hot USB
path; we must never block there):

```cpp
void broadcast_bytes(const std::uint8_t* data, std::size_t len);
```

**(c)** Rewrites the accept loop so each accepted client runs in its own
detached reader thread and is registered for broadcast fan-out:

```cpp
register_client(client);
std::thread([client]{
    handle_client(client);
    unregister_client(client);
    close_sock(client);
}).detach();
```

**(d)** `dimensions_listener_stop()` gains a step that closes every
client socket before joining the accept thread, so the reader threads
exit cleanly instead of blocking forever.

**(e)** Public entry point `dimensions_listener_broadcast` that
short-circuits when the listener isn't running.

Total change: about 50 additional lines. Zero existing behaviour is
modified — the pre-patch inbound-command path continues to work exactly
as before.

## Change 3 — `Dimensions.cpp`

This is where the colour commands actually get intercepted.

Adds `#include "DimensionsListener.h"` next to the existing
`Dimensions.h` include, and rewrites the `case 0xC0…0xC8` block in
`interrupt_transfer`. The pre-patch block:

```cpp
case 0xC0: // Color
case 0xC1: // Get Pad Color
case 0xC2: // Fade
...
case 0xC8: // Color All
{
    // Send a blank response to acknowledge color has been sent to toypad
    g_dimensionstoypad.get_blank_response(0x01, sequence, q_result);
    break;
}
```

...becomes a block that first constructs a protocol v1 frame from the
command's own bytes, broadcasts it via `dimensions_listener_broadcast`,
then falls through to the same `get_blank_response` call so the game's
USB flow is unchanged.

Key details:

- The **pad byte** in the fork's internal wire is `1=centre, 2=left,
  3=right`; the protocol uses `0=centre, 1=left, 2=right, 0xFF=broadcast`.
  A small lambda translates.
- **0xC0 Color** and **0xC8 Color All** produce a Colour event (type
  0x01) with a 3-byte payload `[r, g, b]`.
- **0xC3 Flash** and **0xC7 Flash All** produce a Flash event (type
  0x02) with a 6-byte payload `[on_ms, off_ms, count, r, g, b]`.
- **0xC2 Fade** produces a Colour event with the final RGB (spec v1
  doesn't have a Fade event; renders as a plain colour).
- **0xC1 Get Pad Color** and **0xC4/0xC6 Random-Fade** are game→pad
  reads or randomised effects with no meaningful RGB to forward; the
  patch skips them, still sends the blank ack.

## Why the anchor regex is whitespace-tolerant

The fork's `Dimensions.cpp` uses two-tab indentation for the `case`
labels (nested inside a switch inside a function). Earlier versions of
the patch matched three-tab, which is what git-format-patch produced on
a different tree. Now the anchor uses `\s+` in the right places so the
patch lands regardless of the fork's whitespace choice; the replacement
preserves whichever indentation the matched anchor used.

## Reverting

The script writes `.orig` copies of every file it modifies (on first
run only). To undo:

```bash
cd ~/rpcs3-dist/rpcs3/Emu/Io
for f in DimensionsListener.h DimensionsListener.cpp Dimensions.cpp; do
    mv "$f.orig" "$f"
done
distrobox enter rpcs3dist -- ninja -C ~/rpcs3-dist/build
```

That produces an emulator identical to unmodified fork — no colour
forwarding, but LOAD/REMOVE/MOVE still work.
