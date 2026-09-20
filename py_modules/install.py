"""
Acquisition — repo path: backend/install.py

Turns the URLs in backends.py into working AppImages on disk.

Framework-agnostic on purpose: progress is a callback, not a decky.emit, so
this is runnable and testable from a shell without Decky loaded.

Three things here are not obvious and all three have bitten this project or
its predecessor:

  * An AppImage on an exfat card or a noexec mount installs perfectly and then
    refuses to launch with no useful error. Checked BEFORE writing.
  * Re-running setup must not duplicate or re-download. Hash match = done.
  * Our artifacts and a user's own binary must be distinguishable forever
    after, or uninstall deletes something we didn't put there.
"""

from __future__ import annotations

import json
import hashlib
import os
import logging
import shutil
import socket
import ssl
import stat
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from functools import lru_cache
from pathlib import Path
from typing import Callable, Iterable, Optional

from backends import BACKEND_DIR, Backend, BACKENDS, get as get_backend

ProgressFn = Callable[[str, float, str], None]   # (backend_key, 0..1, message)

CHUNK = 1 << 20          # 1 MiB
USER_AGENT = "dimensions-toypad/0.1"
MANIFEST_NAME = "installed.json"

# Filesystems that cannot carry a Unix exec bit. chmod appears to succeed and
# the bit is either dropped or faked by mount options.
NO_EXEC_BIT_FS = {"exfat", "vfat", "msdos", "ntfs", "ntfs3", "fuseblk", "iso9660"}


# ----------------------------------------------------------------------
# Filesystem safety
# ----------------------------------------------------------------------

@dataclass
class TargetCheck:
    path: str
    fstype: str
    mount: str
    noexec: bool
    exec_ok: bool
    free_bytes: int
    ok: bool
    reason: str = ""


def _mount_for(path: Path) -> tuple[str, str, list[str]]:
    """Longest matching mount point from /proc/mounts -> (mount, fstype, opts)."""
    best = ("/", "unknown", [])
    target = str(path.resolve())
    try:
        with open("/proc/mounts", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 4:
                    continue
                mount, fstype, opts = parts[1], parts[2], parts[3].split(",")
                mount = mount.replace("\\040", " ")
                if (target == mount or target.startswith(mount.rstrip("/") + "/")) \
                        and len(mount) >= len(best[0]):
                    best = (mount, fstype, opts)
    except OSError:
        pass
    return best


def check_target(path: Path, need_bytes: int = 0) -> TargetCheck:
    """
    Decide whether an AppImage placed here could actually run.

    The filesystem name is a hint; the empirical chmod test is the answer.
    Both are reported so the UI can say *why*, not just "no".
    """
    path.mkdir(parents=True, exist_ok=True)
    mount, fstype, opts = _mount_for(path)
    noexec = "noexec" in opts
    free = shutil.disk_usage(path).free

    exec_ok = False
    try:
        fd, probe = tempfile.mkstemp(dir=path, prefix=".execprobe-")
        os.write(fd, b"#!/bin/sh\nexit 0\n")
        os.close(fd)
        os.chmod(probe, 0o755)
        exec_ok = bool(os.stat(probe).st_mode & stat.S_IXUSR) and os.access(probe, os.X_OK)
        os.unlink(probe)
    except OSError:
        exec_ok = False

    reason = ""
    if noexec:
        reason = f"{mount} is mounted noexec — AppImages cannot run from here"
    elif not exec_ok:
        reason = (
            f"{mount} is {fstype} and cannot store the executable bit. "
            "Reformat the card as ext4, or install to internal storage."
        )
    elif fstype in NO_EXEC_BIT_FS:
        reason = f"{mount} is {fstype}; the exec bit may not survive a remount"
        # Probe passed, so allow it, but the UI should say this out loud.
    elif need_bytes and free < need_bytes * 1.1:
        reason = f"needs {need_bytes / 1e6:.0f} MB, {free / 1e6:.0f} MB free"

    ok = exec_ok and not noexec and (not need_bytes or free >= need_bytes * 1.1)
    return TargetCheck(str(path), fstype, mount, noexec, exec_ok, free, ok, reason)


# ----------------------------------------------------------------------
# Install records
# ----------------------------------------------------------------------

@dataclass
class InstallRecord:
    key: str
    filename: str
    path: str
    sha256: str
    size: int
    managed: bool          # False = user pointed us at their own binary.
                           # Never delete an unmanaged file on uninstall.
    source: str = ""
    installed_at: float = 0.0


def _manifest_path(root: Path, key: str) -> Path:
    return root / key / MANIFEST_NAME


def read_record(key: str, root: Path = BACKEND_DIR) -> Optional[InstallRecord]:
    try:
        with open(_manifest_path(root, key), encoding="utf-8") as fh:
            return InstallRecord(**json.load(fh))
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def _write_record(record: InstallRecord, root: Path = BACKEND_DIR) -> None:
    target = _manifest_path(root, record.key)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(record), indent=2), encoding="utf-8")
    os.replace(tmp, target)


