"""
Decky entrypoint — repo path: main.py (plugin root)

Owns everything: backend state, the catalog, the LED poller, the overlay and
the local web server.

Two rules this file exists to enforce:

  1. ONE reader of port 9191. The listener serves a single connection at a
     time, so the poller here is the only thing that talks to it. The overlay
     is fed, never left to poll for itself.
  2. NOTHING BLOCKING ON THE LOOP. Decky runs this on asyncio; protocol.py
     uses blocking sockets on purpose. Every probe and command goes through an
     executor, or a dead emulator stalls the whole panel for a socket timeout.
"""

import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Optional

import decky

sys.path.insert(0, os.path.join(decky.DECKY_PLUGIN_DIR, "py_modules"))
sys.path.insert(0, decky.DECKY_PLUGIN_DIR)

import backends as registry                          # noqa: E402
from tcp_adapter import TcpAdapter, Status           # noqa: E402
from install import Installer                        # noqa: E402
import gamescan                                      # noqa: E402
import custom_tags                                   # noqa: E402
import mods as modlib                                # noqa: E402
import shadps4_setup                                 # noqa: E402
from shortcuts import Shortcuts, steam_running       # noqa: E402
from hotkeys import HotkeyListener, describe as describe_chord  # noqa: E402
from overlay import Overlay                          # noqa: E402
from protocol import (SLOTS, LedMode, LED_TICK_MS, LedPoller, LedRegion, animated_frame,   # noqa: E402
                      calibrate)
from web import Server                               # noqa: E402

PLUGIN_DIR = Path(decky.DECKY_PLUGIN_DIR)
SETTINGS_FILE = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "config.json"

# The boxed Starter Pack, for the remote's Story page and our own tile.
STARTER_IDS = (
    "WORLD_DC_COMICS_CHAR_BATMAN_BIN",
    "WORLD_THE_LEGO_MOVIE_CHAR_WYLDSTYLE_BIN",
    "WORLD_THE_LORD_OF_THE_RINGS_CHAR_GANDALF_THE_GREY_BIN",
    "WORLD_DC_COMICS_VEH_BATMOBILE_1_BIN",
)

# Which wave each franchise shipped in, taken verbatim from the desktop app's
# IsYear1FranchiseName / IsYear2FranchiseName. DC Comics is in both, which is
# why these are two sets rather than one field on the franchise.
YEAR1_FRANCHISES = {
    "DC Comics", "The LEGO Movie", "The Lord of the Rings", "Back to the Future",
    "Portal 2", "The Simpsons", "Jurassic World", "Scooby-Doo!",
    "Legends of Chima", "The Wizard of Oz", "Doctor Who", "Ninjago",
    "Ghostbusters", "Midway Arcade",
}
YEAR2_FRANCHISES = {
    "DC Comics", "Ghostbusters 2016", "Adventure Time", "Mission Impossible",
    "Harry Potter", "The A-Team", "Fantastic Beasts and Where to Find Them",
    "Sonic the Hedgehog", "Gremlins", "E.T. the Extra-Terrestrial",
    "The LEGO Batman Movie", "Knight Rider", "The Goonies", "LEGO City Undercover",
    "The Powerpuff Girls", "Teen Titans Go!", "Beetlejuice",
}

# The remote's sort ids. Its switcher looks these up by id, so they are a
# contract, not a display order.
SORT_DEFAULT, SORT_USER, SORT_STORY = 0, 1, 2
SORT_FAVORITES, SORT_YEAR1, SORT_YEAR2, SORT_ABILITIES = 3, 4, 5, 6

DEFAULTS = {
    "activeBackend": "rpcs3",
    "ledEnabled": False,        # polling costs battery; opt in
    "overlayEnabled": True,
    "remoteEnabled": False,     # nothing on the network unless asked
    "installRoot": "",
    "fastLoad": True,           # keep the picker open after placing
    "games": {},                # backend key -> game path
    "favourites": [],           # stableIds
    "recents": [],              # stableIds, most recent first
    # Raw controller bitmasks, captured by pressing the chord rather than
    # chosen from a list — Steam's button bit meanings are undocumented and
    # have moved between builds, so storing what was actually pressed is the
    # only mapping that cannot go stale.
    # Hardware key codes, as lists. 115 = volume up, 114 = volume down;
    # [114, 115] means both together. Read from /dev/input, because
    # SteamClient.Input is absent on some Steam builds and the volume keys are
    # kernel key events rather than controller inputs anyway.
    # On by default, matching the desktop app: in-game tag writes (vehicle
    # upgrades, unlocks) persist to the figure's own file and come back next
    # time. Off hands the emulator a scratch copy instead, leaving every tag
    # exactly as shipped.
    "writableTags": True,
    # The extended remote's franchise ordering: 0 alphabetical, 1 year 1,
    # 2 year 2, 3 user order.
    "franchiseSort": SORT_DEFAULT,
    "franchiseOrder": [],
    "hotkeyPeek": [115],
    "hotkeyModal": [114],
}


