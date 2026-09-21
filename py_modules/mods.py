"""
Emulator mods — repo path: backend/mods.py

Detect, toggle and install per-emulator mods. Cemu graphic packs first,
because their format is fully specified and the source is canonical.

WHERE THE CONFIG LIVES MATTERS MORE THAN THE FORMAT DOES.

Our Cemu runs portable: it keeps settings and packs beside the AppImage, under
the plugin's own backends directory. A Deck typically has three or four other
Cemu configs lying around — EmuDeck's, RetroDECK's, ~/.config/Cemu — and
writing to any of them looks completely successful and changes nothing in the
emulator we actually launch. Always resolve from the installed AppImage.

Cemu's enabled-pack state is presence, not a flag:

    <GraphicPack>
        <Entry filename="graphicPacks/downloadedGraphicPacks/X/rules.txt"/>
        <Entry filename=".../Y/rules.txt">
            <Preset><category>..</category><preset>..</preset></Preset>
        </Entry>
    </GraphicPack>

Listed means on. Removing the element is how you turn a pack off.
"""

from __future__ import annotations

import io
import json
import logging
import re
import shutil
import tarfile
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# From the packs' own rules.txt — the Wii U releases of LEGO Dimensions.
DIMENSIONS_TITLE_IDS = ("0005000010194200", "0005000010195D00")

GRAPHIC_PACKS_TARBALL = (
    "https://github.com/cemu-project/cemu_graphic_packs"
    "/archive/refs/heads/master.tar.gz"
)

USER_AGENT = "dimensions-toypad/1.0"


def _opener_context():
    """
    Reuse install.py's CA discovery.

    Decky's Python has no working default trust store, so a plain urlopen dies
    with CERTIFICATE_VERIFY_FAILED — which is exactly what "Get graphic packs"
    did. install.py already probes certifi, the system default and each known
    bundle with a real handshake; borrowing it beats solving this twice.
    """
    try:
        import install                                       # noqa: PLC0415
        return install._ssl_context()
    except Exception:                                        # noqa: BLE001
        return None


@dataclass
class Mod:
    backend: str
    ident: str            # path relative to the Cemu data dir; the toggle key
    name: str
    description: str
    category: str
    enabled: bool
    presets: list

    def as_dict(self) -> dict:
        return asdict(self)


# ----------------------------------------------------------------------
# Cemu
# ----------------------------------------------------------------------

def cemu_root(exe: Path) -> Path:
    """
    Cemu's portable data directory: the folder holding the AppImage.

    install.py places each backend at <root>/<key>/<file>.AppImage, and a
    portable Cemu writes config/ and graphicPacks/ next to itself.
    """
    return Path(exe).expanduser().resolve().parent


def cemu_settings(exe: Path) -> Optional[Path]:
    candidate = cemu_root(exe) / "config" / "Cemu" / "settings.xml"
    return candidate if candidate.is_file() else None


def cemu_packs_dir(exe: Path) -> Path:
    path = cemu_root(exe) / "graphicPacks"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _parse_rules(rules: Path) -> dict:
    """
    Minimal INI reader for a pack's rules.txt.

    Deliberately not configparser: these files carry duplicate [Preset]
    sections and unquoted values that configparser rejects outright.
    """
    out: dict = {"titleIds": [], "name": "", "description": "",
                 "path": "", "presets": []}
    section = ""
    try:
        text = rules.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].lower()
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip().lower(), value.strip().strip('"')

        if section == "definition":
            if key == "titleids":
                out["titleIds"] = [t.strip().upper().zfill(16)
                                   for t in value.split(",") if t.strip()]
            elif key in ("name", "description", "path"):
                out[key] = value
        elif section == "preset" and key == "name":
            out["presets"].append(value)
    return out


