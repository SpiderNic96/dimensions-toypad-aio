// SPDX-License-Identifier: MIT
import * as DFL from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { FaCubes } from "react-icons/fa";
import {
  getState,
  getFranchises,
  getFigures,
  loadFigure,
  removeFigure,
  moveFigure,
  clearAll,
  checkListener,
  setupStatus,
  getPadColors,
  getLedDiagnostics,
  hotkeyState,
  hotkeyCapture,
  hotkeySet,
  installTags,
  installLauncher,
  installShortcuts,
  setWeb,
  checkRpcs3Release,
  installRpcs3,
  setLedEnabled,
  getLedEnabled,
  setDiagnosticsEnabled,
  getDiagnosticsEnabled,
  resetPaths,
  runSetup,
  getFavourites,
  toggleFavourite,
  getCurrentBackend,
  setBackend,
  getConfigSetting,
  setConfigSetting,
} from "./api";
import { Check, PadGrid, PAD_VIEW } from "./Pad";
import { FranchiseRow, FigureRow, ModalFranchiseTile, ModalFigureRow } from "./Picker";
import { ledMapEqual } from "./led";

// R8: user-facing strings must name whichever backend is actually active,
// not assume RPCS3 - "waiting for RPCS3" reads as broken when Xenia is the
// one connected. Short, display-friendly names; the RPC layer already
// has the full label via getBackends() when that's ever needed instead.
const BACKEND_SHORT_NAMES: Record<string, string> = { rpcs3: "RPCS3", xenia: "Xenia" };
const backendShortName = (key: string) => BACKEND_SHORT_NAMES[key] || (key ? key.toUpperCase() : "the backend");

// v3.3.12: the Quick Access menu runs its own focus pass shortly after a panel
// mounts, and it lands on the last ButtonItem rather than the pad. Re-asserting
// focus on a short ladder of timers wins that race without fighting Steam's
// own navigation once the user starts moving.
const useLandingFocus = (ref: any, deps: any) => {
    useEffect(() => {
        let live = true;
        const grab = () => {
            if (!live || !ref.current)
                return;
            try {
                const el = ref.current;
                // Steam wraps DOM nodes differently across builds; try each
                // shape, and fall back to a synthetic focus on the node itself.
                const node = (el && el.element) ? el.element
                    : (el && el.m_element) ? el.m_element
                    : el;
                if (node && typeof node.focus === "function") {
                    node.focus({ preventScroll: false });
                    if (node.scrollIntoView)
                        node.scrollIntoView({ block: "nearest" });
                }
            }
            catch (e) { /* Steam focus internals vary by build */ }
        };
        const timers = [0, 60, 180, 400, 700, 1100].map((t) => setTimeout(grab, t));
        return () => { live = false; timers.forEach(clearTimeout); };
    }, deps || []);
};

function notify(res: any) {
    if (!res.ok) {
        toaster.toast({ title: "Toypad", body: res.error ?? "Something went wrong" });
        return false;
    }
    if (res.message) {
        toaster.toast({ title: "Toypad", body: res.message });
    }
    if (res.warning) {
        toaster.toast({ title: "Toypad", body: res.warning });
    }
    return true;
}

// ---------------------------------------------------------------- setup
const FOCUS_CSS = `
.dt-tag-card, .dt-tag-card:focus, .dt-tag-card:focus-within, .dt-tag-card:hover { background: #141821 !important; color: #ffffff !important; }
.dt-tag-card:focus, .dt-tag-card:focus-within { outline: 2px solid #45b8ff !important; outline-offset: -2px; box-shadow: 0 0 0 2px rgba(69,184,255,.20), 0 4px 12px rgba(0,0,0,.35) !important; transform: scale(1.015); }
.dt-pad-focus { outline: 2px solid #ffffff !important; outline-offset: 1px; transform: scale(1.03); }
.dt-row-focus { outline: 2px solid #45b8ff !important; outline-offset: -2px; }
.dt-cell, .dt-zone { transition: background .18s linear, border-color .18s linear, box-shadow .18s linear; }
.dt-glow { border-radius: inherit; }
.dt-toypad-modal-root { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; overflow: hidden !important; }
.dt-toypad-modal-root > div { width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important; overflow: hidden !important; }
`;

