// SPDX-License-Identifier: MIT
import * as DFL from "@decky/ui";
import { useState, useEffect, useRef } from "react";
import { getIcon } from "./api";
import {
    zoneRgb,
    zoneRgba,
    flashStyle,
    flashBrightnessStyle,
    flashKeyframes,
    useLedFrameVars,
} from "./led";

// ---------------------------------------------------------------- pad geometry
// Ported from LegoToypad main.cpp:4509 (kPadCells), absolutely positioned in a
// 700x397 landscape view box (x 100-800, y 103-500) - not 350:400, that was a
// misread of a CSS calc() width that propagated into an earlier draft. The
// centre cell is larger and sits higher than the two wings; the lower row is
// visibly wider than the upper row.
export const PAD_CELLS = [
    { slot: 0, x: 100, y: 220, w: 140, h: 136 },  // left upper
    { slot: 1, x: 356, y: 103, w: 188, h: 184 },  // CENTRE - larger, higher
    { slot: 2, x: 660, y: 220, w: 140, h: 136 },  // right upper
    { slot: 3, x: 100, y: 364, w: 136, h: 136 },
    { slot: 4, x: 244, y: 364, w: 164, h: 136 },  // lower row is WIDER
    { slot: 5, x: 492, y: 364, w: 164, h: 136 },
    { slot: 6, x: 664, y: 364, w: 136, h: 136 },
];
export const PAD_VIEW = { x: 100, y: 103, w: 700, h: 397 };

// The pad is 3/1/3: a tall centre flanked by two sections of three. Laying it
// out the way the hardware looks makes "Left · lower R" mean something at a
// glance, rather than being a label you have to decode.
export const ZONE_ORDER = {
    left: [0, 3, 4],
    centre: [1],
    right: [2, 5, 6],
};
export const zoneColour = (_zone: any) => "#a9d7ee";

// pad 1 = centre, pad 2 = left section, pad 3 = right section.
// 3/1/3 geometry: left owns 0/3/4, centre is slot 1, right owns 2/5/6.
export const SLOTS = [
    { "slot": 0, "pad": 2, "index": 0, "zone": "left", "label": "Left · upper" },
    { "slot": 1, "pad": 1, "index": 1, "zone": "centre", "label": "Centre" },
    { "slot": 2, "pad": 3, "index": 2, "zone": "right", "label": "Right · upper" },
    { "slot": 3, "pad": 2, "index": 3, "zone": "left", "label": "Left · lower L" },
    { "slot": 4, "pad": 2, "index": 4, "zone": "left", "label": "Left · lower R" },
    { "slot": 5, "pad": 3, "index": 5, "zone": "right", "label": "Right · lower L" },
    { "slot": 6, "pad": 3, "index": 6, "zone": "right", "label": "Right · lower R" },
];

const cellByIndex = (i: number) => PAD_CELLS[i];

// Percentages against PAD_VIEW, not raw pixels - the pad scales with whatever
// box the panel gives it.
const pctRect = (r: { x: number; y: number; w: number; h: number }) => ({
    left: `${((r.x - PAD_VIEW.x) / PAD_VIEW.w) * 100}%`,
    top: `${((r.y - PAD_VIEW.y) / PAD_VIEW.h) * 100}%`,
    width: `${(r.w / PAD_VIEW.w) * 100}%`,
    height: `${(r.h / PAD_VIEW.h) * 100}%`,
});