# Deliberately NOT xml.dom.minidom, and not xml.etree either: Decky runs
# plugins on a trimmed Python with no xml package at all. An import error at
# module scope takes the entire plugin down — the panel never finishes loading
# — which is exactly what happened the first time, twice.
#
# settings.xml is machine-written by Cemu, so its shape is predictable: a
# single <GraphicPack> block of <Entry filename="..."/> elements, some with
# nested <Preset> children. Text editing is safe here in a way it would not be
# on hand-written XML.
GRAPHICPACK_RE = re.compile(r"(<GraphicPack\s*/>)|"
                            r"(<GraphicPack>)(.*?)(</GraphicPack>)", re.S)
ENTRY_RE = re.compile(r'<Entry\s+filename="([^"]+)"\s*(?:/>|>.*?</Entry>)', re.S)


def _graphicpack_block(xml: str):
    """(before, inner, after) around the GraphicPack contents, or None."""
    m = GRAPHICPACK_RE.search(xml)
    if not m:
        return None
    if m.group(1):                       # self-closing <GraphicPack/>
        return xml[:m.start()], "", xml[m.end():], True
    return (xml[:m.start(3)], m.group(3), xml[m.end(3):], False)


def _enabled_entries(settings: Path) -> set[str]:
    try:
        xml = settings.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        log.warning("could not read %s: %s", settings, exc)
        return set()
    block = _graphicpack_block(xml)
    if not block:
        return set()
    return set(ENTRY_RE.findall(block[1]))


def cemu_list(exe: Path, title_ids=DIMENSIONS_TITLE_IDS) -> list[Mod]:
    """Every installed pack that declares one of our title ids."""
    packs_dir = cemu_packs_dir(exe)
    settings = cemu_settings(exe)
    enabled = _enabled_entries(settings) if settings else set()
    wanted = {t.upper().zfill(16) for t in title_ids}

    mods: list[Mod] = []
    for rules in sorted(packs_dir.rglob("rules.txt")):
        info = _parse_rules(rules)
        if wanted and not (wanted & set(info["titleIds"])):
            continue

        ident = rules.relative_to(cemu_root(exe)).as_posix()
        # Cemu's own category is the leading part of `path`, e.g.
        # "Lego Dimensions/Mods/60FPS" -> Mods.
        parts = [p for p in info["path"].split("/") if p]
        category = parts[1] if len(parts) > 1 else "Other"

        mods.append(Mod(
            backend="cemu",
            ident=ident,
            name=info["name"] or rules.parent.name,
            description=info["description"],
            category=category,
            enabled=ident in enabled,
            presets=info["presets"],
        ))
    return mods


def cemu_toggle(exe: Path, ident: str, on: bool) -> dict:
    """
    Add or remove the pack's <Entry>. Presence is the enabled state.

    Only the targeted element is touched — other packs, their nested <Preset>
    children and every other section of settings.xml are left byte for byte
    as they were.

    Cemu rewrites settings.xml on exit, so this must run with Cemu closed or
    the edit is discarded — the same trap as Steam's shortcuts.vdf and
    shadPS4's config.json.
    """
    settings = cemu_settings(exe)
    if not settings:
        return {"ok": False, "error": "no Cemu settings.xml — run Cemu once first"}

    try:
        xml = settings.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    block = _graphicpack_block(xml)
    if not block:
        return {"ok": False, "error": "no <GraphicPack> section in settings.xml"}

    before, inner, after, self_closed = block
    present = ident in set(ENTRY_RE.findall(inner))

    if on and present:
        return {"ok": True, "changed": False, "enabled": True}

    if on:
        entry = f'\n        <Entry filename="{ident}"/>'
        inner = inner.rstrip() + entry + "\n    "
    else:
        if not present:
            return {"ok": True, "changed": False, "enabled": False}
        drop = re.compile(
            r'\s*<Entry\s+filename="' + re.escape(ident) + r'"\s*(?:/>|>.*?</Entry>)',
            re.S)
        inner = drop.sub("", inner)

    rebuilt = (before + ("<GraphicPack>" if self_closed else "")
               + inner + ("</GraphicPack>" if self_closed else "") + after)

    try:
        shutil.copy2(settings, settings.with_suffix(".xml.bak"))
        settings.write_text(rebuilt, encoding="utf-8")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    return {"ok": True, "changed": True, "enabled": on,
            "backup": str(settings.with_suffix(".xml.bak"))}