// ---------------------------------------------------------------- main panel
const Content = () => {
    const [slots, setSlots] = useState<any[]>([]);
    const [pads, setPads] = useState<any[]>(Array(7).fill(null));
    const [franchises, setFranchises] = useState<any[]>([]);
    const [figures, setFigures] = useState<any[]>([]);
    const [view, setView] = useState("pad");
    const [franchise, setFranchise] = useState("");
    const [search, setSearch] = useState("");
    const [story, setStory] = useState(false);
    const [held, setHeld] = useState<any>(null);
    const [padColors, setPadColors] = useState<any>(null);
    const [moveSource, setMoveSource] = useState<any>(null);
    const [removeMode, setRemoveMode] = useState(false);
    const [moveArm, setMoveArm] = useState(false);
    const [targetSlot, setTargetSlot] = useState<any>(null);
    const [listening, setListening] = useState<any>(null);
    const [count, setCount] = useState(0);
    const [root, setRoot] = useState<any>(null);
    const [setup, setSetup] = useState<any>(null);
    const [setupError, setSetupError] = useState("");
    const setupRefreshing = useRef(false);
    const [working, setWorking] = useState("");
    const [release, setRelease] = useState<any>(null);
    const [shortcutMsg, setShortcutMsg] = useState("");
    // R2b: three independent shortcut kinds per backend - Game Mode play
    // defaults on, the two Desktop Mode entries default off.
    const [gmPlayChecked, setGmPlayChecked] = useState(true);
    const [desktopGuiChecked, setDesktopGuiChecked] = useState(false);
    const [desktopPlayChecked, setDesktopPlayChecked] = useState(false);
    // v3.3.12: one landing ref per view so entering the plugin, or any of its
    // submenus, puts the cursor on the content instead of the last button.
    const padRef = useRef(null);
    const setupRef = useRef(null);
    const franchiseRef = useRef(null);
    const figuresRef = useRef(null);
    useLandingFocus(padRef, [view]);
    useLandingFocus(setupRef, [view]);
    useLandingFocus(franchiseRef, [view]);
    useLandingFocus(figuresRef, [view, franchise]);
    const [customPath, setCustomPath] = useState("");
    const [wizard, setWizard] = useState<any>(null);
    const refreshSetup = async () => {
        if (setupRefreshing.current) return;
        setupRefreshing.current = true;
        try {
            const result = await setupStatus();
            setSetup(result);
            setSetupError("");
        }
        catch (e: any) {
            setSetupError(String(e?.message || e || "Unable to query setup status"));
        }
        finally {
            setupRefreshing.current = false;
        }
    };
    // Only ask what build is on offer when it's actually needed - no network
    // call on every panel open once the emulator is in place.
    const refreshRelease = async () => {
        try {
            setRelease(await checkRpcs3Release());
        }
        catch {
            setRelease(null);
        }
    };
    const refresh = async () => {
        const l = await checkListener();
        setListening(l.listening);
        await refreshSetup();
        try {
        }
        catch { /* ignore */ }
    };
    useEffect(() => { refresh(); const timer = setInterval(() => { refreshSetup(); checkListener().then((l: any) => setListening(l.listening)).catch(() => {}); }, 5000); return () => clearInterval(timer); }, []);
    // Keep the path box showing whatever is actually configured.
    useEffect(() => {
        setCustomPath(setup?.rpcs3Custom ?? "");
    }, [setup?.rpcs3Custom]);
    useEffect(() => {
        if (view !== "figures")
            return;
        getFigures(franchise, search, story).then(setFigures).catch(() => setFigures([]));
    }, [view, franchise, search, story]);
    const openBrowser = async () => {
        setFranchises(await getFranchises());
        setView("franchises");
    };
    // Tapping a pad is always "put something here", whether it's empty or not —
    // the old confirm dialog made swapping a figure a three-step job. Taking off
    // and moving are explicit modes armed from the buttons under the pad, so
    // neither needs a dialog either.
    const onSlot = async (slot: any) => {
        // Move in progress: this tap is the destination.
        if (moveSource !== null) {
            const src = moveSource;
            setMoveSource(null);
            const res = await moveFigure(src, slot);
            if (notify(res) && res.pads)
                setPads(res.pads);
            return;
        }
        // Move armed: this tap chooses which figure is moving.
        if (moveArm) {
            setMoveArm(false);
            if (!pads[slot]) {
                toaster.toast({ title: "Toypad", body: "That pad is empty" });
                return;
            }
            setMoveSource(slot);
            toaster.toast({ title: "Toypad", body: "Now tap where it goes" });
            return;
        }
        // Take-off mode: this tap clears the pad.
        if (removeMode) {
            setRemoveMode(false);
            if (!pads[slot]) {
                toaster.toast({ title: "Toypad", body: "That pad is empty" });
                return;
            }
            const res = await removeFigure(slot);
            if (notify(res) && res.pads)
                setPads(res.pads);
            return;
        }
        // Holding a figure: place it. The backend replaces whatever was there.
        if (held !== null) {
            const fig = held;
            setHeld(null);
            setTargetSlot(null);
            const res = await loadFigure(fig, slot);
            if (notify(res) && res.pads)
                setPads(res.pads);
            return;
        }
        // Idle: remember which pad we're filling and go pick something for it.
        setTargetSlot(slot);
        openBrowser();
    };
    // -------------------------------------------------------------- browser
    if (view === "setup") {
        return (
            <>
                <DFL.Focusable ref={setupRef} autoFocus onCancel={() => setView("pad")} flow-children="vertical">
                    <HotkeySection />
                    <DiagnosticsSection />
                    <DFL.PanelSection title="Setup">
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={() => setView("pad")}>Back to pad</DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" disabled={working !== ""} onClick={async () => {
                                setWizard(null);
                                setWorking("Setting up — this can take a few minutes...");
                                try {
                                    const res = await runSetup();
                                    setWizard(res.steps || []);
                                    notify({ ok: res.ok, message: res.message, error: res.error });
                                }
                                finally {
                                    setWorking("");
                                    await refresh();
                                }
                            }}>
                                {setup?.setupComplete ? "Setup complete · Re-run setup" : "Set everything up"}
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        {wizard ? (
                            <DFL.PanelSectionRow>
                                <div style={{ padding: "2px 0" }}>
                                    {wizard.map((w: any, i: number) => (
                                        <Check key={i} ok={w.ok} label={w.label} detail={w.detail} />
                                    ))}
                                </div>
                            </DFL.PanelSectionRow>
                        ) : null}
                        {setup ? (
                            <>
                                <DFL.PanelSectionRow>
                                    <div>
                                        <Check ok={setup.rpcs3Ok} label="Bundled RPCS3" detail={setup.rpcs3Ok ? `${setup.rpcs3Version} · ${setup.rpcs3Path || setup.rpcs3ExpectedPath}` : `Missing: ${setup.rpcs3ExpectedPath || setup.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}`} />
                                        <Check ok={setup.tagsOk} label={`Tag library (${setup.tagCount})`} detail={setup.tagsOk ? setup.tagRoot : "Use Download tag library below"} />
                                        <Check ok={setup.gameOk} label="Game dump" detail={setup.gameOk ? setup.gamePath : `Nothing under ${setup.gameRoot}`} />
                                        <Check ok={setup.launcherOk} label="Steam launcher" detail={setup.launcherOk ? setup.launcherPath : "Use Write launcher below"} />
                                        <Check ok={setup.webOk} label="Phone remote" detail={setup.webOk ? setup.webUrl : "Disabled"} />
                                        <Check ok={setup.listenerOk} pending={setup.listenerState === "waiting"} label="Toypad listener" detail={
                                            setup.listenerState === "connected"
                                                ? `Connected on :${setup.listenerPort}`
                                                : setup.listenerState === "waiting"
                                                    ? `Waiting for the ${backendShortName(setup.backend)} game...`
                                                    : `Not configured — ${backendShortName(setup.backend)} is not installed`
                                        } />
                                    </div>
                                </DFL.PanelSectionRow>
                                {setup?.padColors ? (
                                    <DFL.PanelSectionRow>
                                        <div style={{ display: "flex", gap: "10px", alignItems: "center", padding: "4px 0", fontSize: "12px", flexWrap: "wrap" }}>
                                            <span style={{ opacity: 0.7 }}>LEDs:</span>
                                            {["0", "1", "2"].map(function (k, i) {
                                                var label = i === 0 ? "C" : i === 1 ? "L" : "R";
                                                var c = setup.padColors[k] || setup.padColors.all;
                                                var bg = c ? c.hex : "#333";
                                                return (
                                                    <span key={k} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                                                        <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: bg, border: "1px solid #555", boxShadow: c && c.kind === "flash" ? "0 0 4px " + c.hex : "none" }} />
                                                        <span style={{ opacity: 0.7 }}>{label}</span>
                                                    </span>
                                                );
                                            })}
                                            {setup.colorReader ? (
                                                <span style={{ opacity: 0.6, fontSize: "10px", marginLeft: "6px" }}>
                                                    {setup.colorReader.connected ? ("reader: " + setup.colorReader.frames_parsed + " frames") : ("reader: waiting" + (setup.colorReader.last_error ? " (" + setup.colorReader.last_error.slice(0, 30) + ")" : ""))}
                                                </span>
                                            ) : null}
                                        </div>
                                    </DFL.PanelSectionRow>
                                ) : null}
                                {working ? (
                                    <DFL.PanelSectionRow>
                                        <div style={{ fontSize: "12px", color: "#ffc93c", padding: "4px 0" }}>{working}</div>
                                    </DFL.PanelSectionRow>
                                ) : null}
                                <DFL.PanelSectionRow>
                                    <DFL.ButtonItem layout="below" disabled={working !== ""} onClick={async () => {
                                        setWorking("Checking tag library...");
                                        let res = await installTags(false);
                                        if (res?.requiresConfirmation) {
                                            setWorking("");
                                            const ok = window.confirm(`You already have ${res.tagCount} tags installed. Re-download will replace the current tag library and Web/Assets files. Continue?`);
                                            if (!ok) return;
                                            setWorking("Downloading tag library, this takes a minute...");
                                            res = await installTags(true);
                                        } else {
                                            setWorking("Downloading tag library, this takes a minute...");
                                        }
                                        setWorking("");
                                        notify(res);
                                        await refresh();
                                    }}>
                                        {setup.tagsOk ? "Re-download tag library" : "Download tag library"}
                                    </DFL.ButtonItem>
                                </DFL.PanelSectionRow>
                                <DFL.PanelSectionRow>
                                    <DFL.ButtonItem layout="below" disabled={working !== ""} onClick={async () => {
                                        const res = await installLauncher();
                                        notify(res);
                                        await refreshSetup();
                                    }}>
                                        {setup?.launcherOk ? "Steam launcher already written · rewrite" : "Write Steam launcher"}
                                    </DFL.ButtonItem>
                                </DFL.PanelSectionRow>
                                <DFL.PanelSectionRow>
                                    <DFL.ButtonItem layout="below" onClick={async () => {
                                        const s = await setWeb(!setup.webEnabled, setup.webPort);
                                        setSetup(s);
                                    }}>
                                        {setup.webEnabled ? "Turn off phone remote" : "Turn on phone remote"}
                                    </DFL.ButtonItem>
                                </DFL.PanelSectionRow>
                                <DFL.PanelSectionRow>
                                    <DFL.ButtonItem layout="below" onClick={refresh}>Re-check everything</DFL.ButtonItem>
                                </DFL.PanelSectionRow>
                            </>
                        ) : (
                            <DFL.PanelSectionRow>
                                <div style={{ fontSize: "12px", opacity: 0.7 }}>Checking...</div>
                            </DFL.PanelSectionRow>
                        )}
                    </DFL.PanelSection>
                    <DFL.PanelSection title="Backend & Preferences">
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem
                                layout="below"
                                onClick={async () => {
                                    const current = await getCurrentBackend();
                                    const next = current === "rpcs3" ? "xenia" : "rpcs3";
                                    const res = await setBackend(next);
                                    if (res && res.ok) {
                                        toaster.toast({ title: "Backend Switch", body: `Switched backend to ${next.toUpperCase()}` });
                                        await refresh();
                                    }
                                }}
                            >
                                {`Active Backend: ${(setup?.backend || "rpcs3").toUpperCase()} (Click to toggle RPCS3 / Xenia)`}
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem
                                layout="below"
                                onClick={async () => {
                                    const current = await getConfigSetting("padSkin", "default");
                                    const skins = ["default", "Plain", "Old"];
                                    const next = skins[(skins.indexOf(current) + 1) % skins.length];
                                    await setConfigSetting("padSkin", next);
                                    toaster.toast({ title: "Pad Skin", body: `Pad skin set to ${next}` });
                                    await refresh();
                                }}
                            >
                                {`Pad Skin: ${setup?.padSkin || "default"} (Click to cycle)`}
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ToggleField
                                label="Sound Effects"
                                checked={setup?.soundEffects !== false}
                                onChange={async (val: boolean) => {
                                    await setConfigSetting("soundEffects", val);
                                    await refresh();
                                }}
                            />
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ToggleField
                                label="Confirm Button Swap (Swap A/B)"
                                checked={setup?.confirmButtonSwap === true}
                                onChange={async (val: boolean) => {
                                    await setConfigSetting("confirmButtonSwap", val);
                                    await refresh();
                                }}
                            />
                        </DFL.PanelSectionRow>
                    </DFL.PanelSection>
                    <DFL.PanelSection title="RPCS3">
                        <DFL.PanelSectionRow>
                            <div style={{ fontSize: "11px", opacity: 0.7, lineHeight: 1.4 }}>
                                {setup?.rpcs3Ok
                                    ? `RPCS3 ✓ Bundled AppImage · ${setup.rpcs3Version}`
                                    : `RPCS3 ✗ Bundled AppImage missing · expected ${setup?.rpcs3ExpectedPath || setup?.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}`}
                            </div>
                        </DFL.PanelSectionRow>
                        {!setup?.rpcs3Ok && release && release.ok ? (
                            <DFL.PanelSectionRow>
                                <DFL.ButtonItem layout="below" disabled={working !== ""} onClick={async () => {
                                    setWorking("Downloading RPCS3, this takes a few minutes...");
                                    const res = await installRpcs3();
                                    setWorking("");
                                    notify(res);
                                    await refresh();
                                }}>
                                    Install patched RPCS3 ({release.sizeMB} MB)
                                </DFL.ButtonItem>
                            </DFL.PanelSectionRow>
                        ) : null}
                        <DFL.PanelSectionRow>
                            <DFL.TextField label="RPCS3 bundled AppImage (authoritative)" value={setup?.rpcs3Path ?? ""} disabled />
                        </DFL.PanelSectionRow>
                    </DFL.PanelSection>
                    <DFL.PanelSection title="Play">
                        <DFL.PanelSectionRow>
                            <DFL.ToggleField
                                label="Game Mode — play"
                                description="Boots straight into the game, no GUI. Added to Steam's library."
                                checked={gmPlayChecked}
                                onChange={setGmPlayChecked}
                            />
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ToggleField
                                label="Desktop — emulator GUI"
                                description="Opens the emulator's own settings screens, no game."
                                checked={desktopGuiChecked}
                                onChange={setDesktopGuiChecked}
                            />
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ToggleField
                                label="Desktop — play"
                                description="Same script as Game Mode play, for testing outside Game Mode."
                                checked={desktopPlayChecked}
                                onChange={setDesktopPlayChecked}
                            />
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <div style={{ fontSize: "10px", opacity: 0.6, lineHeight: 1.4, padding: "2px 0" }}>
                                {(setup?.backend || "rpcs3") === "xenia"
                                    ? "Xenia's GUI is controller-navigable: Display → Internal Resolution, Display → Toggle 60 FPS Unlock, Performance on Right Shift."
                                    : "RPCS3's Qt UI is mouse-oriented — the GUI shortcut may need a mouse or trackpad, not just a stick."}
                            </div>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem
                                layout="below"
                                disabled={!gmPlayChecked && !desktopGuiChecked && !desktopPlayChecked}
                                onClick={async () => {
                                    setShortcutMsg("Creating...");
                                    const backendKey = setup?.backend || "rpcs3";
                                    const shortName = backendShortName(backendKey);
                                    const messages: string[] = [];
                                    if (gmPlayChecked) {
                                        try {
                                            // Steam's own shortcut API - this is what "Add a Non-Steam
                                            // Game" calls, so the entry behaves like any other. No
                                            // Python API writes shortcuts.vdf directly.
                                            const name = `LEGO Dimensions (${shortName})`;
                                            const exe = setup?.launcherPath ?? "";
                                            if (!exe) {
                                                messages.push("Write the launcher first.");
                                            } else {
                                                const appId = await SteamClient.Apps.AddShortcut(name, exe, "", "");
                                                if (appId) {
                                                    await SteamClient.Apps.SetShortcutName(appId, name);
                                                    messages.push(`Added "${name}" — restart Steam to see it in your library.`);
                                                } else {
                                                    messages.push("Steam refused the shortcut. Add it manually.");
                                                }
                                            }
                                        } catch (e: any) {
                                            messages.push(`Couldn't add the Game Mode shortcut: ${e?.message ?? e}`);
                                        }
                                    }
                                    if (desktopGuiChecked || desktopPlayChecked) {
                                        const res = await installShortcuts(backendKey, desktopGuiChecked, desktopPlayChecked);
                                        messages.push((res && (res.message || res.error)) || "");
                                    }
                                    setShortcutMsg(messages.filter(Boolean).join(" "));
                                }}
                            >
                                Create shortcuts
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        {shortcutMsg ? (
                            <DFL.PanelSectionRow>
                                <div style={{ fontSize: "11px", opacity: 0.75, lineHeight: 1.4 }}>{shortcutMsg}</div>
                            </DFL.PanelSectionRow>
                        ) : null}
                    </DFL.PanelSection>
                    <DFL.PanelSection title="After setup">
                        <DFL.PanelSectionRow>
                            <div style={{ fontSize: "11px", opacity: 0.7, lineHeight: 1.5 }}>
                                Use Create shortcuts above. Launch LEGO Dimensions from Steam; the Game Mode shortcut boots straight into the game. The emulator's own settings remain available via the Desktop — emulator GUI shortcut.
                            </div>
                        </DFL.PanelSectionRow>
                    </DFL.PanelSection>
                    <DFL.PanelSection title="Reset">
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={async () => {
                                notify(await resetPaths());
                                setCustomPath("");
                                await refresh();
                            }}>
                                Reset paths
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <div style={{ fontSize: "10px", opacity: 0.55, lineHeight: 1.4 }}>
                                Clears the custom path and goes back to detection. Nothing is uninstalled — RPCS3, tags and saved progress stay put.
                            </div>
                        </DFL.PanelSectionRow>
                    </DFL.PanelSection>
                    <DFL.PanelSection title="Credits">
                        <DFL.PanelSectionRow>
                            <div style={{ fontSize: "12px", lineHeight: 1.6 }}>
                                <div style={{ marginBottom: "8px" }}>
                                    <span style={{ opacity: 0.6 }}>Plugin by </span>
                                    <span style={{ color: "#ffc93c", fontWeight: 600 }}>MetalNic96</span>
                                </div>
                                <div style={{ fontSize: "11px", opacity: 0.7 }}>
                                    <div style={{ marginBottom: "6px" }}>
                                        <b>NeverCookFirst</b> — RPCS3 Seamless Toypad Build. The TCP listener was written cross-platform from the start, which is the only reason any of this works on Linux.
                                    </div>
                                    <div>
                                        <b>harrysof</b> — LegoToypad, its UI design, and the tag library.
                                    </div>
                                </div>
                            </div>
                        </DFL.PanelSectionRow>
                    </DFL.PanelSection>
                </DFL.Focusable>
            </>
        );
    }
    if (view === "franchises") {
        return (
            <>
                <DFL.Focusable ref={franchiseRef} autoFocus onCancel={() => setView("pad")} flow-children="vertical">
                    <DFL.PanelSection title="Choose a franchise">
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={() => setView("pad")}>Back to pad</DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={() => {
                                setStory(false);
                                setFranchise("");
                                setSearch("");
                                setView("figures");
                            }}>
                                Search everything ({count})
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={() => {
                                setStory(true);
                                setFranchise("");
                                setSearch("");
                                setView("figures");
                            }}>
                                Story mode (starter pack)
                            </DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        {franchises.map((f: any) => (
                            <DFL.PanelSectionRow key={f.name}>
                                <FranchiseRow franchise={f} onPick={() => {
                                    setStory(false);
                                    setFranchise(f.name);
                                    setSearch("");
                                    setView("figures");
                                }} />
                            </DFL.PanelSectionRow>
                        ))}
                    </DFL.PanelSection>
                </DFL.Focusable>
            </>
        );
    }
    if (view === "figures") {
        return (
            <>
                <DFL.Focusable ref={figuresRef} autoFocus onCancel={() => setView(story ? "pad" : "franchises")} flow-children="vertical">
                    <DFL.PanelSection title={story ? "Story mode" : franchise || "All figures"}>
                        <DFL.PanelSectionRow>
                            <DFL.ButtonItem layout="below" onClick={() => setView("franchises")}>Back to franchises</DFL.ButtonItem>
                        </DFL.PanelSectionRow>
                        <DFL.PanelSectionRow>
                            <DFL.TextField label="Filter" value={search} onChange={(e: any) => setSearch(e.target.value)} />
                        </DFL.PanelSectionRow>
                        {figures.length === 0 ? (
                            <DFL.PanelSectionRow>
                                <div style={{ fontSize: "12px", opacity: 0.7, padding: "8px 0" }}>Nothing matches.</div>
                            </DFL.PanelSectionRow>
                        ) : null}
                        {figures.map((f: any) => (
                            <DFL.PanelSectionRow key={f.id}>
                                <FigureRow figure={f} onPick={async () => {
                                    // Came from tapping a specific pad, so put it straight there
                                    // instead of making them pick the same pad twice.
                                    if (targetSlot !== null) {
                                        const slot = targetSlot;
                                        setTargetSlot(null);
                                        setView("pad");
                                        const res = await loadFigure(f.id, slot);
                                        if (notify(res) && res.pads)
                                            setPads(res.pads);
                                        pushRecent({ figure: f.id, name: f.name, hasIcon: f.hasIcon });
                                        return;
                                    }
                                    setHeld(f.id);
                                    setView("pad");
                                    toaster.toast({
                                        title: "Toypad",
                                        body: `Holding ${f.name} — pick a pad`,
                                    });
                                }} />
                            </DFL.PanelSectionRow>
                        ))}
                    </DFL.PanelSection>
                </DFL.Focusable>
            </>
        );
    }
    // -------------------------------------------------------------- sidebar entry
    // Toypad interaction lives exclusively in the modal. The sidebar intentionally
    // keeps no live pad grid, LED renderer, character browser, or Toypad polling.
    return (
        <>
            <DFL.PanelSection title="LEGO Dimensions Toypad">
                <DFL.PanelSectionRow>
                    <div style={{ fontSize: "12px", lineHeight: 1.45 }}>
                        <div style={{ fontWeight: 600 }}>{listening === false ? "Toypad listener not connected" : "Toypad overlay ready"}</div>
                        <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "3px" }}>The Toypad, picker, LEDs and controller navigation live in one overlay.</div>
                    </div>
                </DFL.PanelSectionRow>
                <DFL.PanelSectionRow>
                    <DFL.ButtonItem layout="below" onClick={() => openToypadModal()}>Open Toypad overlay</DFL.ButtonItem>
                </DFL.PanelSectionRow>
                <DFL.PanelSectionRow>
                    <DFL.ButtonItem layout="below" onClick={() => { refreshSetup(); refreshRelease(); setView("setup"); }}>Setup & phone remote</DFL.ButtonItem>
                </DFL.PanelSectionRow>
            </DFL.PanelSection>
        </>
    );
};

