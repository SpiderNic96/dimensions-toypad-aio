// SPDX-License-Identifier: MIT
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------- LED colour comparison
export const ledEqual = (a: any, b: any) => {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    const keys = ["r", "g", "b", "hex", "kind", "onMs", "offMs", "speedMs", "count", "serial", "timestamp"];
    return keys.every((k) => a[k] === b[k]);
};
export const ledMapEqual = (a: any, b: any) => !!a && !!b && ledEqual(a["0"], b["0"]) && ledEqual(a["1"], b["1"]) && ledEqual(a["2"], b["2"]) && ledEqual(a.all, b.all) && a.tickMs === b.tickMs && a.serial === b.serial;

// ---------------------------------------------------------------- pad grid colour helpers
export const hexA = (hex: any, a: any) => {
    var h = String(hex || "#000000").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
};
// LED rendering is frame-driven. GET_LED remains the authoritative source,
// while requestAnimationFrame interpolates the last visible RGB toward the
// newly observed target. CSS is used only for static diffusion/glow and flash
// presentation; it never invents fade colours. Toypad timing is 40 ms/tick.
export const effectiveMs = (n: any) => Math.max(1, Number(n) || 1);
export const clampByte = (n: any) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
export const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("");
export const hexToRgb = (hex: any) => {
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
export const zoneLedKey = (zone: any) => ({ centre: "0", center: "0", left: "1", right: "2" } as any)[String(zone).toLowerCase()] || "0";
export const zoneVarName = (zone: any) => ({ centre: "centre", center: "centre", left: "left", right: "right" } as any)[String(zone).toLowerCase()] || "left";
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
export const LED_WHITE_POINT = { r: 255, g: 110, b: 24 };

export const srgbEncode = (lin: number) =>
    lin <= 0.0031308 ? 12.92 * lin
                     : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;

export const calibrateLedColor = (r: number, g: number, b: number) => {
    const lr = Math.min(1, Math.max(0, r / LED_WHITE_POINT.r));
    const lg = Math.min(1, Math.max(0, g / LED_WHITE_POINT.g));
    const lb = Math.min(1, Math.max(0, b / LED_WHITE_POINT.b));
    return {
        r: Math.round(srgbEncode(lr) * 255),
        g: Math.round(srgbEncode(lg) * 255),
        b: Math.round(srgbEncode(lb) * 255)
    };
};

export const ledCalibrate = ({ r, g, b }: { r: number, g: number, b: number }) =>
    calibrateLedColor(r, g, b);

export const getLedRgb = (led: any) => {
    if (!led || led.kind === "off") return { r: 0, g: 0, b: 0 };
    return calibrateLedColor(led.r, led.g, led.b);
};

export const fadeColorAt = (region: any, elapsedMs: number) => {
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

export const useLedFrameVars = (padColors: any, rootRef: any) => {
    const currentRef = useRef<Record<string, { r: number; g: number; b: number }>>({
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
export const zoneRgba = (zone: any, alpha: any) => {
    const z = zoneVarName(zone);
    return `rgba(var(--dt-${z}-r), var(--dt-${z}-g), var(--dt-${z}-b), ${alpha})`;
};
export const zoneRgb = (zone: any) => {
    const z = zoneVarName(zone);
    return `rgb(var(--dt-${z}-r), var(--dt-${z}-g), var(--dt-${z}-b))`;
};
export const flashName = (led: any) => (led && led.kind === "flash")
    ? "dt-f-" + effectiveMs(led.onMs) + "-" + effectiveMs(led.offMs)
    : null;
export const fadeName = (led: any) => (led && led.kind === "fade")
    ? "dt-d-" + effectiveMs(led.speedMs) + "-" + (led.count || 0)
    : null;
export const flashStyle = (led: any) => {
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
export const fadeStyle = (_led: any) => ({});
export const flashBrightnessStyle = (led: any) => {
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
export const flashKeyframes = (leds: any[]) => {
    const seen: any = {};
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
        const fn = fadeName(led) as string;
        if (!seen[fn]) seen[fn] = "@keyframes " + fn + " { 0% { opacity: .18; } 50% { opacity: 1; } 100% { opacity: .18; } }";
    });
    return Object.keys(seen).map((k) => seen[k]).join("\n");
};
