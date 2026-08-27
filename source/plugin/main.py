"""
Dimensions Toypad - Decky Loader plugin backend.

Speaks the RPCS3 Seamless Toypad Build wire protocol directly over loopback.
No Wine, no nested compositor, no container: Decky already runs inside Steam's
UI layer, which gamescope composites over the game, and the QAM receives
controller input even while a game holds the pad.

Wire protocol (matches DimensionsListener.cpp):
  LOAD   0x01 | pad | index | 00 | 00 | <180-byte tag> | u16le pathlen | path
  REMOVE 0x02 | pad | index | 00 | 00
  MOVE   0x03 | destpad | destindex | srcpad | srcindex

Fire-and-forget: connect, send, close. No acknowledgement, so pad state here
is bookkeeping.

Tag persistence: the LOAD path tells the emulator where to write the tag back,
which is how character upgrades and studs survive. Rather than writing into the
user's pristine dumps, each tag is copied once into a working directory and
that copy is what gets sent. First use seeds it; after that the working copy is
authoritative, so progress accumulates.
"""

import asyncio
import base64
import io
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import tarfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn

import decky

TAG_SIZE = 180
CMD_LOAD = 0x01
CMD_REMOVE = 0x02
CMD_MOVE = 0x03

# pad 1 = centre, pad 2 = left section, pad 3 = right section.
# 3/1/3 geometry: left owns 0/3/4, centre is slot 1, right owns 2/5/6.
SLOTS = [
    {"slot": 0, "pad": 2, "index": 0, "zone": "left",   "label": "Left · upper"},
    {"slot": 1, "pad": 1, "index": 1, "zone": "centre", "label": "Centre"},
    {"slot": 2, "pad": 3, "index": 2, "zone": "right",  "label": "Right · upper"},
    {"slot": 3, "pad": 2, "index": 3, "zone": "left",   "label": "Left · lower L"},
    {"slot": 4, "pad": 2, "index": 4, "zone": "left",   "label": "Left · lower R"},
    {"slot": 5, "pad": 3, "index": 5, "zone": "right",  "label": "Right · lower L"},
    {"slot": 6, "pad": 3, "index": 6, "zone": "right",  "label": "Right · lower R"},
]

# The emulator sleeps internally between the lift and the re-place on a MOVE,
# mimicking a hand moving a figure. Commands fired faster than this make the
# game miss transitions.
COMMAND_GAP = 0.35

# Decky runs as root; the Deck user's home is where everything actually lives.
DECK_HOME = Path("/home/deck")
HOME = DECK_HOME if DECK_HOME.is_dir() else Path(os.path.expanduser("~"))

WORK_DIR = HOME / ".local" / "share" / "dimensions-toypad"
TAG_CACHE = WORK_DIR / "tags"
TAG_LIBRARY = WORK_DIR / "library"
CONFIG_FILE = WORK_DIR / "config.json"
SETUP_LOG = WORK_DIR / "setup.log"
LAUNCHER = HOME / "toypad" / "play-dimensions.sh"
RUN_BOTH = HOME / "toypad" / "run-both.sh"

RPCS3_REPO = "https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build"

# AIO runtime: this exact AppImage is the only RPCS3 source allowed at runtime.
PLUGIN_ROOT = Path(__file__).resolve().parent
BUNDLED_RPCS3 = PLUGIN_ROOT / "rpcs3" / "RPCS3-Toypad-x86_64.AppImage"
BUNDLED_RPCS3_SHA256 = "1f2ce02de8bf361834bcb38e1e92d0f9ee138bc71e1c271628b55eed437f2e71"
BUNDLED_RPCS3_VERSION = "toypad-20260825 / 0.0.42-5-797f1e41+colour"
AIO_PLUGIN_VERSION = "3.3.11"
WEB_UI_VERSION = "LegoToypad v1.5"

# Tag dumps and artwork live in harrysof's picker repo.
TAG_SOURCE_TARBALL = "https://codeload.github.com/harrysof/LegoToypad/tar.gz/refs/tags/v1.5"

# v1.5's "Story" mode: the starter pack only, like the game's own campaign.
# Scoped by franchise as upstream does - "Batman" alone also matches the one
# from The LEGO Batman Movie, which is not the starter-pack figure.
STORY_ROSTER = (
    ("dc comics", "batman"),
    ("lord of the rings", "gandalf the grey"),
    ("the lego movie", "wyldstyle"),
    ("dc comics", "batmobile"),
)
# A broader "Starters" set for the Decky panel + a synthetic phone franchise.
# Vehicle names vary between tag dumps, so several common aliases are listed;
# whichever the user's library actually contains gets picked up. Anything not
# present is silently omitted, so extras never produce empty tiles.
STARTERS_ROSTER = (
    # Minifigures
    ("dc comics", "batman"),
    ("lord of the rings", "gandalf the grey"),
    ("the lego movie", "wyldstyle"),
    # Batman's vehicle - the one that ships in the starter pack box
    ("dc comics", "batmobile"),
    # Wyldstyle's bike - alias variants seen in different dumps
    ("the lego movie", "shadow-bolt bike"),
    ("the lego movie", "wyldstyle's bike"),
    ("the lego movie", "ultra kool bike"),
    # Gandalf's vehicle
    ("lord of the rings", "shadowfax"),
    ("lord of the rings", "gandalf's horse"),
    # Marty McFly's DeLorean (Nic's requested addition; ships in the BttF
    # level pack rather than the base starter box, but rounds out a good
    # "getting started" loadout)
    ("back to the future", "delorean time machine"),
    ("back to the future", "delorean"),
)
TAG_SOURCE_BINS = "All Bin Files"
# v1.5 ships its phone UI and artwork in the repo; we serve them verbatim so the
# remote looks and behaves exactly like the desktop app's own web remote.
TAG_SOURCE_EXTRA = ("Assets", "Web")
ASSET_ROOT = WORK_DIR / "assets"
WEB_ROOT = WORK_DIR / "web"

# The managed download puts Web/ and Assets/ under WORK_DIR, but anyone who
# already cloned LegoToypad has them in the checkout. Look there too, or the
# phone falls back to a stub page even though the real UI is sitting on disk.
EXTRA_WEB_ROOTS = [
    WEB_ROOT,
    HOME / "LegoToypad-src" / "Web",
    HOME / "toypad" / "Web",
]
EXTRA_ASSET_ROOTS = [
    ASSET_ROOT,
    HOME / "LegoToypad-src" / "Assets",
    HOME / "toypad" / "Assets",
]

# Searched in order; first hit wins. The managed copy comes first so a fresh
# install works without the user ever having built the Windows picker.
DEFAULT_LIBRARY_PATHS = [
    TAG_LIBRARY,
    HOME / "LegoToypad-src" / "All Bin Files",
    HOME / "toypad" / "All Bin Files",
    HOME / "lego" / "bins",
    HOME / "Documents" / "toypad-tags",
]


DEFAULT_CONFIG = {
    "webPort": 8781,
    "webEnabled": True,
    "gamePath": str(HOME / "lego" / "game"),
    "rpcs3Path": "",
}


