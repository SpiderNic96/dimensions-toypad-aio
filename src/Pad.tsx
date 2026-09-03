// SPDX-License-Identifier: MIT
import * as DFL from "@decky/ui";
import { useState, useEffect, useRef } from "react";
import { getIcon } from "./api";
import {
    hexA,
    zoneRgb,
    zoneRgba,
    flashStyle,
    flashBrightnessStyle,
    flashKeyframes,
    useLedFrameVars,
} from "./led";

// ---------------------------------------------------------------- pad grid
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

export const PadCell = ({ slot, occupant, armed, isSource, wide, onActivate, ledColor, cellRef }: any) => {
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
    const tint = lit || zoneColour(slot.zone);
    const edge = isSource ? "#45b8ff" : armed ? "#ffc93c" : lit ? lit : "rgba(169,215,238,.28)";
    return (
        <DFL.Focusable ref={cellRef} onActivate={onActivate} focusClassName="dt-pad-focus" className="dt-cell" style={{
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
        } as any}>
            {/* Whole-cell LED wash. Sits under the portrait so the figure stays
                readable while the tile itself carries the colour. */}
            {lit ? (
                <div className="dt-glow" style={Object.assign({
                    position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                    background: "radial-gradient(ellipse at 50% 45%, " + zoneRgba(slot.zone, 0.62) + " 0%, " + zoneRgba(slot.zone, 0.34) + " 28%, " + zoneRgba(slot.zone, 0.13) + " 62%, " + zoneRgba(slot.zone, 0.025) + " 100%)",
                    filter: "saturate(1.08)",
                }, ledColor?.kind === "flash" ? flashStyle(ledColor) : {}) as any}>
                    <div style={{ position: "absolute", left: "50%", top: "45%", width: "22px", height: "22px", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.96) 0%, rgba(255,255,255,.72) 18%, " + zoneRgba(slot.zone, 0.48) + " 42%, rgba(255,255,255,0) 72%)", filter: "blur(.35px)", boxShadow: "0 0 12px " + zoneRgba(slot.zone, 0.55) + ", 0 0 8px rgba(255,255,255,.32)" }} />
                    <div style={{ position: "absolute", inset: "2px", borderRadius: "inherit", boxShadow: "inset 0 0 22px " + zoneRgba(slot.zone, 0.30) + ", 0 0 18px " + zoneRgba(slot.zone, 0.24) }} />
                </div>
            ) : null}
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

export const PadZone = ({ zone, ledColor, wideFirst, children }: any) => {
    const explicitOff = !!(ledColor && ledColor.kind === "off");
    const lit = ledColor && !explicitOff ? zoneRgb(zone) : null;
    const tint = lit || zoneColour(zone);
    const base = explicitOff ? "rgba(0,0,0,.10)" : "rgba(190,230,248,.10)";
    return (
        <div className="dt-zone" style={{
            position: "relative",
            flex: zone === "centre" ? "0.85 1 0%" : "1 1 0%",
            minWidth: 0,
            display: "flex", flexDirection: "column",
            padding: "3px",
            borderRadius: zone === "centre" ? "18px" : "13px",
            background: "radial-gradient(ellipse at 50% 45%, " + (lit ? zoneRgba(zone, 0.26) : base) + " 0%, " + (lit ? zoneRgba(zone, 0.08) : "rgba(190,230,248,.025)") + " 58%, rgba(0,0,0,.10) 100%)",
            border: "1px solid " + (lit ? hexA(lit, 0.55) : "rgba(190,230,248,.08)"),
            boxShadow: lit ? "0 0 24px " + zoneRgba(zone, 0.35) + ", inset 0 0 28px " + zoneRgba(zone, 0.16) : "0 0 10px rgba(190,230,248,.04), inset 0 0 20px rgba(190,230,248,.03)",
        }}>
            <div className="dt-glow" style={Object.assign({
                position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                borderRadius: "inherit",
                background: lit ? "radial-gradient(ellipse at 50% 45%, " + zoneRgba(zone, 0.38) + " 0%, " + zoneRgba(zone, 0.20) + " 34%, " + zoneRgba(zone, 0.065) + " 70%, rgba(0,0,0,0) 100%)" : explicitOff ? "none" : "radial-gradient(ellipse at 50% 45%, rgba(220,245,255,.13) 0%, rgba(220,245,255,.05) 48%, rgba(0,0,0,0) 100%)",
                boxShadow: lit ? "inset 0 0 34px " + zoneRgba(zone, 0.22) + ", 0 0 24px " + zoneRgba(zone, 0.18) : "none",
            }, ledColor?.kind === "flash" ? flashStyle(ledColor) : {}) as any}>
                {lit ? <div style={{ position: "absolute", left: "50%", top: "45%", width: "30px", height: "30px", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.92) 0%, rgba(255,255,255,.62) 16%, " + zoneRgba(zone, 0.40) + " 42%, rgba(255,255,255,0) 72%)", filter: "blur(.4px)", boxShadow: "0 0 16px " + zoneRgba(zone, 0.48) }} /> : null}
                <div style={{ position: "absolute", inset: "1px", borderRadius: "inherit", border: lit ? "1px solid " + zoneRgba(zone, 0.22) : "1px solid rgba(220,245,255,.03)", pointerEvents: "none" }} />
            </div>
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>{children}</div>
        </div>
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
    const cell = (i: number, wide?: boolean) => {
        const s = slots[i];
        if (!s)
            return null;
        return (
            <PadCell key={i} slot={s} occupant={pads[i]} armed={held !== null && !pads[i]} isSource={moveSource === i} wide={wide} onActivate={() => onSlot(i)} ledColor={zoneLed(s.zone)} cellRef={i === ZONE_ORDER.left[0] ? gridRef : undefined} />
        );
    };
    // Shaped like the real toypad: a dark base plate, two rounded side sections
    // of three, and a taller rounded centre between them.
    const activeLeds = ["left", "centre", "right"].map(zoneLed).filter(Boolean);
    return (
        <>
            <style>{flashKeyframes(activeLeds)}</style>
            <DFL.Focusable flow-children="horizontal" ref={ledRootRef} style={{
                display: "flex", gap: "5px", padding: "5px",
                borderRadius: "16px", background: "rgba(4,8,13,.32)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
                "--dt-left-r": "0", "--dt-left-g": "0", "--dt-left-b": "0",
                "--dt-centre-r": "0", "--dt-centre-g": "0", "--dt-centre-b": "0",
                "--dt-right-r": "0", "--dt-right-g": "0", "--dt-right-b": "0",
            } as any}>
                <>
                    <PadZone zone="left" ledColor={zoneLed("left")}>
                        <DFL.Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                            {cell(ZONE_ORDER.left[0], true)}
                            <DFL.Focusable flow-children="horizontal" style={{ display: "flex" }}>
                                {cell(ZONE_ORDER.left[1])}
                                {cell(ZONE_ORDER.left[2])}
                            </DFL.Focusable>
                        </DFL.Focusable>
                    </PadZone>
                    <PadZone zone="centre" ledColor={zoneLed("centre")}>
                        <DFL.Focusable flow-children="vertical" style={{ display: "flex", flex: 1 }}>
                            {cell(ZONE_ORDER.centre[0], true)}
                        </DFL.Focusable>
                    </PadZone>
                    <PadZone zone="right" ledColor={zoneLed("right")}>
                        <DFL.Focusable flow-children="vertical" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                            {cell(ZONE_ORDER.right[0], true)}
                            <DFL.Focusable flow-children="horizontal" style={{ display: "flex" }}>
                                {cell(ZONE_ORDER.right[1])}
                                {cell(ZONE_ORDER.right[2])}
                            </DFL.Focusable>
                        </DFL.Focusable>
                    </PadZone>
                </>
            </DFL.Focusable>
        </>
    );
};
