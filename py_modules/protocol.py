"""
LegoToypad wire protocol — Phase 1 core.

Verified against:
  harrysof/LegoToypad @ main (250e569)            — the app
  NeverCookFirst/RPCS3-Seamless-Toypad-Build v1.4 — DimensionsListener.cpp
  NeverCookFirst/shadPS4-Seamless-Toypad-Bridge   — BuildLedSnapshot()

No Decky imports on purpose — runnable standalone for Phase 1 smoke tests.
"""

from __future__ import annotations

import math
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Callable, Optional

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9191
WEB_REMOTE_PORT = 8765

TAG_SIZE = 180
POLL_FAST = 0.033                  # while the game is driving the pads
# How long the LED poll keeps off the wire after a user LOAD / REMOVE / MOVE.
#
# The listener serves one connection at a time, so a poll firing straight after
# a command lands mid-transition: the game has been told the pad changed but
# has not finished acting on it. Flashes suffer most — the snapshot catches a
# half-updated region and the phase resets every poll, so a slow flash stutters
# or appears solid. Standing back for a moment costs one frame of latency and
# fixes it. Matches the desktop app's 250ms.
POLL_QUIET_AFTER_COMMAND = 0.25

# How long to keep polling fast after the LAST change, rather than for a
# single cycle.
#
# The old rule was binary: a poll that saw a change slept 33ms, one that did
# not slept 160ms. During a light show that is almost always the slow branch —
# the emulator bumps its serial once per command, so the very next poll sees
# nothing new and immediately drops back to 160ms. Every following command
# then waits up to 160ms to be noticed, which is the lag you can see against
# the game.
#
# Staying fast for a window after activity costs a handful of extra reads on a
# pad that is doing something, and nothing at all on a pad that is idle.
POLL_ACTIVE_WINDOW = 1.5

POLL_IDLE = 0.033                  # Match LegoToypad reference 33ms interval

# v2 only. All four backends emit it:
#   RPCS3   9d5dc2d6  (patched)   Cemu  7e1ff66
#   shadPS4 fd98029               recomp 0.1.10+
# Older formats exist upstream (v1 = 30 bytes, v0 = 9 raw RGB bytes from
# DimensionsRecompiled 0.1.5-0.1.9) but nothing we ship speaks them.
LED_V2_SIZE = 4 + 3 * 12           # 40 bytes
LED_PROTOCOL_VERSION = 2

# Timing fields on the wire are TOYPAD TICKS, not milliseconds. One tick is
# roughly 40 ms. Keep raw ticks in the model and convert only at render time.
LED_TICK_MS = 40
# Discrete blend levels, matching the reference's kLedIntensityLevels.
LED_LEVELS = 9

# Linear divide against the LED white point, then clamp. Apply DOWNSTREAM for
# halo/pad tint only — never to the stored value.
LED_WHITE = (255, 110, 24)


class Cmd(IntEnum):
    LOAD = 0x01
    REMOVE = 0x02
    MOVE = 0x03
    GET_LED = 0x04


class LedMode(IntEnum):
    """From Dimensions.h: 0 off, 1 solid, 2 flash, 3 fade."""
    OFF = 0
    SOLID = 1
    FLASH = 2
    FADE = 3


@dataclass(frozen=True)
class Slot:
    pad: int
    index: int
    label: str


# Pad numbering is NOT left-to-right: pad 2 = left, 1 = centre, 3 = right.
SLOTS: tuple[Slot, ...] = (
    Slot(2, 0, "Left - upper"),
    Slot(1, 1, "Center"),
    Slot(3, 2, "Right - upper"),
    Slot(2, 3, "Left - lower left"),
    Slot(2, 4, "Left - lower right"),
    Slot(3, 5, "Right - lower left"),
    Slot(3, 6, "Right - lower right"),
)

# Only the centre portal writes tags — hardware fact, not a UI choice.
WRITE_CAPABLE_PAD = 1

_PAD_TO_REGION = {2: 0, 1: 1, 3: 2}


def led_region_for_pad(pad: int) -> int:
    return _PAD_TO_REGION.get(pad, -1)


