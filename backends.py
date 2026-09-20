"""
Backend registry — repo path: backend/backends.py

Every difference between the four backends lives in this file. If you find
yourself writing `if backend.key == "recomp"` anywhere else, add a field here
instead.

Artifact URLs and hashes are the single source of truth for install.py.
All three fetch with a plain redirect-following GET: no auth, no GitHub API,
no rate limit.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

DEFAULT_PORT = 9191

# Internal M.2 by default. microSD is an override, not the default — see
# install.py for the exfat exec-bit check before writing anywhere else.
INSTALL_ROOT = Path.home() / ".local/share/dimensions-toypad"
BACKEND_DIR = INSTALL_ROOT / "backends"
TAG_CACHE = INSTALL_ROOT / "tags"


@dataclass(frozen=True)
class Artifact:
    filename: str
    url: str
    sha256: str
    size: int

    def __post_init__(self) -> None:
        # The 4.2.0 manifest shipped a hash with a stray trailing character and
        # could never verify. Catch that at import, not at install time.
        if not re.fullmatch(r"[0-9a-f]{64}", self.sha256):
            raise ValueError(f"{self.filename}: sha256 must be 64 hex chars")


@dataclass(frozen=True)
class Backend:
    key: str
    label: str
    console: str

    # --- artifact -------------------------------------------------------
    # None means the user supplies it themselves (recomp).
    artifact: Optional[Artifact] = None
    # Relative path to the executable once installed. For an AppImage this is
    # just the AppImage.
    exe_name: str = ""

    # --- wire -----------------------------------------------------------
    port: int = DEFAULT_PORT
    # Environment variables consulted in order; first valid one wins.
    port_envs: tuple[str, ...] = ()

    # How to hand this emulator a game path. {game} is substituted; the
    # whole thing goes in Steam's LaunchOptions, so the quoting matters —
    # an unquoted path with a space silently fails to launch and reports
    # nothing anywhere.
    launch_args: str = '"{game}"'
    shortcut_name: str = ""

    # --- quirks ---------------------------------------------------------
    # The listener runs inside a Wine prefix. A POSIX tag path handed to it on
    # LOAD will not resolve, and ToypadFigure::Save() only LOGS A WARNING — so
    # write-back fails silently and looks like a broken feature.
    wine_prefix: bool = False
    wine_drive: str = "Z:"

    # Minimum upstream version that answers GET_LED with a v2 frame. Older
    # builds answer v1 (30 bytes) or nine raw RGB bytes, or close the socket.
    # We are v2-only, so anything older is reported unsupported rather than
    # silently rendering dead pads.
    min_version: Optional[str] = None

    # Free-text notes surfaced in the setup UI.
    setup_notes: tuple[str, ...] = field(default_factory=tuple)

    # ------------------------------------------------------------------
    def resolve_port(self) -> int:
        """Env override first, then the configured default."""
        for name in self.port_envs:
            raw = os.environ.get(name)
            if raw and raw.strip().lstrip("-").isdigit():
                value = int(raw)
                if 1 <= value <= 65535:
                    return value
        return self.port

    def install_path(self, root: Path = BACKEND_DIR) -> Optional[Path]:
        if not self.artifact:
            return None
        return root / self.key / self.artifact.filename

    def wire_path(self, posix_path: str | Path) -> str:
        """
        Translate a tag path for whatever filesystem the listener sees.

        Native backends get the path unchanged. Wine backends get the prefix
        drive with backslashes — anything else is accepted by the listener and
        then silently fails to save.
        """
        text = str(posix_path)
        if not self.wine_prefix:
            return text
        return self.wine_drive + text.replace("/", "\\")


BACKENDS: dict[str, Backend] = {
    "rpcs3": Backend(
        key="rpcs3",
        label="RPCS3",
        console="PS3",
        artifact=Artifact(
            filename="rpcs3-v0.0.42-9-9d5dc2d6_linux64.AppImage",
            url=(
                "https://github.com/SpiderNic96/RPCS3-Seamless-Toypad-Build"
                "/releases/download/linux-9d5dc2d6"
                "/rpcs3-v0.0.42-9-9d5dc2d6_linux64.AppImage"
            ),
            sha256="1004966aa4cf58fa3e74da0a1f61ae1e87b4737d575cf2b3f4b729f8488da50f",
            size=93840681,
        ),
        exe_name="rpcs3-v0.0.42-9-9d5dc2d6_linux64.AppImage",
        launch_args='--no-gui "{game}"',
        shortcut_name="LEGO Dimensions (PS3)",
        setup_notes=(
            "Locally patched to emit v2 LED frames; upstream is still v1.",
        ),
    ),
    "cemu": Backend(
        key="cemu",
        label="Cemu",
        console="Wii U",
        artifact=Artifact(
            filename="Cemu-7e1ff66-x86_64.AppImage",
            url=(
                "https://github.com/SpiderNic96"
                "/Cemu-2.6-Remote-Toypad-Build-LinuxRun"
                "/releases/download/linux-7e1ff66/Cemu-7e1ff66-x86_64.AppImage"
            ),
            sha256="851667b390c5523816cb6e0dd5990f70fc1bc2a506c89b4ed23b68a34bba39f9",
            size=46248248,
        ),
        exe_name="Cemu-7e1ff66-x86_64.AppImage",
        launch_args='-f -g "{game}"',
        shortcut_name="LEGO Dimensions (Wii U)",
        setup_notes=(
            "Cemu defaults to a SHARED config — it will read existing saves "
            "and settings from internal storage or SD unless made portable.",
        ),
    ),
    "shadps4": Backend(
        key="shadps4",
        label="shadPS4",
        console="PS4",
        artifact=Artifact(
            filename="Shadps4-sdl.AppImage",
            url=(
                "https://github.com/SpiderNic96/shadPS4"
                "/releases/download/linux-3edd8d5/Shadps4-sdl.AppImage"
            ),
            # harrysof feature/dimensions-listener @ 3edd8d5 — adds the MOVE
            # no-op fix and the 500ms pickup delay, so a move registers first
            # time instead of needing a second attempt.
            sha256="0fd26b53e19b7780d8d4d66565787d26ccf5a9f4a3507941766f1d2189da0c36",
            size=35346936,
        ),
        exe_name="Shadps4-sdl.AppImage",
        launch_args='"{game}"',
        shortcut_name="LEGO Dimensions (PS4)",
        setup_notes=(
            "Needs a PS4 dump (CUSA01176).",
            "Use the setup button: it enables the Toy Pad USB backend and "
            "registers your dump, so the Qt browser is not needed.",
            "Listener is on by default; a stored port of 0 in config.toml "
            "falls back to 9191 rather than disabling it.",
        ),
    ),
    "recomp": Backend(
        key="recomp",
        label="Dimensions Recompiled",
        console="PC (recomp)",
        artifact=None,  # user-supplied Proton install
        port_envs=("REXGLUE_TOYPAD_PORT", "XENIA_TOYPAD_PORT"),
        wine_prefix=True,
        wine_drive="Z:",
        min_version="0.1.10",
        setup_notes=(
            "Requires 0.1.10 or newer — earlier builds answer GET_LED in a "
            "format this plugin no longer parses.",
            "Runs under Proton; tag paths are rewritten to the prefix drive "
            "before they go on the wire.",
        ),
    ),
}


def get(key: str) -> Backend:
    try:
        return BACKENDS[key]
    except KeyError:
        raise KeyError(
            f"unknown backend {key!r}; known: {', '.join(sorted(BACKENDS))}"
        ) from None


def version_at_least(found: str, required: str) -> bool:
    """Compare dotted versions numerically — '0.1.9' < '0.1.10'."""
    def parts(v: str) -> list[int]:
        return [int(x) for x in re.findall(r"\d+", v)]

    a, b = parts(found), parts(required)
    a += [0] * (len(b) - len(a))
    b += [0] * (len(a) - len(b))
    return a >= b