class Plugin:
    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    async def _main(self):
        self.loop = asyncio.get_event_loop()
        self.settings = dict(DEFAULTS)
        self._adapters: dict[str, TcpAdapter] = {}
        self._poller: LedPoller | None = None
        self._placed: dict[int, dict] = {}
        self._led_cache: dict[int, tuple] = {}     # pad -> (region, started_at)
        # Shared browse cursor for the remote; -1 / "" means nothing selected.
        self._selection = {"world": -1, "virtual": "", "bin": 0, "ability": -1, "slot": 1}

        await self._load_settings()

        self.overlay = Overlay(plugin_dir=PLUGIN_DIR,
                               atlas=PLUGIN_DIR / "data" / "portraits.atlas")
        self._learning: str = ""
        self._modal_request = 0
        self.hotkeys = HotkeyListener(self._on_chord)
        self.hotkeys.start()
        self.web = Server(PLUGIN_DIR, api=self._web_api,
                          custom_root=registry.INSTALL_ROOT / "custom")
        self.web.start(lan=self.settings["remoteEnabled"])

        self._catalog = self._read_json("data/catalog.json", {"franchises": []})
        self._abilities = self._read_json("data/abilities.json", {"abilities": []})
        self._asset_map = self._read_json("data/asset-map.json", {})
        # Cheap fingerprint of the asset set — changes whenever the map does.
        self._asset_version = str(abs(hash(
            tuple(sorted(self._asset_map.items()))))
        )[:8] if self._asset_map else "0"
        self._index = self._build_index()
        self._custom: list = []
        self._refresh_custom()
        self._assign_bin_ids()

        if self.settings.get("ledEnabled", True):
            self._start_poller()

        decky.logger.info(
            "Dimensions Toypad ready — %d franchises, %d entries, overlay=%s",
            len(self._catalog["franchises"]), len(self._index),
            "yes" if self.overlay.available else "missing",
        )

    async def _unload(self):
        self.hotkeys.stop()
        self._stop_poller()
        self.overlay.stop()
        self.web.stop()
        for adapter in self._adapters.values():
            try:
                adapter.stop()
            except Exception as exc:                      # noqa: BLE001
                decky.logger.warning("adapter stop: %s", exc)
        decky.logger.info("Dimensions Toypad unloaded")

    async def _uninstall(self):
        decky.logger.info("Dimensions Toypad uninstalled")

    # ------------------------------------------------------------------
    # data
    # ------------------------------------------------------------------

    def _read_json(self, rel: str, fallback):
        try:
            return json.loads((PLUGIN_DIR / rel).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            decky.logger.warning("could not read %s: %s", rel, exc)
            return fallback

    def _refresh_custom(self) -> None:
        """
        Fold the drop folder into the index.

        Custom tags go through exactly the same load, move, swap and writable
        -tag paths as catalog figures — the only difference is an absolute
        `bin` path instead of one relative to assets/. Keeping them in one
        index means none of that code needs to know they exist.
        """
        self._custom = custom_tags.scan(registry.INSTALL_ROOT)
        # Also check runtime drop folder for backwards compatibility
        runtime_drop = registry.INSTALL_ROOT / "custom"
        if runtime_drop.is_dir():
            seen_stables = {t.stableId for t in self._custom}
            for tag in custom_tags.scan(registry.INSTALL_ROOT):
                if tag.stableId not in seen_stables:
                    self._custom.append(tag)
        for tag in self._custom:
            self._index[tag.stableId] = tag.as_entry()
        if hasattr(self, "_by_bin_id"):
            self._assign_bin_ids()

    def _assign_bin_ids(self) -> None:
        """
        Give every entry a stable NUMERIC id.

        The 1.9 remote addresses figures by `bin` as a number — it sends
        {slot, bin: 42} — while our catalog's `bin` is the tag's file path.
        Number("All Bin Files/...") is NaN, which is why every load from the
        phone came back "command failed".

        The id is the entry's position in catalog order, which is derived from
        the generated tables and therefore identical on every run and every
        machine. Rebuilding the catalog from a newer LegoToypad can renumber
        them, but nothing persists a bin id — favourites and writable tags are
        keyed by stableId.
        """
        self._by_bin_id: dict[int, str] = {}
        for i, (stable, entry) in enumerate(self._index.items()):
            entry["binId"] = i
            self._by_bin_id[i] = stable

    def _build_index(self) -> dict[str, dict]:
        """Flatten so a slot can be filled from a single stableId."""
        out: dict[str, dict] = {}
        for f in self._catalog["franchises"]:
            for e in f["characters"]:
                out[e["stableId"]] = {**e, "franchise": f["name"]}
            for g in f["vehicles"]:
                for e in g["builds"]:
                    out[e["stableId"]] = {**e, "franchise": f["name"],
                                          "group": g["baseName"]}
        return out

    def _asset_url(self, path: str) -> str:
        """
        A RELATIVE url, deliberately.

        These are served to two very different clients. The QAM panel runs
        inside Steam and needs an absolute http://127.0.0.1:8765 prefix; the
        phone loads the page from the Deck's LAN address, where 127.0.0.1
        means the phone itself — which is why every image on the remote came
        up broken. A relative path resolves correctly against whichever host
        served the page, and the panel adds its own prefix.

        catalog.json still points at .png; the build rewrote them to .webp.
        """
        if not path:
            return ""
        # ?v= busts the browser cache. /assets/ is served with a day-long
        # max-age, so rebuilding the catalog would otherwise leave the phone
        # showing yesterday's art — or worse, the right art under a filename
        # that now means something else.
        return f"/assets/{self._asset_map.get(path, path)}?v={self._asset_version}"

    # ------------------------------------------------------------------
    # settings
    # ------------------------------------------------------------------

    async def _load_settings(self):
        try:
            stored = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        # Whitelist: a config from the old 4.x line must not leak keys in.
        for key in DEFAULTS:
            if key in stored:
                self.settings[key] = stored[key]

    async def _save_settings(self):
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.settings, indent=2), encoding="utf-8")
        os.replace(tmp, SETTINGS_FILE)      # atomic; a torn write would wedge boot

    async def get_settings(self) -> dict:
        return {**self.settings,
                "overlayAvailable": self.overlay.available,
                "remoteUrl": self.web.remote_url()}

    async def set_setting(self, key: str, value) -> dict:
        if key not in DEFAULTS:
            raise KeyError(f"unknown setting {key!r}")
        self.settings[key] = value
        await self._save_settings()

        if key == "ledEnabled":
            self._start_poller() if value else self._stop_poller()
        elif key == "remoteEnabled":
            self.web.start(lan=bool(value))
        elif key == "overlayEnabled" and not value:
            self.overlay.hide()
        return await self.get_settings()

    # ------------------------------------------------------------------
    # backends
    # ------------------------------------------------------------------

    def _root(self) -> Path:
        return Path(self.settings["installRoot"] or registry.BACKEND_DIR)

    def _adapter(self, key: str) -> TcpAdapter:
        if key not in self._adapters:
            self._adapters[key] = TcpAdapter(key)
        return self._adapters[key]

    def _describe(self, key: str) -> dict:
        backend = registry.get(key)
        inst = Installer(root=self._root()).status(key)

        state, detail, serial = "not-installed", "", None
        if inst["installed"] or not backend.artifact:
            probe = self._adapter(key).probe()
            serial, detail = probe.serial, probe.detail
            state = {Status.READY: "running",
                     Status.UNSUPPORTED: "unsupported",
                     Status.OFFLINE: "installed" if inst["installed"]
                                     else "not-configured"}[probe.status]
        elif backend.artifact:
            detail = f"{backend.artifact.size / 1e6:.0f} MB download"

        return {"key": key, "label": backend.label, "console": backend.console,
                "state": state, "detail": detail, "port": backend.resolve_port(),
                "serial": serial, "managed": backend.artifact is not None,
                "minVersion": backend.min_version,
                "notes": list(backend.setup_notes), "path": inst["path"]}

    async def list_backends(self) -> list:
        keys = list(registry.BACKENDS)
        return await self.loop.run_in_executor(
            None, lambda: [self._describe(k) for k in keys])

    async def probe_backend(self, key: str) -> dict:
        return await self.loop.run_in_executor(None, self._describe, key)

    async def set_active_backend(self, key: str) -> dict:
        registry.get(key)
        was_polling = self._poller is not None
        self._stop_poller()
        self.settings["activeBackend"] = key
        await self._save_settings()
        self._placed.clear()
        self.overlay.clear_all()
        if was_polling:
            self._start_poller()
        return await self.probe_backend(key)

    async def install_backend(self, key: str, force: bool = False) -> dict:
        """
        Fetch and place a backend.

        force=True re-downloads even when the file already verifies. Normally
        pointless, but when the pinned hash CHANGES — a new upstream build —
        the installed copy no longer matches its record and a forced pull is
        the honest way to confirm the plugin's own download path works rather
        than assuming it.
        """
        def work():
            try:
                Installer(root=self._root(),
                          on_progress=lambda k, f, m: decky.logger.info(
                              "install %s %.0f%% %s", k, f * 100, m)
                          ).install(key, force=bool(force))
            except Exception as exc:                          # noqa: BLE001
                # The full traceback goes to the journal; the panel gets a
                # sentence it can act on. "python exception" tells the user
                # nothing and costs a journalctl round trip every time.
                decky.logger.exception("install %s failed", key)
                info = self._describe(key)
                info["error"] = f"{type(exc).__name__}: {exc}"
                return info
            return self._describe(key)
        return await self.loop.run_in_executor(None, work)

    async def find_games(self, key: str) -> list:
        """
        Every dump on the system for this backend, richest first.

        gamescan identifies by the game's own PARAM.SFO or meta.xml rather
        than by filename, so it finds a dump in an oddly named folder and
        rejects the other game sitting next to it. Metadata-confirmed hits
        sort above filename guesses.
        """
        def work():
            return [h.as_dict() for h in gamescan.scan(backend=key)]
        return await self.loop.run_in_executor(None, work)

    async def find_games_all(self, key: str) -> list:
        """Same scan without the Dimensions filter — for when discovery
        misses and the user needs to see what IS visible."""
        def work():
            return [h.as_dict()
                    for h in gamescan.scan(backend=key, only_dimensions=False)]
        return await self.loop.run_in_executor(None, work)

    # ------------------------------------------------------------------
    # catalog
    # ------------------------------------------------------------------

    async def get_catalog(self) -> dict:
        abilities = self._abilities["abilities"]
        # Field names the 1.9 remote reads off the catalog root. Ours are
        # additive, so both clients work from one response.
        return {
            # Paths keyed exactly as they appear in the repo — _asset_url maps
            # them through asset-map.json to the optimised .webp.
            "appName": "Dimensions Toypad",
            "favoritesIcon": self._asset_url("Assets/Buttons/Y_button.png"),
            "customTile": self._asset_url("Assets/Tiles/world_tile.png"),
            "charactersTile": self._asset_url("Assets/Tiles/characters_tile.png"),
            "abilitiesTile": self._asset_url("Assets/Tiles/Abilities.png"),
            "wordmark": self._asset_url("Assets/Branding/Lego_Toypad_Wordmark.png"),
            "byMark": self._asset_url("Assets/Branding/by_harrysof.png"),
            "background": self._asset_url("Assets/Wallpapers/Background.jpg"),
            "clearBtn": self._asset_url("Assets/Buttons/clear.png"),
            "scrollBar": self._asset_url("Assets/Buttons/Scroll_Bar.png"),
            # `story` is a WORLD, not a logo — the remote feeds it straight to
            # the roster renderer for the Starter Pack page.
            "story": {"name": "Starter Pack",
                      "logo": self._asset_url("Assets/Branding/Starter_sort.png"),
                      "characters": [self._entry(self._index[i])
                                     for i in STARTER_IDS if i in self._index],
                      "vehicles": []},
            # Objects with an `id`, not strings — the remote finds each sort
            # by id and reads its badge art off `icon`.
            "sorts": [
                {"id": SORT_DEFAULT, "label": "Default", "color": "#F0F4FA",
                 "icon": self._asset_url("Assets/Branding/Default_sort.png")},
                {"id": SORT_USER, "label": "My order", "color": "#F0F4FA",
                 "icon": self._asset_url("Assets/Branding/User_sort.png")},
                {"id": SORT_STORY, "label": "Starter Pack", "color": "#F0C64A",
                 "icon": self._asset_url("Assets/Branding/Starter_sort.png")},
                {"id": SORT_FAVORITES, "label": "Favorites", "color": "#F0C64A",
                 "icon": self._asset_url("Assets/Buttons/Y_button.png")},
                {"id": SORT_YEAR1, "label": "Year 1", "color": "#F0F4FA",
                 "icon": self._asset_url("Assets/Branding/Year1_sort.png")},
                {"id": SORT_YEAR2, "label": "Year 2", "color": "#F0F4FA",
                 "icon": self._asset_url("Assets/Branding/Year2_sort.png")},
                {"id": SORT_ABILITIES, "label": "Abilities", "color": "#8FD3FF",
                 "icon": self._asset_url("Assets/Branding/Abilities_sort.png")},
            ],
            "abilitySections": ["Common", "Uncommon", "Exclusive",
                                "Vehicular", "One-Timed"],
            # `index` is what the remote keys the drill-down on: its tile
            # stores ability.index and then filters every entry whose
            # `abilities` array contains it. Without the field the lookup was
            # `includes(undefined)` — hence "Nothing here yet" on every
            # ability despite the data being right.
            "abilities": [{**a, "index": i,
                           "icon": self._asset_url(a["icon"])}
                          for i, a in enumerate(abilities)],
            "custom": {"name": "Custom",
                       "logo": self._asset_url("Assets/Tiles/world_tile.png"),
                       "characters": [self._entry(self._index[c.stableId])
                                      for c in self._custom
                                      if c.stableId in self._index],
                       "vehicles": []},
            "recents": {"name": "Recent",
                        "logo": self._asset_url("Assets/Branding/Default_sort.png"),
                        "characters": [self._entry(self._index[i])
                                       for i in self.settings["recents"]
                                       if i in self._index],
                        "vehicles": []},
            "franchises": [
                {"name": f["name"], "logo": self._asset_url(f["logo"]),
                 # The Year 1 / Year 2 sort pages filter on these.
                 "year1": f["name"] in YEAR1_FRANCHISES,
                 "year2": f["name"] in YEAR2_FRANCHISES,
                 "characters": [self._entry(e) for e in f["characters"]],
                 # `base` and `franchise` are the remote's names; `baseName`
                 # is ours. Its ability roster rebuilds vehicle groups from
                 # these, so a missing `base` leaves unnamed groups.
                 "vehicles": [{"baseName": g["baseName"],
                               "base": g["baseName"], "franchise": f["name"],
                               "builds": [self._entry(b) for b in g["builds"]]}
                              for g in f["vehicles"]]}
                for f in self._catalog["franchises"]
            ]
        }

    def _entry(self, e: dict) -> dict:
        """
        Both field names, deliberately.

        Our own UI reads `ringColor`; the 1.9 remote reads `color`. Returning
        only ours made its tile builder call rgba(undefined), which threw
        inside the roster loop — so tapping a world ran the handler, blew up
        before setScreen(), and looked like the tap did nothing at all.
        """
        colour = e["ringColor"]
        # A custom tag's portrait is an absolute path in the drop folder, so
        # it is served from /custom/, not through the catalog asset map.
        raw_art = e.get("portrait") or ""
        art = (f"/custom/{Path(raw_art).name}" if Path(raw_art).is_absolute()
               else self._asset_url(raw_art))
        return {"stableId": e["stableId"], "name": e["name"], "build": e["build"],
                "ringColor": colour, "color": colour,
                "abilities": e["abilities"],
                "portrait": art,
                # `bin` must be the NUMBER the remote round-trips; the path
                # goes out separately for anything that wants it.
                #
                # Looked up through the index rather than read off `e`:
                # _build_index stores COPIES, so an id written there never
                # reaches the catalog dicts this is usually called with.
                "bin": self._index.get(e["stableId"], e).get("binId", -1),
                "binPath": e["bin"],
                "atlas": e.get("atlas", -1)}

    async def get_abilities(self) -> dict:
        return {"abilities": [{**a, "icon": self._asset_url(a["icon"])}
                              for a in self._abilities["abilities"]]}

    async def next_free_slot(self, after: int = -1) -> int:
        """First empty slot at or after `after`, wrapping. -1 if the pad is full."""
        order = list(range(after + 1, len(SLOTS))) + list(range(0, after + 1))
        for i in order:
            if i not in self._placed:
                return i
        return -1

    async def get_slots(self) -> list:
        return [{"index": i, "pad": s.pad, "label": s.label,
                 "writeCapable": s.pad == 1,
                 "occupant": self._placed.get(i)}
                for i, s in enumerate(SLOTS)]

    # ------------------------------------------------------------------
    # commands
    # ------------------------------------------------------------------

    def _tag_path(self, entry: dict, backend: str) -> Path:
        """
        The persistent writable tag for this figure on this backend.

        Keyed by stableId and backend, NOT by slot, and seeded from the
        catalog only if it does not already exist. That is what makes
        progress stick: the emulator writes upgrades, unlocks and re-minted
        UIDs back into the file it was handed, so handing it the same file
        next time restores exactly where you left off.

        Per backend on purpose. A vehicle upgraded in the PS3 save has no
        business appearing upgraded in a fresh Wii U playthrough, and the
        three emulators re-mint UIDs independently anyway.

        Seed-once also fixes duplication safety properly: the catalog copy is
        never handed out, so it can never be mutated.
        """
        # A custom tag carries an absolute path; catalog entries are relative
        # to assets/.
        raw = entry["bin"]
        source = Path(raw) if Path(raw).is_absolute() else PLUGIN_DIR / "assets" / raw
        store = registry.TAG_CACHE / backend
        store.mkdir(parents=True, exist_ok=True)

        # stableId is already filesystem-safe and unique per build.
        working = store / f"{entry['stableId']}.bin"
        if not working.is_file():
            # Check for existing save in root TAG_CACHE or runtime dir from previous builds
            legacy = registry.TAG_CACHE / f"{entry['stableId']}.bin"
            runtime_legacy = registry.INSTALL_ROOT / "tags" / backend / f"{entry['stableId']}.bin"
            if legacy.is_file():
                shutil.copy2(legacy, working)
            elif runtime_legacy.is_file():
                shutil.copy2(runtime_legacy, working)
            elif source.is_file():
                shutil.copy2(source, working)
        return working

    def _tag_is_stock(self, entry: dict, backend: str) -> bool:
        """True when the working tag still matches the shipped one byte for byte."""
        raw = entry["bin"]
        source = Path(raw) if Path(raw).is_absolute() else PLUGIN_DIR / "assets" / raw
        working = registry.TAG_CACHE / backend / f"{entry['stableId']}.bin"
        if not working.is_file() or not source.is_file():
            return True
        if working.stat().st_size != source.stat().st_size:
            return False
        return working.read_bytes() == source.read_bytes()

    async def reset_tag(self, stable_id: str, backend: str = "") -> dict:
        """Throw away a figure's progress and go back to the shipped tag."""
        entry = self._index.get(stable_id)
        if not entry:
            return {"ok": False, "error": "unknown figure"}
        key = backend or self.settings["activeBackend"]

        def work():
            working = registry.TAG_CACHE / key / f"{stable_id}.bin"
            working.unlink(missing_ok=True)
            return self._tag_path(entry, key)
        await self.loop.run_in_executor(None, work)
        return {"ok": True, "name": entry["name"]}

    async def reset_all_tags(self, backend: str = "") -> dict:
        key = backend or self.settings["activeBackend"]

        def work():
            store = registry.TAG_CACHE / key
            n = 0
            if store.is_dir():
                for f in store.glob("*.bin"):
                    f.unlink(missing_ok=True)
                    n += 1
            return n
        return {"ok": True, "cleared": await self.loop.run_in_executor(None, work)}

    async def tag_status(self, stable_id: str) -> dict:
        """Whether this figure carries progress on the active backend."""
        entry = self._index.get(stable_id)
        if not entry:
            return {"found": False}
        key = self.settings["activeBackend"]
        stock = await self.loop.run_in_executor(
            None, self._tag_is_stock, entry, key)
        return {"found": True, "backend": key, "stock": stock,
                "modified": not stock}

    async def load_figure(self, slot: int, stable_id: str) -> dict:
        entry = self._index.get(stable_id)
        if not entry:
            return {"ok": False, "error": "unknown figure"}
        key = self.settings["activeBackend"]
        try:
            if self.settings["writableTags"]:
                tag = await self.loop.run_in_executor(
                    None, self._tag_path, entry, key)
            else:
                # Read-only: hand over a scratch copy that is thrown away, so
                # nothing the game writes survives the session.
                def scratch():
                    raw = entry["bin"]
                    src = (Path(raw) if Path(raw).is_absolute()
                           else PLUGIN_DIR / "assets" / raw)
                    tmp = Path.home() / ".local/share/dimensions-toypad/scratch"
                    tmp.mkdir(parents=True, exist_ok=True)
                    out = tmp / f"slot{slot}-{Path(entry['bin']).name}"
                    if src.is_file():
                        shutil.copy2(src, out)
                    return out
                tag = await self.loop.run_in_executor(None, scratch)
        except OSError as exc:
            return {"ok": False, "error": f"could not stage tag: {exc}"}
        if not tag.is_file():
            return {"ok": False, "error": f"tag missing: {entry['bin']}"}

        # Read-only mode must also tell the EMULATOR not to write. Handing it
        # a scratch copy with write-back still on means it happily writes into
        # a file we then throw away — harmless, but it makes the setting a lie
        # at the wire level rather than only at ours.
        writable = bool(self.settings["writableTags"])
        ok = await self.loop.run_in_executor(
            None, lambda: self._adapter(key).load(SLOTS[slot], tag,
                                                  writable=writable))
        if ok:
            self._selection["slot"] = slot
            # The staged path travels WITH the figure. A swap re-places the
            # displaced figure from this same file, so anything the emulator
            # wrote into it — a re-minted UID, vehicle upgrades — survives.
            # Re-staging from the catalog would silently reset all of it.
            self._placed[slot] = {"stableId": stable_id, "name": entry["name"],
                                  "portrait": self._asset_url(entry["portrait"]),
                                  "ringColor": entry["ringColor"],
                                  "atlas": entry.get("atlas", -1),
                                  "work": str(tag)}
            if self.settings["overlayEnabled"]:
                self.overlay.set_figure(slot, entry["name"],
                                        entry.get("atlas", -1))
            await self._touch_recent(stable_id)
        return {"ok": ok, "name": entry["name"]}

    async def clear_slot(self, slot: int) -> dict:
        key = self.settings["activeBackend"]
        ok = await self.loop.run_in_executor(
            None, lambda: self._adapter(key).remove(SLOTS[slot]))
        if ok:
            self._selection["slot"] = slot
            self._placed.pop(slot, None)
            self.overlay.clear_figure(slot)
        return {"ok": ok}

    async def move_figure(self, src: int, dest: int) -> dict:
        """
        Move a figure, or SWAP if the destination is occupied.

        MoveFigure in every listener begins with RemoveFigure(destination), so
        a plain MOVE onto an occupied pad destroys whatever was standing there
        — by design; MOVE means "put it here". No emulator offers a swap, so
        it is built from two wire messages, the same way the desktop app does:

            MOVE  source -> destination      (listener clears the destination)
            LOAD  displaced figure -> source (from ITS OWN staged file)

        No explicit REMOVE first: MoveFigure already does it, and the listener
        holds a 500ms pickup delay inside the MOVE so the game sees the lift
        and the arrival as separate events.
        """
        if src == dest:
            return {"ok": True, "note": "same slot"}

        moving = self._placed.get(src)
        if not moving:
            # Meaningless, and on pre-3edd8d5 shadPS4 it corrupted the target.
            return {"ok": False, "error": "nothing on that pad to move"}

        adapter = self._adapter(self.settings["activeBackend"])
        displaced = self._placed.get(dest)

        ok = await self.loop.run_in_executor(
            None, lambda: adapter.move(SLOTS[src], SLOTS[dest]))
        if not ok:
            return {"ok": False, "error": "the emulator rejected the move"}

        self._placed[dest] = moving
        self._placed.pop(src, None)
        self._selection["slot"] = dest
        if self.settings["overlayEnabled"]:
            self.overlay.clear_figure(src)
            self.overlay.set_figure(dest, moving["name"], moving.get("atlas", -1))
            # A move makes the game rewrite several regions at once. The
            # poller pushes only what CHANGED, so replaying the cache keeps
            # the pads it did not mention from going dark on the overlay.
            self.overlay.replay_leds([
                (self._settled_region(r, started, rest), int(started * 1000.0))
                for r, started, rest in self._led_cache.values()
            ])

        if not displaced:
            return {"ok": True}

        # Put the displaced figure down where the mover came from.
        work = Path(displaced.get("work") or "")
        if not work.is_file():
            entry = self._index.get(displaced["stableId"])
            if entry:
                work = await self.loop.run_in_executor(
                    None, self._tag_path, entry, self.settings["activeBackend"])

        placed_back = False
        if work.is_file():
            placed_back = await self.loop.run_in_executor(
                None, lambda: adapter.load(SLOTS[src], work))

        if placed_back:
            displaced["work"] = str(work)
            self._placed[src] = displaced
            if self.settings["overlayEnabled"]:
                self.overlay.set_figure(src, displaced["name"],
                                        displaced.get("atlas", -1))
            return {"ok": True, "swapped": True,
                    "note": f"{moving['name']} \u2194 {displaced['name']}"}

        # The MOVE already happened and cannot be taken back, so report what
        # the pad actually looks like rather than pretending it failed.
        return {"ok": False, "swapped": True,
                "error": f"moved {moving['name']}, but could not put "
                         f"{displaced['name']} back"}

    async def clear_all(self) -> dict:
        for slot in list(self._placed):
            await self.clear_slot(slot)
        return {"ok": True}

    # ------------------------------------------------------------------
    # LEDs and overlay
    # ------------------------------------------------------------------

    def _on_region(self, index: int, region: LedRegion) -> None:
        """LedPoller callback. Runs on the poller thread, not the loop."""
        previous = self._led_cache.get(region.pad)
        now = time.monotonic()
        if region.mode == 2:  # LedMode.FLASH
            if previous and previous[0].key() == region.key():
                if region.count == 0:
                    started = previous[1]
                else:
                    period = (region.on_ms + region.off_ms) / 1000.0
                    total_dur = (period * region.count) if period > 0 else 0.0
                    if total_dur > 0 and (now - previous[1]) < total_dur:
                        started = previous[1]
                    else:
                        started = now
            else:
                started = now
        elif region.mode == 3:  # LedMode.FADE
            if previous and previous[0].key() == region.key():
                if region.count == 0:
                    started = previous[1]
                else:
                    prev_elapsed_ms = (now - previous[1]) * 1000.0
                    step = max(region.speed_ms, LED_TICK_MS)
                    dur = (step * region.count) / 1000.0 if step > 0 else 0.0
                    if dur > 0 and (now - previous[1]) < dur:
                        started = previous[1]
                    else:
                        started = now
            else:
                started = now
        else:
            started = (previous[1] if previous and previous[0].key() == region.key()
                       else now)
        # Carry the resting colour forward. A SOLID defines it; everything
        # else inherits whatever the pad was last told to hold, so a finite
        # flash can return there instead of going dark.
        # Solid and Fade are RESTING states, so they move the base; a Flash
        # is transient and leaves it alone, which is how a finite flash knows
        # what to return to. Straight from the reference's SetLedState.
        if region.mode != 2:
            rest = (region.r, region.g, region.b)
        else:
            rest = previous[2] if previous and len(previous) > 2 else None
        self._led_cache[region.pad] = (region, started, rest)
        if self.settings["overlayEnabled"]:
            self.overlay.push_led(region, started_ms=int(started * 1000.0))

    def _settled_region(self, r: LedRegion, started: float,
                        rest: Optional[tuple] = None) -> LedRegion:
        """
        Settles completed finite flashes or fades into steady SOLID commands
        before replaying to the overlay. Without this, showing the overlay
        restarts finished animations from t=0.
        """
        if r.mode in (LedMode.OFF, LedMode.SOLID):
            return r
        elapsed_ms = max(0.0, (time.monotonic() - started)) * 1000.0
        if r.mode == LedMode.FLASH:
            period = r.on_ms + r.off_ms
            if period <= 0:
                return LedRegion(pad=r.pad, mode=LedMode.SOLID, r=r.r, g=r.g, b=r.b)
            if r.count and elapsed_ms >= period * r.count:
                if rest:
                    return LedRegion(pad=r.pad, mode=LedMode.SOLID,
                                     r=rest[0], g=rest[1], b=rest[2])
                return LedRegion(pad=r.pad, mode=LedMode.OFF, r=0, g=0, b=0)
            return r
        if r.mode == LedMode.FADE:
            step = max(r.speed_ms, LED_TICK_MS)
            if r.count and elapsed_ms >= step * r.count:
                forward = ((r.count - 1) % 2) == 0
                final_r = r.r if forward else r.from_r
                final_g = r.g if forward else r.from_g
                final_b = r.b if forward else r.from_b
                return LedRegion(pad=r.pad, mode=LedMode.SOLID,
                                 r=final_r, g=final_g, b=final_b)
            return r
        return r

    async def get_selection(self) -> dict:
        """The shared browse cursor. The phone writes it too — see /api/selection."""
        return {"ok": True, **self._selection}

    async def set_selection(self, kind: int, value) -> dict:
        """
        Mirror of the remote's POST. kind: 1 world, 2 virtual, 3 figure,
        4 ability — the numbering is the remote's, so both ends agree.
        """
        kind = int(kind)
        if kind == 1:
            self._selection.update(world=int(value), virtual="")
        elif kind == 2:
            self._selection.update(world=-1, virtual=str(value or ""))
        elif kind == 3:
            self._selection["bin"] = int(value)
        elif kind == 4:
            self._selection["ability"] = int(value)
        elif kind == 5:
            self._selection["slot"] = int(value)
        return {"ok": True, **self._selection}

    async def tag_states(self) -> dict:
        """
        Which figures have a MODIFIED tag on the active backend.

        A vehicle that has been rebuilt in-game has a working file that no
        longer matches the catalog seed. Surfacing that lets you see at a
        glance which tags carry progress, and which are still stock.
        """
        backend = self.settings["activeBackend"]
        root = registry.TAG_CACHE / backend
        modified: list[str] = []
        if root.is_dir():
            for path in root.glob("*.bin"):
                stable = path.stem
                entry = self._index.get(stable)
                if not entry:
                    continue
                seed = Path(decky.DECKY_PLUGIN_DIR) / "assets" / entry["bin"]
                try:
                    if not seed.is_file() or path.read_bytes() != seed.read_bytes():
                        modified.append(stable)
                except OSError:
                    continue
        return {"ok": True, "backend": backend, "modified": modified,
                "writable": bool(self.settings["writableTags"])}

    async def get_led_cached(self) -> dict:
        """
        Last known LED state, with no socket traffic at all.

        The listener serves ONE connection at a time. The modal polling
        get_led while the poller polls it too made them take turns, which is
        exactly the stutter and lag you see with both open. The poller is the
        single reader; everything else reads this.
        """
        by_pad_base = {
            pad: (list(calibrate(*cached[2])) if cached[2] else None)
            for pad, cached in self._led_cache.items()
        }
        regions = []
        for r, started, rest in self._led_cache.values():
            disp_color = list(animated_frame(r, started, base=rest)[0])
            brightness = animated_frame(r, started, base=rest)[1]
            if r.mode == 2 and max(disp_color) < 8:
                base = by_pad_base.get(r.pad)
                if base:
                    disp_color = base
            regions.append({
                "pad": r.pad, "mode": r.mode,
                "rgb": [r.r, r.g, r.b],
                "display": disp_color,
                "brightness": brightness,
                "target": list(calibrate(r.r, r.g, r.b)),
                "onMs": r.on_ms, "offMs": r.off_ms,
                "count": r.count, "speedMs": r.speed_ms,
                "startedMs": started * 1000.0,
                "rest": list(calibrate(*rest)) if rest else None,
            })
        return {"ok": bool(regions), "polling": self._poller is not None,
                "regions": regions}

    def _start_poller(self) -> None:
        if self._poller:
            return
        adapter = self._adapter(self.settings["activeBackend"])
        self._poller = LedPoller(adapter.client, self._on_region)
        self._poller.start()
        decky.logger.info("LED poller started")

    def _stop_poller(self) -> None:
        if self._poller:
            self._poller.stop()
            self._poller = None
        self._led_cache.clear()

    async def get_led(self) -> dict:
        key = self.settings["activeBackend"]
        snap = await self.loop.run_in_executor(None, self._adapter(key).led)
        if not snap:
            return {"ok": False, "regions": []}
        return {"ok": True, "serial": snap.serial,
                "regions": [{"pad": r.pad, "mode": r.mode,
                             "rgb": [r.r, r.g, r.b],
                             "from": [r.from_r, r.from_g, r.from_b],
                             "display": list(calibrate(r.r, r.g, r.b)),
                             "onMs": r.on_ms, "offMs": r.off_ms,
                             "count": r.count, "speedMs": r.speed_ms}
                            for r in snap.regions]}

    async def toggle_overlay(self) -> dict:
        if not self.overlay.available:
            return {"ok": False, "error": "overlay binary missing"}
        visible = self.overlay.toggle()
        if visible:
            # Showing restarts the process, so hand it everything we know
            # rather than waiting for the game to send the next command.
            self.overlay.replay_leds([
                (self._settled_region(r, started, rest), int(started * 1000.0))
                for r, started, rest in self._led_cache.values()
            ])
            for slot, placed in self._placed.items():
                self.overlay.set_figure(slot, placed["name"],
                                        placed.get("atlas", -1))
        # Sneak peek is worthless without live colour, so turn polling on with
        # it rather than making the user find two switches.
        if visible and not self._poller:
            self._start_poller()
        return {"ok": True, "visible": visible}

    # -- hotkeys ----------------------------------------------------------

    def _on_chord(self, keys) -> None:
        """Hotkey thread. Never touch the event loop directly from here."""
        combo = sorted(keys)

        if self._learning:
            which = self._learning
            self._learning = ""
            self.settings[which] = combo
            asyncio.run_coroutine_threadsafe(self._save_settings(), self.loop)
            decky.logger.info("bound %s to %s", which, describe_chord(keys))
            return

        if combo == sorted(self.settings["hotkeyPeek"]):
            if self.overlay.available:
                visible = self.overlay.toggle()
                if visible:
                    self.overlay.replay_leds([
                        (self._settled_region(r, started, rest), int(started * 1000.0))
                        for r, started, rest in self._led_cache.values()
                    ])
                    for slot, placed in self._placed.items():
                        self.overlay.set_figure(slot, placed["name"],
                                                placed.get("atlas", -1))
                if visible and not self._poller:
                    asyncio.run_coroutine_threadsafe(
                        self._start_poller_async(), self.loop)
        elif combo == sorted(self.settings["hotkeyModal"]):
            # Emit to the frontend rather than setting a flag for it to poll.
            # The panel's React tree only exists while the QAM is open, so a
            # polled flag could never fire mid-game — which is exactly when
            # the hotkey matters. The listener for this is registered at
            # plugin scope and outlives the panel.
            self._modal_request += 1
            asyncio.run_coroutine_threadsafe(
                decky.emit("toypad_open_modal"), self.loop)

    async def _start_poller_async(self) -> None:
        self._start_poller()

    async def hotkey_status(self) -> dict:
        return {
            "available": bool(self.hotkeys.devices),
            "learning": self._learning,
            "peek": describe_chord(self.settings["hotkeyPeek"]),
            "modal": describe_chord(self.settings["hotkeyModal"]),
            "modalRequest": self._modal_request,
        }

    async def learn_hotkey(self, which: str) -> dict:
        if which not in ("hotkeyPeek", "hotkeyModal"):
            raise KeyError(which)
        self._learning = which
        return {"ok": True, "learning": which}

    async def cancel_learn(self) -> dict:
        self._learning = ""
        return {"ok": True}

    # -- favourites and recents ------------------------------------------

    async def _touch_recent(self, stable_id: str) -> None:
        recents = [r for r in self.settings["recents"] if r != stable_id]
        recents.insert(0, stable_id)
        self.settings["recents"] = recents[:24]
        await self._save_settings()

    async def toggle_favourite(self, stable_id: str) -> dict:
        favourites = list(self.settings["favourites"])
        if stable_id in favourites:
            favourites.remove(stable_id)
        else:
            favourites.append(stable_id)
        self.settings["favourites"] = favourites
        await self._save_settings()
        return {"ok": True, "favourites": favourites}

    async def get_lists(self) -> dict:
        """Favourites and recents, resolved to full entries and pruned.

        Ids can go stale when the catalog is rebuilt from a newer LegoToypad,
        so anything that no longer resolves is dropped rather than rendered
        as a blank tile."""
        def resolve(ids):
            return [self._entry(self._index[i]) for i in ids if i in self._index]
        return {"favourites": resolve(self.settings["favourites"]),
                "recents": resolve(self.settings["recents"])}

    # -- custom tags ------------------------------------------------------

    async def get_custom_tags(self) -> dict:
        def work():
            self._refresh_custom()
            return {"tags": [
                {**tag.as_entry(),
                 "portrait": (f"http://127.0.0.1:8765/custom/{Path(tag.portrait).name}"
                              if tag.portrait else "")}
                for tag in self._custom
            ], "folder": str(custom_tags.store_dir(registry.INSTALL_ROOT))}
        return await self.loop.run_in_executor(None, work)

    async def import_custom_tag(self, path: str, name: str = "") -> dict:
        def work():
            result = custom_tags.import_file(
                registry.INSTALL_ROOT, path, name or None)
            if result.get("ok"):
                self._refresh_custom()
            return result
        return await self.loop.run_in_executor(None, work)

    async def remove_custom_tag(self, stable_id: str) -> dict:
        def work():
            result = custom_tags.remove(
                registry.INSTALL_ROOT, stable_id)
            if result.get("ok"):
                self._index.pop(stable_id, None)
                self._refresh_custom()
            return result
        return await self.loop.run_in_executor(None, work)

    # -- mods -------------------------------------------------------------

    def _backend_exe(self, key: str) -> Optional[Path]:
        record = Installer(root=self._root()).status(key)
        return Path(record["path"]) if record.get("path") else None

    def _game_for(self, key: str) -> str:
        return self.settings["games"].get(key, "")

    def _app_ver(self, key: str) -> str:
        """
        The EFFECTIVE game version — the patch's, not the base game's.

        A PS4 dump is a base folder plus a sibling update folder
        (CUSA01176 and CUSA01176-patch). shadPS4 applies the update at
        runtime, so the version that matters to Anomaly and to cheat files is
        the patch's. Reading only the base reports 01.00 and refuses to
        install a loader that would have worked perfectly.
        """
        game = self._game_for(key)
        if not game:
            return ""
        base = Path(game).parent if Path(game).is_file() else Path(game)

        def sfo_version(folder: Path) -> str:
            for name in ("param.sfo", "PARAM.SFO"):
                candidate = folder / "sce_sys" / name
                if candidate.is_file():
                    sfo = gamescan.read_sfo(candidate)
                    return sfo.get("APP_VER") or sfo.get("VERSION") or ""
            return ""

        versions = [sfo_version(base)]
        for suffix in ("-patch", "-update", "-UPDATE", "-PATCH"):
            sibling = base.parent / (base.name + suffix)
            if sibling.is_dir():
                versions.append(sfo_version(sibling))
        # Highest wins: the update supersedes the base.
        return max((v for v in versions if v), default="", key=lambda v: v.lstrip("0"))

    async def list_mods(self, key: str = "") -> dict:
        """Everything moddable for a backend, and an honest note where not."""
        backend = key or self.settings["activeBackend"]

        def work():
            exe = self._backend_exe(backend)
            out: dict = {"backend": backend, "mods": [], "sections": [],
                         "note": ""}

            if backend == "cemu" and exe:
                packs = modlib.cemu_list(exe)
                out["mods"] = [m.as_dict() for m in packs]
                out["sections"].append(
                    {"id": "packs", "label": "Graphic packs",
                     "count": len(packs), "installable": True})
                if not packs:
                    out["note"] = ("No packs installed yet — install pulls the "
                                   "community 60FPS and resolution packs.")

            elif backend == "rpcs3" and exe:
                patches = modlib.rpcs3_list(exe)
                out["mods"] = [m.as_dict() for m in patches]
                out["sections"].append(
                    {"id": "patches", "label": "Game patches",
                     "count": len(patches), "installable": False})
                if not patches:
                    out["note"] = ("No patches downloaded. Use RPCS3's "
                                   "Manage \u2192 Game Patches \u2192 Download "
                                   "Latest Patches, then refresh here.")

            elif backend == "shadps4":
                game = self._game_for(backend)
                app_ver = self._app_ver(backend)
                user = shadps4_setup.user_dir(exe)

                if game:
                    status = modlib.anomaly_status(game, app_ver, user)
                    out["anomaly"] = status
                    out["mods"] += [m.as_dict()
                                    for m in modlib.anomaly_mods(game)]
                    out["sections"].append(
                        {"id": "anomaly", "label": "Anomaly mods",
                         "count": status["modCount"], "installable": True})

                if user:
                    cheats = modlib.cheats_list(user, "CUSA01176", app_ver)
                    out["cheats"] = cheats
                    out["sections"].append(
                        {"id": "cheats", "label": "Cheat files",
                         "count": len(cheats), "installable": False})
                    if cheats:
                        # Say it plainly rather than let a dead feature look live.
                        out["note"] = modlib.CHEATS_NOTE

            return out
        return await self.loop.run_in_executor(None, work)

    async def toggle_mod(self, key: str, ident: str, on: bool) -> dict:
        backend = key or self.settings["activeBackend"]

        def work():
            exe = self._backend_exe(backend)
            if backend == "cemu":
                if modlib.running("cemu"):
                    return {"ok": False,
                            "error": "Close Cemu first — it rewrites "
                                     "settings.xml on exit."}
                return modlib.cemu_toggle(exe, ident, bool(on)) if exe else \
                    {"ok": False, "error": "Cemu is not installed"}
            if backend == "rpcs3":
                return modlib.rpcs3_toggle(exe, ident, bool(on)) if exe else \
                    {"ok": False, "error": "RPCS3 is not installed"}
            if backend == "shadps4":
                game = self._game_for(backend)
                if not game:
                    return {"ok": False, "error": "no game selected"}
                return modlib.anomaly_toggle(game, ident, bool(on))
            return {"ok": False, "error": f"{backend} has no mods"}
        return await self.loop.run_in_executor(None, work)

    async def install_mods(self, key: str = "") -> dict:
        """Fetch what upstream offers for this backend."""
        backend = key or self.settings["activeBackend"]

        def work():
            exe = self._backend_exe(backend)
            if backend == "cemu":
                if not exe:
                    return {"ok": False, "error": "Cemu is not installed"}
                if modlib.running("cemu"):
                    return {"ok": False, "error": "Close Cemu first."}
                return modlib.cemu_install_packs(exe)
            if backend == "shadps4":
                game = self._game_for(backend)
                if not game:
                    return {"ok": False, "error": "no game selected"}
                return modlib.anomaly_install(
                    game, self._app_ver(backend),
                    shadps4_setup.user_dir(self._backend_exe(backend)))
            return {"ok": False,
                    "error": f"nothing to install for {backend}"}
        return await self.loop.run_in_executor(None, work)

    async def uninstall_anomaly(self) -> dict:
        """Remove the loader, keeping the mods folder — they are not ours."""
        def work():
            game = self._game_for("shadps4")
            if not game:
                return {"ok": False, "error": "no game selected"}
            return modlib.anomaly_uninstall(
                game, shadps4_setup.user_dir(self._backend_exe("shadps4")))
        return await self.loop.run_in_executor(None, work)

    async def import_cheat_file(self, path: str) -> dict:
        def work():
            user = shadps4_setup.user_dir(self._backend_exe("shadps4"))
            if not user:
                return {"ok": False, "error": "shadPS4 user folder not found"}
            return modlib.cheats_import(user, path)
        return await self.loop.run_in_executor(None, work)

    # -- steam shortcuts --------------------------------------------------

    async def shortcut_status(self) -> dict:
        def work():
            sc = Shortcuts()
            return {"available": sc.available,
                    "steamRunning": steam_running(),
                    "existing": sc.list_ours() if sc.available else []}
        return await self.loop.run_in_executor(None, work)

    async def prepare_backend(self, key: str, game: str = "") -> dict:
        """
        Whatever the emulator needs before it will talk to us.

        For shadPS4: enable Toy Pad, listener port, and register dump directory.
        For Cemu: enable EmulateDimensionsToypad, listener port 9191, 60fps graphic pack, and game path.
        For recomp: rewrite legodimensions.toml paths to the Z:\ drive.
        RPCS3 needs nothing.
        """
        if key not in ("shadps4", "cemu", "recomp"):
            return {"ok": True, "changed": [], "note": "no setup needed"}

        def work():
            if key == "recomp":
                if not game:
                    return {"ok": False, "error": "no game selected"}
                return modlib.recomp_configure(Path(game))
                
            record = Installer(root=self._root()).status(key)
            exe = Path(record["path"]) if record.get("path") else None
            
            if key == "shadps4":
                addon = shadps4_setup.status(exe).get("addonDir") or None
                return shadps4_setup.configure(game=game or None,
                                               addon_dir=addon, exe=exe)
            if key == "cemu":
                if not exe or not exe.is_file():
                    return {"ok": False, "error": "Cemu AppImage not found; install it first"}
                return modlib.cemu_configure(exe, game=game or None)
            return {"ok": True, "changed": []}
        return await self.loop.run_in_executor(None, work)

    async def backend_setup_status(self, key: str) -> dict:
        if key not in ("shadps4", "cemu"):
            return {"found": True, "toypadEnabled": True, "needsSetup": False}

        def work():
            record = Installer(root=self._root()).status(key)
            exe = Path(record["path"]) if record.get("path") else None
            if key == "shadps4":
                info = shadps4_setup.status(exe)
                info["needsSetup"] = not info.get("toypadEnabled", False)
                return info
            if key == "cemu":
                if not exe:
                    return {"found": False, "toypadEnabled": False, "needsSetup": True}
                return modlib.cemu_status(exe)
            return {"found": True, "toypadEnabled": True, "needsSetup": False}
        return await self.loop.run_in_executor(None, work)

    async def shortcut_plan(self, key: str, game: str = "") -> dict:
        """
        Work out what the shortcut should be. The frontend then hands it to
        SteamClient.Apps.AddShortcut.

        We deliberately do NOT write shortcuts.vdf from here. Steam rewrites
        that file from memory when it exits, so an edit made while it is
        running is discarded — and the panel only exists while Steam is
        running. Asking Steam to add it in-process is the only path that can
        work from the UI.
        """
        def work():
            backend = registry.get(key)
            path = game or self.settings["games"].get(key, "")
            
            if not backend.artifact:
                # User-supplied backend (recomp), the game IS the exe
                exe = Path(path) if path else Path("")
                args = "" if not backend.artifact else (backend.launch_args.format(game=path) if path else "")
            else:
                record = Installer(root=self._root()).status(key)
                if not record["installed"]:
                    return {"ok": False, "error": f"{backend.label} is not installed"}
                exe = Path(record["path"])
                args = "" if not backend.artifact else (backend.launch_args.format(game=path) if path else "")

            return {
                "ok": True,
                "name": backend.shortcut_name or backend.label,
                "exe": str(exe),
                "startDir": str(exe.parent) if str(exe) else "",
                "args": args,
            }
        return await self.loop.run_in_executor(None, work)

    async def create_shortcut_offline(self, key: str, game: str = "") -> dict:
        """
        Fallback for a Konsole session with Steam closed — writes the vdf
        directly. Not reachable from the panel, by design.
        """
        def work():
            backend = registry.get(key)
            record = Installer(root=self._root()).status(key)
            if not record["installed"]:
                return {"ok": False, "error": f"{backend.label} is not installed"}
            if steam_running():
                return {"ok": False, "error": "Steam is running; close it first"}
            sc = Shortcuts()
            if not sc.available:
                return {"ok": False, "error": "no Steam user config found"}
            path = game or self.settings["games"].get(key, "")
            args = "" if not backend.artifact else (backend.launch_args.format(game=path) if path else "")
            name = backend.shortcut_name or f"{backend.label} Toypad"
            appid = sc.add(name, Path(record["path"]), args)
            return ({"ok": True, "appid": appid, "name": name}
                    if appid else {"ok": False, "error": "write failed"})
        return await self.loop.run_in_executor(None, work)

    async def remove_shortcut(self, key: str) -> dict:
        def work():
            backend = registry.get(key)
            name = backend.shortcut_name or f"{backend.label} Toypad"
            if steam_running():
                return {"ok": False, "error": "Close Steam first."}
            return {"ok": Shortcuts().remove(name)}
        return await self.loop.run_in_executor(None, work)

    async def set_game_path(self, key: str, path: str) -> dict:
        games = dict(self.settings["games"])
        games[key] = path
        self.settings["games"] = games
        await self._save_settings()
        return {"ok": True, "games": games}

    # -- overlay navigation ---------------------------------------------
    # The overlay has no input region, so the QAM owns navigation and pushes
    # cursor state here. These are thin by design: all the logic lives in the
    # panel, which is the thing actually receiving button presses.

    async def overlay_set_mode(self, picker: bool) -> dict:
        self.overlay.set_mode(bool(picker))
        return {"ok": True}

    async def overlay_set_pad_cursor(self, slot: int) -> dict:
        self.overlay.set_pad_cursor(int(slot))
        return {"ok": True}

    async def overlay_set_grid(self, title: str, items: list,
                               cursor: int = 0) -> dict:
        # items arrive as [[colour, label], ...] over the RPC
        self.overlay.set_grid(title, [(i[0], i[1]) for i in items], int(cursor))
        return {"ok": True}

    async def overlay_set_grid_cursor(self, index: int) -> dict:
        self.overlay.set_grid_cursor(int(index))
        return {"ok": True}

    async def get_remote_url(self) -> str:
        return self.web.remote_url()

    # ------------------------------------------------------------------
    # phone remote API — same handlers, reached over HTTP
    # ------------------------------------------------------------------

    @staticmethod
    def _for_remote(result: dict) -> dict:
        """
        The remote throws `data.status || 'command failed'` on !ok, so an
        error under any other key surfaces as the useless "command failed".
        Mirror ours into `status` on the way out.
        """
        if isinstance(result, dict) and not result.get("ok") and "status" not in result:
            result = {**result, "status": result.get("error") or "command failed"}
        return result

    def _web_api(self, route: str, body: dict):
        run = asyncio.run_coroutine_threadsafe
        if route == "/api/catalog":
            return self._for_remote(run(self.get_catalog(), self.loop).result(10))
        # /api/slots and /api/led are ours; /api/state, /api/leds,
        # /api/favorites and /api/favorite are the names the 1.9 remote calls.
        # Aliasing means its app.js is served verbatim and stays upgradable.
        if route in ("/api/slots", "/api/state"):
            slots = run(self.get_slots(), self.loop).result(5)
            # The remote reads a FLAT pad: occupied / bin / name / portrait /
            # color, indexed 0..6. Ours nests all of that under `occupant`,
            # so `p.bin` was undefined — which is why the pads drew blank,
            # Favourite said "nothing placed" and a drag had nothing to move.
            pads = []
            for slot in slots:
                who = slot.get("occupant")
                entry = self._index.get(who["stableId"]) if who else None
                pads.append({
                    "occupied": bool(who),
                    "bin": (entry or {}).get("binId", -1) if entry else -1,
                    "name": who["name"] if who else "",
                    "portrait": who["portrait"] if who else "",
                    "color": who["ringColor"] if who else "#8B929A",
                    "label": slot["label"],
                })
            return {"slots": slots, "pads": pads,
                    "ledMirror": bool(self.settings["ledEnabled"]),
                    "ok": True}
        if route == "/api/led":
            return self._for_remote(run(self.get_led_cached(), self.loop).result(5))
        if route == "/api/leds":
            # The remote wants a css colour and a 0..1 intensity per region,
            # with mode as a word — it does no colour maths of its own. Ours
            # returns raw rgb and a numeric mode, so translate here rather
            # than making the page understand the wire format.
            snap = run(self.get_led_cached(), self.loop).result(5)
            names = {0: "off", 1: "solid", 2: "flash", 3: "fade"}
            by_pad = {r["pad"]: r for r in snap.get("regions", [])}
            by_pad_base = {
                pad: (list(calibrate(*cached[2])) if cached[2] else None)
                for pad, cached in self._led_cache.items()
            }
            regions = []
            for pad in (2, 1, 3):          # left, centre, right — display order
                r = by_pad.get(pad)
                if not r:
                    regions.append({"mode": "off", "color": "transparent",
                                    "intensity": 0.0})
                    continue
                red, green, blue = r["display"]
                dim = r.get("brightness", 1.0)

                # The remote draws a glow layer tinted with this colour and
                # animates its opacity. A BLACK flash is therefore invisible
                # there whatever we send — black glow over a dark pad
                # animates nothing. The page is upstream's, so the colour is
                # chosen here instead: a black flash blinks the pad's resting
                # colour, which is what the hardware is actually doing.
                if r["mode"] == 2 and max(red, green, blue) < 8:
                    base = by_pad_base.get(r["pad"])
                    if base:
                        red, green, blue = base
                # Colour AND intensity both come from the animated value, so a
                # flash actually blinks on the phone instead of sitting lit:
                # the page just applies what it is given, 90ms at a time.
                regions.append({
                    "mode": names.get(r["mode"], "off"),
                    "color": f"rgb({red},{green},{blue})",
                    # Intensity carries the flash's brightness beat, not just
                    # the colour's own level, so a black flash pulses on the
                    # phone instead of sitting invisible.
                    "intensity": round(dim, 3),
                })
            return {"ok": True, "enabled": bool(self.settings["ledEnabled"]),
                    "regions": regions}
        if route == "/api/favorites":
            # The remote passes this straight to its roster renderer, so it
            # must have a world's shape — characters/vehicles — not our
            # {favourites, recents} pair.
            lists = run(self.get_lists(), self.loop).result(10)
            return {"name": "Favorites", "logo": "",
                    "characters": lists["favourites"], "vehicles": [],
                    "favourites": lists["favourites"],
                    "recents": lists["recents"]}
        if route == "/api/favorite":
            stable = body.get("stableId") or self._by_bin_id.get(int(body.get("bin", -1)), "")
            if not stable:
                return {"ok": False, "status": "unknown figure"}
            result = run(self.toggle_favourite(stable), self.loop).result(5)
            # The remote reads `favorited` to choose between "Added" and
            # "Removed" — without it every toggle reported a removal.
            result["favorited"] = stable in result.get("favourites", [])
            return result
        if route == "/api/tag":
            return self._for_remote(run(self.tag_status(body.get("stableId", "")), self.loop).result(5))
        if route == "/api/reset-tag":
            return self._for_remote(run(self.reset_tag(body["stableId"]), self.loop).result(10))

        # --- the 1.9 extended remote's own additions ---
        if route == "/api/ledmirror":
            if "enabled" in body:
                return self._for_remote(run(self.set_setting("ledEnabled", bool(int(body["enabled"]))),
                           self.loop).result(5)) and {"ok": True}
            return {"ok": True, "enabled": int(self.settings["ledEnabled"])}
        if route == "/api/selection":
            # Two-way cursor sync. The phone shows what the Deck is browsing
            # and can drive it — so it is shared state, not a query, and both
            # ends write to the same place.
            if "slot" in body:
                self._selection["slot"] = int(body["slot"])
            if "kind" in body:
                kind, value = int(body["kind"]), body.get("value")
                if kind == 1:
                    self._selection.update(world=int(value), virtual="")
                elif kind == 2:
                    self._selection.update(world=-1,
                                           virtual="custom" if value else "favorites")
                elif kind == 3:
                    self._selection["bin"] = int(value)
                elif kind == 4:
                    self._selection["ability"] = int(value)
                elif kind == 5:
                    self._selection["slot"] = int(value)
                return {"ok": True, **self._selection}
            return {"ok": True, **self._selection}
        if route == "/api/sort":
            if "sort" in body:
                self.settings["franchiseSort"] = int(body["sort"])
                run(self._save_settings(), self.loop).result(5)
            return {"ok": True, "sort": self.settings.get("franchiseSort", 0),
                    "userOrder": self.settings.get("franchiseOrder", [])}
        if route == "/api/load":
            # The remote sends a numeric bin; our own UI sends a stableId.
            stable = body.get("stableId") or self._by_bin_id.get(int(body.get("bin", -1)), "")
            if not stable:
                return {"ok": False, "status": "unknown figure"}
            slot = int(body["slot"])
            self._selection["slot"] = slot
            return self._for_remote(run(self.load_figure(slot, stable),
                       self.loop).result(10))
        if route == "/api/clear":
            slot = int(body["slot"])
            self._selection["slot"] = slot
            return self._for_remote(run(self.clear_slot(slot), self.loop).result(10))
        if route == "/api/move":
            # The remote sends {src, dest}; our own UI sends {from, to}.
            src = body.get("src", body.get("from"))
            dest = body.get("dest", body.get("to"))
            if src is None or dest is None:
                return {"ok": False, "status": "missing src/dest"}
            self._selection["slot"] = int(dest)
            return self._for_remote(run(self.move_figure(int(src), int(dest)),
                       self.loop).result(15))
        return None
