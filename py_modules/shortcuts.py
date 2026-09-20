"""
Steam shortcuts — repo path: backend/shortcuts.py

Adds the emulator AppImages to Steam as non-Steam games so they launch from
Game Mode.

shortcuts.vdf is binary VDF, not text, and Steam rewrites the whole file from
memory when it exits. So: never write while Steam is running, or the edit is
silently discarded on shutdown. Every entry point here checks.

Stdlib only — no vdf package on a Deck.
"""

from __future__ import annotations

import binascii
import logging
import os
import shutil
import struct
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

MAP, STR, INT, END = 0x00, 0x01, 0x02, 0x08

STEAM_ROOTS = (
    Path.home() / ".steam/steam",
    Path.home() / ".local/share/Steam",
    Path.home() / ".steam/root",
)


# ----------------------------------------------------------------------
# Binary VDF
# ----------------------------------------------------------------------

def _read_cstr(buf: bytes, pos: int) -> tuple[str, int]:
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("utf-8", "replace"), end + 1


def _parse_map(buf: bytes, pos: int) -> tuple[dict, int]:
    out: dict[str, Any] = {}
    while pos < len(buf):
        kind = buf[pos]
        pos += 1
        if kind == END:
            return out, pos
        key, pos = _read_cstr(buf, pos)
        if kind == MAP:
            out[key], pos = _parse_map(buf, pos)
        elif kind == STR:
            out[key], pos = _read_cstr(buf, pos)
        elif kind == INT:
            out[key] = struct.unpack_from("<i", buf, pos)[0]
            pos += 4
        else:
            raise ValueError(f"unknown VDF type 0x{kind:02x} at {pos - 1}")
    return out, pos


def loads(buf: bytes) -> dict:
    data, _ = _parse_map(buf, 0)
    return data


def _dump_map(node: dict) -> bytes:
    out = bytearray()
    for key, value in node.items():
        name = key.encode("utf-8") + b"\x00"
        if isinstance(value, dict):
            out += bytes([MAP]) + name + _dump_map(value)
        elif isinstance(value, bool):
            out += bytes([INT]) + name + struct.pack("<i", int(value))
        elif isinstance(value, int):
            out += bytes([INT]) + name + struct.pack("<i", value)
        else:
            out += bytes([STR]) + name + str(value).encode("utf-8") + b"\x00"
    return bytes(out) + bytes([END])


def dumps(node: dict) -> bytes:
    return _dump_map(node)


# ----------------------------------------------------------------------
# Steam layout
# ----------------------------------------------------------------------

def steam_root() -> Optional[Path]:
    for root in STEAM_ROOTS:
        if (root / "userdata").is_dir():
            return root
    return None


def user_config_dirs() -> list[Path]:
    """
    Every logged-in user's config dir, most recently used first.

    Sorting by mtime matters: a Deck that has had a second account logged in
    keeps the stale userdata folder forever, and writing to it looks like a
    silent no-op.
    """
    root = steam_root()
    if not root:
        return []
    dirs = [
        d / "config" for d in (root / "userdata").iterdir()
        if d.is_dir() and d.name.isdigit() and d.name != "0"
    ]
    return sorted((d for d in dirs if d.is_dir()),
                  key=lambda d: d.stat().st_mtime, reverse=True)


def steam_running() -> bool:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / "comm").read_text().strip() == "steam":
                return True
        except OSError:
            continue
    return False


def app_id(exe: str, name: str) -> int:
    """
    Steam's non-Steam appid: crc32 of exe+name, high bit set.

    Deriving it rather than storing one means re-adding the same shortcut
    lands on the same id, so artwork and controller layouts survive.
    """
    crc = binascii.crc32((exe + name).encode("utf-8")) & 0xFFFFFFFF
    return crc | 0x80000000


# ----------------------------------------------------------------------

def _entry(name: str, exe: Path, args: str = "", tags: Optional[list] = None) -> dict:
    # Steam wants the exe quoted; unquoted paths with spaces silently fail to
    # launch and give no error anywhere.
    quoted = f'"{exe}"'
    return {
        "appid": struct.unpack("<i", struct.pack("<I", app_id(quoted, name)))[0],
        "AppName": name,
        "Exe": quoted,
        "StartDir": f'"{exe.parent}"',
        "icon": "",
        "ShortcutPath": "",
        "LaunchOptions": args,
        "IsHidden": 0,
        "AllowDesktopConfig": 1,
        "AllowOverlay": 1,
        "OpenVR": 0,
        "Devkit": 0,
        "DevkitGameID": "",
        "DevkitOverrideAppID": 0,
        "LastPlayTime": 0,
        "FlatpakAppID": "",
        "tags": {str(i): t for i, t in enumerate(tags or ["Dimensions Toypad"])},
    }


class Shortcuts:
    def __init__(self, config_dir: Optional[Path] = None) -> None:
        dirs = user_config_dirs()
        self.config_dir = Path(config_dir) if config_dir else (dirs[0] if dirs else None)
        self.path = (self.config_dir / "shortcuts.vdf") if self.config_dir else None

    @property
    def available(self) -> bool:
        return self.path is not None

    def read(self) -> dict:
        if not self.path or not self.path.is_file():
            return {}
        try:
            return loads(self.path.read_bytes()).get("shortcuts", {})
        except (OSError, ValueError, IndexError) as exc:
            log.warning("shortcuts.vdf unreadable: %s", exc)
            return {}

    def write(self, entries: dict) -> bool:
        if not self.path:
            return False
        if steam_running():
            log.warning("refusing to write shortcuts.vdf while Steam is running")
            return False

        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.is_file():
            # Steam's own file, and the only copy of every other non-Steam
            # game the user has added. Back it up before touching it.
            backup = self.path.with_suffix(f".vdf.bak-{int(time.time())}")
            shutil.copy2(self.path, backup)

        tmp = self.path.with_suffix(".vdf.tmp")
        tmp.write_bytes(dumps({"shortcuts": entries}))
        os.replace(tmp, self.path)
        return True

    # ------------------------------------------------------------------

    def add(self, name: str, exe: Path, args: str = "",
            replace: bool = True) -> Optional[int]:
        """Add or update one shortcut. Returns its appid, or None."""
        exe = Path(exe).expanduser().resolve()
        if not exe.is_file():
            log.warning("shortcut target missing: %s", exe)
            return None

        entries = self.read()
        new = _entry(name, exe, args)

        if replace:
            entries = {k: v for k, v in entries.items()
                       if v.get("AppName") != name}
        # Steam keys entries by position, so they must stay contiguous — a gap
        # makes it drop everything after it.
        entries = {str(i): v for i, v in enumerate(entries.values())}
        entries[str(len(entries))] = new

        return app_id(new["Exe"], name) if self.write(entries) else None

    def remove(self, name: str) -> bool:
        entries = self.read()
        kept = [v for v in entries.values() if v.get("AppName") != name]
        if len(kept) == len(entries):
            return False
        return self.write({str(i): v for i, v in enumerate(kept)})

    def list_ours(self, tag: str = "Dimensions Toypad") -> list[dict]:
        return [
            {"name": v.get("AppName", ""), "exe": v.get("Exe", ""),
             "args": v.get("LaunchOptions", "")}
            for v in self.read().values()
            if tag in (v.get("tags") or {}).values()
        ]