// ================================================================ hotkey overlay
// v3.3.12: reaching the pad in Game Mode meant STEAM -> Decky -> scroll to the
// plugin, every single time. This registers a global overlay that any button
// chord can summon on top of the running game.
//
// Chords are *learned*, not hardcoded: Steam's controller button bitmasks move
// around between client builds, so guessing L4/R4 constants would be a coin
// flip. Setup captures whatever you actually hold and stores the raw mask.
const HK_KEY = "dimensions-toypad.hotkey";
const RECENT_KEY = "dimensions-toypad.recent";
const readJson = (key: any, fallback: any) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    }
    catch (e) { return fallback; }
};
const writeJson = (key: any, val: any) => {
    try { window.localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { /* private mode / quota */ }
};
const getHotkey = () => readJson(HK_KEY, { sig: "", paths: [], enabled: true, label: "" });
const setHotkey = (hk: any) => { writeJson(HK_KEY, hk); };
const getRecent = () => readJson(RECENT_KEY, []);
const pushRecent = (fig: any) => {
    if (!fig)
        return;
    const list = getRecent().filter((f: any) => f.figure !== fig.figure);
    list.unshift({ figure: fig.figure, name: fig.name, hasIcon: fig.hasIcon });
    writeJson(RECENT_KEY, list.slice(0, 12));
};

// --- tiny pub/sub so the chord listener can talk to the mounted overlay -----
const overlayBus = {
    listeners: [] as any[],
    on(fn: any) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((l) => l !== fn); }; },
    emit(v: any) {
        if (v === "toggle" || v === "open") {
            // A second press closes it rather than stacking a second modal.
            if (modalOpen && closeActiveModal) {
                try { closeActiveModal(); } catch (e) { }
            }
            else {
                try { openToypadModal(); } catch (e) { console.warn("[Dimensions Toypad] modal failed", e); }
            }
        }
        this.listeners.forEach((l) => { try { l(v); } catch (e) { } });
    },
};

