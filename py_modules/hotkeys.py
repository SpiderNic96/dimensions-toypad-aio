"""
Hotkeys — repo path: backend/hotkeys.py

Reads the Deck's hardware buttons straight from /dev/input.

SteamClient.Input is not exposed on every Steam build — it is absent on this
one — and the volume keys are not controller inputs anyway: they are kernel
key events. Reading evdev works regardless of what the UI layer offers, and it
is how the volume-button chords worked before.

Stdlib only. An evdev event is a fixed 24-byte struct on 64-bit Linux:
    struct input_event { timeval time; __u16 type; __u16 code; __s32 value; }

Needs read access to /dev/input/event*. Decky runs plugins as root, so this is
fine there; running it as `deck` from a shell needs the `input` group.
"""

from __future__ import annotations

import logging
import os
import select
import struct
import threading
import time
from pathlib import Path
from typing import Callable, Iterable, Optional

log = logging.getLogger(__name__)

EVENT_SIZE = struct.calcsize("llHHi")
EV_KEY = 0x01

# Deck hardware buttons, from the kernel's standard keycodes.
KEY_VOLUMEDOWN = 114
KEY_VOLUMEUP = 115
KEY_POWER = 116

NAMES = {
    KEY_VOLUMEUP: "Volume Up",
    KEY_VOLUMEDOWN: "Volume Down",
    KEY_POWER: "Power",
}

# Power is deliberately absent: binding it would fight the OS for something
# the user cannot afford to have intercepted.
BINDABLE = (KEY_VOLUMEUP, KEY_VOLUMEDOWN)

# How long two presses may be apart and still count as a chord.
CHORD_WINDOW = 0.35


def describe(keys: Iterable[int]) -> str:
    names = [NAMES.get(k, f"key {k}") for k in sorted(keys)]
    return " + ".join(names) if names else "not set"


def _candidate_devices() -> list[Path]:
    """
    Input devices that report the volume keys.

    Matching on capabilities rather than a device name: the Deck exposes
    several keyboard-ish devices and which one carries the volume keys has
    moved between SteamOS releases.
    """
    found: list[Path] = []
    try:
        for line in Path("/proc/bus/input/devices").read_text().split("\n\n"):
            if "B: KEY=" not in line:
                continue
            handlers = [ln for ln in line.splitlines() if ln.startswith("H: Handlers=")]
            if not handlers:
                continue
            for token in handlers[0].split("=", 1)[1].split():
                if token.startswith("event"):
                    found.append(Path("/dev/input") / token)
    except OSError:
        pass

    if not found:                       # fall back to trying everything
        try:
            found = sorted(Path("/dev/input").glob("event*"))
        except OSError:
            return []
    return [p for p in found if os.access(p, os.R_OK)]


class HotkeyListener:
    """
    Watches for volume-key presses and chords.

    on_chord(keys) fires once per press, with the set of keys held together.
    A single Volume Up is {115}; both together is {114, 115}.
    """

    def __init__(self, on_chord: Callable[[frozenset[int]], None]) -> None:
        self._on_chord = on_chord
        self._thread: Optional[threading.Thread] = None
        self._running = threading.Event()
        self.devices: list[Path] = []

    @property
    def available(self) -> bool:
        return bool(_candidate_devices())

    def start(self) -> bool:
        if self._thread and self._thread.is_alive():
            return True
        self.devices = _candidate_devices()
        if not self.devices:
            log.warning("no readable input devices; hotkeys disabled")
            return False
        self._running.set()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        log.info("hotkeys watching %d device(s)", len(self.devices))
        return True

    def stop(self) -> None:
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self) -> None:
        handles = []
        for path in self.devices:
            try:
                handles.append(os.open(path, os.O_RDONLY | os.O_NONBLOCK))
            except OSError:
                continue
        if not handles:
            return

        held: set[int] = set()
        pending: set[int] = set()
        last_press = 0.0

        try:
            while self._running.is_set():
                ready, _, _ = select.select(handles, [], [], 0.2)

                # A chord that has gone quiet for CHORD_WINDOW is complete.
                # Waiting lets "both volume keys" register as one event rather
                # than two separate single-key presses.
                if pending and time.monotonic() - last_press > CHORD_WINDOW:
                    keys = frozenset(pending)
                    pending.clear()
                    try:
                        self._on_chord(keys)
                    except Exception as exc:               # noqa: BLE001
                        log.warning("hotkey handler failed: %s", exc)

                for fd in ready:
                    try:
                        data = os.read(fd, EVENT_SIZE * 32)
                    except OSError:
                        continue
                    for offset in range(0, len(data) - EVENT_SIZE + 1, EVENT_SIZE):
                        _s, _us, etype, code, value = struct.unpack_from(
                            "llHHi", data, offset)
                        if etype != EV_KEY or code not in BINDABLE:
                            continue
                        if value == 1:                      # press
                            held.add(code)
                            pending.add(code)
                            last_press = time.monotonic()
                        elif value == 0:                    # release
                            held.discard(code)
        finally:
            for fd in handles:
                try:
                    os.close(fd)
                except OSError:
                    pass
