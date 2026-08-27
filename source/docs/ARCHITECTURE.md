# Architecture

How the four pieces fit together.

```
    ┌──────────────────────────┐        ┌──────────────────────────┐
    │  LEGO Dimensions game    │        │  Phone (Safari/Chrome)   │
    │  running inside RPCS3    │        │                          │
    └──────────┬───────────────┘        └────────────┬─────────────┘
               │ USB toypad emul.                    │ HTTP + polling
               │  (unchanged from                    │  (LegoToypad v1.5
               │   upstream RPCS3)                   │   unmodified)
               ▼                                     ▼
    ┌───────────────────────────────────────────────────────────────┐
    │                   Patched RPCS3 fork                          │
    │  Emu/Io/Dimensions.cpp:                                       │
    │    - inbound cmds (LOAD/REMOVE/MOVE) executed on toypad       │
    │    - outbound colour/flash cmds emitted as protocol frames    │
    │  Emu/Io/DimensionsListener.cpp:                               │
    │    - multi-client TCP listener on 127.0.0.1:9191              │
    │    - accepts N clients concurrently, fans out broadcasts      │
    └───────────────────────────┬───────────────────────────────────┘
                                │ TCP 9191
                                │
       ┌────────────────────────┼───────────────────────────┐
       │                        │                           │
       ▼                        ▼                           ▼
    Client A: colour        Client B: phone            Client C: shell
    reader task in          UI's WebSocket             tap (nc/xxd)
    Python plugin           via web app                for debugging
    (no HELLO sent,         (also on 9191)             (never sends;
    just reads frames)                                  reads only)
       │
       │ writes to self.pad_colors[key] = (r,g,b,kind,ts)
       ▼
    ┌───────────────────────────────────────────────────────────────┐
    │                    Plugin backend (main.py)                   │
    │  self.pad_colors: dict                                        │
    │    - keys "0","1","2","all"                                   │
    │    - values (r,g,b,kind,timestamp) or None                    │
    │  _pad_colors_json() resolves per-pad vs broadcast by recency  │
    │  Exposed via:                                                 │
    │    - setup_status.padColors (heavy poll ~2s)                  │
    │    - get_pad_colors.padColors (light poll ~500ms)             │
    │    - state_json.pads[i].color (overridden with ledColor)      │
    └────────────┬──────────────────────────────┬───────────────────┘
                 │                              │
                 │ Decky JSON RPC                │ HTTP JSON
                 ▼                              ▼
    ┌──────────────────────────┐   ┌──────────────────────────────┐
    │  Decky QAM panel         │   │  Phone LegoToypad v1.5 UI    │
    │  dist/index.js:          │   │  reads /api/state repeatedly │
    │  - Setup checks          │   │  - halo colour comes from    │
    │  - LEDs diagnostic dots  │   │    pads[i].color which the   │
    │  - Pad grid with border  │   │    backend now populates     │
    │    painted from ledColor │   │    with the live LED value   │
    └──────────────────────────┘   └──────────────────────────────┘
```

## Why each layer is separate

- **The wire protocol** (`protocol/SPEC.md`) is a spec that could sit in
  its own repository. Emulators other than RPCS3 (Cemu, shadPS4)
  implement it independently; UIs consume it without caring which
  emulator produced the frames. Keeping the spec tiny is what makes
  cross-emulator adoption possible.
- **The RPCS3 fork** is where the wire protocol is emitted. The patch
  is deliberately minimal - one file gains outbound broadcast, one
  file gains multi-client accept, plus a small header addition. That
  makes upstreaming plausible in the long term.
- **The plugin backend** is the orchestration layer. It owns the
  emulator lifecycle, the phone UI web server, the tag library, and the
  colour reader. Nothing about it is emulator-specific except the SHA
  it verifies against.
- **The two frontends** are unmodified upstream (phone UI) and a from-
  scratch Decky component (QAM panel). Neither knows about the wire
  protocol - they just render `pad_colors` state served over their
  respective transports.

## Data flow: a single LED event, end to end

1. Game calls `set_pad_colour(pad=1, r=0xFF, g=0x6E, b=0x18)` via USB.
2. RPCS3's `usb_device_dimensions::interrupt_transfer` dispatches to
   `case 0xC0`. The patched code extracts the RGB bytes and calls
   `dimensions_listener_broadcast(frame_bytes)`.
3. `broadcast_bytes` iterates registered clients, writes to each socket
   non-blocking. Bytes travel through the loopback stack.
4. Plugin's `_run_color_reader` task recv()s them. `_parse_color_frames`
   matches on MAGIC, decodes header, updates
   `self.pad_colors["1"] = (0xFF, 0x6E, 0x18, "color", monotonic_now)`.
5. Two clients see the update:
   - Decky panel polls `get_pad_colors` every 500ms → new `padColors`
     JSON → `PadCell`'s `ledColor` prop changes → border colour and
     glow re-render on next React frame.
   - Phone UI polls `/api/state` every N seconds → `state_json` now
     returns `pads[1].color = "#ff6e18"` (overridden from ledColor,
     not the character's static `tagColor`) → halo repaints.

Total end-to-end latency from game LED command to visible colour on both
surfaces: about 100-600 ms depending on where in the polling cycles the
event lands.
