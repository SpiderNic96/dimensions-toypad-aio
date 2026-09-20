#!/usr/bin/env python3
"""
Game scanner — repo path: backend/gamescan.py

Finds LEGO Dimensions dumps anywhere on the system, for any region and any
container format.

IDENTIFY BY METADATA, NOT BY FILENAME. A dump can be called anything and live
anywhere, and region IDs differ per territory. But every PS3 and PS4 dump
carries a PARAM.SFO with the real title and title id, and every Wii U dump
carries meta/meta.xml. Reading those is exact and region-proof, where a list
of hard-coded ids is a list of things to miss.

Filename matching stays as a fallback for containers whose metadata is not
cheaply readable — .wud/.wux/.wua are packed, .iso needs a filesystem parse.

    python3 gamescan.py                 # every backend, whole system
    python3 gamescan.py --backend cemu  # one
    python3 gamescan.py --all           # don't filter to Dimensions
"""

from __future__ import annotations

import os
import re
import struct
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator, Optional

# Title ids and product codes seen referenced for this game. HINTS ONLY, never
# the sole test — this list is certainly incomplete across regions and
# re-releases, and I could not verify most of it. Metadata is the real check;
# these exist so a dump named ONLY by its code is still found.
#
# Extend it without editing this file: drop ids, one per line, into
# ~/.local/share/dimensions-toypad/data/extra-ids.txt
TITLE_ID_HINTS = {
    "rpcs3":   ("BLES02105", "BLES02052", "BLUS31363", "BLAS50758",
                "NPEB02221", "NPUB31552"),
    "shadps4": ("CUSA01176", "CUSA02514", "CUSA01399"),
    "recomp":  ("5752084B", "72B1DD2A"),
    # Wii U dumps are usually named by product code rather than title id.
    # ALD is the game's four-letter code; the last letter is the region.
    "cemu":    ("ALDE", "ALDP", "ALDJ", "ALDZ", "WUPPALD"),
}

EXTRA_IDS_FILE = (Path.home() / ".local/share/dimensions-toypad"
                  / "data" / "extra-ids.txt")

NAME_RE = re.compile(r"lego.{0,3}dimensions|dimensions.{0,3}lego|"
                     r"legodimensions", re.I)


def _load_extra_ids() -> tuple[str, ...]:
    """User-supplied ids, so an unknown region never needs a code change."""
    try:
        return tuple(
            line.strip().upper().replace("-", "")
            for line in EXTRA_IDS_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        )
    except OSError:
        return ()


def _normalise(text: str) -> str:
    """Uppercase, strip separators — so WUP-P-ALDE matches WUPPALD."""
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())

# Filesystems that cannot hold a game, or that would hang a walk.
SKIP_FS = {
    "proc", "sysfs", "devtmpfs", "devpts", "tmpfs", "cgroup", "cgroup2",
    "securityfs", "pstore", "bpf", "tracefs", "debugfs", "configfs",
    "fusectl", "mqueue", "hugetlbfs", "efivarfs", "autofs", "binfmt_misc",
    "nfs", "nfs4", "cifs", "smb3", "sshfs", "overlay", "squashfs", "ramfs",
}
# Pruned by NAME at every level, so keep this to things that are never a game.
# Notably NOT proc/sys/dev/run: those are excluded by filesystem type in
# mount_points(), and blacklisting the names would also skip a perfectly real
# folder that happens to be called "run" — which silently lost an SD card of
# games during testing.
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", "steamapps", "compatdata",
    ".cache", "Trash", "lost+found",
}

# The XDG document portal bind-mounts every file a Flatpak has ever opened
# under several ids at once, so one dump shows up five or six times with
# different paths. Real files, real duplicates — exclude the portal entirely
# and let the originals stand.
SKIP_PATH_RE = re.compile(r"/run/user/\d+/doc(/|$)|/\.flatpak/|/var/lib/flatpak/")

