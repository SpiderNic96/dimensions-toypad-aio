"""
Backend adapter — repo path: backend/adapters/tcp.py

All four backends speak the same protocol on the same port, so there is one
adapter. Differences come from the Backend record, never from a branch here.

Process launching is deliberately NOT this class's job. The adapter owns the
wire; shortcuts.py owns getting the emulator running. recomp in particular is
launched by Steam under Proton and we only ever attach to it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Callable, Optional

from backends import Backend, TAG_CACHE, get as get_backend
from protocol import (
    LedPoller,
    LedRegion,
    LedSnapshot,
    Slot,
    ToypadClient,
)

log = logging.getLogger(__name__)


class Status(Enum):
    OFFLINE = "offline"              # nothing listening
    UNSUPPORTED = "unsupported"      # listening, but not a v2 frame
    READY = "ready"                  # v2 confirmed


@dataclass
class Probe:
    status: Status
    port: int
    serial: Optional[int] = None
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status is Status.READY


class TcpAdapter:
    """
    start()      connect + begin LED polling
    stop()       stop polling
    load/remove/move   commands
    probe()      one-shot capability check, safe to call any time
    """

    def __init__(
        self,
        backend: Backend | str,
        on_region: Optional[Callable[[int, LedRegion], None]] = None,
        host: str = "127.0.0.1",
    ) -> None:
        self.backend = get_backend(backend) if isinstance(backend, str) else backend
        self.port = self.backend.resolve_port()
        self.client = ToypadClient(host=host, port=self.port)
        self._on_region = on_region
        self._poller: Optional[LedPoller] = None

    # -- lifecycle ------------------------------------------------------

    def start(self) -> Probe:
        """Probe first; only start polling if the backend actually speaks v2."""
        result = self.probe()
        if result.ok and self._on_region:
            self._poller = LedPoller(self.client, self._on_region)
            self._poller.start()
        return result

    def stop(self) -> None:
        if self._poller:
            self._poller.stop()
            self._poller = None

    def __enter__(self) -> "TcpAdapter":
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()

    # -- capability -----------------------------------------------------

    def probe(self) -> Probe:
        """
        Three outcomes, and the difference matters to the user:

          OFFLINE      nothing is listening — emulator not running
          UNSUPPORTED  something answered but not with a v2 frame. Almost
                       always an unpatched RPCS3 or a recomp older than
                       0.1.10. Say so; do not show dead pads and let the user
                       conclude the plugin is broken.
          READY        v2 confirmed
        """
        snap = self.client.get_led()
        if snap is None:
            # get_led() returns None both for "no connection" and "not a v2
            # frame". Re-test the socket to tell them apart.
            if self._socket_alive():
                detail = "listener answered, but not with a v2 LED frame"
                if self.backend.min_version:
                    detail += f" — needs {self.backend.label} {self.backend.min_version}+"
                return Probe(Status.UNSUPPORTED, self.port, detail=detail)
            return Probe(
                Status.OFFLINE, self.port,
                detail=f"nothing listening on 127.0.0.1:{self.port}",
            )
        return Probe(Status.READY, self.port, serial=snap.serial,
                     detail=f"v{snap.version}, {len(snap.regions)} regions")

    def _socket_alive(self) -> bool:
        import socket as _s
        try:
            with _s.create_connection((self.client.host, self.port), timeout=0.5):
                return True
        except OSError:
            return False

    # -- commands -------------------------------------------------------

    def load(self, slot: Slot, tag_path: Path | str, writable: bool = True) -> bool:
        """
        writable=False sends an empty path, which makes the tag read-only. That
        is the right choice for bundled catalog tags, and the wrong one for a
        user's own vehicle whose upgrades should persist.
        """
        tag_path = Path(tag_path)
        data = tag_path.read_bytes()
        wire = self.backend.wire_path(tag_path) if writable else ""
        if writable and self.backend.wine_prefix:
            log.debug("wine path: %s -> %s", tag_path, wire)
        return self.client.load(slot, data, file_path=wire)

    def remove(self, slot: Slot) -> bool:
        return self.client.remove(slot)

    def move(self, src: Slot, dest: Slot) -> bool:
        return self.client.move(src, dest)

    def led(self) -> Optional[LedSnapshot]:
        return self.client.get_led()


# ----------------------------------------------------------------------
# CLI — drives any backend with --backend. Phase 2's definition of done.
#   python3 tcp_adapter.py --backend rpcs3 --probe
#   python3 tcp_adapter.py --backend recomp --tag Batman.bin --watch 10
# ----------------------------------------------------------------------

def _main() -> int:
    import argparse
    import time

    from backends import BACKENDS
    from protocol import LedMode, SLOTS, calibrate

    ap = argparse.ArgumentParser(description="Toypad backend adapter")
    ap.add_argument("--backend", required=True, choices=sorted(BACKENDS))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--probe", action="store_true", help="capability check only")
    ap.add_argument("--tag", help="path to a .bin to load")
    ap.add_argument("--slot", type=int, default=1, help="0-6, default 1 (centre)")
    ap.add_argument("--hold", type=float, default=2.0, help="seconds before clearing")
    ap.add_argument("--watch", type=float, default=0.0, help="seconds to poll LEDs")
    ap.add_argument("--read-only", action="store_true",
                    help="send an empty path; upgrades will not persist")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG, format="%(message)s")

    def show(idx: int, reg: LedRegion) -> None:
        print(
            f"  region {idx}  pad {reg.pad}  {LedMode(reg.mode).name:<5} "
            f"rgb=({reg.r},{reg.g},{reg.b}) "
            f"from=({reg.from_r},{reg.from_g},{reg.from_b}) "
            f"{reg.on_ms}/{reg.off_ms}ms x{reg.count or 'inf'} "
            f"display={calibrate(reg.r, reg.g, reg.b)}"
        )

    adapter = TcpAdapter(args.backend, on_region=show, host=args.host)
    result = adapter.probe()
    print(f"{adapter.backend.label}: {result.status.value} "
          f"(port {result.port}) — {result.detail}")

    if args.probe or not result.ok:
        for note in adapter.backend.setup_notes:
            print(f"  note: {note}")
        return 0 if result.ok else 1

    adapter.start()
    try:
        if args.tag:
            slot = SLOTS[args.slot]
            print(f"LOAD -> {slot.label}: "
                  f"{adapter.load(slot, args.tag, writable=not args.read_only)}")
            time.sleep(args.hold)
            print(f"CLEAR -> {slot.label}: {adapter.remove(slot)}")
        if args.watch:
            print(f"watching LEDs for {args.watch}s")
            time.sleep(args.watch)
    finally:
        adapter.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
