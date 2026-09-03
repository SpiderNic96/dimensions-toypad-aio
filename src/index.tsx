// SPDX-License-Identifier: MIT
import * as DFL from "@decky/ui";
import * as SP_JSX from "react/jsx-runtime";
import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  Focusable,
  ToggleField,
  TextField,
  showModal,
  ModalRoot,
} from "@decky/ui";
import { callable, definePlugin, toaster, routerHook } from "@decky/api";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
} from "react";
import { FaCubes } from "react-icons/fa";

const rpc = callable as (<T = any>(name: string) => (...args: any[]) => Promise<T>);

const getState = rpc("get_state");
const getFranchises = rpc("get_franchises");
const getFigures = rpc("get_figures");
const getIcon = rpc("get_icon");
const getFranchiseLogo = rpc("get_franchise_logo");
const loadFigure = rpc("load_figure");
const removeFigure = rpc("remove_figure");
const moveFigure = rpc("move_figure");
const clearAll = rpc("clear_all");
const resync = rpc("resync");
const rescan = rpc("rescan");
const checkListener = rpc("check_listener");
rpc("reset_progress");
const setupStatus = rpc("setup_status");
const getPadColors = rpc("get_pad_colors");
const getLedDiagnostics = rpc("get_led_diagnostics");
const hotkeyState = rpc("hotkey_state");
const hotkeyCapture = rpc("hotkey_capture");
const hotkeySet = rpc("hotkey_set");
const installTags = rpc("install_tags");
const installLauncher = rpc("install_launcher");
const setWeb = rpc("set_web");
const checkRpcs3Release = rpc("check_rpcs3_release");
const installRpcs3 = rpc("install_rpcs3");
const launchEmulatorGui = rpc("launch_emulator_gui");
const setLedEnabled = rpc("set_led_enabled");
const getLedEnabled = rpc("get_led_enabled");
const setDiagnosticsEnabled = rpc("set_diagnostics_enabled");
const getDiagnosticsEnabled = rpc("get_diagnostics_enabled");
const setRpcs3Path = rpc("set_rpcs3_path");
const resetPaths = rpc("reset_paths");
const runSetup = rpc("run_setup");
const getFullArt = rpc("get_full_art");
const getFavourites = rpc("get_favourites");
const toggleFavourite = rpc("toggle_favourite");
const getRecents = rpc("get_recents");
const clearRecents = rpc("clear_recents");
const getBackends = rpc("get_backends");
const getCurrentBackend = rpc("get_current_backend");
const setBackend = rpc("set_backend");
const getConfigSetting = rpc("get_config_setting");
const setConfigSetting = rpc("set_config_setting");

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
// ---------------------------------------------------------------- helpers
// The pad is 3/1/3: a tall centre flanked by two sections of three. Laying it
// out the way the hardware looks makes "Left · lower R" mean something at a
// glance, rather than being a label you have to decode.
const ZONE_ORDER = {
    left: [0, 3, 4],
    centre: [1],
    right: [2, 5, 6],
};
const zoneColour = (_zone) => "#a9d7ee";
const ledEqual = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    const keys = ["r", "g", "b", "hex", "kind", "onMs", "offMs", "speedMs", "count", "serial", "timestamp"];
    return keys.every((k) => a[k] === b[k]);
};
const ledMapEqual = (a, b) => !!a && !!b && ledEqual(a["0"], b["0"]) && ledEqual(a["1"], b["1"]) && ledEqual(a["2"], b["2"]) && ledEqual(a.all, b.all) && a.tickMs === b.tickMs && a.serial === b.serial;
function notify(res) {
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
const Check = ({ ok, label, detail, pending }) => (SP_JSX.jsxs("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", padding: "3px 0" }, children: [SP_JSX.jsx("span", { style: { color: pending ? "#ffc93c" : ok ? "#5fd08a" : "#ff6b4a", fontSize: "13px", width: "14px" }, children: pending ? "•" : ok ? "\u2713" : "\u2717" }), SP_JSX.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [SP_JSX.jsx("div", { style: { fontSize: "12px" }, children: label }), detail ? (SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.55, wordBreak: "break-all" }, children: detail })) : null] })] }));
// ---------------------------------------------------------------- pad grid
const hexA = (hex, a) => {
    var h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
};
// LED rendering is frame-driven. GET_LED remains the authoritative source,
// while requestAnimationFrame interpolates the last visible RGB toward the
// newly observed target. CSS is used only for static diffusion/glow and flash
// presentation; it never invents fade colours. Toypad timing is 40 ms/tick.
const effectiveMs = (n) => Math.max(1, Number(n) || 1);
const clampByte = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("");
const hexToRgb = (hex) => {
    const h = String(hex || "#000000").replace(/^#/, "");
    const x = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
    const n = parseInt(x, 16);
    if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
// v3.3.37 performance renderer: one animation loop for the whole Toypad.
// GET_LED remains authoritative. We interpolate zone RGB into CSS custom
// properties on one DOM root so animation never causes 10 child React renders
// per frame. The browser only repaints the lighting layers.
const zoneLedKey = (zone) => ({ centre: "0", center: "0", left: "1", right: "2" })[String(zone).toLowerCase()] || "0";
const zoneVarName = (zone) => ({ centre: "centre", center: "centre", left: "left", right: "right" })[String(zone).toLowerCase()] || "left";
// v3.3.39: the game does not send display sRGB. It drives the pad's physical
// RGB LED against a per-channel calibration white point, so "white" arrives as
// (255,110,24) and a pure yellow arrives as (255,110,0). Rendering those bytes
// straight to a screen is why every colour read orange or muddy - the Portal
// chamber's yellow / turquoise / magenta came out orange / dark green / red.
//
// Dividing each channel by its calibration maximum recovers the intended
// colour. Verified against every frame captured in testing:
//   (255,110, 0) -> #ffff00 yellow
//   (  0,110,24) -> #00ffff turquoise
//   (255,  0,24) -> #ff00ff magenta
//   (153, 66,14) -> #999995 white at 60%   (the "power-on" glow)
const LED_WHITE_POINT = { r: 255, g: 110, b: 24 };

const srgbEncode = (lin: number) =>
    lin <= 0.0031308 ? 12.92 * lin
                     : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;

const calibrateLedColor = (r: number, g: number, b: number) => {
    const lr = Math.min(1, Math.max(0, r / LED_WHITE_POINT.r));
    const lg = Math.min(1, Math.max(0, g / LED_WHITE_POINT.g));
    const lb = Math.min(1, Math.max(0, b / LED_WHITE_POINT.b));
    return {
        r: Math.round(srgbEncode(lr) * 255),
        g: Math.round(srgbEncode(lg) * 255),
        b: Math.round(srgbEncode(lb) * 255)
    };
};

const ledCalibrate = ({ r, g, b }: { r: number, g: number, b: number }) =>
    calibrateLedColor(r, g, b);

const getLedRgb = (led: any) => {
    if (!led || led.kind === "off") return { r: 0, g: 0, b: 0 };
    return calibrateLedColor(led.r, led.g, led.b);
};

const fadeColorAt = (region: any, elapsedMs: number) => {
    const LED_TICK_MS = 40;
    const speedTicks = region.speedTicks || region.speed_ticks || 1;
    const stepMs = Math.max(1, (region.speedMs || speedTicks * LED_TICK_MS));
    const step = Math.floor(elapsedMs / stepMs);

    const from_r = region.from_r !== undefined && region.from_r !== null ? region.from_r : (region.fromRgb ? region.fromRgb[0] : null);
    const from_g = region.from_g !== undefined && region.from_g !== null ? region.from_g : (region.fromRgb ? region.fromRgb[1] : null);
    const from_b = region.from_b !== undefined && region.from_b !== null ? region.from_b : (region.fromRgb ? region.fromRgb[2] : null);

    if (from_r === null || from_g === null || from_b === null) {
        const t = Math.max(0, Math.min(1, elapsedMs / stepMs));
        return calibrateLedColor(
            Math.round(region.r * t),
            Math.round(region.g * t),
            Math.round(region.b * t)
        );
    }

    const target = { r: region.r, g: region.g, b: region.b };
    const from = { r: from_r, g: from_g, b: from_b };

    if (region.count > 0 && step >= region.count) {
        const settled = region.count % 2 === 1 ? target : from;
        return calibrateLedColor(settled.r, settled.g, settled.b);
    }

    const t = (elapsedMs % stepMs) / stepMs;
    const forward = step % 2 === 0;
    const a = forward ? from : target;
    const bC = forward ? target : from;

    const rawR = Math.round(a.r + (bC.r - a.r) * t);
    const rawG = Math.round(a.g + (bC.g - a.g) * t);
    const rawB = Math.round(a.b + (bC.b - a.b) * t);

    return calibrateLedColor(rawR, rawG, rawB);
};

const useLedFrameVars = (padColors: any, rootRef: any) => {
    const currentRef = useRef({
        left: { r: 0, g: 0, b: 0 },
        centre: { r: 0, g: 0, b: 0 },
        right: { r: 0, g: 0, b: 0 },
    });
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const zones = ["left", "centre", "right"];
        const targets: Record<string, { r: number, g: number, b: number }> = {};
        for (const zone of zones) {
            const key = zoneLedKey(zone);
            targets[zone] = getLedRgb(padColors ? (padColors[key] || padColors.all) : null);
        }
        const starts: Record<string, { r: number, g: number, b: number }> = {};
        for (const zone of zones) starts[zone] = { ...currentRef.current[zone] };
        const started = performance.now();
        // The game exposes the live fade duration through GET_LED. Use that
        // duration when present; otherwise make ordinary state changes quick.
        let duration = 90;
        for (const zone of zones) {
            const key = zoneLedKey(zone);
            const led = padColors ? (padColors[key] || padColors.all) : null;
            if (led && led.kind === "fade") duration = Math.max(duration, Math.min(2000, effectiveMs(led.speedMs || led.speedTicks * 40)));
        }
        let raf = 0;
        const write = (now: number) => {
            const elapsed = now - started;
            const t = Math.max(0, Math.min(1, elapsed / duration));
            const e = t * t * (3 - 2 * t);
            for (const zone of zones) {
                const key = zoneLedKey(zone);
                const led = padColors ? (padColors[key] || padColors.all) : null;
                let col;
                if (led && led.kind === "fade") {
                    col = fadeColorAt(led, elapsed);
                } else {
                    const a = starts[zone], b = targets[zone];
                    col = {
                        r: Math.round(a.r + (b.r - a.r) * e),
                        g: Math.round(a.g + (b.g - a.g) * e),
                        b: Math.round(a.b + (b.b - a.b) * e),
                    };
                }
                currentRef.current[zone] = col;
                root.style.setProperty(`--dt-${zone}-r`, String(col.r));
                root.style.setProperty(`--dt-${zone}-g`, String(col.g));
                root.style.setProperty(`--dt-${zone}-b`, String(col.b));
            }
            const hasActiveFade = zones.some(z => {
                const key = zoneLedKey(z);
                const led = padColors ? (padColors[key] || padColors.all) : null;
                return led && led.kind === "fade" && (!led.count || elapsed < (led.count * (led.speedMs || 40)));
            });
            if (t < 1 || hasActiveFade) raf = requestAnimationFrame(write);
        };
        raf = requestAnimationFrame(write);
        return () => cancelAnimationFrame(raf);
    }, [padColors?.serial, padColors?.["0"]?.hex, padColors?.["1"]?.hex, padColors?.["2"]?.hex, padColors?.all?.hex, padColors?.["0"]?.speedMs, padColors?.["1"]?.speedMs, padColors?.["2"]?.speedMs, padColors?.all?.speedMs]);
};
const zoneRgba = (zone, alpha) => {
    const z = zoneVarName(zone);
    return `rgba(var(--dt-${z}-r), var(--dt-${z}-g), var(--dt-${z}-b), ${alpha})`;
};
const zoneRgb = (zone) => {
    const z = zoneVarName(zone);
    return `rgb(var(--dt-${z}-r), var(--dt-${z}-g), var(--dt-${z}-b))`;
};
const flashName = (led) => (led && led.kind === "flash")
    ? "dt-f-" + effectiveMs(led.onMs) + "-" + effectiveMs(led.offMs)
    : null;