// --- hotkey: backend evdev poller -------------------------------------------
// v3.3.15: SteamClient.Input cannot do this. On current SteamOS
// RegisterForControllerStateChanges is absent, and the APIs that do exist hand
// the callback a bare integer - the field diagnostic came back `raw: 15`.
// Detection now lives in main.py against /dev/input/event*; the frontend only
// watches a monotonic counter. Poll is 120ms.
const chordDiag: any = { attached: false, events: 0, error: "", devices: [], names: [], nodes: 0, held: [], chord: [] };
let chordUnsub: any = null;
let captureCb: any = null;
let lastFired: any = null;

const startChordWatch = () => {
    if (chordUnsub)
        return;
    let alive = true;
    const tick = async () => {
        if (!alive)
            return;
        try {
            const st = await hotkeyState();
            chordDiag.attached = true;
            chordDiag.error = st.error || "";
            chordDiag.devices = st.devices || [];
            chordDiag.names = st.names || [];
            chordDiag.nodes = st.nodes || 0;
            chordDiag.held = st.held || [];
            chordDiag.chord = st.chord || [];
            chordDiag.events = (st.devices || []).reduce((a: any, d: any) => a + d.events, 0);
            if (captureCb && st.captured && st.captured.length) {
                const cb = captureCb;
                captureCb = null;
                cb(st.captured);
            }
            // Edge-detect the fire counter. The first reading only primes it,
            // so reloading the plugin never triggers a phantom open.
            if (lastFired === null)
                lastFired = st.fired;
            else if (st.fired > lastFired) {
                lastFired = st.fired;
                overlayBus.emit("toggle");
            }
        }
        catch (e: any) {
            chordDiag.attached = false;
            chordDiag.error = (e && e.message) ? e.message : String(e);
        }
    };
    const t = setInterval(tick, 120);
    tick();
    chordUnsub = () => { alive = false; clearInterval(t); };
};
const stopChordWatch = () => { if (chordUnsub) { chordUnsub(); chordUnsub = null; chordDiag.attached = false; } };
const captureChord = (cb: any) => { captureCb = cb; hotkeyCapture(true).catch(() => { }); };
const cancelCapture = () => { captureCb = null; hotkeyCapture(false).catch(() => { }); };
const KEYNAMES: any = {
    0x130: "A", 0x131: "B", 0x133: "X", 0x134: "Y",
    0x136: "L1", 0x137: "R1", 0x138: "L2", 0x139: "R2",
    0x13a: "Select", 0x13b: "Start", 0x13c: "Steam",
    0x13d: "L3", 0x13e: "R3",
    0x2c0: "L4", 0x2c1: "R4", 0x2c2: "L5", 0x2c3: "R5",
};
const keyLabel = (c: any) => KEYNAMES[c] || ("0x" + c.toString(16));