def animated_frame(region: "LedRegion", started: float,
                   now: Optional[float] = None,
                   base: Optional[tuple] = None) -> tuple:
    """
    (rgb, intensity) for this instant — a line-for-line port of
    ComputeLedFrame in LegoToypad's main.cpp, so all three of our renderers
    behave exactly as the reference does.

    Two things separate this from a naive implementation:

    COLOUR AND INTENSITY ARE SEPARATE. Flash never changes the colour; it
    toggles intensity 1 -> 0. That is what lets a renderer dim the whole tile
    on the off-beat, which is the only way a black flash is visible at all.

    FADE IS AN ALTERNATING CROSS-FADE, at full intensity throughout. Even legs
    run from->to, odd legs to->from, each speedTicks long; a finite count
    lands on the parity-correct endpoint. Each leg is COSINE-eased, and the
    eased value is quantised to 9 levels so an endless fade emits a bounded
    set of colours rather than a new one every frame.

    `base` is the pad's resting colour — what a finite flash returns to.
    """
    now = time.monotonic() if now is None else now
    colour = (region.r, region.g, region.b)

    if region.mode == LedMode.OFF:
        return calibrate(*colour), 0.0
    if region.mode == LedMode.SOLID:
        return calibrate(*colour), 1.0

    elapsed_ms = max(0.0, (now - started)) * 1000.0

    if region.mode == LedMode.FLASH:
        period = (region.on_ms + region.off_ms)
        if period <= 0:
            # Degenerate flash: steady rather than strobing.
            return calibrate(*colour), 1.0
        if region.count and elapsed_ms >= period * region.count:
            # Cycles done: back to whatever the pad was resting on, or off if
            # nothing preceded the flash.
            if base:
                return calibrate(*base), 1.0
            return calibrate(*colour), 0.0
        on_phase = (elapsed_ms % period) < region.on_ms
        return calibrate(*colour), (1.0 if on_phase else 0.0)

    # Fade — full intensity throughout; only the hue moves.
    step = max(region.speed_ms, LED_TICK_MS)
    index = int(elapsed_ms // step)
    local = (elapsed_ms % step) / step
    if region.count and index >= region.count:
        index, local = region.count - 1, 1.0

    eased = 0.5 - 0.5 * math.cos(local * math.pi)
    quantised = round(eased * (LED_LEVELS - 1)) / float(LED_LEVELS - 1)

    forward = (index % 2) == 0
    start_c = (region.from_r, region.from_g, region.from_b) if forward else colour
    end_c = colour if forward else (region.from_r, region.from_g, region.from_b)
    blended = tuple(
        max(0, min(255, int(a + (b - a) * quantised + 0.5)))
        for a, b in zip(start_c, end_c)
    )
    return calibrate(*blended), 1.0


def animated_colour(region: "LedRegion", started: float,
                    now: Optional[float] = None,
                    rest: Optional[tuple] = None) -> tuple:
    """Colour only, for callers that do not render intensity themselves."""
    return animated_frame(region, started, now, rest)[0]


def calibrate(r: int, g: int, b: int) -> tuple[int, int, int]:
    return tuple(
        max(0, min(255, c * 255 // w)) for c, w in zip((r, g, b), LED_WHITE)
    )  # type: ignore[return-value]


# --------------------------------------------------------------------------
# Encoders
# --------------------------------------------------------------------------

def encode_load(slot: Slot, tag: bytes, file_path: str = "") -> bytes:
    """
    LOAD: header(5) + tag(180) + u16le path length + UTF-8 path.

    file_path is what makes WRITABLE VEHICLE TAGS work — the emulator opens
    that file read/write and persists in-game upgrades into it. Bundled catalog
    tags pass "". Omitting it turns write-back off silently, with no error.
    """
    if len(tag) != TAG_SIZE:
        raise ValueError(f"tag must be {TAG_SIZE} bytes, got {len(tag)}")
    path = file_path.encode("utf-8")
    return (
        bytes((Cmd.LOAD, slot.pad, slot.index, 0, 0))
        + tag
        + struct.pack("<H", len(path))
        + path
    )


def encode_remove(slot: Slot) -> bytes:
    return bytes((Cmd.REMOVE, slot.pad, slot.index, 0, 0))


def encode_move(src: Slot, dest: Slot) -> bytes:
    """MOVE: destination first, then source."""
    return bytes((Cmd.MOVE, dest.pad, dest.index, src.pad, src.index))


def encode_get_led() -> bytes:
    """Operands are all zero and must NOT be pad/index validated."""
    return bytes((Cmd.GET_LED, 0, 0, 0, 0))


# --------------------------------------------------------------------------
# GET_LED decoder — handles BOTH wire formats
# --------------------------------------------------------------------------

@dataclass
class LedRegion:
    pad: int = 0
    mode: int = 0
    r: int = 0
    g: int = 0
    b: int = 0
    from_r: int = 0
    from_g: int = 0
    from_b: int = 0
    on_ticks: int = 0
    off_ticks: int = 0
    count: int = 0
    speed_ticks: int = 0

    def key(self) -> tuple:
        return (
            self.mode, self.r, self.g, self.b,
            self.from_r, self.from_g, self.from_b,
            self.on_ticks, self.off_ticks, self.count, self.speed_ticks,
        )

    @property
    def on_ms(self) -> int:
        return self.on_ticks * LED_TICK_MS

    @property
    def off_ms(self) -> int:
        return self.off_ticks * LED_TICK_MS

    @property
    def speed_ms(self) -> int:
        return self.speed_ticks * LED_TICK_MS

    @property
    def forever(self) -> bool:
        """count 0 (normalised from 0xFF by the emulator) means indefinite."""
        return self.count == 0 and self.mode in (LedMode.FLASH, LedMode.FADE)


@dataclass
class LedSnapshot:
    serial: int = 0
    version: int = 0
    regions: list[LedRegion] = field(default_factory=list)


def parse_led_snapshot(data: bytes) -> Optional[LedSnapshot]:
    """
    v2 frame, 40 bytes:
      'L', serial, version=2, region_count=3, then 3 x 12:
      pad, mode, r, g, b, fromR, fromG, fromB,
      on_ticks, off_ticks, count, speed_ticks

    Byte 2 is the version. A 3 there is the older 30-byte v1 frame from an
    unpatched upstream build — rejected rather than parsed, so a wrong
    backend fails loudly instead of rendering nonsense.
    """
    if len(data) < LED_V2_SIZE or data[0] != ord("L"):
        return None
    if data[2] != LED_PROTOCOL_VERSION:
        return None

    snap = LedSnapshot(serial=data[1], version=data[2])
    for i in range(min(data[3], 3)):
        off = 4 + i * 12
        snap.regions.append(LedRegion(*data[off:off + 12]))
    return snap


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------

class ToypadClient:
    """
    One connection at a time — the listener serves a single connection, so a
    GET_LED poll racing a LOAD desyncs both. Everything goes through _lock.
    """

    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT,
                 timeout: float = 1.0) -> None:
        # Monotonic deadline until which the LED poll should stay quiet. Set by
        # every user command; read by LedPoller.
        self.quiet_until: float = 0.0
        self.host = host
        self.port = port
        self.timeout = timeout
        self._lock = threading.Lock()

    @staticmethod
    def _recv_exactly(sock: socket.socket, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                break
            buf.extend(chunk)
        return bytes(buf)

    def _send(self, payload: bytes) -> bool:
        with self._lock:
            try:
                with socket.create_connection(
                    (self.host, self.port), timeout=self.timeout
                ) as sock:
                    sock.sendall(payload)
                    return True
            except OSError:
                return False

    def _mark_user_command(self) -> None:
        """Hold the LED poll off for a moment — see POLL_QUIET_AFTER_COMMAND."""
        self.quiet_until = time.monotonic() + POLL_QUIET_AFTER_COMMAND

    def load(self, slot: Slot, tag: bytes, file_path: str = "") -> bool:
        self._mark_user_command()
        return self._send(encode_load(slot, tag, file_path))

    def remove(self, slot: Slot) -> bool:
        self._mark_user_command()
        return self._send(encode_remove(slot))

    def move(self, src: Slot, dest: Slot) -> bool:
        self._mark_user_command()
        return self._send(encode_move(src, dest))

    def get_led(self) -> Optional[LedSnapshot]:
        with self._lock:
            try:
                with socket.create_connection(
                    (self.host, self.port), timeout=self.timeout
                ) as sock:
                    sock.sendall(encode_get_led())
                    data = self._recv_exactly(sock, LED_V2_SIZE)
            except OSError:
                return None
        return parse_led_snapshot(data)


class LedPoller:
    """
    33 ms poll with wire-against-wire deduplication.

    THE TRAP: never compare a snapshot against live animation state. The
    emulator stores COMMANDS, not animation progress — a finished fade settles
    to Solid locally while the emulator reports the original fade forever.
    Compare those two and the mismatch is permanent, and since the serial is
    global, one pad changing re-fires every finished animation on all three.
    So keep the last APPLIED WIRE bytes and diff against those.
    """

    def __init__(self, client: ToypadClient,
                 on_region: Callable[[int, LedRegion], None]) -> None:
        self._client = client
        self._on_region = on_region
        self._thread: Optional[threading.Thread] = None
        self._running = threading.Event()
        self._last_serial: Optional[int] = None
        self._applied: dict[int, tuple] = {}
        self._applied_time: dict[int, float] = {}

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._running.set()
        self._last_serial = None
        self._applied.clear()
        self._applied_time.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None

    def _loop(self) -> None:
        last_change = 0.0
        misses = 0
        while self._running.is_set():
            # Stay off the wire for a moment after a user command so the game
            # gets an undisturbed window to register the pad change. Polling
            # through it reads a half-applied state and makes flashes stutter.
            quiet_for = getattr(self._client, "quiet_until", 0.0) - time.monotonic()
            if quiet_for > 0:
                time.sleep(min(quiet_for, POLL_QUIET_AFTER_COMMAND))
                continue

            changed = False
            try:
                snap = self._client.get_led()
            except Exception:                                # noqa: BLE001
                # A raised read used to kill this thread outright, and a dead
                # poller looks exactly like "the LEDs froze".
                snap = None
            if snap:
                misses = 0
                changed = self._apply(snap)
            else:
                # The listener has gone — the game closed, or the emulator
                # did. Holding the last frame leaves the pad lit forever on
                # the overlay and the phone, long after there is anything to
                # mirror. A few misses in a row is a real disconnect rather
                # than one dropped read.
                misses += 1
                # The listener going quiet is the ONLY reliable "the game has
                # gone" signal. Process-name matching looked tempting and was
                # wrong: /proc comm truncates at 15 chars, so an AppImage's
                # name is a guess, and a wrong guess wipes the LEDs mid-game.
                if misses == 5:
                    self._blank()
                elif misses > 5:
                    # Back right off once it is clearly gone; retrying at 33ms
                    # against a closed port is pure churn.
                    time.sleep(1.0)

            now = time.monotonic()
            if changed:
                last_change = now
            active = (now - last_change) < POLL_ACTIVE_WINDOW
            time.sleep(POLL_FAST if active else POLL_IDLE)

    def _apply(self, snap: LedSnapshot) -> bool:
        if snap.serial == self._last_serial:
            return False
        self._last_serial = snap.serial

        fired = False
        now = time.monotonic()
        for region in snap.regions:
            idx = led_region_for_pad(region.pad)
            if idx < 0:
                continue
            prev_key = self._applied.get(idx)
            # If the command hasn't changed at all, keep the ongoing state / animation
            if prev_key == region.key():
                continue
            self._applied[idx] = region.key()
            self._applied_time[idx] = now
            self._on_region(idx, region)
            fired = True
        return fired

    def _blank(self) -> None:
        """Zero out all regions when disconnected to prevent stale glow/freeze."""
        self._last_serial = -1
        for pad in (1, 2, 3):
            idx = led_region_for_pad(pad)
            if idx >= 0:
                reg = LedRegion(pad, LedMode.OFF, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
                if self._applied.get(idx) != reg.key():
                    self._applied[idx] = reg.key()
                    self._on_region(idx, reg)


# --------------------------------------------------------------------------
# Phase 1 smoke test:  python3 protocol.py <tag.bin>
# --------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    client = ToypadClient()

    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as fh:
            tag_bytes = fh.read()
        target = SLOTS[1]  # Center
        print(f"LOAD -> {target.label}:",
              client.load(target, tag_bytes, file_path=sys.argv[1]))
        time.sleep(2)
        print(f"CLEAR -> {target.label}:", client.remove(target))

    probe = client.get_led()
    print("LED v2 OK" if probe else "LED: no v2 response (wrong or unpatched backend?)")

    print("Polling for 10s (serial advances only while the game drives the pads)")
    poller = LedPoller(
        client,
        lambda i, reg: print(
            f"  region {i}  mode={LedMode(reg.mode).name:<5} "
            f"rgb=({reg.r},{reg.g},{reg.b}) "
            f"from=({reg.from_r},{reg.from_g},{reg.from_b}) "
            f"{reg.on_ms}/{reg.off_ms}ms x{reg.count or 'inf'} "
            f"display={calibrate(reg.r, reg.g, reg.b)}"
        ),
    )
    poller.start()
    time.sleep(10)
    poller.stop()