const fadeName = (led) => (led && led.kind === "fade")
    ? "dt-d-" + effectiveMs(led.speedMs) + "-" + (led.count || 0)
    : null;
const flashStyle = (led) => {
    if (!led || led.kind !== "flash") return {};
    const on = effectiveMs(led.onMs), off = effectiveMs(led.offMs);
    return {
        animationName: flashName(led),
        animationDuration: (on + off) + "ms",
        animationTimingFunction: "steps(1, end)",
        animationIterationCount: led.count > 0 ? String(led.count) : "infinite",
        animationFillMode: "forwards",
    };
};
const fadeStyle = (_led) => ({});
const flashBrightnessStyle = (led) => {
    if (!led || led.kind !== "flash") return {};
    const on = effectiveMs(led.onMs), off = effectiveMs(led.offMs);
    return {
        animationName: "dt-fb-" + on + "-" + off,
        animationDuration: (on + off) + "ms",
        animationTimingFunction: "steps(1, end)",
        animationIterationCount: led.count > 0 ? String(led.count) : "infinite",
        animationFillMode: "forwards",
    };
};
const flashKeyframes = (leds) => {
    const seen = {};
    leds.forEach((led) => {
        const n = flashName(led);
        if (!n || seen[n]) return;
        const on = effectiveMs(led.onMs), off = effectiveMs(led.offMs);
        const pct = Math.max(1, Math.min(98, Math.round((on / (on + off)) * 100)));
        // One animation iteration represents one complete flash cycle. Start
        // and finish lit so a finite cycle count ends in the same illuminated
        // state expected by the Toypad client convention.
        seen[n] = "@keyframes " + n + " { 0%," + pct + "%,100% { opacity: 1; } " + (pct + 1) + "%,99.8% { opacity: .08; } }";
        // v3.3.40: the opacity keyframe above only reads when the glow colour
        // differs from what is behind it. A flash of black on black, or white
        // on white, animates something invisible - which is why keystone
        // colour flashes showed and swap/build flashes did not. This companion
        // keyframe modulates tile brightness instead, so a flash of ANY colour
        // is visible. Applied to the cell root, not the glow.
        const bn = "dt-fb-" + on + "-" + off;
        if (!seen[bn]) {
            seen[bn] = "@keyframes " + bn + " { 0%," + pct + "%,100% { filter: brightness(1); } " +
                (pct + 1) + "%,99.8% { filter: brightness(.34); } }";
        }
        const fn = fadeName(led);
        if (fn && !seen[fn]) {
            seen[fn] = "@keyframes " + fn + " { 0% { opacity: .18; } 50% { opacity: 1; } 100% { opacity: .18; } }";
        }
    });
    // Fade-only states don't pass through the flash branch above.
    leds.filter((led) => led && led.kind === "fade").forEach((led) => {
        const fn = fadeName(led);
        if (!seen[fn]) seen[fn] = "@keyframes " + fn + " { 0% { opacity: .18; } 50% { opacity: 1; } 100% { opacity: .18; } }";
    });
    return Object.keys(seen).map((k) => seen[k]).join("\n");
};
const PadCell = ({ slot, occupant, armed, isSource, wide, onActivate, ledColor, cellRef }) => {
    const [art, setArt] = useState("");
    // The portrait is the figure's own artwork, fetched by the id the pad is
    // holding. v3.3.12: the portrait IS the tile - no name text competing for
    // the ~30px of width the lower cells actually get in the QAM.
    useEffect(() => {
        let live = true;
        setArt("");
        if (occupant && occupant.hasIcon) {
            getIcon(occupant.figure)
                .then((d) => { if (live && d)
                setArt(d); })
                .catch(() => { });
        }
        return () => { live = false; };
    }, [occupant?.figure, occupant?.hasIcon]);
    const explicitOff = !!(ledColor && ledColor.kind === "off");
    const lit = ledColor && !explicitOff ? zoneRgb(slot.zone) : null;
    const animated = !!(ledColor && ledColor.kind === "flash");
    const tint = lit || zoneColour(slot.zone);
    const edge = isSource ? "#45b8ff" : armed ? "#ffc93c" : lit ? lit : "rgba(169,215,238,.28)";
    return (SP_JSX.jsxs(DFL.Focusable, { ref: cellRef, onActivate: onActivate, focusClassName: "dt-pad-focus", className: "dt-cell", style: {
            flex: wide ? "1 1 100%" : "1 1 0%",
            minWidth: 0,
            position: "relative",
            minHeight: wide ? "66px" : "52px",
            margin: "3px",
            borderRadius: slot.zone === "centre" ? "14px" : "9px",
            background: occupant ? "rgba(10,14,20,.30)" : "rgba(6,10,15,.22)",
            border: "2px " + (isSource ? "dashed" : "solid") + " " + edge,
            boxShadow: lit ? "0 0 16px " + zoneRgba(slot.zone, 0.45) + ", inset 0 0 20px " + zoneRgba(slot.zone, 0.18) : "inset 0 1px 0 rgba(255,255,255,.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            // v3.3.40: colour-independent flash. See flashKeyframes.
            ...(animated ? flashBrightnessStyle(ledColor) : {}),
        }, children: [
            // Whole-cell LED wash. Sits under the portrait so the figure stays
            // readable while the tile itself carries the colour.
            lit ? SP_JSX.jsxs("div", { className: "dt-glow", style: Object.assign({
                    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                    background: "radial-gradient(ellipse at 50% 45%, " + zoneRgba(slot.zone, 0.62) + " 0%, " + zoneRgba(slot.zone, 0.34) + " 28%, " + zoneRgba(slot.zone, 0.13) + " 62%, " + zoneRgba(slot.zone, 0.025) + " 100%)",
                    filter: "saturate(1.08)",
                }, ledColor?.kind === "flash" ? flashStyle(ledColor) : {}), children: [
                SP_JSX.jsx("div", { style: { position: "absolute", left: "50%", top: "45%", width: "22px", height: "22px", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.96) 0%, rgba(255,255,255,.72) 18%, " + zoneRgba(slot.zone, 0.48) + " 42%, rgba(255,255,255,0) 72%)", filter: "blur(.35px)", boxShadow: "0 0 12px " + zoneRgba(slot.zone, 0.55) + ", 0 0 8px rgba(255,255,255,.32)" } }),
                SP_JSX.jsx("div", { style: { position: "absolute", inset: "2px", borderRadius: "inherit", boxShadow: "inset 0 0 22px " + zoneRgba(slot.zone, 0.30) + ", 0 0 18px " + zoneRgba(slot.zone, 0.24) } })
            ] }) : null,
            art ? (SP_JSX.jsx("img", { src: art, alt: "", style: {
                    position: "absolute", left: "50%", top: "50%",
                    transform: "translate(-50%,-50%)",
                    height: "84%", maxWidth: "88%", objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,.75))",
                    pointerEvents: "none", zIndex: 2,
                } })) : occupant ? (SP_JSX.jsx("div", { style: {
                    fontSize: "10px", lineHeight: 1.15, textAlign: "center", padding: "0 3px",
                    color: "#e6e9ef", zIndex: 2, overflow: "hidden", wordBreak: "break-word",
                }, children: occupant.name })) : (SP_JSX.jsx("div", { style: {
                    fontSize: "9px", lineHeight: 1.15, textAlign: "center", padding: "0 3px",
                    color: "#6b7280", zIndex: 2,
                }, children: slot.label })),
            occupant && occupant.build > 1 ? (SP_JSX.jsx("div", { style: {
                    position: "absolute", right: "3px", bottom: "2px", zIndex: 3,
                    fontSize: "9px", fontFamily: "monospace", color: "#0b0d12",
                    background: "#ffc93c", borderRadius: "3px", padding: "0 3px",
                }, children: "B" + occupant.build })) : null,
        ] }));
};
const PadZone = ({ zone, ledColor, wideFirst, children }) => {
    const explicitOff = !!(ledColor && ledColor.kind === "off");
    const lit = ledColor && !explicitOff ? zoneRgb(zone) : null;
    const tint = lit || zoneColour(zone);
    const base = explicitOff ? "rgba(0,0,0,.10)" : "rgba(190,230,248,.10)";
    return (SP_JSX.jsxs("div", { className: "dt-zone", style: {
            position: "relative",
            flex: zone === "centre" ? "0.85 1 0%" : "1 1 0%",
            minWidth: 0,
            display: "flex", flexDirection: "column",
            padding: "3px",
            borderRadius: zone === "centre" ? "18px" : "13px",
            background: "radial-gradient(ellipse at 50% 45%, " + (lit ? zoneRgba(zone, 0.26) : base) + " 0%, " + (lit ? zoneRgba(zone, 0.08) : "rgba(190,230,248,.025)") + " 58%, rgba(0,0,0,.10) 100%)",
            border: "1px solid " + (lit ? hexA(lit, 0.55) : "rgba(190,230,248,.08)"),
            boxShadow: lit ? "0 0 24px " + zoneRgba(zone, 0.35) + ", inset 0 0 28px " + zoneRgba(zone, 0.16) : "0 0 10px rgba(190,230,248,.04), inset 0 0 20px rgba(190,230,248,.03)",
        }, children: [
            SP_JSX.jsxs("div", { className: "dt-glow", style: Object.assign({
                    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                    borderRadius: "inherit",
                    background: lit ? "radial-gradient(ellipse at 50% 45%, " + zoneRgba(zone, 0.38) + " 0%, " + zoneRgba(zone, 0.20) + " 34%, " + zoneRgba(zone, 0.065) + " 70%, rgba(0,0,0,0) 100%)" : explicitOff ? "none" : "radial-gradient(ellipse at 50% 45%, rgba(220,245,255,.13) 0%, rgba(220,245,255,.05) 48%, rgba(0,0,0,0) 100%)",
                    boxShadow: lit ? "inset 0 0 34px " + zoneRgba(zone, 0.22) + ", 0 0 24px " + zoneRgba(zone, 0.18) : "none",
                }, ledColor?.kind === "flash" ? flashStyle(ledColor) : {}), children: [
                lit ? SP_JSX.jsx("div", { style: { position: "absolute", left: "50%", top: "45%", width: "30px", height: "30px", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.92) 0%, rgba(255,255,255,.62) 16%, " + zoneRgba(zone, 0.40) + " 42%, rgba(255,255,255,0) 72%)", filter: "blur(.4px)", boxShadow: "0 0 16px " + zoneRgba(zone, 0.48) } }) : null,
                SP_JSX.jsx("div", { style: { position: "absolute", inset: "1px", borderRadius: "inherit", border: lit ? "1px solid " + zoneRgba(zone, 0.22) : "1px solid rgba(220,245,255,.03)", pointerEvents: "none" } })
            ] }),
            SP_JSX.jsx("div", { style: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }, children: children }),
        ] }));
};
const PadGrid = ({ slots, pads, held, moveSource, onSlot, padColors, gridRef }) => {
    const ledRootRef = useRef(null);
    useLedFrameVars(padColors, ledRootRef);
    // gridRef now lands on the first *cell*, which is a real focus target.
    // v3.3.12: SLOTS carries pad as an int (1/2/3) and the section name in
    // `zone`. The old lookup keyed off `pad`, never matched, and silently fell
    // back to the broadcast colour - so per-pad LEDs never rendered.
    const zoneLed = (zone) => {
        var padKey = ({ 'centre': '0', 'center': '0', 'left': '1', 'right': '2' })[String(zone).toLowerCase()];
        return padColors ? (padColors[padKey] || padColors.all) : null;
    };
    const cell = (i, wide) => {
        const s = slots[i];
        if (!s)
            return null;
        return (SP_JSX.jsx(PadCell, { slot: s, occupant: pads[i], armed: held !== null && !pads[i], isSource: moveSource === i, wide: wide, onActivate: () => onSlot(i), ledColor: zoneLed(s.zone), cellRef: (i === ZONE_ORDER.left[0] ? gridRef : undefined) }, i));
    };
    // Shaped like the real toypad: a dark base plate, two rounded side sections
    // of three, and a taller rounded centre between them.
    const activeLeds = ["left", "centre", "right"].map(zoneLed).filter(Boolean);
    return (SP_JSX.jsxs(Fragment, { children: [
        SP_JSX.jsx("style", { children: flashKeyframes(activeLeds) }),
        SP_JSX.jsx(DFL.Focusable, { "flow-children": "horizontal", ref: ledRootRef, style: {
            display: "flex", gap: "5px", padding: "5px",
            borderRadius: "16px", background: "rgba(4,8,13,.32)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
            "--dt-left-r": "0", "--dt-left-g": "0", "--dt-left-b": "0",
            "--dt-centre-r": "0", "--dt-centre-g": "0", "--dt-centre-b": "0",
            "--dt-right-r": "0", "--dt-right-g": "0", "--dt-right-b": "0",
        }, children: SP_JSX.jsxs(Fragment, { children: [
            SP_JSX.jsx(PadZone, { zone: "left", ledColor: zoneLed("left"), children: SP_JSX.jsxs(DFL.Focusable, { "flow-children": "vertical", style: { display: "flex", flexDirection: "column", flex: 1 }, children: [cell(ZONE_ORDER.left[0], true), SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex" }, children: [cell(ZONE_ORDER.left[1]), cell(ZONE_ORDER.left[2])] })] }) }),
            SP_JSX.jsx(PadZone, { zone: "centre", ledColor: zoneLed("centre"), children: SP_JSX.jsx(DFL.Focusable, { "flow-children": "vertical", style: { display: "flex", flex: 1 }, children: cell(ZONE_ORDER.centre[0], true) }) }),
            SP_JSX.jsx(PadZone, { zone: "right", ledColor: zoneLed("right"), children: SP_JSX.jsxs(DFL.Focusable, { "flow-children": "vertical", style: { display: "flex", flexDirection: "column", flex: 1 }, children: [cell(ZONE_ORDER.right[0], true), SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex" }, children: [cell(ZONE_ORDER.right[1]), cell(ZONE_ORDER.right[2])] })] }) }),
        ] }) })] }));
};
// ---------------------------------------------------------------- franchise tile
const FranchiseRow = ({ franchise, onPick, }) => {
    const [logo, setLogo] = useState("");
    const [dark, setDark] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        if (franchise.hasLogo) {
            getFranchiseLogo(franchise.name)
                .then((d) => {
                if (!live)
                    return;
                if (d && d.icon) {
                    setLogo(d.icon);
                    setDark(!!d.dark);
                }
                else
                    setFailed(true);
            })
                .catch(() => { if (live)
                setFailed(true); });
        }
        return () => { live = false; };
    }, [franchise.name, franchise.hasLogo]);
    const showArt = franchise.hasLogo && !failed;
    return (SP_JSX.jsx(DFL.ButtonItem, { className: "dt-tag-card", layout: "below", onClick: onPick, children: SP_JSX.jsxs("div", { style: {
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minHeight: showArt ? "52px" : undefined,
            }, children: [showArt ? (SP_JSX.jsx("div", { style: {
                        width: "104px",
                        height: "48px",
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        // Dark line-art logos vanish on a dark plate and light ones vanish
                        // on a light plate, so the plate follows the artwork.
                        background: "#252a33",
                        borderRadius: "6px",
                        padding: "4px",
                    }, children: logo ? (SP_JSX.jsx("img", { src: logo, alt: franchise.name, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 0 1px rgba(255,255,255,.55))" } })) : null })) : null, SP_JSX.jsxs("div", { style: { flex: 1, minWidth: 0, textAlign: "left" }, children: [SP_JSX.jsx("div", { style: { fontSize: "13px", lineHeight: 1.25 }, children: franchise.name }), SP_JSX.jsxs("div", { style: { fontSize: "10px", opacity: 0.55 }, children: [franchise.count, " tags"] })] })] }) }));
};
// ---------------------------------------------------------------- figure row
const FigureRow = ({ figure, onPick }) => {
    const [icon, setIcon] = useState("");
    useEffect(() => {
        let live = true;
        if (figure.hasIcon) {
            getIcon(figure.id).then((d) => { if (live)
                setIcon(d); }).catch(() => { });
        }
        return () => { live = false; };
    }, [figure.id, figure.hasIcon]);
    return (SP_JSX.jsx(DFL.ButtonItem, { className: "dt-tag-card", layout: "below", onClick: onPick, children: SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, className: "dt-row", children: [icon ? (SP_JSX.jsx("img", { src: icon, style: { width: "28px", height: "28px", objectFit: "contain" } })) : (SP_JSX.jsx("div", { style: { width: "28px" } })), SP_JSX.jsxs("div", { style: { flex: 1, textAlign: "left" }, children: [SP_JSX.jsxs("div", { style: { fontSize: "13px" }, children: [figure.name, figure.build > 1 ? (SP_JSX.jsx("span", { style: { opacity: 0.6 }, children: ` \u00b7 Build ${figure.build}` })) : null] }), figure.kind ? (SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.55 }, children: figure.kind })) : null] })] }) }));
};
// ---------------------------------------------------------------- main panel
const Content = () => {
    const [slots, setSlots] = useState([]);
    const [pads, setPads] = useState(Array(7).fill(null));
    const [franchises, setFranchises] = useState([]);
    const [figures, setFigures] = useState([]);
    const [view, setView] = useState("pad");
    const [franchise, setFranchise] = useState("");
    const [search, setSearch] = useState("");
    const [story, setStory] = useState(false);
    const [held, setHeld] = useState(null);
    const [padColors, setPadColors] = useState(null);
    const [moveSource, setMoveSource] = useState(null);
    const [removeMode, setRemoveMode] = useState(false);
    const [moveArm, setMoveArm] = useState(false);
    const [targetSlot, setTargetSlot] = useState(null);
    const [listening, setListening] = useState(null);
    const [count, setCount] = useState(0);
    const [root, setRoot] = useState(null);
    const [setup, setSetup] = useState(null);
    const [setupError, setSetupError] = useState("");
    const setupRefreshing = useRef(false);
    const [working, setWorking] = useState("");
    const [release, setRelease] = useState(null);
    const [shortcutMsg, setShortcutMsg] = useState("");
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
    const [wizard, setWizard] = useState(null);
    const refreshSetup = async () => {
        if (setupRefreshing.current) return;
        setupRefreshing.current = true;
        try {
            const result = await setupStatus();
            setSetup(result);
            setSetupError("");
        }
        catch (e) {
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
    useEffect(() => { refresh(); const timer = setInterval(() => { refreshSetup(); checkListener().then(l => setListening(l.listening)).catch(() => {}); }, 5000); return () => clearInterval(timer); }, []);
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
    const onSlot = async (slot) => {
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
        return (SP_JSX.jsx(Fragment, { children: SP_JSX.jsxs(DFL.Focusable, { ref: setupRef, autoFocus: true, onCancel: () => setView("pad"), "flow-children": "vertical", children: [SP_JSX.jsx(HotkeySection, {}), SP_JSX.jsx(DiagnosticsSection, {}), SP_JSX.jsxs(DFL.PanelSection, { title: "Setup", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("pad"), children: "Back to pad" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
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
                                    }, children: setup?.setupComplete ? "Setup complete · Re-run setup" : "Set everything up" }) }), wizard ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { padding: "2px 0" }, children: wizard.map((w, i) => (SP_JSX.jsx(Check, { ok: w.ok, label: w.label, detail: w.detail }, i))) }) })) : null, setup ? (SP_JSX.jsxs(Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { children: [SP_JSX.jsx(Check, { ok: setup.rpcs3Ok, label: "Bundled RPCS3", detail: setup.rpcs3Ok ? `${setup.rpcs3Version} · ${setup.rpcs3Path || setup.rpcs3ExpectedPath}` : `Missing: ${setup.rpcs3ExpectedPath || setup.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}` }), SP_JSX.jsx(Check, { ok: setup.tagsOk, label: `Tag library (${setup.tagCount})`, detail: setup.tagsOk ? setup.tagRoot : "Use Download tag library below" }), SP_JSX.jsx(Check, { ok: setup.gameOk, label: "Game dump", detail: setup.gameOk ? setup.gamePath : `Nothing under ${setup.gameRoot}` }), SP_JSX.jsx(Check, { ok: setup.launcherOk, label: "Steam launcher", detail: setup.launcherOk ? setup.launcherPath : "Use Write launcher below" }), SP_JSX.jsx(Check, { ok: setup.webOk, label: "Phone remote", detail: setup.webOk ? setup.webUrl : "Disabled" }), SP_JSX.jsx(Check, { ok: setup.listenerOk, pending: setup.listenerState === "waiting", label: "Toypad listener", detail: setup.listenerState === "connected"
                                                        ? `Connected on :${setup.listenerPort}`
                                                        : setup.listenerState === "waiting"
                                                            ? "Waiting for RPCS3 game..."
                                                            : "Not configured — bundled RPCS3 is unavailable" })] }) }), setup?.padColors ? SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { display: "flex", gap: "10px", alignItems: "center", padding: "4px 0", fontSize: "12px", flexWrap: "wrap" }, children: [SP_JSX.jsx("span", { style: { opacity: 0.7 }, children: "LEDs:" }), ["0", "1", "2"].map(function(k, i) { var label = i === 0 ? "C" : i === 1 ? "L" : "R"; var c = setup.padColors[k] || setup.padColors.all; var bg = c ? c.hex : "#333"; return SP_JSX.jsxs("span", { style: { display: "flex", alignItems: "center", gap: "3px" }, children: [SP_JSX.jsx("span", { style: { width: "10px", height: "10px", borderRadius: "50%", background: bg, border: "1px solid #555", boxShadow: c && c.kind === "flash" ? "0 0 4px " + c.hex : "none" } }), SP_JSX.jsx("span", { style: { opacity: 0.7 }, children: label })]}, k); }), setup.colorReader ? SP_JSX.jsx("span", { style: { opacity: 0.6, fontSize: "10px", marginLeft: "6px" }, children: setup.colorReader.connected ? ("reader: " + setup.colorReader.frames_parsed + " frames") : ("reader: waiting" + (setup.colorReader.last_error ? " (" + setup.colorReader.last_error.slice(0, 30) + ")" : "")) }) : null] }) }) : null, working ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", color: "#ffc93c", padding: "4px 0" }, children: working }) })) : null, SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
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
            }, children: setup.tagsOk ? "Re-download tag library" : "Download tag library" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
                                                const res = await installLauncher();
                                                notify(res);
                                                await refreshSetup();
                                            }, children: setup?.launcherOk ? "Steam launcher already written · rewrite" : "Write Steam launcher" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                                const s = await setWeb(!setup.webEnabled, setup.webPort);
                                                setSetup(s);
                                            }, children: setup.webEnabled ? "Turn off phone remote" : "Turn on phone remote" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: refresh, children: "Re-check everything" }) })] })) : (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", opacity: 0.7 }, children: "Checking..." }) }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Backend & Preferences", children: [
                    SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, {
                        layout: "below",
                        onClick: async () => {
                            const current = await getCurrentBackend();
                            const next = current === "rpcs3" ? "xenia" : "rpcs3";
                            const res = await setBackend(next);
                            if (res && res.ok) {
                                toaster.toast({ title: "Backend Switch", body: `Switched backend to ${next.toUpperCase()}` });
                                await refresh();
                            }
                        },
                        children: `Active Backend: ${(setup?.backend || "rpcs3").toUpperCase()} (Click to toggle RPCS3 / Xenia)`
                    }) }),
                    SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, {
                        layout: "below",
                        onClick: async () => {
                            const current = await getConfigSetting("padSkin", "default");
                            const skins = ["default", "Plain", "Old"];
                            const next = skins[(skins.indexOf(current) + 1) % skins.length];
                            await setConfigSetting("padSkin", next);
                            toaster.toast({ title: "Pad Skin", body: `Pad skin set to ${next}` });
                            await refresh();
                        },
                        children: `Pad Skin: ${setup?.padSkin || "default"} (Click to cycle)`
                    }) }),
                    SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, {
                        label: "Sound Effects",
                        checked: setup?.soundEffects !== false,
                        onChange: async (val) => {
                            await setConfigSetting("soundEffects", val);
                            await refresh();
                        }
                    }) }),
                    SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, {
                        label: "Confirm Button Swap (Swap A/B)",
                        checked: setup?.confirmButtonSwap === true,
                        onChange: async (val) => {
                            await setConfigSetting("confirmButtonSwap", val);
                            await refresh();
                        }
                    }) }),
                ] }), SP_JSX.jsxs(DFL.PanelSection, { title: "RPCS3", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.7, lineHeight: 1.4 }, children: setup?.rpcs3Ok
                                        ? `RPCS3 ✓ Bundled AppImage · ${setup.rpcs3Version}`
                                        : `RPCS3 ✗ Bundled AppImage missing · expected ${setup?.rpcs3ExpectedPath || setup?.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}` }) }), !setup?.rpcs3Ok && release && release.ok ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
                                        setWorking("Downloading RPCS3, this takes a few minutes...");
                                        const res = await installRpcs3();
                                        setWorking("");
                                        notify(res);
                                        await refresh();
                                    }, children: ["Install patched RPCS3 (", release.sizeMB, " MB)"] }) })) : null, SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "RPCS3 bundled AppImage (authoritative)", value: setup?.rpcs3Path ?? "", disabled: true }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Play", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                        setShortcutMsg("Adding...");
                                        try {
                                            // Steam's own shortcut API - this is what "Add a Non-Steam
                                            // Game" calls, so the entry behaves like any other.
                                            const name = "LEGO Dimensions";
                                            const exe = setup?.launcherPath ?? "";
                                            if (!exe) {
                                                setShortcutMsg("Write the launcher first.");
                                                return;
                                            }
                                            const appId = await SteamClient.Apps.AddShortcut(name, exe, "", "");
                                            if (appId) {
                                                await SteamClient.Apps.SetShortcutName(appId, name);
                                                setShortcutMsg(`Added "${name}" to your library.`);
                                            }
                                            else {
                                                setShortcutMsg("Steam refused the shortcut. Add it manually.");
                                            }
                                        }
                                        catch (e) {
                                            setShortcutMsg(`Couldn't add it: ${e?.message ?? e}`);
                                        }
                                    }, children: "Add game shortcut to Steam" }) }), shortcutMsg ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.75, lineHeight: 1.4 }, children: shortcutMsg }) })) : null] }), SP_JSX.jsx(DFL.PanelSection, { title: "After setup", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.7, lineHeight: 1.5 }, children: "Use Add game shortcut to Steam. Launch LEGO Dimensions from Steam; the shortcut starts the bundled RPCS3 directly in Game Mode. The RPCS3 GUI remains available from Setup." }) }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Reset", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                        notify(await resetPaths());
                                        setCustomPath("");
                                        await refresh();
                                    }, children: "Reset paths" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.55, lineHeight: 1.4 }, children: "Clears the custom path and goes back to detection. Nothing is uninstalled \u2014 RPCS3, tags and saved progress stay put." }) })] }), SP_JSX.jsx(DFL.PanelSection, { title: "Credits", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "12px", lineHeight: 1.6 }, children: [SP_JSX.jsxs("div", { style: { marginBottom: "8px" }, children: [SP_JSX.jsx("span", { style: { opacity: 0.6 }, children: "Plugin by " }), SP_JSX.jsx("span", { style: { color: "#ffc93c", fontWeight: 600 }, children: "MetalNic96" })] }), SP_JSX.jsxs("div", { style: { fontSize: "11px", opacity: 0.7 }, children: [SP_JSX.jsxs("div", { style: { marginBottom: "6px" }, children: [SP_JSX.jsx("b", { children: "NeverCookFirst" }), " \u2014 RPCS3 Seamless Toypad Build. The TCP listener was written cross-platform from the start, which is the only reason any of this works on Linux."] }), SP_JSX.jsxs("div", { children: [SP_JSX.jsx("b", { children: "harrysof" }), " \u2014 LegoToypad, its UI design, and the tag library."] })] })] }) }) })] }) }));
    }
    if (view === "franchises") {
        return (SP_JSX.jsx(Fragment, { children: SP_JSX.jsx(DFL.Focusable, { ref: franchiseRef, autoFocus: true, onCancel: () => setView("pad"), "flow-children": "vertical", children: SP_JSX.jsxs(DFL.PanelSection, { title: "Choose a franchise", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("pad"), children: "Back to pad" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", onClick: () => {
                                    setStory(false);
                                    setFranchise("");
                                    setSearch("");
                                    setView("figures");
                                }, children: ["Search everything (", count, ")"] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => {
                                    setStory(true);
                                    setFranchise("");
                                    setSearch("");
                                    setView("figures");
                                }, children: "Story mode (starter pack)" }) }), franchises.map((f) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(FranchiseRow, { franchise: f, onPick: () => {
                                    setStory(false);
                                    setFranchise(f.name);
                                    setSearch("");
                                    setView("figures");
                                } }) }, f.name)))] }) }) }));
    }
    if (view === "figures") {
        return (SP_JSX.jsx(Fragment, { children: SP_JSX.jsx(DFL.Focusable, { ref: figuresRef, autoFocus: true, onCancel: () => setView(story ? "pad" : "franchises"), "flow-children": "vertical", children: SP_JSX.jsxs(DFL.PanelSection, { title: story ? "Story mode" : franchise || "All figures", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("franchises"), children: "Back to franchises" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Filter", value: search, onChange: (e) => setSearch(e.target.value) }) }), figures.length === 0 ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", opacity: 0.7, padding: "8px 0" }, children: "Nothing matches." }) })) : null, figures.map((f) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(FigureRow, { figure: f, onPick: async () => {
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
                                } }) }, f.id)))] }) }) }));
    }
    // -------------------------------------------------------------- sidebar entry
    // Toypad interaction lives exclusively in the modal. The sidebar intentionally
    // keeps no live pad grid, LED renderer, character browser, or Toypad polling.
    return (SP_JSX.jsxs(Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "LEGO Dimensions Toypad", children: [
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "12px", lineHeight: 1.45 }, children: [
            SP_JSX.jsx("div", { style: { fontWeight: 600 }, children: listening === false ? "Toypad listener not connected" : "Toypad overlay ready" }),
            SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.6, marginTop: "3px" }, children: "The Toypad, picker, LEDs and controller navigation live in one overlay." })
        ] }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => openToypadModal(), children: "Open Toypad overlay" }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => { refreshSetup(); refreshRelease(); setView("setup"); }, children: "Setup & phone remote" }) })
    ] })] }));
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
const readJson = (key, fallback) => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    }
    catch (e) { return fallback; }
};
const writeJson = (key, val) => {
    try { window.localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { /* private mode / quota */ }
};
const getHotkey = () => readJson(HK_KEY, { sig: "", paths: [], enabled: true, label: "" });
const setHotkey = (hk) => { writeJson(HK_KEY, hk); };
const getRecent = () => readJson(RECENT_KEY, []);
const pushRecent = (fig) => {
    if (!fig)
        return;
    const list = getRecent().filter((f) => f.figure !== fig.figure);
    list.unshift({ figure: fig.figure, name: fig.name, hasIcon: fig.hasIcon });
    writeJson(RECENT_KEY, list.slice(0, 12));
};

// --- tiny pub/sub so the chord listener can talk to the mounted overlay -----
const overlayBus = {
    listeners: [],
    on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((l) => l !== fn); }; },
    emit(v) {
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
const chordDiag = { attached: false, events: 0, error: "", devices: [], names: [], nodes: 0, held: [], chord: [] };
let chordUnsub = null;
let captureCb = null;
let lastFired = null;

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
            chordDiag.events = (st.devices || []).reduce((a, d) => a + d.events, 0);
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
        catch (e) {
            chordDiag.attached = false;
            chordDiag.error = (e && e.message) ? e.message : String(e);
        }
    };
    const t = setInterval(tick, 120);
    tick();
    chordUnsub = () => { alive = false; clearInterval(t); };
};
const stopChordWatch = () => { if (chordUnsub) { chordUnsub(); chordUnsub = null; chordDiag.attached = false; } };
const captureChord = (cb) => { captureCb = cb; hotkeyCapture(true).catch(() => { }); };
const cancelCapture = () => { captureCb = null; hotkeyCapture(false).catch(() => { }); };
const KEYNAMES = {
    0x130: "A", 0x131: "B", 0x133: "X", 0x134: "Y",
    0x136: "L1", 0x137: "R1", 0x138: "L2", 0x139: "R2",
    0x13a: "Select", 0x13b: "Start", 0x13c: "Steam",
    0x13d: "L3", 0x13e: "R3",
    0x2c0: "L4", 0x2c1: "R4", 0x2c2: "L5", 0x2c3: "R5",
};
const keyLabel = (c) => KEYNAMES[c] || ("0x" + c.toString(16));