# A .pkg is an INSTALLER, not a bootable game. You install it into RPCS3 or
# shadPS4 and boot the result. Offering pkgs as games listed sixteen DLC packs
# as if each were a copy of the game, and misfiled PS3 packs as PS4 because
# the extension does not say which console it is for.
BOOTABLE_ONLY = True


@dataclass
class Found:
    backend: str
    path: str          # what the emulator should be handed
    title: str
    title_id: str
    container: str
    confident: bool    # True = metadata confirmed, False = filename guess

    def as_dict(self) -> dict:
        return asdict(self)


# ----------------------------------------------------------------------
# PARAM.SFO — PS3 and PS4
# ----------------------------------------------------------------------

def read_sfo(path: Path) -> dict[str, str]:
    """
    Minimal PARAM.SFO reader.

    Layout: magic \\x00PSF, version, key table offset, data table offset,
    entry count, then N index entries of
    (key_off u16, fmt u16, len u32, max u32, data_off u32).
    """
    try:
        blob = path.read_bytes()
    except OSError:
        return {}
    if len(blob) < 20 or blob[:4] != b"\x00PSF":
        return {}

    key_table, data_table, count = struct.unpack_from("<III", blob, 8)
    out: dict[str, str] = {}
    for i in range(min(count, 256)):
        base = 20 + i * 16
        if base + 16 > len(blob):
            break
        key_off, fmt, length, _max, data_off = struct.unpack_from("<HHIII", blob, base)
        try:
            key_start = key_table + key_off
            key = blob[key_start:blob.index(b"\x00", key_start)].decode("utf-8", "replace")
            raw = blob[data_table + data_off: data_table + data_off + length]
        except (ValueError, IndexError):
            continue
        if fmt == 0x0404:                       # int32
            out[key] = str(struct.unpack_from("<I", raw)[0]) if len(raw) >= 4 else ""
        else:                                   # utf8, padded or not
            out[key] = raw.split(b"\x00", 1)[0].decode("utf-8", "replace")
    return out


def _pkg_backend(path: Path) -> str:
    """
    PS3 and PS4 packages share the .pkg extension and nothing else. The magic
    tells them apart: PS3 is \x7FPKG, PS4 is \x7FCNT.
    """
    try:
        with open(path, "rb") as fh:
            magic = fh.read(4)
    except OSError:
        return "shadps4"
    return "rpcs3" if magic == b"\x7FPKG" else "shadps4"


# Deliberately NOT xml.etree: Decky runs plugins on a trimmed Python and that
# module is absent, which takes the whole plugin down at import. meta.xml is a
# flat list of single-line elements, so a regex is enough and costs nothing.
_META_RE = re.compile(
    r"<(longname_en|shortname_en|title_id|product_code)[^>]*>(.*?)</\1>",
    re.I | re.S)