class Plugin:
    # ---------------------------------------------------------------- lifecycle

    async def _main(self):
        self.loop = asyncio.get_running_loop()
        self.host = "127.0.0.1"
        self.port = int(os.environ.get("RPCS3_TOYPAD_PORT", 9191))
        self.pads = [None] * 7
        self.library = []
        self.library_root = None
        self.last_send = 0.0
        self._lock = asyncio.Lock()
        self._httpd = None
        self._busy = ""
        self._asset_ids = {}
        self._asset_paths = {}
        self.ui = {}
        self.logos = {}
        self.status = "Ready."
        self._rpcs3_info_cache = None
        self._setup_status_cache = None
        self._setup_status_cache_at = 0.0
        self._verify_task = None
        self._game_cache = ("", 0.0)

        # v3.3.8: colour forwarding. The patched RPCS3 emits Colour/Flash
        # events on the toypad socket per the LEGO Dimensions Toypad Event
        # Protocol v1. A long-lived background reader keeps a client
        # connection open and updates pad_colors as frames arrive. Both the
        # Decky panel and the phone UI read from here.
        # Keys "0", "1", "2" are per-pad (centre/left/right); "all" is the
        # last broadcast colour. Each value is a tuple (r, g, b, kind)
        # where kind is "color" or "flash", or None if no LED command yet.
        self.pad_colors = {"0": None, "1": None, "2": None, "all": None}
        self._color_reader_task = None
        # v3.3.10: diagnostics for the reader loop so the Setup panel can
        # show whether it's actually connected + parsing frames.
        self._color_reader_stats = {
            "connects": 0, "frames_parsed": 0, "last_error": "",
            "connected": False, "last_frame_ts": 0.0,
        }

        WORK_DIR.mkdir(parents=True, exist_ok=True)
        TAG_CACHE.mkdir(parents=True, exist_ok=True)
        self.config = self._load_config()

        self._scan()
        if BUNDLED_RPCS3.is_file():
            try:
                BUNDLED_RPCS3.chmod(0o755)
            except OSError as exc:
                decky.logger.warning("Bundled RPCS3 could not be made executable: %s", exc)
        else:
            decky.logger.error("Bundled RPCS3 AppImage missing; expected %s", BUNDLED_RPCS3)
        if self.config.get("webEnabled", True):
            self._start_web()

        # A fresh AIO install is self-provisioning: once the plugin is loaded,
        # perform the same setup wizard in the background. This downloads the
        # upstream LegoToypad v1.5 Web/Assets and tag library, verifies the
        # bundled RPCS3, discovers the user's existing game files, and writes
        # the Steam/Game Mode launcher. If setup cannot complete (for example
        # because the user has not supplied game files yet), the Decky UI shows
        # the failed step and the user can rerun setup manually.
        self._auto_setup_task = None
        if not self._auto_setup_complete():
            self._auto_setup_task = asyncio.create_task(self._auto_setup())

        # Colour reader is best-effort - if RPCS3 isn't running yet, the task
        # sits in a reconnect loop; when the emulator launches, it connects
        # and starts populating pad_colors within a second or two.
        self._color_reader_task = asyncio.create_task(self._run_color_reader())

        decky.logger.info(
            "Dimensions Toypad ready: %d tags from %s",
            len(self.library), self.library_root)

    def _auto_setup_complete(self):
        return bool(self.library and self._web_assets_ready() and
                    LAUNCHER.is_file() and RUN_BOTH.is_file())

    async def _auto_setup(self):
        try:
            await asyncio.sleep(0.5)
            result = await self.run_setup()
            if result.get("ok"):
                decky.logger.info("First-run AIO setup completed automatically")
            else:
                decky.logger.warning("First-run AIO setup incomplete: %s", result.get("error", result.get("message", "unknown error")))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            decky.logger.warning("First-run AIO setup failed: %s", exc)

    async def _unload(self):
        if getattr(self, "_auto_setup_task", None):
            self._auto_setup_task.cancel()
            self._auto_setup_task = None
        if getattr(self, "_color_reader_task", None):
            self._color_reader_task.cancel()
            self._color_reader_task = None
        self._stop_web()
        decky.logger.info("Dimensions Toypad unloaded")

    # ---------------------------------------------- LEGO Toypad Event Protocol
    # v1 wire format (see spec repo): 0x55, 0x01, event_type, pad_byte,
    # payload_len, payload...
    #   0x01 Colour: [r, g, b]
    #   0x02 Flash:  [on_ms, off_ms, count, r, g, b]
    #   pad byte:    0=centre, 1=left, 2=right, 0xFF=broadcast (all pads)
    # Anything else is skipped without disconnecting so future firmware
    # additions can't break this reader.

    async def _run_color_reader(self):
        import time
        backoff = 1.0
        while True:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port), timeout=2)
            except (asyncio.TimeoutError, OSError) as exc:
                # Emulator not up yet, or listener not bound. Retry with
                # gentle backoff; the user launching the game is the
                # trigger for a real connect.
                self._color_reader_stats["last_error"] = "connect: %s" % exc
                self._color_reader_stats["connected"] = False
                await asyncio.sleep(min(backoff, 5.0))
                backoff = min(backoff * 1.5, 5.0)
                continue
            backoff = 1.0
            self._color_reader_stats["connects"] += 1
            self._color_reader_stats["connected"] = True
            self._color_reader_stats["last_error"] = ""
            decky.logger.info(
                "Colour reader connected to %s:%d (connect #%d)",
                self.host, self.port,
                self._color_reader_stats["connects"])
            # v3.3.10 KEY FIX: do NOT send HELLO. The fork's inbound listener
            # thread parses the first byte we send as a LOAD/REMOVE/MOVE
            # command byte (0x01/0x02/0x03). 'H' is 0x48, which the fork
            # treats as unknown and drops the connection - killing the whole
            # session and preventing outbound colour frames from ever
            # reaching us. Instead we say nothing on the socket; the fork's
            # broadcast side (patched in) pushes frames unsolicited as
            # colour commands arrive. This matches the "cat <&3" tap that
            # works from the shell.
            try:
                await self._parse_color_frames(reader)
            except asyncio.CancelledError:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
                raise
            except Exception as exc:
                self._color_reader_stats["last_error"] = "parse: %s" % exc
                decky.logger.warning("Colour reader disconnected: %s", exc)
            finally:
                self._color_reader_stats["connected"] = False
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass
            await asyncio.sleep(1.0)

    async def _parse_color_frames(self, reader):
        # Resync-on-MAGIC state machine: tolerates stray bytes and unknown
        # versions/event types by skipping past their payload.
        import time
        MAGIC = 0x55
        VERSION = 0x01
        while True:
            # Advance to next magic byte
            b = await reader.readexactly(1)
            if b[0] != MAGIC:
                continue
            header = await reader.readexactly(4)
            version, event_type, pad, payload_len = header
            payload = await reader.readexactly(payload_len)
            if version != VERSION:
                continue
            key = ({0: "0", 1: "1", 2: "2", 0xFF: "all"}).get(pad)
            if key is None:
                continue
            # v3.3.11: store a timestamp on every event so _pad_colors_json
            # can resolve per-pad vs broadcast by recency rather than the
            # old "per-pad always wins" rule. This is what makes Locate
            # Keystone hints usable: game paints per-pad blue, later
            # broadcasts a reset colour - the reset must actually take
            # effect on the pads whose per-pad hint has expired.
            now = time.monotonic()
            if event_type == 0x01 and payload_len == 3:
                self.pad_colors[key] = (payload[0], payload[1], payload[2], "color", now)
                self._color_reader_stats["frames_parsed"] += 1
                self._color_reader_stats["last_frame_ts"] = time.time()
            elif event_type == 0x02 and payload_len == 6:
                # payload: on_ms, off_ms, count, r, g, b
                self.pad_colors[key] = (payload[3], payload[4], payload[5], "flash", now)
                self._color_reader_stats["frames_parsed"] += 1
                self._color_reader_stats["last_frame_ts"] = time.time()
            # Unknown types skipped silently.

    def _pad_colors_json(self):
        """Serialise pad_colors as a shape the frontends can render.

        v3.3.11: resolve per-pad vs broadcast by recency. Previously the
        rule was "per-pad always wins if it exists" which stranded stale
        hints - the game emits a per-pad Colour for a Locate Keystone
        target, then later broadcasts a reset (Colour All), but the reset
        was ignored on any pad that had ever received a per-pad command.

        Now each stored event carries a monotonic timestamp; for pads 0/1/2
        we return whichever of that pad's own event or the last broadcast
        happened more recently. The `all` key still exposes the raw
        broadcast for anything that wants to distinguish (e.g. the Setup
        diagnostic dots).
        """
        broadcast = self.pad_colors.get("all")

        def _shape(val):
            if val is None:
                return None
            r, g, b, kind, _ts = val
            return {"r": r, "g": g, "b": b,
                    "hex": "#%02x%02x%02x" % (r, g, b),
                    "kind": kind}

        def _resolve(pad_key):
            own = self.pad_colors.get(pad_key)
            if own is None:
                return broadcast
            if broadcast is None:
                return own
            # Both exist - pick the one with the larger timestamp.
            return own if own[4] >= broadcast[4] else broadcast

        return {
            "0": _shape(_resolve("0")),
            "1": _shape(_resolve("1")),
            "2": _shape(_resolve("2")),
            "all": _shape(broadcast),
        }

    # ---------------------------------------------------------------- config

    def _load_config(self):
        cfg = dict(DEFAULT_CONFIG)
        try:
            if CONFIG_FILE.is_file():
                cfg.update(json.loads(CONFIG_FILE.read_text()))
        except (OSError, ValueError) as exc:
            decky.logger.warning("Config unreadable, using defaults: %s", exc)
        return cfg

    def _save_config(self):
        try:
            CONFIG_FILE.write_text(json.dumps(self.config, indent=2))
            self._chown_deck(CONFIG_FILE)
        except OSError as exc:
            decky.logger.warning("Could not save config: %s", exc)

    def _log_setup(self, line):
        decky.logger.info("[setup] %s", line)
        try:
            with SETUP_LOG.open("a") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')}  {line}\n")
        except OSError:
            pass
    def _download_url_blocking(self, url, timeout=180):
        """Download an HTTPS payload using the host's trusted CA store.

        Decky/SteamOS Python environments can have an incomplete CA search
        path even though the operating system itself is correctly configured.
        Bazzite can expose the same mismatch when the plugin is running under
        Decky. Prefer the system curl client, which uses the host trust store,
        then fall back to urllib with explicit CA-bundle discovery. This keeps
        the downloader distro-neutral without disabling TLS verification.
        """
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https":
            raise ValueError("Refusing non-HTTPS download URL: %s" % url)

        errors = []
        tmp = WORK_DIR / (".download-%d-%d.tmp" % (os.getpid(), int(time.time() * 1000)))
        try:
            curl = shutil.which("curl")
            if curl:
                try:
                    proc = subprocess.run(
                        [
                            curl, "--fail", "--silent", "--show-error",
                            "--location", "--proto", "=https",
                            "--retry", "3", "--retry-delay", "1",
                            "--connect-timeout", "20",
                            "--max-time", str(int(timeout)),
                            "-A", "dimensions-toypad",
                            "-o", str(tmp), url,
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        timeout=timeout + 20,
                        check=False,
                    )
                    if proc.returncode == 0 and tmp.is_file() and tmp.stat().st_size:
                        blob = tmp.read_bytes()
                        self._log_setup(
                            "Downloaded %d KiB via system curl" % (len(blob) // 1024))
                        return blob
                    detail = proc.stderr.decode("utf-8", "replace").strip()
                    errors.append("curl: %s" % (detail or "exit %d" % proc.returncode))
                except Exception as exc:
                    errors.append("curl: %s" % exc)

            # Python's default CA lookup can be broken in a Decky virtualenv.
            # Try explicit CA bundles from the environment, Python's OpenSSL
            # defaults, common Linux locations, and certifi when available.
            cafiles = []
            env_cafile = os.environ.get("SSL_CERT_FILE")
            if env_cafile:
                cafiles.append(env_cafile)
            try:
                defaults = ssl.get_default_verify_paths()
                if defaults.cafile:
                    cafiles.append(defaults.cafile)
                if defaults.openssl_cafile:
                    cafiles.append(defaults.openssl_cafile)
            except Exception:
                pass
            cafiles.extend([
                "/etc/ssl/certs/ca-certificates.crt",
                "/etc/pki/tls/certs/ca-bundle.crt",
                "/etc/ssl/cert.pem",
            ])
            try:
                import certifi
                cafiles.append(certifi.where())
            except Exception:
                pass

            seen = set()
            for cafile in cafiles:
                if not cafile or cafile in seen or not os.path.isfile(cafile):
                    continue
                seen.add(cafile)
                try:
                    context = ssl.create_default_context(cafile=cafile)
                    req = urllib.request.Request(
                        url, headers={"User-Agent": "dimensions-toypad"})
                    with urllib.request.urlopen(
                            req, timeout=timeout, context=context) as resp:
                        blob = resp.read()
                    if blob:
                        self._log_setup(
                            "Downloaded %d KiB via Python CA bundle %s" %
                            (len(blob) // 1024, cafile))
                        return blob
                except Exception as exc:
                    errors.append("urllib/%s: %s" % (cafile, exc))

            raise RuntimeError(
                "Secure download failed. System TLS could not verify the "
                "LegoToypad server. " + " | ".join(errors[-4:]))
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass


    @staticmethod
    def _tag_stem(entry):
        """Per-figure working-copy name. Builds of the same vehicle share a
        display name, so the tier has to be in the filename or build 2 would
        inherit build 1's saved progress."""
        stem = "%s__%s" % (entry["franchise"], entry["name"])
        if entry.get("build", 1) > 1:
            stem += "__b%d" % entry["build"]
        return "".join(c if c.isalnum() or c in "-_ ." else "_" for c in stem)

    @staticmethod
    def _chown_deck(path):
        """Decky runs as root; keep anything we create owned by the Deck user."""
        try:
            import pwd
            info = pwd.getpwnam("deck")
            os.chown(str(path), info.pw_uid, info.pw_gid)
        except Exception:
            pass

    # ---------------------------------------------------------------- web

    def _web_assets_ready(self):
        """The phone remote is the upstream LegoToypad v1.5 web app.

        Do not report a working phone remote merely because the HTTP socket
        exists: a fresh AIO install must actually have the upstream Web UI and
        its artwork before the service is considered configured.
        """
        root = self._web_root()
        return bool(root and (root / "index.html").is_file()
                    and (root / "app.js").is_file()
                    and (root / "style.css").is_file())

    def _restart_web(self):
        self._stop_web()
        if self.config.get("webEnabled", True) and self._web_assets_ready():
            self._start_web()

    def _start_web(self):
        if self._httpd is not None:
            return
        if not self._web_assets_ready():
            decky.logger.info("Phone remote waiting for LegoToypad v1.5 Web/Assets payload")
            return
        port = int(self.config.get("webPort", 8781))
        _Handler.plugin = self
        try:
            self._httpd = _ThreadedHTTP(("0.0.0.0", port), _Handler)
        except OSError as exc:
            decky.logger.warning("Phone remote could not bind :%d - %s", port, exc)
            self._httpd = None
            return
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()
        decky.logger.info("Phone remote listening on 0.0.0.0:%d", port)

    def _stop_web(self):
        if self._httpd is None:
            return
        try:
            self._httpd.shutdown()
            self._httpd.server_close()
        except Exception:
            pass
        self._httpd = None

    @staticmethod
    def _lan_ip():
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("8.8.8.8", 80))
            ip = probe.getsockname()[0]
            probe.close()
            return ip
        except OSError:
            return ""

    # ---------------------------------------------------------------- library

    def _scan(self):
        """Index every 180-byte .bin under the first library path that exists.

        Folder names become franchise labels, which is how the upstream dumps
        are organised ("All Bin Files/Adventure Time/Characters/Finn.bin").
        """
        self.library = []
        self.library_root = None

        root = None
        for candidate in DEFAULT_LIBRARY_PATHS:
            if candidate.is_dir() and any(candidate.rglob("*.bin")):
                root = candidate
                break
        if root is None:
            decky.logger.warning("No tag library found. Looked in: %s",
                                 ", ".join(str(p) for p in DEFAULT_LIBRARY_PATHS))
            return

        self.library_root = str(root)
        entries = []
        for path in sorted(root.rglob("*.bin")):
            try:
                if path.stat().st_size != TAG_SIZE:
                    continue
            except OSError:
                continue

            rel = path.relative_to(root)
            parts = rel.parts
            franchise = parts[0] if len(parts) > 1 else "Uncategorised"
            # "Characters" / "Vehicles" / "Gadgets" subfolder, when present
            kind = parts[1] if len(parts) > 2 else ""
            # The upstream library spells this folder "Vehicules".
            if kind.lower().startswith("vehicul"):
                kind = "Vehicles"

            # Vehicle files carry their build tier as a numeric prefix:
            # "2. Quinn Ultra Racer" is that vehicle's second build. Strip it
            # for display and keep the number, the way v1.5 labels them.
            build = 1
            display = path.stem
            m = re.match(r"^(\d+)[.\-]\s*(.+)$", display)
            if m:
                build = int(m.group(1))
                display = m.group(2).strip()

            icon = None
            for ext in (".png", ".jpg"):
                candidate = path.with_suffix(ext)
                if candidate.is_file():
                    icon = str(candidate)
                    break

            entries.append({
                "id": len(entries),
                "name": display,
                "build": build,
                "franchise": franchise,
                "kind": kind,
                "path": str(path),
                "hasIcon": icon is not None,
                "_icon": icon,
            })

        entries.sort(key=lambda e: (e["franchise"].lower(),
                                    0 if e["kind"].lower().startswith("char") else 1,
                                    e["name"].lower(),
                                    e["build"]))
        for i, e in enumerate(entries):
            e["id"] = i
        self.library = entries
        self._build_assets()

    def _resolve_tag(self, entry):
        """Return (bytes_to_send, path_to_send).

        The working copy wins once it exists, so anything the game wrote to the
        tag is carried forward. Seeding from the source dump only happens on
        first use. Getting this backwards silently resets progress on every
        launch, with no error to explain why.
        """
        source = Path(entry["path"])
        working = TAG_CACHE / (self._tag_stem(entry) + ".bin")

        try:
            if working.is_file() and working.stat().st_size == TAG_SIZE:
                return working.read_bytes(), str(working)
        except OSError as exc:
            decky.logger.warning("Working tag unreadable (%s): %s", working, exc)
            return source.read_bytes(), ""

        try:
            data = source.read_bytes()
            if len(data) != TAG_SIZE:
                raise ValueError(f"{source} is {len(data)} bytes, expected {TAG_SIZE}")
            working.write_bytes(data)
            self._chown_deck(working)
            return data, str(working)
        except OSError as exc:
            decky.logger.warning("Could not seed working tag: %s", exc)
            return source.read_bytes(), ""

    # ---------------------------------------------------------------- transport

    async def _send(self, frame: bytes):
        async with self._lock:
            gap = COMMAND_GAP - (time.monotonic() - self.last_send)
            if gap > 0:
                await asyncio.sleep(gap)
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.host, self.port), timeout=3)
                writer.write(frame)
                await writer.drain()
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            except (ConnectionRefusedError, OSError, asyncio.TimeoutError) as exc:
                raise RuntimeError(
                    "Nothing listening on %s:%d. Start LEGO Dimensions and get "
                    "past the intro so the game attaches the toypad."
                    % (self.host, self.port)) from exc
            finally:
                self.last_send = time.monotonic()



    # ---------------------------------------------------------------- v1.5 web assets

    # Ring colours are reproduced from LegoToypad's generator so the phone UI
    # shows the same colour per figure as the desktop app: FNV-1a over the
    # resource name, golden-angle hue, HSV(h, 0.62, 0.96).
    @staticmethod
    def _sanitize(component):
        out = re.sub(r"[^A-Za-z0-9]+", "_", component.upper()).strip("_")
        return re.sub(r"_+", "_", out) or "EMPTY"

    @staticmethod
    def _fnv1a(value):
        h = 0x811C9DC5
        for byte in value.encode("ascii", "ignore"):
            h ^= byte
            h = (h * 0x01000193) & 0xFFFFFFFF
        return h

    @classmethod
    def _ring_colour(cls, resource_name):
        h = cls._fnv1a(resource_name)
        hue = ((h & 0xFFFFFFFF) / 4294967296.0 * 0.6180339887498949 % 1.0) * 360.0
        c, v, sat = 0.0, 0.96, 0.62
        c = v * sat
        x = c * (1 - abs((hue / 60.0) % 2 - 1))
        m = v - c
        if hue < 60:    r, g, b = c, x, 0
        elif hue < 120: r, g, b = x, c, 0
        elif hue < 180: r, g, b = 0, c, x
        elif hue < 240: r, g, b = 0, x, c
        elif hue < 300: r, g, b = x, 0, c
        else:           r, g, b = c, 0, x
        return "#%02X%02X%02X" % (round((r + m) * 255), round((g + m) * 255),
                                  round((b + m) * 255))

    def _resource_name(self, entry):
        world = self._sanitize(entry["franchise"])
        if entry["kind"].lower().startswith("char"):
            return "WORLD_%s_CHAR_%s_PNG" % (world, self._sanitize(entry["name"]))
        return "WORLD_%s_VEH_%s_%d_PNG" % (world, self._sanitize(entry["name"]),
                                           entry.get("build", 1))

    def _register(self, path):
        """Give a file a stable numeric id for /img/<id>."""
        if path is None:
            return 0
        key = str(path)
        if key in self._asset_ids:
            return self._asset_ids[key]
        new_id = len(self._asset_paths) + 1
        self._asset_ids[key] = new_id
        self._asset_paths[new_id] = key
        return new_id

    def _first(self, *candidates):
        for c in candidates:
            p = Path(c)
            if p.is_file():
                return p
        return None

    def _build_assets(self):
        """Index the UI artwork the v1.5 phone UI asks for by URL."""
        self._asset_ids = {}
        self._asset_paths = {}

        a = self._asset_root()
        self.ui = {
            "wordmark": self._register(self._first(a / "Branding" / "Lego_Toypad_Wordmark.png")),
            "byMark": self._register(self._first(a / "Branding" / "by_harrysof.png")),
            "logo": self._register(self._first(a / "Branding" / "Legotoypad_Logo.png")),
            "yButton": self._register(self._first(a / "Buttons" / "Y_button.png")),
            "settingsText": self._register(self._first(a / "Buttons" / "Settings_text.png")),
            "loadBtn": self._register(self._first(a / "Buttons" / "load.png")),
            "clearBtn": self._register(self._first(a / "Buttons" / "clear.png")),
            "moveBtn": self._register(self._first(a / "Buttons" / "move.png")),
            "scrollBar": self._register(self._first(a / "Buttons" / "Scroll_Bar.png")),
            "worldTile": self._register(self._first(a / "Tiles" / "world_tile.png")),
            "charactersTile": self._register(self._first(a / "Tiles" / "characters_tile.png")),
        }

        pad_files = ["left_upper.png", "Center.png", "right_upper.png",
                     "left_lower_left.png", "left_lower_right.png",
                     "right_lower_left.png", "right_lower_right.png"]
        self.ui["pads"] = [self._register(self._first(a / "Pads" / f)) for f in pad_files]

        walls = sorted((a / "Wallpapers").glob("*.png")) if (a / "Wallpapers").is_dir() else []
        self.ui["background"] = self._register(walls[0]) if walls else 0

        font = self._first(a / "Fonts" / "Compacta Regular.woff2",
                           WEB_ROOT / "InterVariable.woff2")
        self.ui["font"] = self._register(font)

        # Franchise logos live beside the tags.
        self.logos = {}
        if self.library_root:
            root = Path(self.library_root)
            for entry in self.library:
                fr = entry["franchise"]
                if fr in self.logos:
                    continue
                logo_dir = root / fr / "Logo"
                found = None
                if logo_dir.is_dir():
                    pics = sorted(logo_dir.glob("*.png"))
                    found = pics[0] if pics else None
                self.logos[fr] = self._register(found)

        # Portraits, and the ring colour that goes with each.
        for entry in self.library:
            entry["_portraitId"] = self._register(
                Path(entry["_icon"]) if entry["_icon"] else None)
            entry["_colour"] = self._ring_colour(self._resource_name(entry))

    def _img_url(self, resource_id):
        return "/img/%d" % (resource_id or 0)

    def asset_path(self, resource_id):
        return self._asset_paths.get(int(resource_id))

    def web_file(self, name):
        """A file from the v1.5 Web/ folder, wherever it lives."""
        if "/" in name or "\\" in name or ".." in name:
            return None
        for root in EXTRA_WEB_ROOTS:
            p = root / name
            if p.is_file():
                return p
        return None

    @staticmethod
    def _asset_root():
        for root in EXTRA_ASSET_ROOTS:
            if root.is_dir():
                return root
        return ASSET_ROOT

    @staticmethod
    def _web_root():
        """First writable/populated Web/ dir. Mirrors _asset_root but for the
        LegoToypad v1.5 phone UI (index.html, app.js, style.css)."""
        for root in EXTRA_WEB_ROOTS:
            if root.is_dir():
                return root
        return WEB_ROOT

    def catalog_json(self):
        """The catalog in LegoToypad v1.5's own shape, so its web UI runs
        unmodified against this plugin."""
        franchises = []
        by_fr = {}
        for e in self.library:
            by_fr.setdefault(e["franchise"], []).append(e)

        for name in sorted(by_fr):
            chars, veh_groups = [], {}
            for e in by_fr[name]:
                item = {
                    "name": e["name"],
                    "build": e.get("build", 1),
                    "color": e["_colour"],
                    "portrait": self._img_url(e["_portraitId"]),
                    "bin": e["id"],
                }
                if e["kind"].lower().startswith("char"):
                    chars.append(item)
                else:
                    veh_groups.setdefault(e["name"].casefold(),
                                          {"base": e["name"], "builds": []})
                    veh_groups[e["name"].casefold()]["builds"].append(item)

            vehicles = []
            for key in sorted(veh_groups):
                group = veh_groups[key]
                group["builds"].sort(key=lambda x: x["build"])
                vehicles.append(group)

            franchises.append({
                "name": name,
                "logo": self._img_url(self.logos.get(name, 0)),
                "characters": chars,
                "vehicles": vehicles,
            })

        # v3.3.8: synthetic "Starters" franchise, injected at the top so the
        # first thing a new user sees on the phone remote is Batman + Gandalf
        # + Wyldstyle and their vehicles. It reuses the exact same shape as a
        # real franchise so the LegoToypad v1.5 web UI renders it without any
        # frontend changes. Entries are pulled from the user's actual library
        # (looked up against STARTERS_ROSTER); missing tag names are silently
        # skipped, so users on partial libraries still get whatever's present.
        starter_chars, starter_veh_groups = [], {}
        seen_starter_ids = set()
        starter_names = {(f.lower(), n.lower()) for f, n in STARTERS_ROSTER}
        for e in self.library:
            key = (e["franchise"].lower(), e["name"].lower())
            if key not in starter_names:
                continue
            if e["id"] in seen_starter_ids:
                continue
            seen_starter_ids.add(e["id"])
            item = {
                "name": e["name"],
                "build": e.get("build", 1),
                "color": e["_colour"],
                "portrait": self._img_url(e["_portraitId"]),
                "bin": e["id"],
            }
            if e["kind"].lower().startswith("char"):
                starter_chars.append(item)
            else:
                starter_veh_groups.setdefault(e["name"].casefold(),
                                              {"base": e["name"], "builds": []})
                starter_veh_groups[e["name"].casefold()]["builds"].append(item)
        starter_vehicles = []
        for k in sorted(starter_veh_groups):
            grp = starter_veh_groups[k]
            grp["builds"].sort(key=lambda x: x["build"])
            starter_vehicles.append(grp)
        if starter_chars or starter_vehicles:
            franchises.insert(0, {
                "name": "Starters",
                "logo": self._img_url(0),  # no dedicated logo; UI shows text
                "characters": starter_chars,
                "vehicles": starter_vehicles,
            })

        return {
            "appName": "LEGO Dimensions Toypad",
            "version": "1.5.0",
            "listenerPort": self.port,
            "wordmark": self._img_url(self.ui["wordmark"]),
            "byMark": self._img_url(self.ui["byMark"]),
            "background": self._img_url(self.ui["background"]),
            "fontUrl": self._img_url(self.ui["font"]),
            "yButton": self._img_url(self.ui["yButton"]),
            "settingsText": self._img_url(self.ui["settingsText"]),
            "worldTile": self._img_url(self.ui["worldTile"]),
            "charactersTile": self._img_url(self.ui["charactersTile"]),
            "loadBtn": self._img_url(self.ui["loadBtn"]),
            "clearBtn": self._img_url(self.ui["clearBtn"]),
            "moveBtn": self._img_url(self.ui["moveBtn"]),
            "scrollBar": self._img_url(self.ui["scrollBar"]),
            "pads": [self._img_url(p) for p in self.ui["pads"]],
            "franchises": franchises,
        }

    def state_json(self):
        pads = []
        # v3.3.8: broadcast LED colour applies to every slot; per-pad
        # overrides. Both come from the patched emulator via the colour
        # reader task.
        pc = self._pad_colors_json()
        broadcast = pc.get("all")
        for i, s in enumerate(SLOTS):
            occ = self.pads[i]
            entry = self.library[occ["figure"]] if occ else None
            # Map the SLOTS pad label ("centre"/"left"/"right") to the
            # 0/1/2 keys the colour reader uses.
            pad_key = {"centre": "0", "center": "0",
                       "left": "1", "right": "2"}.get(str(s["pad"]).lower())
            led = pc.get(pad_key) or broadcast
            # LegoToypad v1.5's phone UI reads `.color` per pad and uses
            # it verbatim for the halo. When we have a live LED colour
            # from the game (Chroma Keystone, Locate Keystone, attack
            # scenes), override `.color` so the phone halo mirrors the
            # real toypad's LED without any phone-side JS change. The
            # figure's own aesthetic colour is preserved in `tagColor`
            # for any future client that wants it separately.
            tag_color = entry["_colour"] if entry else "#000000"
            display_color = led["hex"] if led else tag_color
            pads.append({
                "index": i,
                "pad": s["pad"],
                "label": s["label"],
                "occupied": bool(occ),
                "name": (occ["name"] + (" \u00b7 Build %d" % occ["build"]
                                        if occ.get("build", 1) > 1 else "")) if occ else "",
                "color": display_color,
                "tagColor": tag_color,
                "portrait": self._img_url(entry["_portraitId"]) if entry else self._img_url(0),
                "ledColor": led,
            })
        return {
            "background": self._img_url(self.ui["background"]),
            "pads": pads,
            "status": self.status,
            "padColors": pc,
        }


    # ---------------------------------------------------------------- 60 fps

    def _rpcs3_config_files(self):
        """Every RPCS3 config that could govern this game.

        RPCS3 uses a per-game custom config when one exists, and it takes
        precedence over the global one completely. Writing only the global
        config - which is what the first version of this did - silently does
        nothing for anyone who set the game to Network: Disconnected, because
        that act creates a custom config.
        """
        base = HOME / ".config" / "rpcs3"
        out = []
        # Only touch the global config and LEGO Dimensions' own custom config.
        # Do not silently change unrelated PS3 titles.
        glob = base / "config.yml"
        if glob.is_file():
            out.append(glob)
        custom = base / "custom_configs"
        for name in ("config_BLES02105.yml", "config_bles02105.yml"):
            candidate = custom / name
            if candidate.is_file() and candidate not in out:
                out.append(candidate)
        return out

    @staticmethod
    def _yaml_set(raw, section, key, value):
        """Set `key` under `section` in RPCS3's config, adding either if absent."""
        pattern = re.compile(r"^(\s*%s:\s*).*$" % re.escape(key), re.MULTILINE)
        if pattern.search(raw):
            return pattern.sub(lambda m: m.group(1) + str(value), raw, count=1), True
        sec = re.compile(r"^%s:\s*$" % re.escape(section), re.MULTILINE)
        m = sec.search(raw)
        if m:
            insert = "\n  %s: %s" % (key, value)
            return raw[:m.end()] + insert + raw[m.end():], True
        return raw.rstrip("\n") + "\n%s:\n  %s: %s\n" % (section, key, value), True

    async def set_sixty_fps(self, enable: bool):
        """Raise RPCS3's vblank rate, which is what unlocks a 30 fps cap."""
        targets = self._rpcs3_config_files()
        if not targets:
            return {"ok": False,
                    "error": "No RPCS3 config yet. Run the emulator once."}

        want = 120 if enable else 60
        touched = []
        try:
            for cfg in targets:
                raw = cfg.read_text()
                backup = cfg.with_suffix(".yml.bak-toypad")
                if not backup.exists():
                    backup.write_text(raw)
                raw, _ = self._yaml_set(raw, "Video", "Vblank Rate", want)
                raw, _ = self._yaml_set(raw, "Video", "Aspect ratio", "16:9")
                raw, _ = self._yaml_set(raw, "Video", "Resolution", "1280x720")
                raw, _ = self._yaml_set(raw, "Video", "Frame limit", "60" if enable else "Auto")
                raw, _ = self._yaml_set(raw, "Miscellaneous",
                                        "Start games in fullscreen mode", "true")
                cfg.write_text(raw)
                self._chown_deck(cfg)
                touched.append(cfg.name)
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

        self._log_setup("VBlank Rate -> %d in %s" % (want, ", ".join(touched)))
        return {"ok": True,
                "message": ("60 fps unlocked in %s. If cutscenes run fast, turn "
                            "this back off." % ", ".join(touched)) if enable
                           else "Back to the stock 60Hz vblank (%s)"
                                % ", ".join(touched)}

    async def set_fullscreen(self, enable: bool = True):
        """Make RPCS3 start the game fullscreen.

        With --no-gui and this off, RPCS3 opens a small window, which in Game
        Mode gamescope then centres on a black field - the "windowed and
        shrunken" launch.
        """
        targets = self._rpcs3_config_files()
        if not targets:
            return {"ok": False, "error": "No RPCS3 config yet. Run it once."}
        touched = []
        try:
            for cfg in targets:
                raw = cfg.read_text()
                backup = cfg.with_suffix(".yml.bak-toypad")
                if not backup.exists():
                    backup.write_text(raw)
                raw, _ = self._yaml_set(raw, "Miscellaneous",
                                        "Start games in fullscreen mode",
                                        "true" if enable else "false")
                raw, _ = self._yaml_set(raw, "Video", "Aspect ratio", "16:9")
                raw, _ = self._yaml_set(raw, "Video", "Resolution", "1280x720")
                cfg.write_text(raw)
                self._chown_deck(cfg)
                touched.append(cfg.name)
        except OSError as exc:
            return {"ok": False, "error": str(exc)}
        self._log_setup("Fullscreen -> %s in %s" % (enable, ", ".join(touched)))
        return {"ok": True,
                "message": "Fullscreen %s in %s"
                           % ("on" if enable else "off", ", ".join(touched))}

    async def get_sixty_fps(self):
        supported = True
        enabled = False
        fullscreen = False
        vblank_rate = 60
        for cfg in self._rpcs3_config_files():
            try:
                raw = cfg.read_text()
            except OSError:
                continue
            m = re.search(r"Vblank Rate:\s*(\d+)", raw, re.IGNORECASE)
            if m:
                vblank_rate = int(m.group(1))
                if vblank_rate > 60:
                    enabled = True
            if re.search(r"Start games in fullscreen mode:\s*true", raw):
                fullscreen = True
        return {"supported": supported, "enabled": enabled,
                "fullscreen": fullscreen, "vblankRate": vblank_rate,
                "frameLimit": "60" if enabled else "Auto"}

    # ---------------------------------------------------------------- launching

    async def launch_emulator_gui(self):
        """Open the selected emulator's own interface.

        Decky's backend runs as root with no session environment, so a GUI
        process spawned from here has no display to draw on. Hand it the deck
        user's session explicitly. In Game Mode there is no desktop for it to
        appear on at all, which is worth saying rather than looking broken.
        """
        import subprocess
        cmd = self._launch_command()
        if not cmd:
            return {"ok": False, "error": "No patched RPCS3 found."}

        env = dict(os.environ)
        env.setdefault("XDG_RUNTIME_DIR", "/run/user/1000")
        env.setdefault("HOME", str(HOME))
        env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
        if "WAYLAND_DISPLAY" not in env and "DISPLAY" not in env:
            # Desktop Mode's session; harmless if it isn't the live one.
            env["DISPLAY"] = ":0"

        # Drop to the deck user so config files stay owned correctly.
        argv = ["sudo", "-u", "deck", "-E"] + cmd if os.geteuid() == 0 else cmd

        try:
            subprocess.Popen(argv, env=env, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

        gamemode = not env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY")
        return {"ok": True,
                "message": "RPCS3 starting. In Game Mode there's no desktop "
                           "for it to appear on - switch to Desktop Mode for "
                           "the emulator's own interface."}

    # ---------------------------------------------------------------- bundled RPCS3 runtime

    # Verification is expensive - full SHA256 of a 175MB file plus `--version`
    # on an AppImage that must extract its squashfs first. Both must run off
    # the asyncio event loop, and both are cached to disk so panel opens after
    # the first install are instant.
    def _verify_cache_path(self):
        return WORK_DIR / "rpcs3-verify.json"

    def _verify_cache_key(self, path):
        try:
            st = path.stat()
            return "%d|%d" % (st.st_size, st.st_mtime_ns)
        except OSError:
            return ""

    def _load_verify_cache(self):
        try:
            data = json.loads(self._verify_cache_path().read_text())
            if isinstance(data, dict):
                return data
        except (OSError, ValueError):
            pass
        return {}

    def _save_verify_cache(self, data):
        try:
            path = self._verify_cache_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2))
            self._chown_deck(path)
        except OSError:
            pass

    def _bundled_rpcs3_meta(self):
        """Cheap: exists, executable, size. No hashing, no subprocess. Safe on
        the event loop and safe to call every panel poll."""
        info = {"path": str(BUNDLED_RPCS3), "exists": BUNDLED_RPCS3.is_file(),
                "executable": False, "sha256": "", "version": "unknown",
                "verified": False}
        if not info["exists"]:
            return info
        # Chmod is a metadata op - cheap - and lets a freshly extracted zip
        # become launchable without a separate ceremony.
        try:
            BUNDLED_RPCS3.chmod(0o755)
        except OSError:
            pass
        info["executable"] = os.access(BUNDLED_RPCS3, os.X_OK)

        # Read whatever we already verified for this exact file. Cache is keyed
        # by size + mtime so a replaced AppImage forces a re-verify.
        key = self._verify_cache_key(BUNDLED_RPCS3)
        cached = self._load_verify_cache().get(key)
        if cached:
            info["sha256"] = cached.get("sha256", "")
            info["version"] = cached.get("version", "unknown")
            info["verified"] = info["sha256"].lower() == BUNDLED_RPCS3_SHA256
        return info

    def _bundled_rpcs3_verify_blocking(self):
        """Heavy: SHA256 + --version. Runs in a thread; result is persisted so
        this only executes on first install and after AppImage replacement."""
        import hashlib, subprocess
        info = self._bundled_rpcs3_meta()
        if not info["exists"]:
            return info
        key = self._verify_cache_key(BUNDLED_RPCS3)
        try:
            h = hashlib.sha256()
            with BUNDLED_RPCS3.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            info["sha256"] = h.hexdigest()
        except OSError:
            return info
        # Extract-and-run avoids FUSE issues in the container; the extracted
        # tree is reused on subsequent launches, so the cost lands only once.
        try:
            env = dict(os.environ)
            env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
            env["QT_QPA_PLATFORM"] = "offscreen"
            # Generous timeout because first-run extraction of a 175MB squashfs
            # on Deck internal storage regularly exceeds 30s.
            proc = subprocess.run([str(BUNDLED_RPCS3), "--version"],
                                  capture_output=True, text=True,
                                  timeout=180, env=env)
            # RPCS3 prints its version to stdout. When stdout is empty it's
            # usually because the AppImage's wrapper shell hit a readline/glibc
            # symbol mismatch on the host - noisy on stderr, harmless for
            # actual RPCS3 execution, and not something a user should see in
            # the panel. Fall through to a neutral label instead of surfacing
            # that noise as a "version".
            def _looks_like_version(line):
                s = line.strip()
                if not s:
                    return False
                low = s.lower()
                if "symbol lookup error" in low or "undefined symbol" in low:
                    return False
                if s.startswith("/bin/") or s.startswith("bash:") or s.startswith("sh:"):
                    return False
                return True

            out = [x.strip()
                   for x in ((proc.stdout or "") + "\n" + (proc.stderr or "")).splitlines()
                   if _looks_like_version(x)]
            if out:
                info["version"] = next((x for x in out if x.startswith("RPCS3 ")), out[-1])
            else:
                # No usable version string, but the binary still runs. Report a
                # clean fallback so the panel doesn't display shell error text.
                info["version"] = "RPCS3 (bundled, version string unavailable)"
        except subprocess.TimeoutExpired:
            info["version"] = "unavailable: timed out"
        except Exception as exc:
            info["version"] = "unavailable: %s" % exc
        info["verified"] = info["sha256"].lower() == BUNDLED_RPCS3_SHA256

        cache = self._load_verify_cache()
        cache[key] = {"sha256": info["sha256"], "version": info["version"]}
        # One entry per file identity; older ones are dead weight.
        if len(cache) > 8:
            cache = {key: cache[key]}
        self._save_verify_cache(cache)
        return info

    async def _bundled_rpcs3_verify(self):
        """Async wrapper: returns cached verify if available, otherwise runs
        the heavy check in a thread. Multiple concurrent callers share one run."""
        info = self._bundled_rpcs3_meta()
        if info["verified"] or not info["exists"]:
            return info
        # Coalesce: if a verify is already in flight, await the same future.
        if self._verify_task is None or self._verify_task.done():
            self._verify_task = self.loop.run_in_executor(
                None, self._bundled_rpcs3_verify_blocking)
        try:
            return await self._verify_task
        except Exception as exc:
            info["version"] = "unavailable: %s" % exc
            return info

    def _bundled_rpcs3_info(self):
        """Legacy shape kept for anywhere still calling it. Returns whatever
        the cheap check knows - never blocks."""
        return self._bundled_rpcs3_meta()

    def _rpcs3_binary(self):
        """Return only the AIO-bundled AppImage. Never discover another RPCS3."""
        return BUNDLED_RPCS3 if BUNDLED_RPCS3.is_file() else None

    def _rpcs3_is_managed(self):
        return BUNDLED_RPCS3.is_file()

    def _launch_command(self):
        if not BUNDLED_RPCS3.is_file():
            return []
        try:
            BUNDLED_RPCS3.chmod(0o755)
        except OSError:
            pass
        return [str(BUNDLED_RPCS3)] if os.access(BUNDLED_RPCS3, os.X_OK) else []

    async def _install_bundled_rpcs3(self):
        if not BUNDLED_RPCS3.is_file():
            return {"ok": False, "error": "Bundled RPCS3 AppImage is missing. Expected: %s" % BUNDLED_RPCS3}
        try:
            BUNDLED_RPCS3.chmod(0o755)
        except OSError:
            pass
        if not os.access(BUNDLED_RPCS3, os.X_OK):
            return {"ok": False, "error": "Bundled RPCS3 AppImage is not executable: %s" % BUNDLED_RPCS3}
        # The heavy work happens in a thread. First call after a fresh install
        # can take a minute or two while the AppImage extracts; subsequent
        # calls hit the disk cache and return instantly.
        info = await self._bundled_rpcs3_verify()
        if info["sha256"].lower() != BUNDLED_RPCS3_SHA256:
            return {"ok": False,
                    "error": "Bundled RPCS3 checksum mismatch; refusing to run it. Got: %s" % info["sha256"]}
        # Bust the cached setup_status so the panel sees the new state at once.
        self._setup_status_cache = None
        return {"ok": True, "message": "Bundled RPCS3 verified: %s" % BUNDLED_RPCS3}

    async def check_rpcs3_release(self):
        info = self._bundled_rpcs3_meta()
        if not info["exists"]:
            return {"ok": False, "error": "Bundled RPCS3 AppImage is missing. Expected: %s" % BUNDLED_RPCS3}
        # If we haven't verified this exact file yet, do it now. This is what
        # the user pressed the button to trigger, so awaiting is correct.
        if not info["verified"]:
            info = await self._bundled_rpcs3_verify()
        if info["sha256"].lower() != BUNDLED_RPCS3_SHA256:
            return {"ok": False, "error": "Bundled RPCS3 checksum mismatch; refusing to use it."}
        return {"ok": True, "version": BUNDLED_RPCS3_VERSION, "sizeMB": BUNDLED_RPCS3.stat().st_size // (1 << 20),
                "notes": "Bundled, Deck-tested RPCS3 Toypad AppImage.", "path": info["path"],
                "sha256": info["sha256"], "executable": info["executable"], "runtimeVersion": info["version"]}

    async def install_rpcs3(self):
        if self._busy:
            return {"ok": False, "error": "Already " + self._busy}
        self._busy = "verifying bundled RPCS3"
        try:
            return await self._install_bundled_rpcs3()
        finally:
            self._busy = ""

    async def install_launcher(self):
        """Write the Steam/Game Mode launcher pair using only the bundled AppImage."""
        cmd = self._launch_command()
        if not cmd:
            return {"ok": False, "error": "Bundled RPCS3 AppImage is missing or not executable. Expected: " + str(BUNDLED_RPCS3)}
        app = str(BUNDLED_RPCS3)
        games = str(self.config.get("gamePath", ""))
        run_script = r'''#!/bin/bash
# Generated by Dimensions Toypad AIO. This is the only RPCS3 runtime.
set -u
RPCS3="__APP__"
GAMES="__GAMES__"
if [ ! -f "$RPCS3" ]; then echo "ERROR: bundled RPCS3 AppImage is missing: $RPCS3" >&2; exit 1; fi
chmod +x "$RPCS3" 2>/dev/null || true
if [ ! -x "$RPCS3" ]; then echo "ERROR: bundled RPCS3 AppImage is not executable: $RPCS3" >&2; exit 1; fi
GAME=$(find "$GAMES" -ipath '*PS3_GAME/USRDIR/EBOOT.BIN' -print -quit 2>/dev/null)
[ -z "$GAME" ] && GAME=$(find "$GAMES" -iname 'EBOOT.BIN' -print -quit 2>/dev/null)
export APPIMAGE_EXTRACT_AND_RUN=1
if [ -z "$GAME" ]; then echo "No EBOOT.BIN under $GAMES - showing bundled RPCS3 game list."; exec "$RPCS3"; fi
echo "RPCS3 bundled AppImage: $RPCS3"
echo "Game: $GAME"
# RPCS3's AppImage is launched directly into the game. Keep --no-gui
# BEFORE the EBOOT path; this is the canonical RPCS3 CLI form used by
# Steam/EmuDeck-style shortcuts and prevents the RPCS3 manager window
# from becoming the Steam shortcut's visible application.
# In Steam Gaming Mode, Gamescope provides XWayland; the bundled AppImage
# is intentionally forced onto XCB because this AppImage's native Wayland
# Qt path is not reliable on SteamOS/Bazzite.
export QT_QPA_PLATFORM=xcb
exec "$RPCS3" --no-gui "$GAME"
'''.replace("__APP__", app).replace("__GAMES__", games)
        play_script = r'''#!/bin/bash
# Generated by Dimensions Toypad AIO. Steam/Game Mode entry point.
set -u
RUN_BOTH="$HOME/toypad/run-both.sh"
if [ ! -x "$RUN_BOTH" ]; then echo "ERROR: launcher component missing: $RUN_BOTH" >&2; exit 1; fi
# When Steam Game Mode launches this, we are ALREADY inside gamescope - it is
# Steam's own compositor. Nesting another gamescope leaves RPCS3's Vulkan
# swapchain unhooked by the outer one and triggers the "Creating swapchain
# for non-Gamescope swapchain / Hooking has failed somewhere" dialog. The
# right thing is to detect the outer gamescope and just exec the runner.
#
# Detection: Steam sets GAMESCOPE_WAYLAND_DISPLAY (and various SteamOS-specific
# vars) when running inside gamescope. Fall back to a general xdg check so
# Desktop Mode users still get a wrapping gamescope when there isn't one.
in_gamescope() {
    [ -n "${GAMESCOPE_WAYLAND_DISPLAY:-}" ] && return 0
    [ "${XDG_CURRENT_DESKTOP:-}" = "gamescope" ] && return 0
    [ "${XDG_SESSION_DESKTOP:-}" = "gamescope" ] && return 0
    [ "${DESKTOP_SESSION:-}" = "gamescope" ] && return 0
    [ -n "${STEAM_GAMESCOPE:-}" ] && return 0

    # Environment variables are not identical on SteamOS and Bazzite. Walk
    # the process tree as a second, distro-neutral indication that Steam has
    # already placed us inside its Gamescope session. This prevents the old
    # failure mode where a Game Mode shortcut accidentally nested Gamescope.
    pid=$$
    i=0
    while [ "$i" -lt 12 ] && [ -r "/proc/$pid/stat" ]; do
        ppid=$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || echo 1)
        [ "$ppid" = "1" ] && break
        if [ -r "/proc/$ppid/cmdline" ]; then
            cmd=$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)
            case "$cmd" in
                *gamescope-session*|*gamescope*) return 0 ;;
            esac
        fi
        pid="$ppid"
        i=$((i + 1))
    done
    return 1
}
if in_gamescope; then
    exec "$RUN_BOTH"
fi
if command -v gamescope >/dev/null 2>&1; then
    exec gamescope -w 1280 -h 720 -f -- "$RUN_BOTH"
fi
exec "$RUN_BOTH"
'''
        try:
            LAUNCHER.parent.mkdir(parents=True, exist_ok=True)
            RUN_BOTH.write_text(run_script); RUN_BOTH.chmod(0o755); self._chown_deck(RUN_BOTH)
            LAUNCHER.write_text(play_script); LAUNCHER.chmod(0o755); self._chown_deck(LAUNCHER); self._chown_deck(LAUNCHER.parent)
            self._log_setup("Wrote Game Mode chain: %s -> %s -> %s" % (LAUNCHER, RUN_BOTH, BUNDLED_RPCS3))
            return {"ok": True, "message": "Steam launcher uses bundled RPCS3 via play-dimensions.sh -> run-both.sh"}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    async def set_rpcs3_path(self, command: str):
        return {"ok": False, "error": "Manual RPCS3 paths are disabled. This AIO uses only the bundled AppImage: " + str(BUNDLED_RPCS3)}

    async def reset_paths(self):
        self.config["rpcs3Path"] = ""
        self._save_config()
        return {"ok": True, "message": "Bundled RPCS3 remains authoritative; no alternate path is configured."}

    async def run_setup(self):
        """Do every setup step that can be automated, in order, for whichever
        emulator is selected. Each step reports for itself and a failure stops
        the chain rather than pressing on into a broken state."""
        if self._busy:
            return {"ok": False, "error": "Already " + self._busy}

        steps = []

        def note(label, ok, detail=""):
            steps.append({"label": label, "ok": bool(ok), "detail": detail})

        # 1. The exact AppImage shipped inside the AIO. No fallback is permitted.
        res = await self._install_bundled_rpcs3()
        note("Bundled RPCS3", res.get("ok"), res.get("message") or res.get("error", ""))
        if not res.get("ok"):
            return {"ok": False, "steps": steps, "error": res.get("error", "Bundled RPCS3 unavailable.")}

        # 2. Tags + the v1.5 phone WebUI assets. Preserve an existing tag
        # library, but repair a missing Web/Assets payload so the phone remote
        # does not regress after an AIO install/update.
        if self.library:
            # Existing tags are preserved. Web/Assets are repaired separately
            # from the same upstream LegoToypad v1.5 source so setup never
            # replaces a user's working tag library merely to restore the phone UI.
            note("Tag library", True, "%d tags" % len(self.library))
            webres = await self.repair_web_assets()
            note("Phone WebUI", webres.get("ok"),
                 webres.get("message") or webres.get("error", ""))
            if not webres.get("ok"):
                return {"ok": False, "steps": steps,
                        "error": webres.get("error", "Phone WebUI setup failed.")}
        else:
            # Fresh AIO install: this downloads the upstream tag library AND
            # its exact v1.5 Web/Assets payload automatically.
            res = await self.install_tags(confirm=True)
            note("Tag/WebUI library", res.get("ok"),
                 res.get("message") or res.get("error", ""))
            if not res.get("ok"):
                return {"ok": False, "steps": steps,
                        "error": "Could not install the tag library and phone WebUI."}

        # 4. The game dump - we can only report on this one.
        status = await self.setup_status()
        note("Game dump", status["gameOk"],
             status["gamePath"] or ("No EBOOT.BIN under %s" % status["gameRoot"]))

        # 5. Launcher.
        res = await self.install_launcher()
        note("Steam launcher", res.get("ok"),
             res.get("message") or res.get("error", ""))

        ok = all(s["ok"] for s in steps)
        return {"ok": ok, "steps": steps,
                "message": ("Ready - add the shortcut to Steam and launch."
                            if ok else
                            "Setup ran, but some steps need you.")}

    def _discover_game(self):
        """Find an existing extracted PS3 game without requiring a hard-coded path.

        User-owned game files may live in common Deck/EmuDeck locations or on a
        mounted storage device. We only discover EBOOT.BIN; we never download or
        manufacture game content.
        """
        configured = Path(self.config.get("gamePath", ""))
        roots = []
        if configured.is_dir():
            roots.append(configured)
        for root in (HOME / "lego" / "game", HOME / "lego", HOME / "Games",
                     HOME / "games", HOME / "Emulation" / "roms" / "ps3",
                     HOME / "Emulation" / "roms" / "PS3",
                     HOME / "Downloads"):
            if root.is_dir() and root not in roots:
                roots.append(root)
        # Avoid walking the whole home directory. External storage is picked up
        # when the user explicitly sets gamePath from the UI.
        for root in roots:
            try:
                for base, dirs, files in os.walk(root):
                    depth = len(Path(base).relative_to(root).parts)
                    if depth >= 5:
                        dirs[:] = []
                    for name in files:
                        if name.upper() == "EBOOT.BIN":
                            found = Path(base) / name
                            self.config["gamePath"] = str(found.parent.parent.parent if (Path(base).name.upper() == "USRDIR") else root)
                            self._save_config()
                            return str(found)
            except (OSError, ValueError):
                continue
        return ""

    def _discover_game_cached(self):
        """5-minute TTL wrapper around _discover_game. The walk into
        Downloads/ etc. is slow enough that letting Decky's 2-second poll
        trigger it would drag every panel open."""
        path, at = self._game_cache
        if path and time.monotonic() - at < 300.0:
            configured = Path(path)
            if configured.is_file():
                return path
        found = self._discover_game()
        self._game_cache = (found, time.monotonic())
        return found

    async def setup_status(self):
        # Polled every couple of seconds by Decky, so everything on this path
        # must be O(cheap). Heavy work (SHA256, `--version`, deep filesystem
        # scan) happens elsewhere and lands here through cached results.
        now = time.monotonic()
        if self._setup_status_cache is not None and now - self._setup_status_cache_at < 5.0:
            return dict(self._setup_status_cache)
        info = self._bundled_rpcs3_meta()

        # If the AppImage is present but not yet verified, kick off the check
        # in the background so a later poll sees it green without the user
        # having to press anything. The current response is not blocked on it.
        if info["exists"] and not info["verified"]:
            if self._verify_task is None or self._verify_task.done():
                try:
                    self._verify_task = self.loop.run_in_executor(
                        None, self._bundled_rpcs3_verify_blocking)
                except Exception:
                    pass

        listener = False
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=1)
            writer.close()
            listener = True
        except Exception:
            pass
        game = self._discover_game_cached()
        game_root = Path(self.config.get("gamePath", ""))
        if not game and game_root.is_file() and game_root.name.upper() == "EBOOT.BIN":
            game = str(game_root)
        port = int(self.config.get("webPort", 8781))
        ip = self._lan_ip()
        # Executable + correct hash is the bar for "usable". Version string is
        # informational; the AppImage is valid before its first --version run.
        rpcs3_ok = bool(info["exists"] and info["executable"]
                        and info["sha256"].lower() == BUNDLED_RPCS3_SHA256)
        # Distinguish "we haven't checked yet" from "we checked and it's wrong"
        # so the frontend can show a pending state instead of a red X on first
        # panel open after install.
        if not info["exists"]:
            rpcs3_state = "missing"
        elif not info["verified"] and not info["sha256"]:
            rpcs3_state = "verifying"
        elif not rpcs3_ok:
            rpcs3_state = "invalid"
        else:
            rpcs3_state = "ready"
        listener_state = "connected" if listener else ("waiting" if rpcs3_ok else "not_configured")
        web_assets_ok = self._web_assets_ready()
        web_ok = bool(self._httpd is not None and web_assets_ok)
        setup_complete = bool(rpcs3_ok and self.library and game
                              and LAUNCHER.is_file() and RUN_BOTH.is_file() and web_ok)
        result = {
            "rpcs3Ok": rpcs3_ok, "rpcs3State": rpcs3_state,
            "rpcs3Path": str(BUNDLED_RPCS3), "rpcs3ResolvedPath": str(BUNDLED_RPCS3),
            "rpcs3Executed": str(BUNDLED_RPCS3), "rpcs3Managed": rpcs3_ok, "rpcs3Custom": "", "rpcs3Fallback": False,
            "rpcs3Executable": info["executable"], "rpcs3Version": info["version"], "rpcs3Sha256": info["sha256"],
            "rpcs3ExpectedSha256": BUNDLED_RPCS3_SHA256, "rpcs3Verified": info["verified"],
            "tagsOk": bool(self.library), "tagCount": len(self.library),
            "tagRoot": self.library_root or "", "gameOk": bool(game), "gamePath": game, "gameRoot": str(game_root),
            "launcherOk": LAUNCHER.is_file() and RUN_BOTH.is_file(), "launcherPath": str(LAUNCHER), "runBothPath": str(RUN_BOTH), "webOk": web_ok, "webPort": port,
            "webEnabled": bool(self.config.get("webEnabled", True)),
            # v3.3.8: previously always shaped as "http://<deck-ip>:PORT" when
            # no LAN interface was detected. That looked broken to the user.
            # Now the frontend can distinguish "we have an IP, use it" from
            # "connect to Wi-Fi first" via phoneRemoteState.
            "webUrl": ("http://%s:%d" % (ip, port)) if ip else "",
            "phoneRemoteIp": ip,
            "phoneRemoteState": "ready" if ip else "no_network",
            "listenerOk": listener, "listenerState": listener_state, "listenerPort": self.port,
            "setupComplete": setup_complete, "busy": self._busy,
            "aioVersion": AIO_PLUGIN_VERSION, "rpcs3ExpectedPath": str(BUNDLED_RPCS3),
            "rpcs3ActualPath": str(BUNDLED_RPCS3) if info["exists"] else "",
            # v3.3.8: live LED state from the patched emulator. Keys "0",
            # "1", "2" are per-pad centre/left/right; "all" is the last
            # broadcast. Frontend renders coloured dots per pad and paints
            # a matching halo behind the pad artwork when a value is set.
            "padColors": self._pad_colors_json(),
            # v3.3.10: reader diagnostics. Lets the Setup panel show
            # whether the colour reader is actually connected + counting
            # frames, so we can tell "no LED events yet" apart from
            # "reader is broken".
            "colorReader": dict(self._color_reader_stats),
        }
        # Verifying state is transient - don't cache it as long as the others
        # or the panel will show "verifying..." for 5 seconds after it's done.
        self._setup_status_cache = dict(result)
        self._setup_status_cache_at = now if rpcs3_state != "verifying" else now - 3.5
        return result

    async def repair_web_assets(self):
        """Install only the upstream LegoToypad v1.5 phone UI and artwork.

        This is intentionally non-destructive to the tag library. It is safe
        for setup/update runs where the tags already exist but Web/Assets were
        not carried forward from an older plugin installation.
        """
        if self._busy:
            return {"ok": False, "error": "Already " + self._busy}
        if self._web_assets_ready():
            self._restart_web()
            return {"ok": True, "message": "LegoToypad v1.5 phone Web UI is ready."}
        self._busy = "installing LegoToypad phone Web UI"
        try:
            result = await self.loop.run_in_executor(None, self._install_web_assets_blocking)
        finally:
            self._busy = ""
        self._scan()
        self._restart_web()
        return result

    def _install_web_assets_blocking(self):
        try:
            self._log_setup("Downloading LegoToypad v1.5 Web/Assets from " + TAG_SOURCE_TARBALL)
            blob = self._download_url_blocking(TAG_SOURCE_TARBALL, timeout=180)
            taken = 0
            with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
                for member in tar.getmembers():
                    if not member.isfile():
                        continue
                    parts = Path(member.name).parts
                    if len(parts) < 3 or parts[1] not in ("Assets", "Web"):
                        continue
                    dest_root = ASSET_ROOT if parts[1] == "Assets" else WEB_ROOT
                    dest = dest_root / Path(*parts[2:])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    src = tar.extractfile(member)
                    if src is None:
                        continue
                    with dest.open("wb") as fh:
                        shutil.copyfileobj(src, fh)
                    taken += 1
            for base in (ASSET_ROOT, WEB_ROOT):
                if base.exists():
                    self._chown_deck(base)
                    for path in base.rglob("*"):
                        self._chown_deck(path)
            if not self._web_assets_ready():
                return {"ok": False, "error": "Downloaded LegoToypad v1.5, but its Web UI files were incomplete."}
            self._log_setup("Installed %d LegoToypad Web/Assets files" % taken)
            return {"ok": True, "message": "LegoToypad v1.5 phone Web UI installed automatically."}
        except Exception as exc:
            self._log_setup("Web UI FAILED: %s" % exc)
            return {"ok": False, "error": str(exc)}

    async def install_tags(self, confirm: bool = False):
        """Download the tag dumps and artwork into the managed library.

        Runs in a worker thread: it is a large download and extract, and
        blocking the plugin's event loop would freeze the QAM panel.
        """
        if self._busy:
            return {"ok": False, "error": "Already " + self._busy}
        if self.library and not confirm:
            return {"ok": False, "requiresConfirmation": True, "tagCount": len(self.library),
                    "error": "%d tags are already installed. Re-download will replace the current tag library and Web/Assets files." % len(self.library)}
        self._busy = "downloading tags"
        try:
            result = await self.loop.run_in_executor(
                None, self._install_tags_blocking)
        finally:
            self._busy = ""
        self._scan()
        result["tagCount"] = len(self.library)
        return result

    def _install_tags_blocking(self):
        try:
            self._log_setup("Downloading " + TAG_SOURCE_TARBALL)
            blob = self._download_url_blocking(TAG_SOURCE_TARBALL, timeout=180)
            self._log_setup("Got %d KiB, extracting" % (len(blob) // 1024))

            TAG_LIBRARY.mkdir(parents=True, exist_ok=True)
            taken = 0
            with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
                for member in tar.getmembers():
                    if not member.isfile():
                        continue
                    parts = Path(member.name).parts
                    if len(parts) < 3:
                        continue
                    if parts[1] == TAG_SOURCE_BINS:
                        dest = TAG_LIBRARY / Path(*parts[2:])
                    elif parts[1] == "Assets":
                        dest = ASSET_ROOT / Path(*parts[2:])
                    elif parts[1] == "Web":
                        dest = WEB_ROOT / Path(*parts[2:])
                    else:
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    src = tar.extractfile(member)
                    if src is None:
                        continue
                    with dest.open("wb") as fh:
                        shutil.copyfileobj(src, fh)
                    taken += 1

            for base in (TAG_LIBRARY, ASSET_ROOT, WEB_ROOT):
                if not base.exists():
                    continue
                self._chown_deck(base)
                for path in base.rglob("*"):
                    self._chown_deck(path)

            self._log_setup("Extracted %d files to %s" % (taken, TAG_LIBRARY))
            if taken == 0:
                return {"ok": False,
                        "error": "Archive downloaded but contained no tag files."}
            return {"ok": True, "message": "Installed %d files" % taken}
        except Exception as exc:
            self._log_setup("FAILED: %s" % exc)
            return {"ok": False, "error": str(exc)}

    async def set_web(self, enabled: bool, port: int):
        self.config["webEnabled"] = bool(enabled)
        try:
            p = int(port)
            if 1024 <= p <= 65535:
                self.config["webPort"] = p
        except (TypeError, ValueError):
            pass
        self._save_config()
        self._stop_web()
        if self.config["webEnabled"]:
            self._start_web()
        return await self.setup_status()

    async def set_game_path(self, path: str):
        self.config["gamePath"] = path
        self._save_config()
        return await self.setup_status()

    async def get_setup_log(self):
        try:
            return SETUP_LOG.read_text()[-4000:]
        except OSError:
            return ""

    # ---------------------------------------------------------------- artwork

    THUMB_DIR = WORK_DIR / "thumbs"

    def _thumbnail(self, source, max_width=256):
        """A display-sized copy of an image, cached on disk.

        The franchise logos are print resolution - 4 MB across thirty files,
        some over 700 KB each. Sending those into the QAM as base64 would cost
        several MB of webview memory for artwork drawn 40 pixels tall. Pillow
        is not guaranteed on SteamOS, so this degrades to the original file
        rather than failing.
        """
        source = Path(source)
        try:
            if source.stat().st_size <= 60 * 1024:
                return source.read_bytes()
        except OSError:
            return b""

        import hashlib
        self.THUMB_DIR.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha1(
            ("%s|%d|%d" % (source, source.stat().st_mtime_ns, max_width)
             ).encode()).hexdigest()[:16]
        cached = self.THUMB_DIR / ("%s.png" % key)
        if cached.is_file():
            try:
                return cached.read_bytes()
            except OSError:
                pass

        try:
            from PIL import Image
            with Image.open(source) as im:
                im = im.convert("RGBA")
                if im.width > max_width:
                    height = max(1, round(im.height * max_width / im.width))
                    im = im.resize((max_width, height), Image.LANCZOS)
                # Palette-quantise: these are flat logo artwork, so 256 colours
                # is visually lossless at tile size and roughly halves the
                # payload again. Transparency is preserved as a palette index.
                try:
                    im = im.quantize(colors=256, method=Image.FASTOCTREE)
                except Exception:
                    pass
                buf = io.BytesIO()
                im.save(buf, format="PNG", optimize=True)
                data = buf.getvalue()
            cached.write_bytes(data)
            self._chown_deck(cached)
            self._chown_deck(self.THUMB_DIR)
            return data
        except Exception as exc:
            decky.logger.info("Thumbnail fallback for %s (%s)", source.name, exc)
            try:
                return source.read_bytes()
            except OSError:
                return b""

    async def get_franchise_logo(self, name: str):
        """Logo plus the plate it needs behind it.

        These logos aren't consistent: some are light artwork on transparency,
        some are near-black line art. A single dark plate makes the dark ones
        invisible, which is what "some franchises look blank" was. So measure
        the artwork and let the caller pick a background that suits it.
        """
        path = self._asset_paths.get(self.logos.get(name, 0))
        if not path:
            return {"icon": "", "dark": False}
        data = self._thumbnail(path)
        if not data:
            return {"icon": "", "dark": False}
        return {
            "icon": "data:image/png;base64," + base64.b64encode(data).decode("ascii"),
            "dark": self._art_is_dark(data),
        }

    @staticmethod
    def _art_is_dark(png_bytes):
        """True when the visible pixels are mostly dark, so the tile needs a
        light plate. Falls back to False (dark plate) if Pillow is missing."""
        try:
            from PIL import Image
            with Image.open(io.BytesIO(png_bytes)) as im:
                im = im.convert("RGBA")
                im.thumbnail((64, 64))
                total = 0.0
                count = 0
                for r, g, b, a in im.getdata():
                    if a < 40:          # transparent, not part of the artwork
                        continue
                    total += 0.299 * r + 0.587 * g + 0.114 * b
                    count += 1
                if not count:
                    return False
                return (total / count) < 96
        except Exception:
            return False

    # ---------------------------------------------------------------- API

    async def get_state(self):
        return {
            "slots": SLOTS,
            "pads": self.pads,
            "libraryRoot": self.library_root,
            "count": len(self.library),
            "port": self.port,
        }

    async def get_pad_colors(self):
        """Live LED state, uncached. Called by the Decky pad view on a fast
        interval so the pad tiles reflect the game's LED commands in real
        time. Cheap: just a dict copy, no I/O."""
        return {
            "padColors": self._pad_colors_json(),
            "readerStats": dict(self._color_reader_stats),
        }

    async def get_franchises(self):
        seen = {}
        for e in self.library:
            seen.setdefault(e["franchise"], 0)
            seen[e["franchise"]] += 1
        return [{"name": k, "count": v,
                 "hasLogo": bool(self.logos.get(k))}
                for k, v in sorted(seen.items())]

    async def get_figures(self, franchise: str = "", search: str = "",
                          story: bool = False):
        needle = (search or "").strip().lower()
        out = []
        for e in self.library:
            if story and (e["franchise"].lower(), e["name"].lower()) not in STORY_ROSTER:
                continue
            if not story and franchise and e["franchise"] != franchise:
                continue
            if needle and needle not in f"{e['name']} {e['franchise']}".lower():
                continue
            out.append({k: e[k] for k in
                        ("id", "name", "build", "franchise", "kind", "hasIcon")})
            if len(out) >= 400:
                break
        return out

    async def get_icon(self, figure_id: int):
        """Base64 data URL for a figure's artwork, or empty string."""
        if not 0 <= figure_id < len(self.library):
            return ""
        icon = self.library[figure_id].get("_icon")
        if not icon:
            return ""
        try:
            raw = Path(icon).read_bytes()
        except OSError:
            return ""
        if len(raw) > 512 * 1024:
            return ""
        mime = "image/png" if icon.lower().endswith(".png") else "image/jpeg"
        return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"

    async def load_figure(self, figure_id: int, slot: int):
        if not 0 <= figure_id < len(self.library):
            return {"ok": False, "error": "That figure is no longer in the library."}
        if not 0 <= slot < 7:
            return {"ok": False, "error": "Bad slot."}

        entry = self.library[figure_id]
        s = SLOTS[slot]
        try:
            tag, path = self._resolve_tag(entry)
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": f"Could not read the tag: {exc}"}

        try:
            encoded = path.encode("utf-8")
            frame = (bytes([CMD_LOAD, s["pad"], s["index"], 0, 0]) + tag
                     + len(encoded).to_bytes(2, "little") + encoded)
            await self._send(frame)
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}

        self.pads[slot] = {
            "name": entry["name"],
            "build": entry.get("build", 1),
            "hasIcon": bool(entry.get("hasIcon")),
            "franchise": entry["franchise"],
            "figure": figure_id,
            "saves": bool(path),
        }
        self.status = f"LOAD sent: {entry['name']} -> {s['label']}"
        return {"ok": True,
                "message": f"{entry['name']} placed on {s['label']}",
                "pads": self.pads,
                "warning": "" if path else
                           "Progress will not save for this figure - the tag "
                           "could not be copied to the working folder."}

    async def remove_figure(self, slot: int):
        if not 0 <= slot < 7:
            return {"ok": False, "error": "Bad slot."}
        s = SLOTS[slot]
        try:
            await self._send(bytes([CMD_REMOVE, s["pad"], s["index"], 0, 0]))
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}
        was = self.pads[slot]
        self.pads[slot] = None
        self.status = f"CLEAR sent: {s['label']}"
        return {"ok": True,
                "message": f"{was['name'] if was else s['label']} removed",
                "pads": self.pads}

    async def move_figure(self, src: int, dst: int):
        if not (0 <= src < 7 and 0 <= dst < 7):
            return {"ok": False, "error": "Bad slot."}
        if src == dst:
            return {"ok": False, "error": "That's already where it is."}
        if self.pads[src] is None:
            return {"ok": False, "error": "Nothing on that pad to move."}

        a, b = SLOTS[src], SLOTS[dst]
        try:
            await self._send(bytes([CMD_MOVE, b["pad"], b["index"],
                                    a["pad"], a["index"]]))
        except RuntimeError as exc:
            return {"ok": False, "error": str(exc)}

        self.pads[dst] = self.pads[src]
        self.pads[src] = None
        self.status = f"MOVE sent: {a['label']} -> {b['label']}"
        return {"ok": True,
                "message": f"{self.pads[dst]['name']} moved to {b['label']}",
                "pads": self.pads}

    async def clear_all(self):
        errors = []
        for slot in range(7):
            if self.pads[slot] is None:
                continue
            s = SLOTS[slot]
            try:
                await self._send(bytes([CMD_REMOVE, s["pad"], s["index"], 0, 0]))
                self.pads[slot] = None
            except RuntimeError as exc:
                errors.append(str(exc))
                break
        if errors:
            return {"ok": False, "error": errors[0], "pads": self.pads}
        return {"ok": True, "message": "Pad cleared", "pads": self.pads}

    async def resync(self):
        """Forget our idea of the pad. Sends nothing to the emulator."""
        self.pads = [None] * 7
        return {"ok": True,
                "message": "Pad view cleared. Nothing was sent to the game.",
                "pads": self.pads}

    async def rescan(self):
        self._scan()
        return {"ok": True,
                "message": f"{len(self.library)} tags found",
                "libraryRoot": self.library_root,
                "count": len(self.library)}

    async def check_listener(self):
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=1)
            writer.close()
            return {"listening": True, "port": self.port}
        except Exception:
            return {"listening": False, "port": self.port}

    async def reset_progress(self, figure_id: int):
        """Delete a figure's working tag so it starts fresh next time."""
        if not 0 <= figure_id < len(self.library):
            return {"ok": False, "error": "Unknown figure."}
        entry = self.library[figure_id]
        working = TAG_CACHE / (self._tag_stem(entry) + ".bin")
        try:
            if working.is_file():
                working.unlink()
                return {"ok": True, "message": f"{entry['name']} reset to a fresh tag"}
            return {"ok": True, "message": f"{entry['name']} had no saved progress"}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Steam launcher template