// --- keyboard fallback (desktop mode / docked with a keyboard) --------------
let keyUnsub = null;
const startKeyWatch = () => {
    if (keyUnsub || typeof document === "undefined")
        return;
    const onKey = (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
            e.preventDefault();
            overlayBus.emit("toggle");
        }
    };
    document.addEventListener("keydown", onKey, true);
    keyUnsub = () => document.removeEventListener("keydown", onKey, true);
};
const stopKeyWatch = () => { if (keyUnsub) { keyUnsub(); keyUnsub = null; } };

// --- the toypad modal -------------------------------------------------------
// v3.3.14: this was a routerHook global component, which renders but never
// receives gamepad focus - hence a dead B button and no navigation. A modal
// via showModal is the supported way to take exclusive controller focus, and
// ModalRoot wires B/Escape to close for free.
const ModalFranchiseTile = ({ franchise, onPick }: any) => {
    const [logo, setLogo] = useState("");
    useEffect(() => {
        let live = true;
        if (franchise.hasLogo) {
            getFranchiseLogo(franchise.name)
                .then((d: any) => { if (live && d && d.icon) setLogo(d.icon); })
                .catch(() => { });
        }
        return () => { live = false; };
    }, [franchise.name, franchise.hasLogo]);

    const isFavTile = franchise.name === "Favourites";
    const isRecentTile = franchise.name === "Recents";

    return (
        <DFL.Focusable
            onActivate={() => onPick(franchise)}
            focusClassName="dt-pad-focus"
            style={{
                boxSizing: "border-box",
                flex: "0 0 calc(20% - 6px)", minWidth: 0,
                position: "relative",
                height: "74px", margin: "3px",
                borderRadius: "10px",
                background: isFavTile ? "rgba(255,201,60,.18)" : isRecentTile ? "rgba(69,184,255,.18)" : "rgba(16,18,24,.55)",
                border: "1px solid " + (isFavTile ? "rgba(255,201,60,.4)" : isRecentTile ? "rgba(69,184,255,.4)" : "transparent"),
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                padding: "4px", overflow: "hidden",
            }}
        >
            {logo ? (
                <img
                    src={logo}
                    alt=""
                    style={{
                        position: "absolute", inset: "3px",
                        width: "calc(100% - 6px)", height: "calc(100% - 6px)",
                        objectFit: "contain", borderRadius: "7px",
                        filter: "drop-shadow(0 0 1px rgba(255,255,255,.45))",
                        pointerEvents: "none",
                    }}
                />
            ) : isFavTile ? (
                <div style={{ textAlign: "center", zIndex: 1 }}>
                    <div style={{ fontSize: "20px", color: "#ffc93c" }}>★</div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#fff" }}>Favourites</div>
                </div>
            ) : isRecentTile ? (
                <div style={{ textAlign: "center", zIndex: 1 }}>
                    <div style={{ fontSize: "18px", color: "#45b8ff" }}>⏱</div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#fff" }}>Recents</div>
                </div>
            ) : (
                <div style={{ fontSize: "10px", lineHeight: 1.15, textAlign: "center", padding: "0 2px", color: "#c8cedb", zIndex: 1 }}>
                    {franchise.name}
                </div>
            )}
            <div style={{
                position: "absolute", right: "3px", bottom: "2px", zIndex: 2,
                fontSize: "9px", fontFamily: "monospace",
                color: "#e6e9ef", background: "rgba(8,10,14,.72)",
                borderRadius: "3px", padding: "0 3px",
            }}>
                {franchise.count}
            </div>
        </DFL.Focusable>
    );
};