def cemu_status(exe: Path) -> dict:
    settings = cemu_settings(exe)
    if not settings:
        return {"found": False, "toypadEnabled": False, "running": running("cemu"), "needsSetup": True}
    try:
        xml = settings.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {"found": True, "toypadEnabled": False, "running": running("cemu"), "needsSetup": True}
    toypad_on = "<EmulateDimensionsToypad>true</EmulateDimensionsToypad>" in xml
    return {
        "found": True,
        "toypadEnabled": toypad_on,
        "running": running("cemu"),
        "needsSetup": not toypad_on,
    }


def cemu_configure(exe: Path, game: Optional[str] = None) -> dict:
    if running("cemu"):
        return {"ok": False, "error": "Close Cemu first — it rewrites settings.xml on exit."}
    settings = cemu_settings(exe)
    if not settings:
        return {"ok": False, "error": "no Cemu settings.xml — run Cemu once first"}

    try:
        xml = settings.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    changed = []
    # 1. Ensure EmulatedUsbDevices with EmulateDimensionsToypad = true and DimensionsToypadListenerPort = 9191
    if "<EmulatedUsbDevices>" not in xml:
        usb_block = """    <EmulatedUsbDevices>
        <EmulateSkylanderPortal>false</EmulateSkylanderPortal>
        <EmulateInfinityBase>false</EmulateInfinityBase>
        <EmulateDimensionsToypad>true</EmulateDimensionsToypad>
        <DimensionsToypadListenerPort>9191</DimensionsToypadListenerPort>
    </EmulatedUsbDevices>
"""
        if "</content>" in xml:
            xml = xml.replace("</content>", usb_block + "</content>")
            changed.append("Toy Pad USB backend enabled")
    else:
        if "<EmulateDimensionsToypad>true</EmulateDimensionsToypad>" not in xml:
            if "<EmulateDimensionsToypad>" in xml:
                xml = re.sub(r"<EmulateDimensionsToypad>.*?</EmulateDimensionsToypad>",
                             "<EmulateDimensionsToypad>true</EmulateDimensionsToypad>", xml)
            else:
                xml = xml.replace("<EmulatedUsbDevices>",
                                  "<EmulatedUsbDevices>\n        <EmulateDimensionsToypad>true</EmulateDimensionsToypad>")
            changed.append("Toy Pad emulation enabled")
        if "<DimensionsToypadListenerPort>9191</DimensionsToypadListenerPort>" not in xml:
            if "<DimensionsToypadListenerPort>" in xml:
                xml = re.sub(r"<DimensionsToypadListenerPort>.*?</DimensionsToypadListenerPort>",
                             "<DimensionsToypadListenerPort>9191</DimensionsToypadListenerPort>", xml)
            else:
                xml = xml.replace("</EmulatedUsbDevices>",
                                  "    <DimensionsToypadListenerPort>9191</DimensionsToypadListenerPort>\n    </EmulatedUsbDevices>")
            changed.append("Toy Pad port set to 9191")

    # 2. Add game dir to GamePaths if game is given
    if game:
        gpath = Path(game)
        gdir = str(gpath.parent.parent if gpath.parent.name.lower() == "code" else (gpath.parent if gpath.is_file() else gpath))
        if f"<Entry>{gdir}</Entry>" not in xml:
            if "<GamePaths>" in xml and "</GamePaths>" in xml:
                xml = xml.replace("</GamePaths>", f"    <Entry>{gdir}</Entry>\n    </GamePaths>")
                changed.append("registered game directory in Cemu")
            elif "</content>" in xml:
                xml = xml.replace("</content>", f"    <GamePaths>\n        <Entry>{gdir}</Entry>\n    </GamePaths>\n</content>")
                changed.append("registered game directory in Cemu")

    if changed:
        try:
            shutil.copy2(settings, settings.with_suffix(".xml.bak"))
            settings.write_text(xml, encoding="utf-8")
        except OSError as exc:
            return {"ok": False, "error": f"Failed to write settings.xml: {exc}"}

    # 3. Enable 60FPS Graphic Pack if present
    cemu_root_dir = cemu_root(exe)
    for p in (cemu_root_dir / "graphicPacks").rglob("rules.txt"):
        if "60fps" in p.as_posix().lower() and "dimensions" in p.as_posix().lower():
            rel = p.relative_to(cemu_root_dir).as_posix()
            res = cemu_toggle(exe, rel, True)
            if res.get("changed"):
                changed.append("60FPS graphic pack enabled")
            break

    return {"ok": True, "changed": changed}