# ---------------------------------------------------------------------------

LAUNCHER_TEMPLATE = """#!/bin/bash
# LEGO Dimensions launcher - generated by Dimensions Toypad AIO.
# The bundled AppImage below is the only allowed RPCS3 runtime.

set -u
RPCS3={command}
GAMES="{games}"
LOG="$HOME/toypad/last-run.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee "$LOG") 2>&1
echo "=== $(date) ==="
echo "RPCS3 bundled AppImage: $RPCS3"

if [ ! -f "$RPCS3" ]; then
    echo "ERROR: bundled RPCS3 AppImage is missing: $RPCS3" >&2
    exit 1
fi
chmod +x "$RPCS3" 2>/dev/null || true
if [ ! -x "$RPCS3" ]; then
    echo "ERROR: bundled RPCS3 AppImage is not executable: $RPCS3" >&2
    exit 1
fi

GAME=$(find "$GAMES" -ipath '*PS3_GAME/USRDIR/EBOOT.BIN' -print -quit 2>/dev/null)
[ -z "$GAME" ] && GAME=$(find "$GAMES" -iname 'EBOOT.BIN' -print -quit 2>/dev/null)

# Execute the AppImage itself; this variable only tells its runtime to unpack
# its own payload when FUSE is unavailable. It never selects another RPCS3.
export APPIMAGE_EXTRACT_AND_RUN=1

if [ -z "$GAME" ]; then
    echo "No EBOOT.BIN under $GAMES - showing the bundled RPCS3 game list."
    exec "$RPCS3"
fi

echo "Game: $GAME"
export QT_QPA_PLATFORM=xcb
if command -v gamescope >/dev/null 2>&1; then
    exec gamescope -w 1280 -h 720 -f -- "$RPCS3" --no-gui "$GAME"
else
    exec "$RPCS3" --no-gui "$GAME"
fi
"""