const ModalFigureRow = ({ fig, onPick, isFav, onToggleFav, builds }: any) => {
    const [art, setArt] = useState("");
    const [showBuilds, setShowBuilds] = useState(false);
    useEffect(() => {
        let live = true;
        if (fig.hasFullArt || fig.hasIcon) {
            getFullArt(fig.id)
                .then((d: string) => {
                    if (live && d) setArt(d);
                    else if (live && fig.hasIcon) getIcon(fig.id).then((ic: string) => { if (live && ic) setArt(ic); });
                })
                .catch(() => {
                    if (live && fig.hasIcon) getIcon(fig.id).then((ic: string) => { if (live && ic) setArt(ic); });
                });
        }
        return () => { live = false; };
    }, [fig.id, fig.hasIcon, fig.hasFullArt]);

    const hasMultipleBuilds = builds && builds.length > 1;

    return (
        <div style={{ margin: "3px 0" }}>
            <DFL.Focusable
                onActivate={() => {
                    if (hasMultipleBuilds && !showBuilds) {
                        setShowBuilds(true);
                    } else {
                        onPick(fig);
                    }
                }}
                onKeyDown={(e: any) => {
                    if (e.key === "x" || e.key === "X" || e.keyCode === 88) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onToggleFav) onToggleFav(fig);
                    }
                }}
                focusClassName="dt-pad-focus"
                className="dt-tag-card"
                style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 8px", borderRadius: "8px",
                    background: "rgba(20,24,33,.6)", border: "1px solid transparent",
                    cursor: "pointer",
                }}
            >
                <div style={{
                    width: "36px", height: "36px", flex: "0 0 36px",
                    display: "flex", alignItems: "flex-end", justifyContent: "center",
                }}>
                    {art ? (
                        <img
                            src={art}
                            alt=""
                            style={{
                                maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
                                filter: "drop-shadow(0 2px 4px rgba(0,0,0,.65))",
                            }}
                        />
                    ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontSize: "13px", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fig.name}
                        {fig.build > 1 ? (
                            <span style={{ opacity: 0.6, fontSize: "11px" }}>{` · Build ${fig.build}`}</span>
                        ) : null}
                        {hasMultipleBuilds ? (
                            <span style={{ opacity: 0.5, fontSize: "10px", marginLeft: "6px" }}>{`(${builds.length} builds)`}</span>
                        ) : null}
                    </div>
                    <div style={{ fontSize: "10px", opacity: 0.55 }}>
                        {fig.franchise} {fig.kind ? `· ${fig.kind}` : ""}
                    </div>
                </div>
                {onToggleFav ? (
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFav(fig);
                        }}
                        style={{
                            padding: "4px 8px",
                            fontSize: "15px",
                            color: isFav ? "#ffc93c" : "rgba(255,255,255,.3)",
                            cursor: "pointer",
                        }}
                        title="Toggle Favourite (X)"
                    >
                        {isFav ? "★" : "☆"}
                    </div>
                ) : null}
            </DFL.Focusable>
            {showBuilds && hasMultipleBuilds ? (
                <div style={{
                    display: "flex", gap: "6px", padding: "4px 8px 6px 44px",
                    background: "rgba(10,14,20,0.5)", borderRadius: "0 0 8px 8px",
                }}>
                    {builds.map((b: any) => (
                        <DFL.Focusable
                            key={b.id}
                            onActivate={() => onPick(b)}
                            focusClassName="dt-pad-focus"
                            style={{
                                flex: "1 1 0%", textAlign: "center", fontSize: "11px",
                                padding: "6px 4px", borderRadius: "6px",
                                background: "rgba(29,39,53,0.75)", border: "1px solid rgba(69,184,255,0.4)",
                                cursor: "pointer",
                            }}
                        >
                            {b.name || `Build ${b.build}`}
                        </DFL.Focusable>
                    ))}
                </div>
            ) : null}
        </div>
    );
};