def cemu_install_packs(exe: Path, title_ids=DIMENSIONS_TITLE_IDS,
                       progress=None) -> dict:
    """
    Fetch the community packs and keep only the ones for this game.

    The branch tarball rather than a release asset: release names have changed
    over the years (appveyor builds), and a URL that breaks when upstream
    renames something is worse than one extra megabyte of download.

    Only matching packs are extracted — the full set is thousands of folders
    for games that are not this one.
    """
    dest = cemu_packs_dir(exe) / "downloadedGraphicPacks"
    dest.mkdir(parents=True, exist_ok=True)
    wanted = {t.upper().zfill(16) for t in title_ids}

    req = urllib.request.Request(GRAPHIC_PACKS_TARBALL,
                                 headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=120,
                                    context=_opener_context()) as response:
            blob = response.read()
    except Exception as exc:                                  # noqa: BLE001
        return {"ok": False, "error": f"download failed: {exc}"}

    if progress:
        progress(0.5, "extracting")

    installed: list[str] = []
    try:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
            members = tar.getmembers()
            # Find rules.txt files whose titleIds match, then take their whole
            # containing folder.
            keep_prefixes: list[str] = []
            for m in members:
                if not m.name.endswith("/rules.txt"):
                    continue
                f = tar.extractfile(m)
                if not f:
                    continue
                head = f.read(2048).decode("utf-8", "replace")
                ids = re.search(r"titleIds\s*=\s*(.+)", head, re.I)
                if not ids:
                    continue
                found = {t.strip().upper().zfill(16)
                         for t in ids.group(1).split(",") if t.strip()}
                if wanted & found:
                    keep_prefixes.append(m.name.rsplit("/rules.txt", 1)[0])

            for prefix in keep_prefixes:
                pack_name = prefix.rsplit("/", 1)[-1]
                target = dest / pack_name
                for m in members:
                    if not m.name.startswith(prefix + "/") or not m.isfile():
                        continue
                    rel = m.name[len(prefix) + 1:]
                    # Never let an archive path escape the destination.
                    out = (target / rel).resolve()
                    if not str(out).startswith(str(target.resolve())):
                        continue
                    out.parent.mkdir(parents=True, exist_ok=True)
                    src = tar.extractfile(m)
                    if src:
                        out.write_bytes(src.read())
                if target.is_dir():
                    installed.append(pack_name)
    except (tarfile.TarError, OSError) as exc:
        return {"ok": False, "error": f"extract failed: {exc}"}

    return {"ok": True, "installed": sorted(set(installed)),
            "path": str(dest)}


# ----------------------------------------------------------------------
# RPCS3
# ----------------------------------------------------------------------

def rpcs3_config_dir(exe: Path) -> Path:
    return Path(exe).expanduser().resolve().parent / "config" / "rpcs3"


def rpcs3_list(exe: Path, title_ids=("BLES02105", "BLUS31363",
                                     "BLES02052", "NPEB02221")) -> list[Mod]:
    """
    Patches RPCS3 knows about for this game.

    RPCS3 splits definitions from state exactly as Cemu does: patches/patch.yml
    holds what a patch IS, patch_config.yml holds whether it is ticked. The
    definition file only exists after Patch Manager has downloaded it, so an
    empty list here usually means "none downloaded yet", not "none exist".

    Parsed by hand rather than with PyYAML: Decky's Python is trimmed and does
    not ship it, and an import error at module scope takes the whole plugin
    down — which has already happened once with xml.etree.
    """
    patches = rpcs3_config_dir(exe) / "patches" / "patch.yml"
    if not patches.is_file():
        return []

    enabled = _rpcs3_enabled(exe)
    wanted = {t.upper() for t in title_ids}
    mods: list[Mod] = []
    group = name = ""

    try:
        lines = patches.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip().rstrip(":")

        if indent == 0 and stripped:
            group, name = stripped, ""
        elif indent == 2 and stripped:
            name = stripped.strip('"')
        elif name and any(t in line.upper() for t in wanted):
            key = f"{group}/{name}"
            if not any(m.ident == key for m in mods):
                mods.append(Mod(backend="rpcs3", ident=key, name=name,
                                description="", category="Patch",
                                enabled=key in enabled, presets=[]))
    return mods


