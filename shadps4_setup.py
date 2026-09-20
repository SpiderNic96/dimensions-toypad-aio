"""
shadPS4 setup — repo path: backend/shadps4_setup.py

Does in one call what otherwise means walking the Qt GUI: turn on the emulated
Toy Pad, point the emulator at the extracted game and its DLC, and leave it
launchable straight from a Steam shortcut.

TWO THINGS THAT WILL WASTE YOUR TIME IF YOU DO NOT KNOW THEM:

1. config.toml is DEAD. shadPS4 moved to config.json; the .toml is left behind
   from an older build and is never read. Writing the TOML looks like it worked
   and changes nothing.

2. usb_device_backend is an int, not a name. The enum is
   Real=0, SkylandersPortal=1, InfinityBase=2, DimensionsToypad=3.
   Anything other than 3 and the listener never starts, so port 9191 stays
   closed and the plugin reports "nothing listening".

dimensions_listener_port already defaults to 9191 upstream, so it only gets
written if someone has changed it.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

USB_DIMENSIONS_TOYPAD = 3
DEFAULT_PORT = 9191

# Portable dir beside the executable wins over XDG, same as path_util.cpp.
PORTABLE_DIR = "user"
XDG_DIR = Path(os.environ.get("XDG_DATA_HOME",
                              Path.home() / ".local" / "share")) / "shadPS4"


def running() -> bool:
    """
    shadPS4 rewrites config.json from memory when it exits, so an edit made
    while it is running is discarded — the same trap as Steam and
    shortcuts.vdf. Check before writing rather than appearing to succeed.
    """
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                comm = (entry / "comm").read_text().strip().lower()
            except OSError:
                continue
            if comm.startswith("shadps4"):
                return True
    except OSError:
        pass
    return False


def user_dir(exe: Optional[Path] = None) -> Optional[Path]:
    if exe:
        portable = Path(exe).expanduser().resolve().parent / PORTABLE_DIR
        if portable.is_dir():
            return portable
    return XDG_DIR if XDG_DIR.is_dir() else None


def config_path(exe: Optional[Path] = None) -> Optional[Path]:
    base = user_dir(exe)
    if not base:
        return None
    cfg = base / "config.json"
    return cfg if cfg.is_file() else None


# ----------------------------------------------------------------------

def _find_key(node: Any, key: str, path: tuple = ()) -> Optional[tuple]:
    """
    Where a setting actually lives, wherever shadPS4 has moved it to.

    The JSON is grouped into sections and they have been reshuffled between
    releases. Searching for the key beats hard-coding a section that quietly
    stops existing.
    """
    if isinstance(node, dict):
        if key in node:
            return path + (key,)
        for k, v in node.items():
            found = _find_key(v, key, path + (k,))
            if found:
                return found
    return None


def _set_path(root: dict, path: tuple, value: Any) -> None:
    node = root
    for part in path[:-1]:
        node = node.setdefault(part, {})
    node[path[-1]] = value


def read_config(exe: Optional[Path] = None) -> tuple[Optional[Path], dict]:
    cfg = config_path(exe)
    if not cfg:
        return None, {}
    try:
        return cfg, json.loads(cfg.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("shadPS4 config unreadable: %s", exc)
        return cfg, {}


def status(exe: Optional[Path] = None) -> dict:
    cfg, data = read_config(exe)
    if not cfg:
        return {"found": False, "reason": "no shadPS4 config.json — run it once first"}

    backend_at = _find_key(data, "usb_device_backend")
    port_at = _find_key(data, "dimensions_listener_port")

    def read(path):
        node = data
        for part in path or ():
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                return None
        return node

    backend = read(backend_at)
    return {
        "found": True,
        "path": str(cfg),
        "running": running(),
        "toypadEnabled": backend == USB_DIMENSIONS_TOYPAD,
        "usbBackend": backend,
        "port": read(port_at) if port_at else DEFAULT_PORT,
        "installDirs": read(_find_key(data, "installDirs")) or [],
        "addonDir": read(_find_key(data, "addonInstallDir")) or "",
    }


def configure(game: Optional[str] = None, addon_dir: Optional[str] = None,
              exe: Optional[Path] = None) -> dict:
    """
    Turn the Toy Pad on and register the game. Returns what changed.

    shadPS4 reads config.json at startup, so this must run with the emulator
    closed — otherwise it rewrites the file on exit and the change vanishes,
    the same trap as Steam and shortcuts.vdf.
    """
    if running():
        return {"ok": False,
                "error": "Close shadPS4 first — it rewrites its config on exit, "
                         "so the change would be lost."}
    cfg, data = read_config(exe)
    if not cfg:
        return {"ok": False, "error": "no shadPS4 config.json — run shadPS4 once first"}
    if not data:
        return {"ok": False, "error": f"{cfg} could not be parsed"}

    changed: list[str] = []

    backend_at = _find_key(data, "usb_device_backend") or ("Input", "usb_device_backend")
    node = data
    for part in backend_at[:-1]:
        node = node.get(part, {}) if isinstance(node, dict) else {}
    if node.get(backend_at[-1]) != USB_DIMENSIONS_TOYPAD:
        _set_path(data, backend_at, USB_DIMENSIONS_TOYPAD)
        changed.append("emulated Toy Pad enabled")

    port_at = _find_key(data, "dimensions_listener_port")
    if port_at:
        node = data
        for part in port_at[:-1]:
            node = node.get(part, {})
        if node.get(port_at[-1]) != DEFAULT_PORT:
            _set_path(data, port_at, DEFAULT_PORT)
            changed.append(f"listener port set to {DEFAULT_PORT}")

    # Registering the folder is what lets the game launch by path without the
    # Qt browser being involved at all.
    if game:
        game_dir = str(Path(game).expanduser().parent)
        at = _find_key(data, "installDirs") or ("GUI", "installDirs")
        node = data
        for part in at[:-1]:
            node = node.get(part, {}) if isinstance(node, dict) else {}
        dirs = list(node.get(at[-1]) or [])
        parent = str(Path(game_dir).parent)
        if parent not in dirs and game_dir not in dirs:
            dirs.append(parent)
            _set_path(data, at, dirs)
            changed.append(f"install dir registered: {parent}")

    if addon_dir:
        at = _find_key(data, "addonInstallDir") or ("GUI", "addonInstallDir")
        node = data
        for part in at[:-1]:
            node = node.get(part, {}) if isinstance(node, dict) else {}
        if node.get(at[-1]) != addon_dir:
            _set_path(data, at, addon_dir)
            changed.append(f"DLC dir set: {addon_dir}")

    if not changed:
        return {"ok": True, "changed": [], "note": "already configured"}

    backup = cfg.with_suffix(f".json.bak-{int(time.time())}")
    try:
        shutil.copy2(cfg, backup)
        tmp = cfg.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, cfg)
    except OSError as exc:
        return {"ok": False, "error": f"could not write config: {exc}"}

    return {"ok": True, "changed": changed, "backup": str(backup)}