const LedDiagnostics = ({ data }) => {
    const safe = data && typeof data === "object" ? data : {};
    const stats = safe.readerStats && typeof safe.readerStats === "object" ? safe.readerStats : {};
    const events = Array.isArray(safe.events) ? safe.events.slice(-40).reverse() : [];
    const current = safe.padColors && typeof safe.padColors === "object" ? safe.padColors : {};
    const rgbText = (p) => Array.isArray(p?.rgb) ? p.rgb.join(",") : "—";
    const modeText = (p) => String(p?.kind || "unknown").toUpperCase();
    const previousFor = (index, padKey) => {
        const prior = events[index + 1];
        const p = prior?.pads?.find?.((x) => String(x?.pad) === padKey);
        return p?.rgb;
    };
    const line = (e, i) => {
        const stamp = e?.timestamp ? new Date(Number(e.timestamp) * 1000).toLocaleTimeString() : "—";
        const delta = e?.delta == null ? "—" : "+" + e.delta;
        const pads = Array.isArray(e?.pads) ? e.pads : [];
        return SP_JSX.jsxs("div", { style: { padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.08)", fontSize: "10px" }, children: [
            SP_JSX.jsxs("div", { style: { display: "flex", justifyContent: "space-between", opacity: .75 }, children: [
                SP_JSX.jsxs("span", { children: [stamp, " · seq ", String(e?.seq ?? "—"), " · serial ", String(e?.serial ?? "—"), " (", delta, ")"] }),
                SP_JSX.jsx("span", { children: e?.source || "GET_LED snapshot" })
            ] }),
            SP_JSX.jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginTop: "4px" }, children: ["0", "1", "2"].map((key) => {
                const p = pads.find((x) => String(x?.pad) === key);
                const prev = previousFor(i, key);
                const label = key === "0" ? "C" : key === "1" ? "L" : "R";
                return SP_JSX.jsxs("div", { style: { background: "rgba(0,0,0,.22)", borderRadius: "4px", padding: "4px" }, children: [
                    SP_JSX.jsxs("div", { children: [SP_JSX.jsx("b", { children: label }), " ", modeText(p)] }),
                    SP_JSX.jsxs("div", { children: ["RGB ", rgbText(p)] }),
                    prev && p ? SP_JSX.jsxs("div", { style: { opacity: .7 }, children: ["FROM ", prev.join(","), " → ", rgbText(p)] }) : null,
                    p?.kind === "fade" ? SP_JSX.jsxs("div", { style: { opacity: .7 }, children: ["speed ", String(p?.speedTicks ?? 0), "t/", String(p?.speedMs ?? 0), "ms · count ", String(p?.count ?? 0)] }) : null,
                    p?.kind === "flash" ? SP_JSX.jsxs("div", { style: { opacity: .7 }, children: ["on ", String(p?.onTicks ?? 0), "t / off ", String(p?.offTicks ?? 0), "t · count ", String(p?.count ?? 0)] }) : null,
                ] }, key);
            }) }),
            e?.raw ? SP_JSX.jsxs("div", { style: { opacity: .45, marginTop: "3px", wordBreak: "break-all" }, children: ["RX ", String(e.raw).slice(0, 90), String(e.raw).length > 90 ? "…" : ""] }) : null,
        ] }, String(e?.seq ?? i));
    };
    return SP_JSX.jsxs("div", { style: { marginTop: "10px", padding: "8px", background: "rgba(5,8,12,.65)", borderRadius: "8px", border: "1px solid rgba(255,255,255,.10)", maxHeight: "38vh", overflowY: "auto", overflowX: "hidden", fontSize: "10px" }, children: [
        SP_JSX.jsxs("div", { style: { fontSize: "12px", fontWeight: 600, marginBottom: "5px" }, children: ["LED LISTENER DIAGNOSTICS ", SP_JSX.jsx("span", { style: { color: "#5fd08a", float: "right" }, children: stats.connected ? "● CONNECTED" : "○ WAITING" })] }),
        SP_JSX.jsxs("div", { style: { opacity: .75, marginBottom: "5px" }, children: [
            "GET_LED snapshots ", String(stats.snapshots_seen ?? 0), " · changed ", String(stats.changed_snapshots ?? 0), " · frames ", String(stats.frames_parsed ?? 0), " · serial ", String(stats.led_serial ?? 0)
        ] }),
        SP_JSX.jsxs("div", { style: { opacity: .6, marginBottom: "6px" }, children: ["This is the listener's received 30-byte GET_LED stream. It is not the raw game's C0–C8 command stream."] }),
        events.length ? events.map(line) : SP_JSX.jsx("div", { style: { opacity: .5, padding: "10px 0" }, children: "Waiting for a changed LED snapshot…" }),
        SP_JSX.jsxs("div", { style: { marginTop: "5px", paddingTop: "5px", borderTop: "1px solid rgba(255,255,255,.08)", opacity: .65 }, children: [
            "Current: C ", current["0"]?.hex || "off", " · L ", current["1"]?.hex || "off", " · R ", current["2"]?.hex || "off"
        ] }),
    ] });
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
                getFranchises().then((f) => setFranchises(f || [])).catch(() => {});
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
        getLedEnabled().then((r) => setLedOn(r?.ledEnabled !== false)).catch(() => { });
    }, []);
    const [busy, setBusy] = useState("");
    const [ledDiagOpen, setLedDiagOpen] = useState(false);
    const [ledDiag, setLedDiag] = useState(null);
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
            setPadColors((prev) => ledMapEqual(prev, next) ? prev : next);
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
                    setPadColors((prev) => ledMapEqual(prev, next) ? prev : next);
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
        getFranchises().then((f) => setFranchises(f || [])).catch(() => setFranchises([]));
    }, []);
    // Debounced search so the virtual keyboard stays responsive.
    useEffect(() => {
        if (mode !== "picking" && mode !== "franchises")
            return;
        if (mode === "franchises" && !search.trim()) { setFigures([]); return; }
        let live = true;
        const t = setTimeout(() => {
            getFigures(mode === "picking" ? franchise : "", search, false)
                .then((f) => { if (live) setFigures((f || []).slice(0, 60)); })
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
        : mode === "franchises" ? "Pick a franchise, or search  \u00b7  B to go back"
        : mode === "picking" ? (franchise || "Pick a figure") + "  \u00b7  B to go back"
        : mode === "move" ? (moveSource === null ? "Tap the figure to move" : "Tap where it goes")
        : mode === "remove" ? "Tap a pad to take its figure off"
        : "Select a pad to place or swap  \u00b7  B to close";

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

    const btn = (label: string, onClick: () => void, tone?: string) => (SP_JSX.jsx(DFL.Focusable, { onActivate: onClick, focusClassName: "dt-pad-focus", style: {
            flex: "1 1 0%", textAlign: "center", fontSize: "12px",
            padding: "8px 6px", borderRadius: "8px",
            background: tone === "on" ? "rgba(29,39,53,.75)" : "rgba(20,24,33,.6)",
            border: "1px solid " + (tone === "on" ? "#45b8ff" : "transparent"),
        }, children: label }));

    return (SP_JSX.jsx(DFL.ModalRoot, { className: "dt-toypad-modal-root", closeModal: back, onCancel: back, onEscKeypress: back, children:
        SP_JSX.jsx("div", { style: {
                position: "fixed", inset: 0,
                width: "100vw", height: "100vh",
                minWidth: "100vw", minHeight: "100vh",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(6,7,10,.72)",
                padding: "24px", boxSizing: "border-box",
                overflow: "hidden",
                overscrollBehavior: "none",
                zIndex: 99999,
            }, children: SP_JSX.jsxs("div", { ref: shellRef, style: {
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
            }, children: [
            SP_JSX.jsx("style", { children: FOCUS_CSS }),
            SP_JSX.jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }, children: [
                SP_JSX.jsx("div", { style: { fontSize: "16px", fontWeight: 600 }, children: "Dimensions Toypad" }),
                SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.6 }, children: hint }),
            ] }),
            SP_JSX.jsx("div", { style: { flex: "0 0 auto" }, children:
                SP_JSX.jsx(PadGrid, { slots: slots, pads: pads, held: null, moveSource: moveSource, onSlot: onSlot, padColors: padColors, gridRef: mode === "pad" ? landRef : undefined }) }),
            (mode === "franchises" || mode === "picking") ? (SP_JSX.jsxs("div", { style: { marginTop: "10px", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }, children: [
                SP_JSX.jsx(DFL.TextField, { ref: landRef, value: search, placeholder: mode === "picking" ? ("Search " + franchise + "...") : "Search all figures...", onChange: (e: any) => setSearch(e?.target?.value ?? ""), }),
                // A live query always wins: results drop straight down as a
                // navigable list, whichever level you are on.
                (search.trim() && groupedFigures.length) ? (
                    SP_JSX.jsx(DFL.Focusable, { "flow-children": "vertical", style: { marginTop: "6px", maxHeight: "40vh", overflowY: "auto", overflowX: "hidden", position: "relative", isolation: "isolate", contain: "paint", borderRadius: "10px" }, children:
                        groupedFigures.map((f) => {
                            const isFav = favourites.some((fav: any) => fav.franchise?.toLowerCase() === f.franchise?.toLowerCase() && fav.name?.toLowerCase() === (f.family || f.name)?.toLowerCase());
                            return SP_JSX.jsx(ModalFigureRow, { fig: f, builds: f.builds, isFav: isFav, onToggleFav: onToggleFav, onPick: place }, f.id);
                        }) })
                ) : search.trim() ? (
                    SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.5, padding: "8px 2px" }, children: "Nothing matches that." })
                ) : mode === "franchises" ? (
                    // 5 across, scrolls vertically for the rest.
                    // v3.3.19: "horizontal" makes Steam treat a wrapping flex
                    // as one row, so wrapped rows were unreachable sideways -
                    // only up/down worked. "grid" walks both axes.
                    SP_JSX.jsx(DFL.Focusable, { "flow-children": "grid", style: {
                            marginTop: "6px", display: "flex", flexWrap: "wrap",
                            maxHeight: "46vh", overflowY: "auto", overflowX: "hidden",
                            alignContent: "flex-start",
                            // Own stacking + paint containment: without these a
                            // tile mid-scroll renders over the modal edge.
                            position: "relative", isolation: "isolate", contain: "paint",
                            borderRadius: "10px",
                        }, children: franchises.length
                            ? franchises.map((f: any) => SP_JSX.jsx(ModalFranchiseTile, { franchise: f, onPick: (fr: any) => { setFranchise(fr.name); setSearch(""); setMode("picking"); } }, f.name))
                            : SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.5, padding: "8px 2px" }, children: "No tag library loaded." }) })
                ) : (
                    SP_JSX.jsx(DFL.Focusable, { "flow-children": "vertical", style: { marginTop: "6px", maxHeight: "40vh", overflowY: "auto", overflowX: "hidden", position: "relative", isolation: "isolate", contain: "paint", borderRadius: "10px" }, children:
                        groupedFigures.length
                            ? groupedFigures.map((f) => {
                                const isFav = favourites.some((fav: any) => fav.franchise?.toLowerCase() === f.franchise?.toLowerCase() && fav.name?.toLowerCase() === (f.family || f.name)?.toLowerCase());
                                return SP_JSX.jsx(ModalFigureRow, { fig: f, builds: f.builds, isFav: isFav, onToggleFav: onToggleFav, onPick: place }, f.id);
                            })
                            : SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.5, padding: "8px 2px" }, children: "Nothing in this franchise." }) })
                ),
            ] })) : (SP_JSX.jsxs(Fragment, { children: [
                SP_JSX.jsx(DFL.Focusable, { onActivate: async () => {
                        const next = !ledOn;
                        setLedOn(next);
                        await setLedEnabled(next).catch(() => { });
                        refreshState();
                        refreshLeds();
                    }, focusClassName: "dt-pad-focus", style: { marginTop: "10px", padding: "8px", borderRadius: "8px", textAlign: "center", background: "rgba(20,24,33,.6)", border: "1px solid " + (ledOn ? "#45b8ff" : "transparent"), fontSize: "12px" },
                    children: ledOn ? "LED lighting: on" : "LED lighting: off (Toypad still works)" }),
                SP_JSX.jsx(DFL.Focusable, { onActivate: () => setLedDiagOpen((v) => !v), focusClassName: "dt-pad-focus", style: { marginTop: "10px", padding: "8px", borderRadius: "8px", textAlign: "center", background: "rgba(20,24,33,.6)", border: "1px solid " + (ledDiagOpen ? "#45b8ff" : "transparent"), fontSize: "12px" }, children: ledDiagOpen ? "Hide LED diagnostics" : "Show LED diagnostics" }),
                ledDiagOpen ? SP_JSX.jsx(LedDiagnostics, { data: ledDiag }) : null,
                SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex", gap: "6px", marginTop: "10px" }, children: [
                btn(demoMode ? "LED demo: running" : "LED demo mode", () => setDemoMode(!demoMode), demoMode ? "on" : undefined),
                btn(mode === "move" ? "Moving..." : "Move", () => { setMoveSource(null); setMode(mode === "move" ? "pad" : "move"); }, mode === "move" ? "on" : ""),
                btn(mode === "remove" ? "Removing..." : "Remove", () => setMode(mode === "remove" ? "pad" : "remove"), mode === "remove" ? "on" : ""),
                btn("Clear all", async () => { setBusy("Clearing..."); await clearAll().catch(() => { }); setBusy(""); refreshState(); refreshLeds(); }),
                btn("Close", () => shut()),
            ] }),
            ] })),
        ] }) }) }));
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
    handle = DFL.showModal(SP_JSX.jsx(ToypadModal, { onClosed: () => { modalOpen = false; closeActiveModal = null; } }), window, {
        strTitle: "Dimensions Toypad",
        bHideMainMenuLogo: true,
    } as any);
};