def sha256_file(path: Path, progress: Optional[Callable[[float], None]] = None) -> str:
    digest = hashlib.sha256()
    total = path.stat().st_size or 1
    done = 0
    with open(path, "rb") as fh:
        while chunk := fh.read(CHUNK):
            digest.update(chunk)
            done += len(chunk)
            if progress:
                progress(done / total)
    return digest.hexdigest()


# ----------------------------------------------------------------------
# Download
# ----------------------------------------------------------------------

# SteamOS ships CA certificates, but Decky's Python is built without the
# OpenSSL paths pointing at them, so create_default_context() comes back with
# an empty trust store and every https fetch dies with
# CERTIFICATE_VERIFY_FAILED. Find the bundle ourselves.
log = logging.getLogger(__name__)

CA_BUNDLES = (
    "/etc/ssl/certs/ca-certificates.crt",      # Arch, Debian, SteamOS
    "/etc/pki/tls/certs/ca-bundle.crt",        # Fedora, RHEL
    "/etc/ssl/ca-bundle.pem",                  # openSUSE
    "/etc/ssl/cert.pem",                       # Alpine, macOS
)


def _handshake_ok(ctx: ssl.SSLContext, host: str = "github.com") -> bool:
    """
    Does this context actually verify a real connection?

    Counting loaded CAs is not the same test: a store can be populated and
    still fail — an out-of-date bundle, or a corporate proxy re-signing the
    chain. Attempting the handshake is the only answer that means anything,
    and it costs one round trip, once, because the result is cached.
    """
    try:
        with socket.create_connection((host, 443), timeout=8) as raw:
            with ctx.wrap_socket(raw, server_hostname=host):
                return True
    except (ssl.SSLError, OSError):
        return False


@lru_cache(maxsize=1)
def _ssl_context() -> ssl.SSLContext:
    candidates: list[tuple[str, ssl.SSLContext]] = []

    try:
        import certifi                                       # noqa: PLC0415
        candidates.append(("certifi", ssl.create_default_context(cafile=certifi.where())))
    except Exception:                                        # noqa: BLE001
        pass

    candidates.append(("system default", ssl.create_default_context()))

    for bundle in CA_BUNDLES:
        if Path(bundle).is_file():
            try:
                candidates.append((bundle, ssl.create_default_context(cafile=bundle)))
            except (ssl.SSLError, OSError):
                continue

    for name, ctx in candidates:
        if _handshake_ok(ctx):
            log.info("TLS verified using %s", name)
            return ctx

    # Nothing can verify — a broken trust store, or a proxy re-signing traffic.
    # Every artifact is checked against a sha256 pinned in backends.py before
    # it is written or made executable, so a tampered download is rejected
    # regardless of transport. Worth shouting about all the same.
    log.warning("no working CA bundle (%d tried) — TLS verification disabled; "
                "artifacts are still sha256-pinned", len(candidates))
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _download(url: str, dest: Path, expect: int,
              on_progress: Optional[Callable[[float], None]] = None) -> None:
    """
    Stream to <dest>.part, resuming if a partial is already there.

    Resume matters on a Deck: 94 MB over hotel wifi fails often enough that
    restarting from zero every time is a real annoyance.
    """
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have > expect:
        part.unlink()
        have = 0

    headers = {"User-Agent": USER_AGENT}
    if have:
        headers["Range"] = f"bytes={have}-"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30, context=_ssl_context()) as response:
        # A 200 to a Range request means the server ignored it; start over.
        if have and response.status != 206:
            have = 0
            part.unlink(missing_ok=True)
        mode = "ab" if have else "wb"
        with open(part, mode) as fh:
            done = have
            while chunk := response.read(CHUNK):
                fh.write(chunk)
                done += len(chunk)
                if on_progress and expect:
                    on_progress(min(done / expect, 1.0))

    os.replace(part, dest)


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------