def read_wiiu_meta(path: Path) -> dict[str, str]:
    """meta/meta.xml from an unpacked Wii U dump."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    return {tag.lower(): " ".join(value.split())
            for tag, value in _META_RE.findall(text) if value.strip()}


# ----------------------------------------------------------------------
# Where to look
# ----------------------------------------------------------------------

def mount_points() -> list[Path]:
    """Every real, readable filesystem — internal, SD, USB."""
    roots: list[Path] = []
    try:
        with open("/proc/mounts", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 3:
                    continue
                target, fstype = parts[1].replace("\\040", " "), parts[2]
                if fstype in SKIP_FS:
                    continue
                path = Path(target)
                if not path.is_dir() or not os.access(path, os.R_OK):
                    continue
                roots.append(path)
    except OSError:
        pass

    # / itself is huge; the interesting parts of it are under home and media.
    roots = [r for r in roots if str(r) != "/"]
    roots.append(Path.home())

    # Removable media, one root PER CARD rather than one for /run/media.
    #
    # Depth is counted from the root, and a Deck mounts its SD at
    # /run/media/deck/<label> — so a game at <label>/Emulation/wiiu/x/code/
    # is already seven levels down before anything interesting starts. Walking
    # from /run/media would run out of depth and silently find nothing on the
    # card, which is exactly the case people most want to work.
    for media in (Path("/run/media"), Path("/media"), Path("/mnt")):
        if not media.is_dir():
            continue
        try:
            for child in media.iterdir():
                if not child.is_dir():
                    continue
                # /run/media/deck/<label> on SteamOS, /media/<label> elsewhere
                grandchildren = [g for g in child.iterdir() if g.is_dir()] \
                    if child.name in ("deck", os.environ.get("USER", "")) else []
                roots.extend(grandchildren or [child])
        except OSError:
            continue

    # Drop anything already covered by a shorter root.
    unique: list[Path] = []
    for root in sorted(set(roots), key=lambda p: len(str(p))):
        if not any(str(root).startswith(str(u) + "/") for u in unique):
            unique.append(root)
    return unique


def walk(root: Path, max_depth: int) -> Iterator[tuple[Path, list[str], list[str]]]:
    base = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False,
                                                onerror=lambda _e: None):
        here = Path(dirpath)
        if len(here.parts) - base >= max_depth:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames
                       if not d.startswith(".") and d not in SKIP_DIRS]
        yield here, dirnames, filenames


# ----------------------------------------------------------------------
# Identify
# ----------------------------------------------------------------------

# Update/patch installs sit beside the game and are not separately bootable.
# RPCS3 applies them to the base title; booting the patch EBOOT directly gives
# you a broken game and a confusing bug report.
PATCH_RE = re.compile(r"patch\s*data|\bupdate\b|\bDLC\b", re.I)

# A PS4 update sits in its own folder next to the game — CUSA01176-patch — and
# carries the SAME title and title id in its param.sfo, so the title alone
# cannot tell them apart. The folder name is the only thing that differs.
PATCH_PATH_RE = re.compile(r"[-_ ]patch(es)?([-_ /.]|$)|[-_ ]update([-_ /.]|$)|"
                           r"/patch(es)?/|/updates?/", re.I)


def _is_patch(found: "Found") -> bool:
    return bool(PATCH_RE.search(found.title or "")
                or PATCH_PATH_RE.search(found.path or ""))


def _matches(found: "Found") -> bool:
    """
    Match on everything we have, not just the leaf name.

    A dump lives at ~/Games/LEGO Dimensions/game.wux as often as it lives at
    ~/Games/game/LEGO Dimensions.wux, and plenty are named only by their
    region code. Checking the whole path catches all three; checking just the
    filename caught none of them.
    """
    haystacks = (found.title or "", found.path or "")
    if any(NAME_RE.search(h) for h in haystacks):
        return True

    ident = _normalise(found.title_id) + _normalise(found.path)
    hints = TITLE_ID_HINTS.get(found.backend, ()) + _load_extra_ids()
    return any(_normalise(h) in ident for h in hints if h)


def identify(here: Path, filenames: list[str]) -> list[Found]:
    out: list[Found] = []
    lower = {f.lower(): f for f in filenames}

    # --- PS3: PS3_GAME/USRDIR/EBOOT.BIN, PARAM.SFO two levels up ---
    if "eboot.bin" in lower and here.name.upper() == "USRDIR":
        eboot = here / lower["eboot.bin"]
        sfo = read_sfo(here.parent / "PARAM.SFO")
        title = sfo.get("TITLE", "")
        tid = sfo.get("TITLE_ID", "")
        out.append(Found("rpcs3", str(eboot), title or here.parents[1].name,
                         tid, "PS3 folder", bool(sfo)))

    # --- PS4: eboot.bin, with param.sfo under sce_sys/ ---
    elif "eboot.bin" in lower:
        # An extracted PKG puts param.sfo in sce_sys/, NOT beside eboot.bin.
        # Requiring them in the same directory meant no PS4 dump could ever
        # match — which is exactly why shortcut creation found nothing.
        sfo = {}
        for candidate in (here / "sce_sys" / "param.sfo",
                          here / "sce_sys" / "PARAM.SFO",
                          here / lower.get("param.sfo", "param.sfo")):
            if candidate.is_file():
                sfo = read_sfo(candidate)
                if sfo:
                    break
        out.append(Found("shadps4", str(here / lower["eboot.bin"]),
                         sfo.get("TITLE", here.name), sfo.get("TITLE_ID", ""),
                         "PS4 folder", bool(sfo)))

    # --- Wii U unpacked: code/*.rpx with ../meta/meta.xml ---
    rpx = [f for f in filenames if f.lower().endswith(".rpx")]
    if rpx and here.name.lower() == "code":
        meta = read_wiiu_meta(here.parent / "meta" / "meta.xml")
        out.append(Found("cemu", str(here / rpx[0]),
                         meta.get("longname_en", here.parent.name),
                         meta.get("title_id", ""), "Wii U folder", bool(meta)))

    # --- packed containers: no cheap metadata, so match the name ---
    for fname in filenames:
        low = fname.lower()
        if low.endswith((".wua", ".wux", ".wud")):
            out.append(Found("cemu", str(here / fname), Path(fname).stem, "",
                             Path(fname).suffix.lstrip("."), False))
        elif low.endswith(".pkg") and not BOOTABLE_ONLY:
            out.append(Found(_pkg_backend(here / fname), str(here / fname),
                             Path(fname).stem, "", "pkg", False))
        elif low in ("default.xex", "default_mp.xex"):
            out.append(Found("recomp", str(here / fname), here.name, "",
                             "Xbox 360", False))
        elif low.startswith("game") and low.endswith(".hdr"):
            out.append(Found("recomp", str(here), here.name, "",
                             "Xbox 360 GOD", False))
    return out


def scan(backend: Optional[str] = None, max_depth: int = 8,
         only_dimensions: bool = True, roots: Optional[list[Path]] = None,
         verbose: bool = False) -> list[Found]:
    seen: set[str] = set()
    results: list[Found] = []
    real_seen: set[str] = set()

    for root in (roots or mount_points()):
        if verbose:
            print(f"  scanning {root}", file=sys.stderr)
        if SKIP_PATH_RE.search(str(root)):
            continue
        for here, _dirs, files in walk(root, max_depth):
            if SKIP_PATH_RE.search(str(here)):
                continue
            for found in identify(here, files):
                if backend and found.backend != backend:
                    continue
                if found.path in seen:
                    continue
                # Bind mounts and symlinks make one file look like several.
                try:
                    real = os.path.realpath(found.path)
                except OSError:
                    real = found.path
                if real in real_seen:
                    continue
                if only_dimensions and _is_patch(found):
                    continue
                if only_dimensions and not _matches(found):
                    continue
                seen.add(found.path)
                real_seen.add(real)
                results.append(found)

    # Metadata-confirmed hits first — those are the ones worth trusting.
    results.sort(key=lambda f: (not f.confident, f.backend, f.title.lower()))
    return results


def main() -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["rpcs3", "cemu", "shadps4", "recomp"])
    ap.add_argument("--all", action="store_true", help="every game, not just Dimensions")
    ap.add_argument("--depth", type=int, default=8)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", action="append", help="limit to these paths")
    args = ap.parse_args()

    roots = [Path(r).expanduser() for r in args.root] if args.root else None
    hits = scan(args.backend, args.depth, not args.all, roots, verbose=not args.json)

    if args.json:
        print(json.dumps([h.as_dict() for h in hits], indent=1))
        return 0

    if not hits:
        print("\nnothing found.")
        print("If you know where the dump is, rerun with --root /path --all")
        return 1

    print()
    for h in hits:
        mark = "confirmed" if h.confident else "by name  "
        print(f"  [{mark}] {h.backend:8} {h.title[:38]:38} "
              f"{h.title_id:10} {h.container}")
        print(f"              {h.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