export const Check = ({ ok, label, detail, pending }: any) => (
    <div style={{ display: "flex", gap: "8px", alignItems: "baseline", padding: "3px 0" }}>
        <span style={{ color: pending ? "#ffc93c" : ok ? "#5fd08a" : "#ff6b4a", fontSize: "13px", width: "14px" }}>
            {pending ? "•" : ok ? "✓" : "✗"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12px" }}>{label}</div>
            {detail ? (
                <div style={{ fontSize: "10px", opacity: 0.55, wordBreak: "break-all" }}>{detail}</div>
            ) : null}
        </div>
    </div>
);

// ---------------------------------------------------------------- region halo
// Upstream RenderLedHalo(region, ...) draws one diffuse glow per region, over
// the region's bounding box - not one per slot, which used to read as three
// independent lamps instead of a diffused panel.
const HALO_MARGIN = 22;       // kLedGlowRadius's companion margin, expands the region box
const HALO_BLUR_MAX = 14;     // kLedGlowRadius: blur radius at full luminance
const HALO_ALPHA_MAX = 210;   // 0-255 scale; converted to a CSS 0-1 alpha below
const HALO_LEVELS = 9;        // quantised intensity steps, 0/8 .. 8/8

const luminance = (r: number, g: number, b: number) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

// Quantised so the halo doesn't visibly repaint on every minor colour shift -
// it steps through 9 fixed levels instead of continuously tracking luminance.
const quantiseIntensity = (l: number) => {
    const step = Math.round((Math.max(0, Math.min(255, l)) / 255) * (HALO_LEVELS - 1));
    return step / (HALO_LEVELS - 1);
};

const regionBounds = (indices: number[]) => {
    const cells = indices.map(cellByIndex);
    const x0 = Math.min(...cells.map((c) => c.x)) - HALO_MARGIN;
    const y0 = Math.min(...cells.map((c) => c.y)) - HALO_MARGIN;
    const x1 = Math.max(...cells.map((c) => c.x + c.w)) + HALO_MARGIN;
    const y1 = Math.max(...cells.map((c) => c.y + c.h)) + HALO_MARGIN;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const REGION_INDICES: Record<"left" | "centre" | "right", number[]> = {
    left: ZONE_ORDER.left,
    centre: ZONE_ORDER.centre,
    right: ZONE_ORDER.right,
};

const RegionPanel = ({ region, ledColor, children }: { region: "left" | "centre" | "right"; ledColor: any; children?: any }) => {
    const explicitOff = !!(ledColor && ledColor.kind === "off");
    const lit = ledColor && !explicitOff;
    const rect = pctRect(regionBounds(REGION_INDICES[region]));
    // The centre region is a circular collar around the puck; the wings stay
    // rounded-rect panels.
    const radius = region === "centre" ? "50%" : "28px";
    const l = lit ? luminance(ledColor.r ?? 0, ledColor.g ?? 0, ledColor.b ?? 0) : 0;
    const intensity = quantiseIntensity(l);
    const blur = HALO_BLUR_MAX * intensity;
    const alpha = (HALO_ALPHA_MAX * intensity) / 255;
    return (
        <>
            {/* One diffuse halo per region, sized to the region's bounding box
                (not per slot) - three independent per-slot glows used to read
                as three lamps rather than one diffused panel. */}
            {lit ? (
                <div
                    className="dt-glow"
                    style={Object.assign(
                        {
                            position: "absolute",
                            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
                            pointerEvents: "none", zIndex: 0,
                            borderRadius: radius,
                            background: "radial-gradient(ellipse at 50% 45%, " + zoneRgba(region, alpha) + " 0%, " + zoneRgba(region, alpha * 0.45) + " 45%, " + zoneRgba(region, 0) + " 100%)",
                            filter: "blur(" + blur + "px)",
                        } as any,
                        ledColor?.kind === "flash" ? flashStyle(ledColor) : {}
                    )}
                />
            ) : null}
            {children}
        </>
    );
};

export const PadCell = ({ slot, occupant, armed, isSource, onActivate, ledColor, cellRef }: any) => {
    const [art, setArt] = useState("");
    // The portrait is the figure's own artwork, fetched by the id the pad is
    // holding. v3.3.12: the portrait IS the tile - no name text competing for
    // the ~30px of width the lower cells actually get in the QAM.
    useEffect(() => {
        let live = true;
        setArt("");
        if (occupant && occupant.hasIcon) {
            getIcon(occupant.figure)
                .then((d: any) => { if (live && d) setArt(d); })
                .catch(() => { });
        }
        return () => { live = false; };
    }, [occupant?.figure, occupant?.hasIcon]);
    const explicitOff = !!(ledColor && ledColor.kind === "off");
    const lit = ledColor && !explicitOff ? zoneRgb(slot.zone) : null;
    const animated = !!(ledColor && ledColor.kind === "flash");
    const edge = isSource ? "#45b8ff" : armed ? "#ffc93c" : lit ? lit : "rgba(169,215,238,.28)";
    const cell = cellByIndex(slot.slot);
    const rect = pctRect(cell);
    // Circular centre collar - most of the visual recognition, and the part
    // that used to be a rounded square.
    const radius = slot.zone === "centre" ? "50%" : "9px";
    return (
        <DFL.Focusable ref={cellRef} onActivate={onActivate} focusClassName="dt-pad-focus" className="dt-cell" style={{
            position: "absolute",
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            zIndex: 1,
            borderRadius: radius,
            background: occupant ? "rgba(10,14,20,.30)" : "rgba(6,10,15,.22)",
            border: "2px " + (isSource ? "dashed" : "solid") + " " + edge,
            // The diffuse glow now lives on the shared region halo (RegionPanel);
            // the cell itself only carries a crisp lit edge and a soft inset lift.
            boxShadow: lit ? "inset 0 0 10px " + zoneRgba(slot.zone, 0.30) : "inset 0 1px 0 rgba(255,255,255,.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            // v3.3.40: colour-independent flash. See flashKeyframes.
            ...(animated ? flashBrightnessStyle(ledColor) : {}),
        } as any}>
            {art ? (
                <img src={art} alt="" style={{
                    position: "absolute", left: "50%", top: "50%",
                    transform: "translate(-50%,-50%)",
                    height: "84%", maxWidth: "88%", objectFit: "contain",
                    filter: "drop-shadow(0 2px 4px rgba(0,0,0,.75))",
                    pointerEvents: "none", zIndex: 2,
                }} />
            ) : occupant ? (
                <div style={{
                    fontSize: "10px", lineHeight: 1.15, textAlign: "center", padding: "0 3px",
                    color: "#e6e9ef", zIndex: 2, overflow: "hidden", wordBreak: "break-word",
                }}>{occupant.name}</div>
            ) : (
                <div style={{
                    fontSize: "9px", lineHeight: 1.15, textAlign: "center", padding: "0 3px",
                    color: "#6b7280", zIndex: 2,
                }}>{slot.label}</div>
            )}
            {occupant && occupant.build > 1 ? (
                <div style={{
                    position: "absolute", right: "3px", bottom: "2px", zIndex: 3,
                    fontSize: "9px", fontFamily: "monospace", color: "#0b0d12",
                    background: "#ffc93c", borderRadius: "3px", padding: "0 3px",
                }}>{"B" + occupant.build}</div>
            ) : null}
        </DFL.Focusable>
    );
};

export const PadGrid = ({ slots, pads, held, moveSource, onSlot, padColors, gridRef }: any) => {
    const ledRootRef = useRef(null);
    useLedFrameVars(padColors, ledRootRef);
    // gridRef now lands on the first *cell*, which is a real focus target.
    // v3.3.12: SLOTS carries pad as an int (1/2/3) and the section name in
    // `zone`. The old lookup keyed off `pad`, never matched, and silently fell
    // back to the broadcast colour - so per-pad LEDs never rendered.
    const zoneLed = (zone: any) => {
        var padKey = ({ 'centre': '0', 'center': '0', 'left': '1', 'right': '2' } as any)[String(zone).toLowerCase()];
        return padColors ? (padColors[padKey] || padColors.all) : null;
    };
    const cell = (i: number) => {
        const s = slots[i];
        if (!s)
            return null;
        return (
            <PadCell key={i} slot={s} occupant={pads[i]} armed={held !== null && !pads[i]} isSource={moveSource === i} onActivate={() => onSlot(i)} ledColor={zoneLed(s.zone)} cellRef={i === ZONE_ORDER.left[0] ? gridRef : undefined} />
        );
    };
    // Shaped like the real toypad: a circular centre collar between two
    // rounded wing panels, absolutely positioned inside a 700x397 landscape
    // box (PAD_VIEW) rather than a flex grid.
    const activeLeds = ["left", "centre", "right"].map(zoneLed).filter(Boolean);
    return (
        <>
            <style>{flashKeyframes(activeLeds)}</style>
            <div ref={ledRootRef} style={{
                position: "relative",
                width: "100%",
                aspectRatio: `${PAD_VIEW.w} / ${PAD_VIEW.h}`,
                // The pad has no backing panel of its own - it sits directly
                // over the game / QAM background.
                background: "transparent",
                "--dt-left-r": "0", "--dt-left-g": "0", "--dt-left-b": "0",
                "--dt-centre-r": "0", "--dt-centre-g": "0", "--dt-centre-b": "0",
                "--dt-right-r": "0", "--dt-right-g": "0", "--dt-right-b": "0",
            } as any}>
                <RegionPanel region="left" ledColor={zoneLed("left")} />
                <RegionPanel region="centre" ledColor={zoneLed("centre")} />
                <RegionPanel region="right" ledColor={zoneLed("right")} />
                <DFL.Focusable flow-children="grid" style={{ position: "absolute", inset: 0 }}>
                    {ZONE_ORDER.left.map(cell)}
                    {ZONE_ORDER.centre.map(cell)}
                    {ZONE_ORDER.right.map(cell)}
                </DFL.Focusable>
            </div>
        </>
    );
};