def _rpcs3_enabled(exe: Path) -> set[str]:
    cfg = rpcs3_config_dir(exe) / "patch_config.yml"
    if not cfg.is_file():
        return set()
    out: set[str] = set()
    group = name = ""
    try:
        for line in cfg.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip())
            stripped = line.strip().rstrip(":")
            if indent == 0:
                group, name = stripped, ""
            elif indent == 2:
                name = stripped.strip('"')
            elif "enabled" in line.lower() and "true" in line.lower() and name:
                out.add(f"{group}/{name}")
    except OSError:
        pass
    return out


def rpcs3_toggle(exe: Path, ident: str, on: bool) -> dict:
    """Write the ticked state into patch_config.yml, preserving everything else."""
    cfg = rpcs3_config_dir(exe) / "patch_config.yml"
    group, _, name = ident.partition("/")
    if not group or not name:
        return {"ok": False, "error": f"bad patch id: {ident}"}

    existing = ""
    if cfg.is_file():
        try:
            existing = cfg.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    block = f'{group}:\n  "{name}":\n    Enabled: {"true" if on else "false"}\n'
    pattern = re.compile(
        rf'^{re.escape(group)}:\n(?:  "{re.escape(name)}":\n(?:    .*\n)*)',
        re.M)

    updated = pattern.sub(block, existing) if pattern.search(existing) \
        else (existing.rstrip("\n") + "\n" + block if existing else block)

    try:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        if cfg.is_file():
            shutil.copy2(cfg, cfg.with_suffix(".yml.bak"))
        cfg.write_text(updated, encoding="utf-8")
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "changed": True, "enabled": on}


# ----------------------------------------------------------------------
# shadPS4
# ----------------------------------------------------------------------

def shadps4_list(user_dir: Path,
                 title_ids=("CUSA01176", "CUSA02514")) -> list[Mod]:
    """
    Patch XMLs covering this game, across every downloaded repo.

    shadPS4 keeps one XML per game under patches/<repo>/, each naming the
    title ids it applies to. At the time of writing neither GoldHEN nor the
    shadPS4 repo carries anything for LEGO Dimensions — this scans anyway, so
    the day someone publishes one it simply appears.
    """
    base = Path(user_dir) / "patches"
    if not base.is_dir():
        return []
    wanted = {t.upper() for t in title_ids}

    mods: list[Mod] = []
    for xml in sorted(base.glob("*/*.xml")):
        try:
            head = xml.read_text(encoding="utf-8", errors="replace")[:4096]
        except OSError:
            continue
        if not any(t in head.upper() for t in wanted):
            continue
        name = re.search(r'<Name>(.*?)</Name>', head, re.I | re.S)
        mods.append(Mod(backend="shadps4", ident=str(xml),
                        name=(name.group(1).strip() if name else xml.stem),
                        description=xml.parent.name, category="Patch",
                        enabled=True, presets=[]))
    return mods


# ----------------------------------------------------------------------
# Anomaly — game mods for the PS4 build
# ----------------------------------------------------------------------
#
# A mod LOADER, not a patch list, which is why it belongs here rather than
# beside the emulator patch scanners. anomaly.prx goes in the game's
# sce_module/ folder and gives the game a mods/ folder whose .DAT archives
# take priority over the shipped ones — so several mods can touch the same
# file instead of overwriting each other.
#
# PS4 only, and only on game version 1.24. Both are checked before install,
# because the failure mode otherwise is a game that boots and silently
# ignores every mod.