// --- keyboard fallback (desktop mode / docked with a keyboard) --------------
let keyUnsub: any = null;
const startKeyWatch = () => {
    if (keyUnsub || typeof document === "undefined")
        return;
    const onKey = (e: any) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
            e.preventDefault();
            overlayBus.emit("toggle");
        }
    };
    document.addEventListener("keydown", onKey, true);
    keyUnsub = () => document.removeEventListener("keydown", onKey, true);
};
const stopKeyWatch = () => { if (keyUnsub) { keyUnsub(); keyUnsub = null; } };

const LedDiagnostics = ({ data }: any) => {
    const safe = data && typeof data === "object" ? data : {};
    const stats = safe.readerStats && typeof safe.readerStats === "object" ? safe.readerStats : {};
    const events = Array.isArray(safe.events) ? safe.events.slice(-40).reverse() : [];
    const current = safe.padColors && typeof safe.padColors === "object" ? safe.padColors : {};
    const rgbText = (p: any) => Array.isArray(p?.rgb) ? p.rgb.join(",") : "—";
    const modeText = (p: any) => String(p?.kind || "unknown").toUpperCase();
    const previousFor = (index: any, padKey: any) => {
        const prior = events[index + 1];
        const p = prior?.pads?.find?.((x: any) => String(x?.pad) === padKey);
        return p?.rgb;
    };
    const line = (e: any, i: any) => {
        const stamp = e?.timestamp ? new Date(Number(e.timestamp) * 1000).toLocaleTimeString() : "—";
        const delta = e?.delta == null ? "—" : "+" + e.delta;
        const pads = Array.isArray(e?.pads) ? e.pads : [];
        return (
            <div key={String(e?.seq ?? i)} style={{ padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.08)", fontSize: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: .75 }}>
                    <span>{stamp} · seq {String(e?.seq ?? "—")} · serial {String(e?.serial ?? "—")} ({delta})</span>
                    <span>{e?.source || "GET_LED snapshot"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginTop: "4px" }}>
                    {["0", "1", "2"].map((key) => {
                        const p = pads.find((x: any) => String(x?.pad) === key);
                        const prev = previousFor(i, key);
                        const label = key === "0" ? "C" : key === "1" ? "L" : "R";
                        return (
                            <div key={key} style={{ background: "rgba(0,0,0,.22)", borderRadius: "4px", padding: "4px" }}>
                                <div><b>{label}</b> {modeText(p)}</div>
                                <div>RGB {rgbText(p)}</div>
                                {prev && p ? <div style={{ opacity: .7 }}>FROM {prev.join(",")} → {rgbText(p)}</div> : null}
                                {p?.kind === "fade" ? <div style={{ opacity: .7 }}>speed {String(p?.speedTicks ?? 0)}t/{String(p?.speedMs ?? 0)}ms · count {String(p?.count ?? 0)}</div> : null}
                                {p?.kind === "flash" ? <div style={{ opacity: .7 }}>on {String(p?.onTicks ?? 0)}t / off {String(p?.offTicks ?? 0)}t · count {String(p?.count ?? 0)}</div> : null}
                            </div>
                        );
                    })}
                </div>
                {e?.raw ? <div style={{ opacity: .45, marginTop: "3px", wordBreak: "break-all" }}>RX {String(e.raw).slice(0, 90)}{String(e.raw).length > 90 ? "…" : ""}</div> : null}
            </div>
        );
    };
    return (
        <div style={{ marginTop: "10px", padding: "8px", background: "rgba(5,8,12,.65)", borderRadius: "8px", border: "1px solid rgba(255,255,255,.10)", maxHeight: "38vh", overflowY: "auto", overflowX: "hidden", fontSize: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "5px" }}>LED LISTENER DIAGNOSTICS <span style={{ color: "#5fd08a", float: "right" }}>{stats.connected ? "● CONNECTED" : "○ WAITING"}</span></div>
            <div style={{ opacity: .75, marginBottom: "5px" }}>
                GET_LED snapshots {String(stats.snapshots_seen ?? 0)} · changed {String(stats.changed_snapshots ?? 0)} · frames {String(stats.frames_parsed ?? 0)} · serial {String(stats.led_serial ?? 0)}
            </div>
            <div style={{ opacity: .6, marginBottom: "6px" }}>This is the listener's received 30-byte GET_LED stream. It is not the raw game's C0–C8 command stream.</div>
            {events.length ? events.map(line) : <div style={{ opacity: .5, padding: "10px 0" }}>Waiting for a changed LED snapshot…</div>}
            <div style={{ marginTop: "5px", paddingTop: "5px", borderTop: "1px solid rgba(255,255,255,.08)", opacity: .65 }}>
                Current: C {current["0"]?.hex || "off"} · L {current["1"]?.hex || "off"} · R {current["2"]?.hex || "off"}
            </div>
        </div>
    );
};