# ---------------------------------------------------------------------------
# phone remote
# ---------------------------------------------------------------------------

class _ThreadedHTTP(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class _Handler(BaseHTTPRequestHandler):
    plugin = None

    def log_message(self, fmt, *args):
        pass

    def _reply(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, payload, code=200):
        self._reply(code, json.dumps(payload).encode("utf-8"), "application/json")

    def _run(self, coro):
        """Bridge a request thread into the plugin's asyncio loop."""
        fut = asyncio.run_coroutine_threadsafe(coro, self.plugin.loop)
        return fut.result(timeout=20)

    def do_GET(self):
        p = self.plugin
        path = self.path.split("?")[0]

        try:
            # LegoToypad v1.5's own phone UI, served verbatim.
            if path == "/":
                f = p.web_file("index.html")
                if f is None:
                    self._reply(200, FALLBACK_PAGE.encode("utf-8"),
                                "text/html; charset=utf-8")
                    return
                self._reply(200, f.read_bytes(), "text/html; charset=utf-8")
                return

            if path in ("/app.js", "/style.css", "/InterVariable.woff2"):
                f = p.web_file(path[1:])
                if f is None:
                    self._json({"error": "not found"}, 404)
                    return
                ctype = ("application/javascript" if path.endswith(".js")
                         else "text/css" if path.endswith(".css")
                         else "font/woff2")
                self._reply(200, f.read_bytes(), ctype)
                return

            if path.startswith("/img/"):
                target = p.asset_path(path.rsplit("/", 1)[1] or 0)
                if not target:
                    self._reply(404, b"", "image/png")
                    return
                # Phones are on Wi-Fi and these are print-resolution files, so
                # the same thumbnail cache the QAM uses is served here too.
                if target.lower().endswith(".png"):
                    data = p._thumbnail(target, 480) or Path(target).read_bytes()
                else:
                    data = Path(target).read_bytes()
                ctype = ("font/woff2" if target.lower().endswith(".woff2")
                         else "image/jpeg" if target.lower().endswith((".jpg", ".jpeg"))
                         else "image/png")
                self._reply(200, data, ctype)
                return

            if path == "/api/catalog":
                self._reply(200, json.dumps(p.catalog_json()).encode("utf-8"),
                            "application/json")
                return

            if path == "/api/state":
                self._reply(200, json.dumps(p.state_json()).encode("utf-8"),
                            "application/json")
                return

            self._json({"error": "no such endpoint"}, 404)
        except Exception as exc:
            self._json({"error": str(exc)}, 500)

    def do_POST(self):
        p = self.plugin
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self._json({"ok": False, "status": "malformed body"}, 400)
            return

        # v1.5's UI posts {slot, bin} / {src, dest} / {slot} and reads back
        # {ok, status}; anything else and its error handling misfires.
        try:
            if path == "/api/load":
                res = self._run(p.load_figure(int(body["bin"]), int(body["slot"])))
            elif path == "/api/move":
                res = self._run(p.move_figure(int(body["src"]), int(body["dest"])))
            elif path == "/api/clear":
                res = self._run(p.remove_figure(int(body["slot"])))
            elif path == "/api/clearall":
                res = self._run(p.clear_all())
            elif path == "/api/resync":
                res = self._run(p.resync())
            else:
                self._json({"ok": False, "status": "no such endpoint"}, 404)
                return
        except (KeyError, ValueError, TypeError) as exc:
            self._json({"ok": False, "status": "bad request: %s" % exc}, 400)
            return
        except Exception as exc:
            self._json({"ok": False, "status": str(exc)}, 500)
            return

        self._json({"ok": bool(res.get("ok")),
                    "status": res.get("error") or res.get("message") or ""})


FALLBACK_PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0b0e">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Toypad</title>
<style>
:root{
  --void:#0a0b0e; --slab:#15171d; --raise:#1c1f27; --edge:#2a2f3a;
  --stud:#e6e9ef; --dim:#7d8494;
  --left:#ff6b4a; --centre:#ffc93c; --right:#45b8ff;
  --body:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --code:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;overflow:hidden}
body{background:var(--void);color:var(--stud);font-family:var(--body);
  display:flex;flex-direction:column;
  padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
button{font:inherit;color:inherit;background:none;border:none;padding:0;cursor:pointer}

header{display:flex;align-items:center;gap:12px;padding:14px 16px 10px}
.mark{font-size:16px;font-weight:700;letter-spacing:.15em}
.mark span{color:var(--centre)}
.lamp{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:10px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--dim);
  border:1px solid var(--edge);border-radius:999px;padding:6px 11px}
.lamp i{width:7px;height:7px;border-radius:50%;background:var(--dim);display:block}
.lamp.up i{background:#5fd08a;box-shadow:0 0 9px #5fd08a}
.lamp.down i{background:var(--left);box-shadow:0 0 9px var(--left)}

.bar{padding:0 16px 10px;display:flex;gap:8px}
.bar input{flex:1;min-width:0;background:var(--slab);border:1px solid var(--edge);
  border-radius:10px;color:var(--stud);padding:11px 13px;font-size:16px}
.bar input::placeholder{color:var(--dim)}
.bar button{background:var(--slab);border:1px solid var(--edge);border-radius:10px;
  padding:0 13px;font-size:11px;color:var(--dim);white-space:nowrap}

main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px 12px}
.row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;
  padding:10px 12px;margin-bottom:6px;border-radius:10px;background:var(--slab);
  border:1px solid transparent}