ANOMALY_RELEASE = "https://github.com/connorh315/anomaly/releases/download"
ANOMALY_VERSION = "v1.1"
ANOMALY_ASSET = "anomaly.prx"
ANOMALY_REQUIRED_APP_VER = "01.24"
PRX_MAGIC = b"\x4f\x15\x3d\x1d"


def anomaly_dir(game: Path) -> Path:
    """The game root: where data/, sce_module/ and sce_sys/ live."""
    game = Path(game).expanduser()
    return game.parent if game.is_file() else game


def anomaly_module_dir(user_dir: Path, serial: str = "CUSA01176") -> Path:
    """
    Where shadPS4 actually auto-loads modules from.

    Its linker walks custom_modules/<GAME_SERIAL>/ at startup and calls
    LoadAndStartModule on everything it finds. The game's own sce_module/ is
    only consulted when the GAME asks for a named module from a fixed Sony
    table — a .prx dropped in there is never touched, which is why Anomaly
    installed happily and never appeared.
    """
    return Path(user_dir) / "custom_modules" / serial


def anomaly_status(game: Path, app_ver: str = "",
                   user_dir: Optional[Path] = None,
                   serial: str = "CUSA01176") -> dict:
    root = anomaly_dir(game)
    prx = (anomaly_module_dir(user_dir, serial) / ANOMALY_ASSET
           if user_dir else root / "sce_module" / ANOMALY_ASSET)
    mods_dir = root / "mods"

    version_ok = (not app_ver) or app_ver.lstrip("0") >= \
        ANOMALY_REQUIRED_APP_VER.lstrip("0")

    return {
        "installed": prx.is_file(),
        "root": str(root),
        "prx": str(prx),
        "modsDir": str(mods_dir),
        "modCount": len(anomaly_mods(game)),
        "appVer": app_ver,
        "versionOk": version_ok,
        "note": ("" if version_ok else
                 f"game is {app_ver}; Anomaly needs {ANOMALY_REQUIRED_APP_VER} "
                 "— install the update first"),
    }


def anomaly_mods(game: Path) -> list[Mod]:
    """
    Installed mods. A mod is a .DAT with a matching .HDR — the loader skips
    either one on its own, so a lone file is reported as incomplete rather
    than silently ignored.
    """
    root = anomaly_dir(game)
    out: list[Mod] = []
    for state, folder in (("on", root / "mods"),
                          ("off", root / "mods" / ".disabled")):
        if not folder.is_dir():
            continue
        for dat in sorted(folder.glob("*.DAT")) + sorted(folder.glob("*.dat")):
            hdr = dat.with_suffix(".HDR")
            if not hdr.is_file():
                hdr = dat.with_suffix(".hdr")
            out.append(Mod(
                backend="shadps4", ident=dat.name, name=dat.stem,
                description="" if hdr.is_file() else "missing its .HDR — not loaded",
                category="Anomaly", enabled=(state == "on" and hdr.is_file()),
                presets=[]))
    return out


def anomaly_install(game: Path, app_ver: str = "",
                    user_dir: Optional[Path] = None,
                    serial: str = "CUSA01176") -> dict:
    root = anomaly_dir(game)
    if not (root / "sce_sys").is_dir():
        return {"ok": False,
                "error": f"{root} does not look like a PS4 game folder"}
    if not user_dir:
        return {"ok": False, "error": "shadPS4 user folder not found"}

    status = anomaly_status(game, app_ver, user_dir, serial)
    if not status["versionOk"]:
        return {"ok": False, "error": status["note"]}

    url = f"{ANOMALY_RELEASE}/{ANOMALY_VERSION}/{ANOMALY_ASSET}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60,
                                    context=_opener_context()) as response:
            blob = response.read()
    except Exception as exc:                                  # noqa: BLE001
        return {"ok": False, "error": f"download failed: {exc}"}

    # A fake-signed PS4 module starts 4F 15 3D 1D. Copying something else into
    # sce_module/ gives a game that refuses to boot with no useful message.
    if blob[:4] != PRX_MAGIC:
        return {"ok": False, "error": "downloaded file is not a PS4 module"}

    module_dir = anomaly_module_dir(user_dir, serial)
    try:
        module_dir.mkdir(parents=True, exist_ok=True)
        (module_dir / ANOMALY_ASSET).write_bytes(blob)
        # mods/ still lives beside the game — that part of the README is right.
        (root / "mods").mkdir(exist_ok=True)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    return {"ok": True, "version": ANOMALY_VERSION, "bytes": len(blob),
            "modsDir": str(root / "mods"), "moduleDir": str(module_dir)}