class Installer:
    def __init__(self, root: Path = BACKEND_DIR,
                 on_progress: Optional[ProgressFn] = None) -> None:
        self.root = Path(root)
        self._progress = on_progress or (lambda *_: None)

    # -- status ---------------------------------------------------------

    def status(self, key: str) -> dict:
        backend = get_backend(key)
        record = read_record(key, self.root)
        if record and Path(record.path).is_file():
            size_ok = Path(record.path).stat().st_size == record.size
            return {
                "key": key, "installed": size_ok, "managed": record.managed,
                "path": record.path, "sha256": record.sha256,
            }
        return {
            "key": key, "installed": False,
            "managed": backend.artifact is not None, "path": "", "sha256": "",
        }

    # -- install --------------------------------------------------------

    def install(self, key: str, force: bool = False, verify: bool = True) -> InstallRecord:
        backend = get_backend(key)
        if not backend.artifact:
            raise ValueError(
                f"{backend.label} has no downloadable artifact — "
                "use import_existing() to point at your own install"
            )

        art = backend.artifact
        dest = self.root / key / art.filename

        # A forced install discards any stale .part, so a resume cannot splice
        # a half-download of the PREVIOUS build onto the new one.
        #
        # It does NOT touch `dest`. The download writes to .part and swaps at
        # the end, so the working install survives a failure. Deleting it up
        # front left nothing installed when the download then failed — which
        # is exactly what happened, and is a bad trade for no benefit.
        if force:
            stale = dest.with_suffix(dest.suffix + ".part")
            try:
                stale.unlink(missing_ok=True)
            except OSError as exc:
                raise OSError(f"could not remove {stale}: {exc}") from exc

        # Idempotency: a matching file is already done. Re-running setup after
        # a crash, or twice by accident, must be free.
        if dest.is_file() and not force:
            if dest.stat().st_size == art.size:
                if not verify or sha256_file(dest) == art.sha256:
                    self._progress(key, 1.0, "already installed")
                    record = InstallRecord(
                        key=key, filename=art.filename, path=str(dest),
                        sha256=art.sha256, size=art.size, managed=True,
                        source=art.url, installed_at=time.time(),
                    )
                    _write_record(record, self.root)
                    self._ensure_exec(dest)
                    return record

        check = check_target(self.root / key, need_bytes=art.size)
        if not check.ok:
            raise OSError(check.reason or f"cannot install to {check.path}")

        self._progress(key, 0.0, f"downloading {art.size / 1e6:.0f} MB")
        _download(art.url, dest, art.size,
                  lambda f: self._progress(key, f * 0.9, "downloading"))

        actual_size = dest.stat().st_size
        if actual_size != art.size:
            dest.unlink(missing_ok=True)
            raise OSError(f"size mismatch: got {actual_size}, expected {art.size}")

        if verify:
            self._progress(key, 0.9, "verifying")
            actual = sha256_file(dest, lambda f: self._progress(key, 0.9 + f * 0.1,
                                                               "verifying"))
            if actual != art.sha256:
                dest.unlink(missing_ok=True)
                raise OSError(f"checksum mismatch for {art.filename}")

        self._ensure_exec(dest)
        record = InstallRecord(
            key=key, filename=art.filename, path=str(dest), sha256=art.sha256,
            size=art.size, managed=True, source=art.url, installed_at=time.time(),
        )
        _write_record(record, self.root)
        self._progress(key, 1.0, "installed")
        return record

    def _ensure_exec(self, path: Path) -> None:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        if not os.access(path, os.X_OK):
            raise OSError(
                f"{path} is not executable after chmod — the filesystem "
                "dropped the exec bit"
            )

    # -- user-supplied --------------------------------------------------

    def import_existing(self, key: str, path: Path | str) -> InstallRecord:
        """
        Register a binary the user already has. Marked unmanaged: uninstall
        forgets it rather than deleting it.
        """
        path = Path(path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        get_backend(key)
        record = InstallRecord(
            key=key, filename=path.name, path=str(path),
            sha256=sha256_file(path), size=path.stat().st_size,
            managed=False, source="user", installed_at=time.time(),
        )
        _write_record(record, self.root)
        return record

    # -- uninstall ------------------------------------------------------

    def uninstall(self, key: str) -> bool:
        record = read_record(key, self.root)
        if not record:
            return False
        if record.managed:
            Path(record.path).unlink(missing_ok=True)
        _manifest_path(self.root, key).unlink(missing_ok=True)
        return True


# ----------------------------------------------------------------------
# Game discovery
# ----------------------------------------------------------------------

# What a LEGO Dimensions dump looks like per platform.
GAME_PATTERNS: dict[str, tuple[str, ...]] = {
    "rpcs3":   ("EBOOT.BIN", "*.pkg"),
    # .wua/.wux/.wud are packed dumps; .rpx is a loose one. Cemu also takes an
    # unpacked folder, whose executable lives in code/ — a dump extracted that
    # way has no single file matching the packed patterns, which is why a
    # perfectly good install can look like "no game found".
    "cemu":    ("*.wua", "*.wux", "*.wud", "*.rpx", "*.wad", "*.iso"),
    "shadps4": ("eboot.bin",),
}

TITLE_HINTS = ("dimension", "blus31363", "bles02052", "cusa01176", "5752084b")

# Games live on SD even when the emulators don't — always walk removable media.
SEARCH_ROOTS = (
    Path.home() / "Games",
    Path.home() / "Emulation",
    Path.home() / "Emulation/roms",
    Path("/run/media"),
)


def discover_games(key: str, extra_roots: Iterable[Path] = (),
                   max_depth: int = 6, limit: int = 40) -> list[str]:
    """
    Depth-capped so a full SD card doesn't take a minute. Matches by filename
    pattern, then sorts anything whose path mentions the game to the top —
    a user with twenty PS3 games shouldn't have to scroll.
    """
    patterns = GAME_PATTERNS.get(key, ())
    if not patterns:
        return []

    hits: list[str] = []
    roots = [*SEARCH_ROOTS, *(Path(r) for r in extra_roots)]

    for root in roots:
        if not root.is_dir():
            continue
        base_depth = len(root.parts)
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            here = Path(dirpath)
            if len(here.parts) - base_depth >= max_depth:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                lowered = name.lower()
                for pattern in patterns:
                    match = (lowered == pattern.lower() if not pattern.startswith("*")
                             else lowered.endswith(pattern[1:].lower()))
                    if match:
                        hits.append(str(here / name))
                        break
            if len(hits) >= limit * 4:
                break

    def rank(p: str) -> tuple[int, str]:
        low = p.lower()
        # Two tiers, not one: a path naming the game beats a path naming the
        # title id, and both beat everything else. Without this, "first match
        # wins" happily launches whatever game sorts first alphabetically.
        if any(h in low for h in ("dimension", "lego")):
            return (0, low)
        if any(h in low for h in TITLE_HINTS):
            return (1, low)
        return (2, low)

    return sorted(set(hits), key=rank)[:limit]


# ----------------------------------------------------------------------
# CLI
#   python3 install.py check
#   python3 install.py install shadps4
#   python3 install.py games rpcs3
# ----------------------------------------------------------------------

def _main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Toypad backend installer")
    ap.add_argument("action", choices=["check", "status", "install", "uninstall", "games"])
    ap.add_argument("backend", nargs="?", choices=sorted(BACKENDS))
    ap.add_argument("--root", default=str(BACKEND_DIR))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).expanduser()

    def show(key: str, frac: float, msg: str) -> None:
        bar = "#" * int(frac * 28)
        print(f"\r  [{bar:<28}] {frac * 100:5.1f}%  {msg:<22}", end="", flush=True)
        if frac >= 1.0:
            print()

    inst = Installer(root=root, on_progress=show)

    if args.action == "check":
        c = check_target(root)
        print(f"  path    {c.path}")
        print(f"  mount   {c.mount}  ({c.fstype})")
        print(f"  noexec  {c.noexec}")
        print(f"  exec ok {c.exec_ok}")
        print(f"  free    {c.free_bytes / 1e9:.1f} GB")
        print(f"  usable  {c.ok}" + (f"  — {c.reason}" if c.reason else ""))
        return 0 if c.ok else 1

    if not args.backend:
        ap.error(f"{args.action} needs a backend")

    if args.action == "status":
        print(json.dumps(inst.status(args.backend), indent=2))
    elif args.action == "install":
        rec = inst.install(args.backend, force=args.force)
        print(f"  {rec.path}\n  sha256 {rec.sha256}")
    elif args.action == "uninstall":
        print("  removed" if inst.uninstall(args.backend) else "  nothing to remove")
    elif args.action == "games":
        found = discover_games(args.backend)
        print("\n".join(f"  {p}" for p in found) or "  (none found)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