const ToypadModal = ({ closeModal, onClosed }: any) => {
    const [slots, setSlots] = useState<any[]>([]);
    const [pads, setPads] = useState<any[]>([]);
    const [padColors, setPadColors] = useState<any>(null);
    const [mode, setMode] = useState("pad");   // pad | picking | move | remove
    const [picking, setPicking] = useState<any>(null);
    const [moveSource, setMoveSource] = useState<any>(null);
    const [search, setSearch] = useState("");
    const [figures, setFigures] = useState<any[]>([]);
    const [franchises, setFranchises] = useState<any[]>([]);
    const [franchise, setFranchise] = useState("");
    const [ledOn, setLedOn] = useState(true);
    const [demoMode, setDemoMode] = useState(false);
    const [favourites, setFavourites] = useState<any[]>([]);

    const refreshFavourites = useCallback(async () => {
        try {
            const favs = await getFavourites();
            setFavourites(favs || []);
        } catch (_) {}
    }, []);

    useEffect(() => {
        refreshFavourites();
    }, [refreshFavourites]);

    const onToggleFav = useCallback(async (fig: any) => {
        const isVeh = !!(fig.kind && fig.kind.toLowerCase().startsWith("vehic"));
        const name = fig.family || fig.name;
        try {
            const res = await toggleFavourite(fig.franchise, name, isVeh);
            if (res && res.ok) {
                toaster.toast({
                    title: "Favourites",
                    body: (res.favourited ? 'Added "' : 'Removed "') + res.name + (res.favourited ? '" to favourites' : '" from favourites'),
                });
                refreshFavourites();
                getFranchises().then((f: any) => setFranchises(f || [])).catch(() => {});
            }
        } catch (_) {}
    }, [refreshFavourites]);

    const demoIndexRef = useRef(0);
    useEffect(() => {
        if (!demoMode) return;
        const DEMO_STATES = [
            {
                "0": { r: 0, g: 255, b: 0, kind: "color", hex: "#00ff00" },
                "1": { r: 255, g: 0, b: 0, kind: "color", hex: "#ff0000" },
                "2": { r: 0, g: 0, b: 255, kind: "color", hex: "#0000ff" },
            },
            {
                "0": { r: 0, g: 110, b: 24, kind: "color", hex: "#00ffff" },
                "1": { r: 255, g: 110, b: 0, kind: "color", hex: "#ffff00" },
                "2": { r: 255, g: 0, b: 24, kind: "color", hex: "#ff00ff" },
            },
            {
                "0": { r: 255, g: 110, b: 24, kind: "color", hex: "#ffffff" },
                "1": { r: 255, g: 110, b: 24, kind: "color", hex: "#ffffff" },
                "2": { r: 255, g: 110, b: 24, kind: "color", hex: "#ffffff" },
            },
            {
                "0": { r: 255, g: 110, b: 0, from_r: 0, from_g: 0, from_b: 24, kind: "fade", speedMs: 500, count: 0, hex: "#ffff00" },
                "1": { r: 0, g: 110, b: 24, from_r: 255, from_g: 0, from_b: 0, kind: "fade", speedMs: 500, count: 0, hex: "#00ffff" },
                "2": { r: 255, g: 0, b: 24, from_r: 0, from_g: 110, from_b: 0, kind: "fade", speedMs: 500, count: 0, hex: "#ff00ff" },
            },
        ];
        const timer = setInterval(() => {
            demoIndexRef.current = (demoIndexRef.current + 1) % DEMO_STATES.length;
            const synthetic = DEMO_STATES[demoIndexRef.current];
            setPadColors({ ...synthetic, serial: Math.floor(Math.random() * 255) } as any);
        }, 1500);
        return () => clearInterval(timer);
    }, [demoMode]);

    const groupedFigures = useMemo(() => {
        const list: any[] = [];
        const familyMap = new Map<string, any>();
        for (const f of figures) {
            const isVeh = f.kind && f.kind.toLowerCase().startsWith("vehic");
            if (isVeh && f.family) {
                const key = `${f.franchise}::${f.family}`;
                if (!familyMap.has(key)) {
                    const item = { ...f, builds: [f] };
                    familyMap.set(key, item);
                    list.push(item);
                } else {
                    const item = familyMap.get(key);
                    item.builds.push(f);
                    item.builds.sort((a: any, b: any) => (a.build || 1) - (b.build || 1));
                }
            } else {
                list.push(f);
            }
        }
        return list;
    }, [figures]);

    useEffect(() => {
        getLedEnabled().then((r: any) => setLedOn(r?.ledEnabled !== false)).catch(() => { });
    }, []);
    const [busy, setBusy] = useState("");
    const [ledDiagOpen, setLedDiagOpen] = useState(false);
    const [ledDiag, setLedDiag] = useState<any>(null);
    const ledDiagRef = useRef(false);
    const landRef = useRef(null);
    const shellRef = useRef(null);
    // ModalRoot draws its own panel around ours, so two stacked rounded boxes
    // appear. Its wrapper class names are hashed and unstable, so walk the
    // ancestor chain instead and strip chrome from every non-fullscreen box
    // above us. The full-viewport dimmer is left alone - that backdrop is
    // wanted.
    const stripChrome = () => {
        let el: any = shellRef.current && (shellRef.current as any).parentElement;
        for (let i = 0; el && i < 10; i += 1) {
            el.style.setProperty("background", "transparent", "important");
            el.style.setProperty("background-color", "transparent", "important");
            el.style.setProperty("background-image", "none", "important");
            el.style.setProperty("border", "none", "important");
            el.style.setProperty("box-shadow", "none", "important");
            el.style.setProperty("padding", "0", "important");
            el.style.setProperty("border-radius", "0", "important");
            el = el.parentElement;
        }
    };
    useEffect(() => {
        // ModalRoot settles its own styling after mount, so one pass is not
        // enough - re-assert on a short ladder.
        const timers = [0, 50, 150, 400].map((t) => setTimeout(stripChrome, t));
        return () => timers.forEach(clearTimeout);
    }, []);

    const refreshState = useCallback(async () => {
        try {
            const s = await getState();
            if (s) {
                setSlots((prev) => JSON.stringify(prev) === JSON.stringify(s.slots || []) ? prev : (s.slots || []));
                setPads((prev) => JSON.stringify(prev) === JSON.stringify(s.pads || []) ? prev : (s.pads || []));
            }
        } catch (e) { }
    }, []);
    const refreshLeds = useCallback(async () => {
        try {
            const pc = await getPadColors();
            const next = pc && pc.padColors ? pc.padColors : (pc || null);
            setPadColors((prev: any) => ledMapEqual(prev, next) ? prev : next);
        } catch (e) { }
    }, []);
    useEffect(() => {
        refreshState();
        const t = setInterval(refreshState, 750);
        return () => clearInterval(t);
    }, [refreshState]);
    // v3.3.37: the modal itself must continuously consume the same live
    // GET_LED-derived state used by diagnostics. Previously the modal only
    // refreshed LEDs after a user action, so diagnostics could show changing
    // game colours while the visible Toypad stayed on its old colour.
    useEffect(() => {
        let live = true;
        const tick = async () => {
            try {
                const pc = await getPadColors();
                const next = pc && pc.padColors ? pc.padColors : (pc || null);
                if (live && next)
                    setPadColors((prev: any) => ledMapEqual(prev, next) ? prev : next);
            } catch (_) {
                // LED transport failures must never affect modal interaction.
            }
        };
        tick();
        const t = setInterval(tick, 100);
        return () => { live = false; clearInterval(t); };
    }, []);
    useEffect(() => {
        if (!ledDiagOpen) return;
        ledDiagRef.current = true;
        let live = true;
        const tick = async () => {
            try {
                const d = await getLedDiagnostics();
                if (live && d && typeof d === "object") setLedDiag(d);
            } catch (_) {
                // Diagnostics must never affect the normal Toypad modal.
            }
        };
        tick();
        const t = setInterval(tick, 750);
        return () => { live = false; ledDiagRef.current = false; clearInterval(t); };
    }, [ledDiagOpen]);
    useEffect(() => {
        getFranchises().then((f: any) => setFranchises(f || [])).catch(() => setFranchises([]));
    }, []);
    // Debounced search so the virtual keyboard stays responsive.
    useEffect(() => {
        if (mode !== "picking" && mode !== "franchises")
            return;
        if (mode === "franchises" && !search.trim()) { setFigures([]); return; }
        let live = true;
        const t = setTimeout(() => {
            getFigures(mode === "picking" ? franchise : "", search, false)
                .then((f: any) => { if (live) setFigures((f || []).slice(0, 60)); })
                .catch(() => { if (live) setFigures([]); });
        }, 220);
        return () => { live = false; clearTimeout(t); };
    }, [search, mode, franchise]);
    useLandingFocus(landRef, [mode]);

    const onSlot = async (i: any) => {
        if (mode === "remove") {
            if (!(pads as any)[i]) { toaster.toast({ title: "Toypad", body: "That pad is empty" }); return; }
            setBusy("Removing...");
            await removeFigure(i).catch(() => { });
            setBusy(""); setMode("pad"); refreshState(); refreshLeds();
            return;
        }
        if (mode === "move") {
            if (moveSource === null) {
                if (!(pads as any)[i]) { toaster.toast({ title: "Toypad", body: "That pad is empty" }); return; }
                setMoveSource(i);
                return;
            }
            setBusy("Moving...");
            await moveFigure(moveSource, i).catch(() => { });
            setBusy(""); setMoveSource(null); setMode("pad"); refreshState(); refreshLeds();
            return;
        }
        setPicking(i);
        setSearch("");
        setFranchise("");
        setMode("franchises");
    };

    const place = async (fig: any) => {
        const slot = picking !== null ? picking : 0;
        setBusy((pads as any)[slot] ? "Swapping..." : "Placing...");
        if ((pads as any)[slot])
            await removeFigure(slot).catch(() => { });
        const res = await loadFigure(fig.id, slot).catch(() => null);
        if (res) notify(res);
        pushRecent({ figure: fig.id, name: fig.name, hasIcon: fig.hasIcon });
        setBusy(""); setPicking(null); setMode("pad"); refreshState(); refreshLeds();
    };

    const hint = busy ? busy
        : mode === "franchises" ? "Pick a franchise, or search  ·  B to go back"
        : mode === "picking" ? (franchise || "Pick a figure") + "  ·  B to go back"
        : mode === "move" ? (moveSource === null ? "Tap the figure to move" : "Tap where it goes")
        : mode === "remove" ? "Tap a pad to take its figure off"
        : "Select a pad to place or swap  ·  B to close";

    const shut = () => { if (onClosed) onClosed(); closeModal(); };
    // ModalRoot fires closeModal on some builds, onCancel on others, and both
    // on a few. Every exit routes through here; the 250ms lock collapses a
    // double invocation so one B press never skips two levels.
    const navLock = useRef(0);
    const back = () => {
        const now = Date.now();
        if (now - navLock.current < 250)
            return;
        navLock.current = now;
        if (mode === "picking") { setMode("franchises"); setSearch(""); setFranchise(""); return; }
        if (mode === "franchises") { setMode("pad"); setPicking(null); setSearch(""); return; }
        if (mode === "move" || mode === "remove") { setMode("pad"); setMoveSource(null); return; }
        shut();
    };

    const btn = (label: string, onClick: () => void, tone?: string) => (
        <DFL.Focusable onActivate={onClick} focusClassName="dt-pad-focus" style={{
            flex: "1 1 0%", textAlign: "center", fontSize: "12px",
            padding: "8px 6px", borderRadius: "8px",
            background: tone === "on" ? "rgba(29,39,53,.75)" : "rgba(20,24,33,.6)",
            border: "1px solid " + (tone === "on" ? "#45b8ff" : "transparent"),
        }}>{label}</DFL.Focusable>
    );

    // How much vertical room the pad may take inside the 88vh shell. Kept in
    // vh rather than "88vh minus my estimate of the chrome": Steam scales its
    // own UI, so a px estimate of the toggles and buttons underneath is a guess
    // that silently stops biting at the exact scale where it matters. 48vh
    // leaves roughly 250px for ~150px of controls at 1:1 - enough slack to
    // survive the scaling. The picker modes hand more of it to the results.
    const padHeightBudget = (mode === "franchises" || mode === "picking")
        ? "38vh"
        : "48vh";

    return (
        <DFL.ModalRoot className="dt-toypad-modal-root" closeModal={back} onCancel={back} onEscKeypress={back}>
            <div style={{
                position: "fixed", inset: 0,
                width: "100vw", height: "100vh",
                minWidth: "100vw", minHeight: "100vh",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(6,7,10,.72)",
                padding: "24px", boxSizing: "border-box",
                overflow: "hidden",
                overscrollBehavior: "none",
                zIndex: 99999,
            } as any}>
                <div ref={shellRef} style={{
                    background: "linear-gradient(180deg,rgba(20,24,34,.92) 0%,rgba(10,12,17,.94) 100%)",
                    border: "none", borderRadius: "18px",
                    padding: "14px",
                    width: "min(820px, calc(100vw - 48px))",
                    maxWidth: "calc(100vw - 48px)",
                    maxHeight: "88vh",
                    height: "auto",
                    margin: "0 auto",
                    display: "flex", flexDirection: "column",
                    overflow: "hidden",
                    boxShadow: "0 24px 60px rgba(0,0,0,.6)",
                }}>
                    <style>{FOCUS_CSS}</style>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                        <div style={{ fontSize: "16px", fontWeight: 600 }}>Dimensions Toypad</div>
                        <div style={{ fontSize: "11px", opacity: 0.6 }}>{hint}</div>
                    </div>
                    {/* v3.4.2: the pad is the part that gives way, not the controls.
                        PadGrid is width-driven (100% + aspect-ratio), so at the shell's
                        full 792px interior it claims ~450px of height and the shell's
                        overflow:hidden simply cropped whatever came after it - the
                        Move/Remove/Clear/Close row in pad mode, the franchise grid in
                        the picker. Capping the pad's *width* by the height left over
                        makes it shrink instead. */}
                    <div style={{ flex: "0 0 auto", display: "flex", justifyContent: "center" }}>
                        <div style={{ minWidth: 0, width: `min(100%, calc(${padHeightBudget} * ${PAD_VIEW.w} / ${PAD_VIEW.h}))` }}>
                            <PadGrid slots={slots} pads={pads} held={null} moveSource={moveSource} onSlot={onSlot} padColors={padColors} gridRef={mode === "pad" ? landRef : undefined} />
                        </div>
                    </div>
                    {(mode === "franchises" || mode === "picking") ? (
                        <div style={{ marginTop: "10px", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
                            <DFL.TextField {...({ ref: landRef, value: search, placeholder: mode === "picking" ? ("Search " + franchise + "...") : "Search all figures...", onChange: (e: any) => setSearch(e?.target?.value ?? "") } as any)} />
                            {/* A live query always wins: results drop straight down as a
                                navigable list, whichever level you are on. */}
                            {(search.trim() && groupedFigures.length) ? (
                                <DFL.Focusable flow-children="vertical" style={{ marginTop: "6px", flex: "1 1 auto", minHeight: 0, maxHeight: "40vh", overflowY: "auto", overflowX: "hidden", position: "relative", isolation: "isolate", contain: "paint", borderRadius: "10px" }}>
                                    {groupedFigures.map((f: any) => {
                                        const isFav = favourites.some((fav: any) => fav.franchise?.toLowerCase() === f.franchise?.toLowerCase() && fav.name?.toLowerCase() === (f.family || f.name)?.toLowerCase());
                                        return <ModalFigureRow key={f.id} fig={f} builds={f.builds} isFav={isFav} onToggleFav={onToggleFav} onPick={place} />;
                                    })}
                                </DFL.Focusable>
                            ) : search.trim() ? (
                                <div style={{ fontSize: "11px", opacity: 0.5, padding: "8px 2px" }}>Nothing matches that.</div>
                            ) : mode === "franchises" ? (
                                // 5 across, scrolls vertically for the rest.
                                // v3.3.19: "horizontal" makes Steam treat a wrapping flex
                                // as one row, so wrapped rows were unreachable sideways -
                                // only up/down worked. "grid" walks both axes.
                                <DFL.Focusable flow-children="grid" style={{
                                    marginTop: "6px", display: "flex", flexWrap: "wrap",
                                    flex: "1 1 auto", minHeight: 0,
                                    maxHeight: "46vh", overflowY: "auto", overflowX: "hidden",
                                    alignContent: "flex-start",
                                    // Own stacking + paint containment: without these a
                                    // tile mid-scroll renders over the modal edge.
                                    position: "relative", isolation: "isolate", contain: "paint",
                                    borderRadius: "10px",
                                }}>
                                    {franchises.length
                                        ? franchises.map((f: any) => <ModalFranchiseTile key={f.name} franchise={f} onPick={(fr: any) => { setFranchise(fr.name); setSearch(""); setMode("picking"); }} />)
                                        : <div style={{ fontSize: "11px", opacity: 0.5, padding: "8px 2px" }}>No tag library loaded.</div>}
                                </DFL.Focusable>
                            ) : (
                                <DFL.Focusable flow-children="vertical" style={{ marginTop: "6px", flex: "1 1 auto", minHeight: 0, maxHeight: "40vh", overflowY: "auto", overflowX: "hidden", position: "relative", isolation: "isolate", contain: "paint", borderRadius: "10px" }}>
                                    {groupedFigures.length
                                        ? groupedFigures.map((f: any) => {
                                            const isFav = favourites.some((fav: any) => fav.franchise?.toLowerCase() === f.franchise?.toLowerCase() && fav.name?.toLowerCase() === (f.family || f.name)?.toLowerCase());
                                            return <ModalFigureRow key={f.id} fig={f} builds={f.builds} isFav={isFav} onToggleFav={onToggleFav} onPick={place} />;
                                        })
                                        : <div style={{ fontSize: "11px", opacity: 0.5, padding: "8px 2px" }}>Nothing in this franchise.</div>}
                                </DFL.Focusable>
                            )}
                        </div>
                    ) : (
                        <>
                            <DFL.Focusable onActivate={async () => {
                                const next = !ledOn;
                                setLedOn(next);
                                await setLedEnabled(next).catch(() => { });
                                refreshState();
                                refreshLeds();
                            }} focusClassName="dt-pad-focus" style={{ marginTop: "10px", padding: "8px", borderRadius: "8px", textAlign: "center", background: "rgba(20,24,33,.6)", border: "1px solid " + (ledOn ? "#45b8ff" : "transparent"), fontSize: "12px" }}>
                                {ledOn ? "LED lighting: on" : "LED lighting: off (Toypad still works)"}
                            </DFL.Focusable>
                            <DFL.Focusable onActivate={() => setLedDiagOpen((v) => !v)} focusClassName="dt-pad-focus" style={{ marginTop: "10px", padding: "8px", borderRadius: "8px", textAlign: "center", background: "rgba(20,24,33,.6)", border: "1px solid " + (ledDiagOpen ? "#45b8ff" : "transparent"), fontSize: "12px" }}>
                                {ledDiagOpen ? "Hide LED diagnostics" : "Show LED diagnostics"}
                            </DFL.Focusable>
                            {ledDiagOpen ? <LedDiagnostics data={ledDiag} /> : null}
                            <DFL.Focusable flow-children="horizontal" style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                                {btn(demoMode ? "LED demo: running" : "LED demo mode", () => setDemoMode(!demoMode), demoMode ? "on" : undefined)}
                                {btn(mode === "move" ? "Moving..." : "Move", () => { setMoveSource(null); setMode(mode === "move" ? "pad" : "move"); }, mode === "move" ? "on" : "")}
                                {btn(mode === "remove" ? "Removing..." : "Remove", () => setMode(mode === "remove" ? "pad" : "remove"), mode === "remove" ? "on" : "")}
                                {btn("Clear all", async () => { setBusy("Clearing..."); await clearAll().catch(() => { }); setBusy(""); refreshState(); refreshLeds(); })}
                                {btn("Close", () => shut())}
                            </DFL.Focusable>
                        </>
                    )}
                </div>
            </div>
        </DFL.ModalRoot>
    );
};

let modalOpen = false;
let closeActiveModal: any = null;
const openToypadModal = () => {
    if (modalOpen)
        return;
    if (!DFL || typeof DFL.showModal !== "function") {
        toaster.toast({ title: "Toypad", body: "This Decky build has no modal API" });
        return;
    }
    modalOpen = true;
    let handle: any = null;
    const finish = () => {
        modalOpen = false;
        closeActiveModal = null;
        if (handle && typeof handle.Close === "function") {
            try { handle.Close(); } catch (e) { }
        }
    };
    closeActiveModal = finish;
    handle = DFL.showModal(<ToypadModal onClosed={() => { modalOpen = false; closeActiveModal = null; }} />, window, {
        strTitle: "Dimensions Toypad",
        bHideMainMenuLogo: true,
    } as any);
};

const DiagnosticsSection = () => {
    const [on, setOn] = useState(false);
    useEffect(() => {
        getDiagnosticsEnabled().then((r: any) => setOn(!!r?.diagnosticsEnabled)).catch(() => { });
    }, []);
    return (
        <DFL.PanelSection title="Diagnostics">
            <DFL.PanelSectionRow>
                <DFL.ToggleField
                    label="LED diagnostics"
                    checked={on}
                    onChange={async (v: boolean) => { setOn(v); await setDiagnosticsEnabled(v).catch(() => { }); }}
                />
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "11px", opacity: 0.6, padding: "2px 0" }}>
                    Records the GET_LED history and raw hex for troubleshooting. The Toypad still receives every colour with this off - only the recording stops.
                </div>
            </DFL.PanelSectionRow>
        </DFL.PanelSection>
    );
};