def anomaly_uninstall(game: Path, user_dir: Optional[Path] = None,
                      serial: str = "CUSA01176") -> dict:
    prx = (anomaly_module_dir(user_dir, serial) / ANOMALY_ASSET
           if user_dir else anomaly_dir(game) / "sce_module" / ANOMALY_ASSET)
    try:
        existed = prx.is_file()
        prx.unlink(missing_ok=True)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    # mods/ is left alone: removing the loader should not throw away the mods.
    return {"ok": True, "removed": existed}


def anomaly_toggle(game: Path, ident: str, on: bool) -> dict:
    """
    Enable or disable by moving the pair in or out of mods/.disabled.

    Anomaly's own instruction is "remove it from the folder", so a hidden
    subfolder keeps that contract while letting the file be put back without
    re-downloading it.
    """
    root = anomaly_dir(game)
    live, shelf = root / "mods", root / "mods" / ".disabled"
    src_dir, dst_dir = (shelf, live) if on else (live, shelf)

    try:
        dst_dir.mkdir(parents=True, exist_ok=True)
        moved = []
        for suffix in (".DAT", ".dat", ".HDR", ".hdr"):
            candidate = src_dir / (Path(ident).stem + suffix)
            if candidate.is_file():
                shutil.move(str(candidate), str(dst_dir / candidate.name))
                moved.append(candidate.name)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}

    if not moved:
        return {"ok": False, "error": f"{ident} not found"}
    return {"ok": True, "enabled": on, "moved": moved}


# ----------------------------------------------------------------------
# shadPS4 cheats
# ----------------------------------------------------------------------
#
# FILE MANAGEMENT ONLY, DELIBERATELY.
#
# The JSON cheat format is parsed by shadPS4's Qt GUI, not by the emulator
# core: memory_patcher.cpp handles XML patches and nothing else. Our
# Shadps4-sdl.AppImage has no Qt in it at all, so a cheat file dropped into
# cheats/ is read by nobody and changes nothing — silently, which is the worst
# way for a feature to not work.
#
# So the plugin keeps the files tidy and reports honestly, rather than
# pretending. Making them take effect means either the Qt build or patching
# eboot.bin on disk, and neither is this module's business.

CHEAT_EXT = ".json"


def cheats_dir(user_dir: Path) -> Path:
    path = Path(user_dir) / "cheats"
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class CheatFile:
    path: str
    name: str
    title_id: str
    version: str
    cheats: list          # [{name, hint, type}]
    credits: list
    applies: bool         # matches the installed game's id AND version

    def as_dict(self) -> dict:
        return asdict(self)


def read_cheat_file(path: Path) -> Optional[CheatFile]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or "mods" not in data:
        return None

    mods_list = data.get("mods") or []
    return CheatFile(
        path=str(path),
        name=str(data.get("name") or Path(path).stem),
        title_id=str(data.get("id") or "").upper(),
        version=str(data.get("version") or ""),
        cheats=[{"name": str(m.get("name", "")),
                 "hint": str(m.get("hint", "")),
                 "type": str(m.get("type", ""))}
                for m in mods_list if isinstance(m, dict)],
        credits=[str(c) for c in (data.get("credits") or [])],
        applies=False,
    )


