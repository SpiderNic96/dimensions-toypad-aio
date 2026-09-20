"""
Overlay manager — repo path: backend/overlay.py

Owns the overlay child process and feeds it state.

The overlay never touches the emulator. The listener on 9191 serves one
connection at a time, so a second poller would race this one and desync both.
The plugin polls; the overlay renders what it is told.

Writes are best-effort by design: a dead overlay must never break placing a
figure. Every failure path here degrades to "no overlay", never to "no plugin".
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
import threading
from pathlib import Path
from typing import Optional

from protocol import LedRegion

log = logging.getLogger(__name__)

BINARY_NAME = "toypad-overlay"
# gamescope's Xwayland. :0 is what a Steam Deck reports; the others are
# fallbacks for nested or unusual sessions.
DISPLAY_CANDIDATES = (":0", ":1", ":2")


def find_binary(plugin_dir: Optional[Path] = None) -> Optional[Path]:
    """bin/ inside the plugin first, then PATH for a dev build."""
    roots = []
    if plugin_dir:
        roots.append(Path(plugin_dir) / "bin" / BINARY_NAME)
        roots.append(Path(plugin_dir) / BINARY_NAME)
    env_dir = os.environ.get("DECKY_PLUGIN_DIR")
    if env_dir:
        roots.append(Path(env_dir) / "bin" / BINARY_NAME)
        roots.append(Path(env_dir) / BINARY_NAME)
    for candidate in roots:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    found = shutil.which(BINARY_NAME)
    return Path(found) if found else None


class Overlay:
    """
    Lifecycle: start() spawns it hidden. show()/hide() map and unmap. stop()
    closes stdin, which the overlay treats as EOF and exits on — so it can
    never outlive the plugin as a stuck window over someone's game.
    """

    def __init__(self, plugin_dir: Optional[Path] = None,
                 display: Optional[str] = None,
                 atlas: Optional[Path] = None) -> None:
        self.binary = find_binary(plugin_dir)
        self.atlas = Path(atlas) if atlas else None
        self.display = display
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._visible = False
        # Mirrors what the overlay has been told, so a restart can replay it
        # rather than coming back blank.
        self._figures: dict[int, tuple[int, str]] = {}   # slot -> (atlas, name)
        self._mode = 0
        self._pad_cursor = -1
        self._grid: list[tuple[str, str]] = []
        self._grid_cursor = 0
        self._title = ""
        # Last LED command per pad. The overlay process is killed on hide, so
        # without this it comes back with every region dark and stays dark
        # until the game happens to send a new command — which is why a
        # hotkey close/open left the pad unlit while the modal and phone kept
        # showing colour.
        self._leds: dict[int, str] = {}

    # -- lifecycle ------------------------------------------------------

    @property
    def available(self) -> bool:
        return self.binary is not None

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def _resolve_display(self) -> str:
        if self.display:
            return self.display
        current = os.environ.get("DISPLAY")
        if current:
            return current
        for candidate in DISPLAY_CANDIDATES:
            if Path(f"/tmp/.X11-unix/X{candidate.lstrip(':')}").exists():
                return candidate
        return ":0"

    def _reap_orphans(self) -> int:
        """
        Kill any overlay left over from a previous plugin instance.

        PR_SET_PDEATHSIG in the binary covers this going forward, but a Deck
        that has already collected orphans needs them cleared, and an older
        binary without pdeathsig may still be installed.
        """
        if not self.binary:
            return 0
        killed = 0
        try:
            for entry in Path("/proc").iterdir():
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                if self._proc and pid == self._proc.pid:
                    continue
                try:
                    exe = os.readlink(entry / "exe")
                except OSError:
                    continue
                if Path(exe).name != BINARY_NAME:
                    continue
                try:
                    os.kill(pid, signal.SIGTERM)
                    killed += 1
                except OSError:
                    pass
        except OSError:
            pass
        if killed:
            log.info("reaped %d orphaned overlay process(es)", killed)
        return killed

    def start(self) -> bool:
        if not self.binary:
            log.info("overlay binary not found; overlay disabled")
            return False
        self._reap_orphans()
        with self._lock:
            if self.running:
                return True
            env = dict(os.environ)
            env["DISPLAY"] = self._resolve_display()
            try:
                argv = [str(self.binary)]
                if self.atlas and self.atlas.is_file():
                    argv += ["--atlas", str(self.atlas)]
                self._proc = subprocess.Popen(
                    argv,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    env=env,
                    # Own process group, so a stray signal to the plugin does
                    # not take the overlay with it mid-frame.
                    start_new_session=True,
                )
            except OSError as exc:
                log.warning("overlay failed to start: %s", exc)
                self._proc = None
                return False
            log.info("overlay started on DISPLAY=%s", env["DISPLAY"])

        # Replay everything. An overlay that crashed mid-session must come
        # back showing what it showed before, not an empty pad.
        for slot, (art, name) in self._figures.items():
            self._send(f"F {slot} {art} {name}")
        for line in self._leds.values():
            self._send(line)
        self._send(f"S {self._pad_cursor}")
        self._send(f"M {self._mode}")
        if self._grid:
            self._push_grid()
        self._send(f"V {1 if self._visible else 0}")
        return True

    def stop(self) -> None:
        with self._lock:
            proc = self._proc
            self._proc = None
        if not proc:
            return
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.write(b"X\n")
                proc.stdin.flush()
                proc.stdin.close()
            proc.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except OSError:
                pass

    # -- wire -----------------------------------------------------------

    def _send(self, line: str) -> bool:
        with self._lock:
            proc = self._proc
            if not proc or proc.poll() is not None or not proc.stdin:
                return False
            try:
                proc.stdin.write(line.encode("utf-8") + b"\n")
                proc.stdin.flush()
                return True
            except (BrokenPipeError, OSError):
                # The overlay died. Drop it and carry on — the plugin keeps
                # working without it.
                log.warning("overlay pipe closed")
                self._proc = None
                return False

    # -- state ----------------------------------------------------------

    def show(self) -> None:
        """
        Start the process if needed and replay what it missed.

        hide() kills, so a show is nearly always a cold start: start() resends
        the stored figure, LED and cursor lines, which is what keeps the pad
        from coming back blank or frozen on the last frame it saw.
        """
        self._visible = True
        if not self.running:
            self.start()           # replays figures, LEDs and cursor
        self._send("V 1")

    def hide(self) -> None:
        """
        KILL the process — do not just unmap.

        Under gamescope an XUnmapWindow is not honoured for an external
        overlay: the window stays on screen, so "V 0" hides nothing and the
        hotkey appears dead. Killing is the only reliable hide, which is why
        start() replays figures, LEDs and cursor when it comes back.
        """
        self._visible = False
        self._send("V 0")          # harmless if it is already going away
        self.stop()

    def toggle(self) -> bool:
        if self._visible:
            self.hide()
        else:
            self.show()
        return self._visible

    def set_figure(self, slot: int, name: str, atlas: int = -1) -> None:
        # Newlines would be read as a second command; spaces are fine because
        # the overlay takes the rest of the line as the name.
        clean = " ".join(str(name).split())[:47]
        art = int(atlas) if atlas is not None else -1
        self._figures[slot] = (art, clean)
        self._send(f"F {slot} {art} {clean}")

    def clear_figure(self, slot: int) -> None:
        self._figures.pop(slot, None)
        self._send(f"C {slot}")

    def clear_all(self) -> None:
        for slot in list(self._figures):
            self.clear_figure(slot)

    # -- navigation ------------------------------------------------------

    def set_mode(self, picker: bool) -> None:
        self._mode = 1 if picker else 0
        self._send(f"M {self._mode}")

    def set_pad_cursor(self, slot: int) -> None:
        self._pad_cursor = slot if 0 <= slot < 7 else -1
        self._send(f"S {self._pad_cursor}")

    def set_grid(self, title: str, items: list[tuple[str, str]],
                 cursor: int = 0) -> None:
        """
        items: (ring_colour, label) pairs. Colour is "#RRGGBB" or "RRGGBB".

        The whole grid is resent rather than diffed. 315 items is about 12 KB
        down a pipe — cheaper than tracking what the overlay already has, and
        it cannot drift out of sync.
        """
        self._title = " ".join(str(title).split())[:95]
        self._grid = [(c, " ".join(str(n).split())[:47]) for c, n in items]
        self._grid_cursor = max(0, min(cursor, len(self._grid) - 1)) if self._grid else 0
        self._push_grid()

    def _push_grid(self) -> None:
        self._send(f"T {self._title}")
        self._send("G")
        for colour, name in self._grid:
            self._send(f"g {str(colour).lstrip('#')[:6] or '8B929A'} {name}")
        self._send(f"I {self._grid_cursor}")

    def set_grid_cursor(self, index: int) -> None:
        if not self._grid:
            return
        self._grid_cursor = max(0, min(index, len(self._grid) - 1))
        self._send(f"I {self._grid_cursor}")

    # -- leds ------------------------------------------------------------

    def push_led(self, region: LedRegion, started_ms: Optional[int] = None) -> None:
        """Wire straight into LedPoller's on_region callback."""
        line = (
            f"L {region.pad} {region.mode} {region.r} {region.g} {region.b} "
            f"{region.from_r} {region.from_g} {region.from_b} "
            f"{region.on_ticks} {region.off_ticks} {region.count} "
            f"{region.speed_ticks}"
        )
        if started_ms is not None:
            line += f" {int(started_ms)}"
        # Kept so start() can replay it. The poller only pushes CHANGED
        # regions, so a restarted overlay would otherwise never learn the
        # state of a pad that has been sitting still.
        self._leds[region.pad] = line
        self._send(line)

    def replay_leds(self, items) -> None:
        """Re-send everything we know, for when the overlay has just come back."""
        for item in items:
            if isinstance(item, tuple) and len(item) == 2:
                self.push_led(item[0], started_ms=item[1])
            else:
                self.push_led(item)