.row:active{background:var(--raise)}
.row.on{border-color:var(--centre);background:var(--raise)}
.row img{width:34px;height:34px;object-fit:contain;flex:0 0 auto}
.row .sp{width:34px;flex:0 0 auto}
.row .txt{flex:1;min-width:0}
.row b{font-weight:500;font-size:14px;display:block}
.row small{display:block;font-size:10px;color:var(--dim);margin-top:1px}
.row em{font-style:normal;font-size:10px;letter-spacing:.08em;color:var(--dim);
  white-space:nowrap}
.blank{padding:32px 4px;color:var(--dim);font-size:13px;line-height:1.6}
.blank b{display:block;color:var(--stud);margin-bottom:6px;letter-spacing:.05em}

footer{flex:0 0 auto;background:var(--slab);border-top:1px solid var(--edge);
  padding:12px 16px 14px}
.holding{display:flex;align-items:center;gap:10px;font-size:12px;margin-bottom:10px;
  color:var(--centre)}
.holding button{margin-left:auto;font-size:10px;letter-spacing:.11em;
  text-transform:uppercase;color:var(--dim);border:1px solid var(--edge);
  border-radius:999px;padding:5px 10px}

.pad{display:grid;grid-template-columns:1fr .78fr 1fr;gap:8px;height:196px}
.zone{display:grid;gap:8px;grid-template-rows:1fr 1fr;grid-template-columns:1fr 1fr}
.zone.centre{grid-template-rows:1fr;grid-template-columns:1fr}
.zone .wide{grid-column:span 2}
.cell{position:relative;overflow:hidden;border-radius:12px;background:#101218;
  border:1.5px solid var(--edge);display:flex;flex-direction:column;
  justify-content:flex-end;padding:8px;text-align:left;
  transition:border-color .18s,background .18s}
