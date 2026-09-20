"""
Custom tags — repo path: backend/custom_tags.py

User-supplied `.bin` figures, treated as first-class catalog entries.

A drop folder, not an import wizard: put a `.bin` in
`~/.local/share/dimensions-toypad/custom/` and it appears beside Favourites.
Copying a file is something people already know how to do, and it survives a
plugin reinstall without anyone having to re-import anything.

Optional, all inferred if absent:
    Batman Beyond.bin           the tag
    Batman Beyond.png           portrait (also .jpg / .webp)
    Batman Beyond.json          {"name", "franchise", "ringColor", "abilities"}

A LEGO Dimensions tag is 180 bytes. Anything else is rejected on sight rather
than handed to the emulator, because a malformed tag is a crash, not an error
message.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

TAG_SIZE = 180
PORTRAIT_EXT = (".png", ".webp", ".jpg", ".jpeg")
DEFAULT_RING = "#8B929A"

# stableIds must not collide with the generated catalog's, which are all
# WORLD_*. The prefix keeps custom entries obvious in logs and settings.
ID_PREFIX = "CUSTOM_"


@dataclass
class CustomTag:
    stableId: str
    name: str
    franchise: str
    ringColor: str
    abilities: list
    bin: str                 # absolute path; the catalog's are relative
    portrait: str            # absolute path, or "" if none
    build: int = 0
    atlas: int = -1          # no atlas cell — the overlay falls back to a name

    def as_entry(self) -> dict:
        return asdict(self)


def _slug(name: str) -> str:
    return ID_PREFIX + re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")


def store_dir(runtime_dir: Path) -> Path:
    path = Path(runtime_dir) / "custom"
    path.mkdir(parents=True, exist_ok=True)
    return path


def valid_tag(path: Path) -> tuple[bool, str]:
    """
    Is this really a Dimensions tag?

    Size is the whole test that matters: the format is a fixed 180 bytes, and
    the emulator reads it straight into a fixed array. Passing it something
    else is a crash rather than a complaint, so the check happens here.
    """
    try:
        size = path.stat().st_size
    except OSError as exc:
        return False, str(exc)
    if size != TAG_SIZE:
        return False, f"{size} bytes, expected {TAG_SIZE}"
    return True, ""


def _sidecar(bin_path: Path) -> dict:
    meta_path = bin_path.with_suffix(".json")
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("custom tag metadata unreadable: %s — %s", meta_path, exc)
        return {}


def _portrait_for(bin_path: Path) -> str:
    for ext in PORTRAIT_EXT:
        candidate = bin_path.with_suffix(ext)
        if candidate.is_file():
            return str(candidate)
    return ""


def scan(runtime_dir: Path) -> list[CustomTag]:
    """Every valid custom tag in the drop folder, named A-Z."""
    store = store_dir(runtime_dir)
    out: list[CustomTag] = []
    seen: set[str] = set()

    for path in sorted(store.glob("*.bin")):
        ok, why = valid_tag(path)
        if not ok:
            log.warning("skipping %s: %s", path.name, why)
            continue

        meta = _sidecar(path)
        name = str(meta.get("name") or path.stem)
        stable = _slug(name)
        # Two files resolving to one id would shadow each other silently.
        if stable in seen:
            stable = _slug(f"{name} {path.stem}")
        seen.add(stable)

        abilities = meta.get("abilities")
        out.append(CustomTag(
            stableId=stable,
            name=name,
            franchise=str(meta.get("franchise") or "Custom"),
            ringColor=str(meta.get("ringColor") or DEFAULT_RING),
            abilities=[int(a) for a in abilities] if isinstance(abilities, list) else [],
            bin=str(path),
            portrait=_portrait_for(path),
            build=int(meta.get("build") or 0),
        ))
    return out


def import_file(runtime_dir: Path, source: str,
                name: Optional[str] = None) -> dict:
    """Copy a tag in from anywhere on disk, validating before it lands."""
    src = Path(source).expanduser()
    if not src.is_file():
        return {"ok": False, "error": f"no such file: {src}"}

    ok, why = valid_tag(src)
    if not ok:
        return {"ok": False, "error": f"not a Dimensions tag — {why}"}

    store = store_dir(runtime_dir)
    stem = re.sub(r"[/\\:]", "-", (name or src.stem)).strip() or src.stem
    dest = store / f"{stem}.bin"

    # Never silently replace an existing custom tag; someone's progress may be
    # keyed to it.
    n = 2
    while dest.exists():
        dest = store / f"{stem} ({n}).bin"
        n += 1

    try:
        shutil.copy2(src, dest)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    # Bring a portrait along if one is sitting beside the source.
    for ext in PORTRAIT_EXT:
        art = src.with_suffix(ext)
        if art.is_file():
            try:
                shutil.copy2(art, dest.with_suffix(ext))
            except OSError:
                pass
            break

    return {"ok": True, "name": dest.stem, "path": str(dest)}


def remove(runtime_dir: Path, stable_id: str) -> dict:
    """Delete a custom tag and whatever came with it."""
    for tag in scan(runtime_dir):
        if tag.stableId != stable_id:
            continue
        path = Path(tag.bin)
        removed = []
        for extra in (path, path.with_suffix(".json"), *(path.with_suffix(e)
                                                         for e in PORTRAIT_EXT)):
            if extra.is_file():
                try:
                    extra.unlink()
                    removed.append(extra.name)
                except OSError as exc:
                    return {"ok": False, "error": str(exc)}
        return {"ok": True, "removed": removed}
    return {"ok": False, "error": "no such custom tag"}