def cheats_list(user_dir: Path, title_id: str = "CUSA01176",
                app_ver: str = "") -> list[dict]:
    """
    Every cheat file present, flagged for whether it matches this dump.

    Version matters as much as the title id: these files patch fixed byte
    offsets, so a file for 01.24 against a different build writes into the
    wrong place. A mismatch is reported, never quietly applied.
    """
    out: list[dict] = []
    want_id = (title_id or "").upper()
    for path in sorted(cheats_dir(user_dir).glob(f"*{CHEAT_EXT}")):
        parsed = read_cheat_file(path)
        if not parsed:
            continue
        id_ok = (not want_id) or parsed.title_id == want_id
        ver_ok = (not app_ver) or (not parsed.version) or \
            parsed.version.lstrip("0") == app_ver.lstrip("0")
        parsed.applies = id_ok and ver_ok
        entry = parsed.as_dict()
        entry["mismatch"] = ("" if parsed.applies else
                             f"for {parsed.title_id} {parsed.version}"
                             f" — your dump is {want_id} {app_ver or '?'}")
        out.append(entry)
    return out


def cheats_import(user_dir: Path, source: str) -> dict:
    """Copy a cheat file in, validating that it is one before it lands."""
    src = Path(source).expanduser()
    if not src.is_file():
        return {"ok": False, "error": f"no such file: {src}"}

    parsed = read_cheat_file(src)
    if not parsed:
        return {"ok": False, "error": "not a shadPS4 cheat file"}

    dest = cheats_dir(user_dir) / src.name
    # Same id AND version is the same file's job — replace it rather than
    # accumulating CUSA01176_01_24 (1).json copies that all fight each other.
    for existing in cheats_dir(user_dir).glob(f"*{CHEAT_EXT}"):
        other = read_cheat_file(existing)
        if other and other.title_id == parsed.title_id \
                and other.version == parsed.version:
            dest = existing
            break

    try:
        shutil.copy2(src, dest)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "name": parsed.name, "cheats": len(parsed.cheats),
            "path": str(dest), "replaced": dest.name != src.name}


def cheats_remove(user_dir: Path, path: str) -> dict:
    target = Path(path)
    if target.parent.resolve() != cheats_dir(user_dir).resolve():
        return {"ok": False, "error": "not a managed cheat file"}
    try:
        target.unlink(missing_ok=True)
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True}


CHEATS_NOTE = (
    "Cheat files are managed here, but the SDL build cannot apply them — "
    "shadPS4 parses this format in its Qt GUI, which this AppImage does not "
    "include."
)


def running(name: str) -> bool:
    """Is this emulator running? Editing its config while it is loses the edit."""
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdigit():
                continue
            try:
                if name.lower() in (entry / "comm").read_text().strip().lower():
                    return True
            except OSError:
                continue
    except OSError:
        pass
    return False

def recomp_configure(exe: Path) -> dict:
    import re
    
    parent_dir = exe.parent
    toml_path = parent_dir / "legodimensions.toml"
    if not toml_path.is_file():
        return {"ok": True, "changed": [], "note": "No legodimensions.toml found"}
        
    win_base = "Z:" + str(parent_dir).replace("/", "\\")
    
    defaults = {
        "game_data_root": r"game",
        "update_data_root": r"update",
        "user_data_root": r"content",
        "log_file": r"game.log",
        "hid_mappings_file": r"gamecontrollerdb.txt",
        "mods_root": r"mods",
        "mods_update_root": r"update-mods",
        "modcli_path": r"tools\modcli\modcli.exe",
        "mods_content_root": r"content\0000000000000000\5752084B\00000002",
        "mods_game_root": r"game",
        "updater_path": r"tools\rexupdate\rexupdate.exe",
    }
    
    with open(toml_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    changed = False
    for i, line in enumerate(lines):
        match = re.match(r"^([a-zA-Z0-9_]+)\s*=\s*(['\"].*?['\"])", line)
        if match:
            key = match.group(1)
            if key in defaults:
                new_val = f"'{win_base}\\{defaults[key]}'"
                if match.group(2) != new_val:
                    lines[i] = f"{key} = {new_val}\n"
                    changed = True
                    
    if changed:
        with open(toml_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        return {"ok": True, "changed": ["Rewrote paths to Z:\\"]}
    return {"ok": True, "changed": [], "note": "Paths already correct"}