.cell .tag{font-family:var(--code);font-size:9px;letter-spacing:.07em;
  color:var(--dim);position:absolute;top:7px;left:8px}
.cell .who{font-size:11px;font-weight:500;line-height:1.25;color:var(--dim)}
.cell.full .who{color:var(--stud)}
.cell.full{background:#141821}
.cell::after{content:"";position:absolute;inset:auto 0 0 0;height:3px;
  background:var(--hue);opacity:.16;transition:opacity .3s,height .3s}
.cell.full::after{opacity:1;height:5px;box-shadow:0 0 16px var(--hue)}
.cell.full{border-color:color-mix(in srgb,var(--hue) 45%,var(--edge))}
.cell.armed{border-color:var(--centre);background:var(--raise)}
.cell.source{border-color:var(--right);border-style:dashed}
.cell:active{background:var(--raise)}
.zone.left .cell{--hue:var(--left)}
.zone.centre .cell{--hue:var(--centre)}
.zone.right .cell{--hue:var(--right)}

.status{margin-top:10px;font-size:12px;line-height:1.4;color:var(--dim);
  min-height:2.6em;display:flex;align-items:flex-start;gap:8px}
.status.bad{color:var(--left)}
.status.good{color:var(--stud)}
.status button{margin-left:auto;flex:0 0 auto;font-size:10px;letter-spacing:.11em;
  text-transform:uppercase;color:var(--dim);border:1px solid var(--edge);
  border-radius:999px;padding:5px 10px}

.sheet{position:fixed;inset:0;background:rgba(6,7,10,.72);display:flex;
  align-items:flex-end;justify-content:center;padding:16px;z-index:9}
.sheet[hidden]{display:none}
.sheet .card{width:100%;max-width:460px;background:var(--slab);
  border:1px solid var(--edge);border-radius:14px;padding:16px}
.sheet h2{font-size:12px;letter-spacing:.07em;margin:0 0 4px;font-weight:600;
  text-transform:uppercase}
.sheet .sub{font-size:11px;color:var(--dim);margin-bottom:13px}
.sheet .card button{display:block;width:100%;text-align:left;padding:13px;
  border-radius:10px;background:var(--raise);margin-bottom:8px;font-size:15px}
.sheet .card button:last-child{margin-bottom:0;color:var(--dim);background:none;
  border:1px solid var(--edge)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (min-height:760px){.pad{height:236px}}
</style>
</head>
<body>

<header>
  <div class="mark">TOY<span>PAD</span></div>
  <button class="lamp" id="lamp" type="button"><i></i><span>check</span></button>
</header>

<div class="bar">
  <input id="q" type="search" placeholder="Filter figures" autocomplete="off"
         autocorrect="off" autocapitalize="off" spellcheck="false">
  <button id="back" type="button">All</button>
  <button id="story" type="button">Story</button>
</div>

<main id="list"></main>

<footer>
  <div class="holding" id="holding" hidden></div>
  <div class="pad" id="pad"></div>
  <div class="status" id="status">
    <span id="statusText">Loading&hellip;</span>
    <button id="resync" type="button">Resync</button>
  </div>
</footer>

<div class="sheet" id="sheet" hidden>
  <div class="card">
    <h2 id="sheetTitle"></h2>
    <div class="sub" id="sheetSub"></div>
    <button type="button" data-do="move">Move to another pad</button>
    <button type="button" data-do="remove">Take it off</button>
    <button type="button" data-do="cancel">Cancel</button>
  </div>
</div>

<script>
var slots=[],pads=[],figures=[],franchises=[],view="franchises",
    franchise="",held=null,source=null,sheetSlot=null,icons={},storyMode=false;
function $(id){return document.getElementById(id)}
function say(t,k){$("statusText").textContent=t;$("status").className="status"+(k?" "+k:"")}

function api(m,p,b){
  return fetch(p,{method:m,headers:b?{"Content-Type":"application/json"}:{},
    body:b?JSON.stringify(b):null}).then(function(r){
      return r.json().then(function(d){
        if(!r.ok)throw new Error(d.error||"Request failed");return d})})}

function drawPad(){
  var z={left:[],centre:[],right:[]};
  slots.forEach(function(s){z[s.zone].push(s)});
  var pad=$("pad");pad.innerHTML="";
  ["left","centre","right"].forEach(function(n){
    var d=document.createElement("div");d.className="zone "+n;
    z[n].forEach(function(s,i){
      var occ=pads[s.slot];
      var c=document.createElement("button");c.type="button";
      c.className="cell"+(occ?" full":"")+(held!==null&&!occ?" armed":"")
        +(source===s.slot?" source":"");
      if(n!=="centre"&&i===0)c.className+=" wide";
      var t=document.createElement("span");t.className="tag";
      t.textContent=s.pad+"/"+s.index;
      var w=document.createElement("span");w.className="who";
      w.textContent=occ?(occ.name+(occ.build>1?" \u00b7 B"+occ.build:"")):s.label;
      c.appendChild(t);c.appendChild(w);
      c.addEventListener("click",function(){tapSlot(s.slot)});
      d.appendChild(c)});
    pad.appendChild(d)});
  drawHolding()}

function drawHolding(){
  var b=$("holding");
  if(held===null&&source===null){b.hidden=true;return}
  b.hidden=false;b.innerHTML="";
  var t=document.createElement("span");
  if(source!==null){
    t.textContent="Moving "+(pads[source]?pads[source].name:"it")+" \u2014 tap where it goes"}
  else{
    var f=figures.filter(function(x){return x.id===held})[0];
    t.textContent="Holding "+(f?f.name:"a figure")+" \u2014 tap a pad"}
  var c=document.createElement("button");c.type="button";c.textContent="Put down";
  c.addEventListener("click",function(){
    held=null;source=null;drawList();drawPad();say("Ready.")});
  b.appendChild(t);b.appendChild(c)}

function drawList(){
  var box=$("list");box.innerHTML="";
  if(view==="franchises"){
    $("back").textContent="All";
    if(!franchises.length){
      box.innerHTML='<div class="blank"><b>NO TAGS FOUND</b>'
        +'Open the plugin on the Deck and use Setup to install the tag library.</div>';
      return}
    franchises.forEach(function(f){
      var r=document.createElement("button");r.type="button";r.className="row";
      var sp=document.createElement("div");sp.className="sp";
      var w=document.createElement("div");w.className="txt";
      var n=document.createElement("b");n.textContent=f.name;w.appendChild(n);
      var e=document.createElement("em");e.textContent=f.count;
      r.appendChild(sp);r.appendChild(w);r.appendChild(e);
      r.addEventListener("click",function(){franchise=f.name;loadFigures()});
      box.appendChild(r)});
    return}

  $("back").textContent="Franchises";
  if(!figures.length){
    box.innerHTML='<div class="blank"><b>NOTHING MATCHES</b>Clear the filter.</div>';
    return}
  figures.forEach(function(f){
    var r=document.createElement("button");r.type="button";
    r.className="row"+(held===f.id?" on":"");
    if(f.hasIcon){
      var im=document.createElement("img");
      if(icons[f.id]){im.src=icons[f.id]}
      else{api("GET","/api/icon/"+f.id).then(function(d){
        if(d.icon){icons[f.id]=d.icon;im.src=d.icon}}).catch(function(){})}
      r.appendChild(im)}
    else{var sp=document.createElement("div");sp.className="sp";r.appendChild(sp)}
    var w=document.createElement("div");w.className="txt";
    var n=document.createElement("b");
    n.textContent=f.name+(f.build>1?" \u00b7 Build "+f.build:"");
    w.appendChild(n);
    if(f.kind){var s=document.createElement("small");s.textContent=f.kind;w.appendChild(s)}
    r.appendChild(w);
    r.addEventListener("click",function(){pickFigure(f)});
    box.appendChild(r)})}

function loadFigures(){
  var q=$("q").value.trim();
  api("GET","/api/figures?franchise="+encodeURIComponent(franchise)
    +"&search="+encodeURIComponent(q)+(storyMode?"&story=1":""))
  .then(function(d){figures=d.figures;view="figures";drawList()})
  .catch(function(e){say(e.message,"bad")})}

function pickFigure(f){
  source=null;held=(held===f.id)?null:f.id;drawList();drawPad();
  say(held===null?"Ready.":"Tap a pad to place "+f.name+".")}

function tapSlot(slot){
  if(source!==null){var from=source;source=null;send("/api/move",{from:from,to:slot});return}
  if(held!==null){var fid=held;held=null;drawList();send("/api/load",{figure:fid,slot:slot});return}
  if(pads[slot]){
    sheetSlot=slot;
    $("sheetTitle").textContent=pads[slot].name;
    $("sheetSub").textContent=pads[slot].saves
      ? "Progress is being saved for this figure."
      : "Progress is NOT being saved for this figure.";
    $("sheet").hidden=false;return}
  say("Pick a figure from the list first.");drawPad()}

function send(p,b){
  say("Sending\u2026");
  api("POST",p,b).then(function(d){
    if(d.ok===false){drawPad();say(d.error,"bad");lamp(false);return}
    if(d.pads)pads=d.pads;
    drawPad();
    say(d.warning||d.message||"Done",d.warning?"bad":"good");
    lamp(true)})
  .catch(function(e){drawPad();say(e.message,"bad");lamp(false)})}

function lamp(up){
  var e=$("lamp");e.className="lamp "+(up?"up":"down");
  e.querySelector("span").textContent=up?"connected":"no listener"}

$("sheet").addEventListener("click",function(e){
  var a=e.target.getAttribute&&e.target.getAttribute("data-do");
  if(!a&&e.target!==this)return;
  $("sheet").hidden=true;
  if(a==="remove")send("/api/remove",{slot:sheetSlot});
  else if(a==="move"){source=sheetSlot;drawPad();say("Tap the destination pad.")}});

$("story").addEventListener("click",function(){
  storyMode=!storyMode;
  $("story").style.color=storyMode?"#ffc93c":"";
  franchise="";loadFigures()});
$("q").addEventListener("input",function(){if(view==="figures")loadFigures()});
$("back").addEventListener("click",function(){
  if(view==="figures"&&franchise){view="franchises";franchise="";drawList()}
  else{franchise="";loadFigures()}});
$("resync").addEventListener("click",function(){
  api("POST","/api/resync",{}).then(function(d){
    if(d.pads)pads=d.pads;drawPad();say(d.message)})});
$("lamp").addEventListener("click",function(){
  api("GET","/api/state").then(function(){lamp(true)}).catch(function(){lamp(false)})});

Promise.all([api("GET","/api/state"),api("GET","/api/franchises")])
.then(function(r){
  slots=r[0].slots;pads=r[0].pads;franchises=r[1].franchises;
  drawPad();drawList();
  say(r[0].count+" figures ready.");lamp(true)})
.catch(function(e){say("Could not reach the plugin: "+e.message,"bad")});

// Keep the phone in step with anything placed from the Deck's QAM panel.
setInterval(function(){
  if(document.hidden)return;
  api("GET","/api/state").then(function(d){
    if(JSON.stringify(d.pads)!==JSON.stringify(pads)){pads=d.pads;drawPad()}})
  .catch(function(){})},2000);
</script>
</body>
</html>
"""
