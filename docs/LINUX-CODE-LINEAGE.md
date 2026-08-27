# How the Linux code came about

The Linux implementation is not a standalone emulator written from scratch for the Deck. It is a layered adaptation built around RPCS3's existing Linux support and the community's Toypad work.

## 1. Start with RPCS3

RPCS3 is the PlayStation 3 emulator/debugger. Its upstream project supports Linux and documents a CMake/Ninja Linux build. The AIO does not replace the emulator core; it uses a patched RPCS3 fork as the runtime.

## 2. Use the Seamless Toypad fork

The distributed runtime is based on the `NeverCookFirst/RPCS3-Seamless-Toypad-Build` fork at commit `797f1e417f736a04e43319f27812228c4c8dbf6e`.

That fork supplies the Toypad-oriented integration that makes an emulated LEGO Dimensions Toypad usable without depending on the physical USB Toypad.

## 3. Add Linux-side colour/event forwarding

The source distribution contains `rpcs3-patch/apply-color-forwarding.sh`. It adds a small bridge to three RPCS3 files:

- `Emu/Io/DimensionsListener.h`
- `Emu/Io/DimensionsListener.cpp`
- `Emu/Io/Dimensions.cpp`

The patch adds a thread-safe connected-client registry and non-blocking broadcast path, makes the listener accept multiple clients concurrently, and forwards relevant `0xC0`–`0xC8` Toypad colour/flash commands as protocol frames.

The important design choice is additive behaviour: the existing USB response/ack path remains intact. The TCP broadcast is an extra observer path, not a replacement for the game's Toypad emulation.

## 4. Keep the wire format independent

The project also contains a small standalone Toypad Event Protocol v1 under `source/protocol/`. That lets a future client/emulator implement the same socket-level interface without depending on the Decky plugin internals.

## 5. Package for Linux handhelds

The Linux executable is packaged as an x86_64 AppImage. The supplied build recipe uses a Fedora 41 environment and explicitly avoids newer host glibc leakage. The AIO launches the bundled AppImage directly and uses Gamescope only where needed, while avoiding nested Gamescope when Steam Gaming Mode already provides a compositor.

## 6. Put Decky above the emulator

The Decky Python backend owns setup, emulator verification, launcher generation, tag/Web provisioning, the phone server, and the colour-reader connection. The Decky TypeScript frontend consumes backend RPCs and renders the Quick Access Menu.

The resulting stack is:

`LEGO Dimensions -> RPCS3 Toypad emulation -> TCP listener -> Decky backend -> QAM + phone UI`

This is why changes to the Linux emulator bridge and changes to the Deck UI can be developed independently.