const DiagnosticsSection = () => {
    const [on, setOn] = useState(false);
    useEffect(() => {
        getDiagnosticsEnabled().then((r) => setOn(!!r?.diagnosticsEnabled)).catch(() => { });
    }, []);
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "Diagnostics", children: [
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, {
            label: "LED diagnostics",
            checked: on,
            onChange: async (v: boolean) => { setOn(v); await setDiagnosticsEnabled(v).catch(() => { }); },
        }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.6, padding: "2px 0" }, children:
            "Records the GET_LED history and raw hex for troubleshooting. The Toypad still receives every colour with this off - only the recording stops." }) }),
    ] }));
};

const HotkeySection = () => {
    const [st, setSt] = useState({ chord: [], enabled: true, held: [] });
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
    return (SP_JSX.jsxs(DFL.PanelSection, { title: "Hotkey", children: [
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.65, padding: "2px 0" }, children: "Summon the toypad over a running game. Press it again to close." }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Hotkey enabled", checked: !!st.enabled, onChange: async (v: boolean) => { await hotkeySet(st.chord || [], v).catch(() => { }); setSt(await hotkeyState().catch(() => st)); } }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.8, padding: "2px 0" }, children:
            capturing ? ("Release all buttons, then hold the exact chord... " + ((diag.held || []).map(keyLabel).join(" + ") || "(waiting)"))
                      : ("Current chord: " + describe()) }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => { if (capturing) { cancelCapture(); setCapturing(false); } else { beginCapture(); } }, children: capturing ? "Listening... (tap to cancel)" : "Set hotkey chord" }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => { await hotkeySet([], false).catch(() => { }); setSt(await hotkeyState().catch(() => st)); }, children: "Clear hotkey" }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => overlayBus.emit("toggle"), children: "Open toypad overlay" }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.75, padding: "4px 0", lineHeight: 1.35 }, children:
            (diag.events > 0)
                ? null
                : (diag.nodes ? "Steam holds the controller, so button presses never reach the plugin. Bind a key instead: Steam \u2192 Controller Settings \u2192 edit layout \u2192 put a keyboard key (F13 works well) on a back button, then capture it here."
                              : "No input devices could be opened. Restart Decky so the backend reloads.") }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "9px", opacity: 0.55, fontFamily: "monospace", wordBreak: "break-all", padding: "3px 0" }, children:
            "evdev " + (diag.attached ? "OK" : "DOWN") + " \u00b7 nodes " + (diag.nodes || 0) + " \u00b7 key events " + diag.events +
            (diag.error ? (" \u00b7 ERR " + diag.error) : "") }) }),
        SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "9px", opacity: 0.45, fontFamily: "monospace", wordBreak: "break-all" }, children:
            (diag.devices && diag.devices.length)
                ? ("live: " + (diag.devices as any[]).map((d: any) => (d.name || d.path.replace("/dev/input/", "")) + ":" + d.events).join("  "))
                : ("watching: " + ((diag.names || []).join(", ") || "nothing")) }) }),
    ] }));
};

var index = definePlugin(() => {
    // v3.3.14: no global component any more. showModal gives the pad real
    // gamepad focus, which addGlobalComponent never did - that is why B did
    // nothing and nothing was navigable.
    startChordWatch();
    startKeyWatch();
    return {
        name: "Dimensions Toypad",
        titleView: SP_JSX.jsx("div", { children: "Dimensions Toypad" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(FaCubes, {}),
        onDismount() {
            stopChordWatch();
            stopKeyWatch();
        },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