const HotkeySection = () => {
    const [st, setSt] = useState<any>({ chord: [], enabled: true, held: [] });
    const [capturing, setCapturing] = useState(false);
    const [diag, setDiag] = useState(Object.assign({}, chordDiag));
    useEffect(() => {
        const t = setInterval(() => setDiag(Object.assign({}, chordDiag)), 250);
        hotkeyState().then(setSt).catch(() => { });
        return () => clearInterval(t);
    }, []);
    const describe = () => (st.chord && st.chord.length)
        ? st.chord.map(keyLabel).join(" + ") : "none set";
    const beginCapture = () => {
        setCapturing(true);
        const timeout = setTimeout(() => {
            cancelCapture(); setCapturing(false);
            toaster.toast({ title: "Toypad", body: "Nothing held - check the device line below" });
        }, 15000);
        captureChord(async (codes: any) => {
            clearTimeout(timeout);
            await hotkeySet(codes, true).catch(() => { });
            setSt(await hotkeyState().catch(() => st));
            setCapturing(false);
            toaster.toast({ title: "Toypad", body: "Hotkey set: " + codes.map(keyLabel).join(" + ") });
        });
    };
    return (
        <DFL.PanelSection title="Hotkey">
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "11px", opacity: 0.65, padding: "2px 0" }}>Summon the toypad over a running game. Press it again to close.</div>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <DFL.ToggleField label="Hotkey enabled" checked={!!st.enabled} onChange={async (v: boolean) => { await hotkeySet(st.chord || [], v).catch(() => { }); setSt(await hotkeyState().catch(() => st)); }} />
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "11px", opacity: 0.8, padding: "2px 0" }}>
                    {capturing ? ("Release all buttons, then hold the exact chord... " + ((diag.held || []).map(keyLabel).join(" + ") || "(waiting)"))
                        : ("Current chord: " + describe())}
                </div>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <DFL.ButtonItem layout="below" onClick={() => { if (capturing) { cancelCapture(); setCapturing(false); } else { beginCapture(); } }}>
                    {capturing ? "Listening... (tap to cancel)" : "Set hotkey chord"}
                </DFL.ButtonItem>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <DFL.ButtonItem layout="below" onClick={async () => { await hotkeySet([], false).catch(() => { }); setSt(await hotkeyState().catch(() => st)); }}>Clear hotkey</DFL.ButtonItem>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <DFL.ButtonItem layout="below" onClick={() => overlayBus.emit("toggle")}>Open toypad overlay</DFL.ButtonItem>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "10px", opacity: 0.75, padding: "4px 0", lineHeight: 1.35 }}>
                    {(diag.events > 0)
                        ? null
                        : (diag.nodes ? "Steam holds the controller, so button presses never reach the plugin. Bind a key instead: Steam → Controller Settings → edit layout → put a keyboard key (F13 works well) on a back button, then capture it here."
                            : "No input devices could be opened. Restart Decky so the backend reloads.")}
                </div>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "9px", opacity: 0.55, fontFamily: "monospace", wordBreak: "break-all", padding: "3px 0" }}>
                    {"evdev " + (diag.attached ? "OK" : "DOWN") + " · nodes " + (diag.nodes || 0) + " · key events " + diag.events +
                        (diag.error ? (" · ERR " + diag.error) : "")}
                </div>
            </DFL.PanelSectionRow>
            <DFL.PanelSectionRow>
                <div style={{ fontSize: "9px", opacity: 0.45, fontFamily: "monospace", wordBreak: "break-all" }}>
                    {(diag.devices && diag.devices.length)
                        ? ("live: " + (diag.devices as any[]).map((d: any) => (d.name || d.path.replace("/dev/input/", "")) + ":" + d.events).join("  "))
                        : ("watching: " + ((diag.names || []).join(", ") || "nothing"))}
                </div>
            </DFL.PanelSectionRow>
        </DFL.PanelSection>
    );
};

export default definePlugin(() => {
    // v3.3.14: no global component any more. showModal gives the pad real
    // gamepad focus, which addGlobalComponent never did - that is why B did
    // nothing and nothing was navigable.
    startChordWatch();
    startKeyWatch();
    return {
        name: "Dimensions Toypad",
        titleView: <div>Dimensions Toypad</div>,
        content: <Content />,
        icon: <FaCubes />,
        onDismount() {
            stopChordWatch();
            stopKeyWatch();
        },
    };
});
