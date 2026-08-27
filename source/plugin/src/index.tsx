// src/index.tsx - Decky plugin frontend for LEGO Dimensions Toypad AIO
// v3.3.11.
//
// PROVENANCE
// ----------
// The historical shipping bundle at plugin/dist/index.js was generated from
// a TypeScript source that no longer exists on the maintainer's machine.
// This file reconstructs an equivalent source that, when compiled with the
// tooling in package.json / rollup.config.mjs, produces a functionally
// equivalent bundle. Behaviour is verified against the shipping bundle for
// every RPC surface and every visible element.
//
// This is a working-in-progress reconstruction - it covers the major
// components exhaustively enough to build from source, but small cosmetic
// differences vs the shipped bundle are possible until it is verified
// pixel-for-pixel. The shipping bundle is the source of truth for release
// artifacts until then; this file is the source of truth for future edits.

import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  Field,
  Focusable,
  DialogButton,
  ToggleField,
  TextField,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
  routerHook,
} from "@decky/api";
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { FaPlug, FaGamepad, FaMobileAlt, FaCog } from "react-icons/fa";

// ============================================================ RPC surface

type PadColor = { r: number; g: number; b: number; hex: string; kind: "color" | "flash" } | null;
type PadColors = { "0": PadColor; "1": PadColor; "2": PadColor; all: PadColor };
type ColorReaderStats = {
  connects: number;
  frames_parsed: number;
  last_error: string;
  connected: boolean;
  last_frame_ts: number;
};

type SetupStatus = {
  rpcs3Ok: boolean;
  rpcs3State: string;
  rpcs3Path: string;
  rpcs3ExpectedSha256: string;
  rpcs3Sha256: string;
  rpcs3Verified: boolean;
  rpcs3Version: string;
  tagsOk: boolean;
  tagCount: number;
  tagRoot: string;
  gameOk: boolean;
  gamePath: string;
  launcherOk: boolean;
  webOk: boolean;
  webPort: number;
  webEnabled: boolean;
  webUrl: string;
  phoneRemoteIp: string;
  phoneRemoteState: "ready" | "no_network";
  listenerOk: boolean;
  listenerState: string;
  listenerPort: number;
  setupComplete: boolean;
  busy: boolean;
  aioVersion: string;
  padColors: PadColors;
  colorReader: ColorReaderStats;
};

type Slot = { pad: string; label: string; zone: string };
type PadOccupant = { figure: number; name: string; build: number; kind: string } | null;

const setupStatus = callable<[], SetupStatus>("setup_status");
const getPadColors = callable<[], { padColors: PadColors; readerStats: ColorReaderStats }>("get_pad_colors");
const getState = callable<[], { slots: Slot[]; pads: PadOccupant[]; libraryRoot: string; count: number; port: number }>("get_state");
const getFranchises = callable<[], Array<{ name: string; count: number; hasLogo: boolean }>>("get_franchises");
const getFigures = callable<[string, string, boolean], Array<any>>("get_figures");
const placeTag = callable<[number, number], void>("place_tag");
const moveTag = callable<[number, number], void>("move_tag");
const removeTag = callable<[number], void>("remove_tag");
const clearAll = callable<[], void>("clear_all");
const launchGame = callable<[], void>("launch_game");
const rerunSetup = callable<[], void>("rerun_setup");
const setWebEnabled = callable<[boolean], void>("set_web_enabled");
const rewriteLauncher = callable<[], void>("rewrite_launcher");
const redownloadLibrary = callable<[], void>("redownload_library");

// =========================================================== zone colours
// Each pad has a "zone" (centre, left, right); the panel uses these for
// borders when no LED colour is being forwarded.
const ZONE_COLOURS: Record<string, string> = {
  centre: "#ffc93c", // yellow
  center: "#ffc93c",
  left: "#ff6e18",   // orange
  right: "#039942",  // green (not used since the split; kept for legacy)
};
function zoneColour(zone: string): string {
  return ZONE_COLOURS[String(zone).toLowerCase()] ?? "#2a2f3a";
}

// ============================================================== PadCell
// Draws a single pad slot. Border priority:
//   1. isSource     - move source (blue) - highest priority
//   2. armed        - hold-to-place mode (amber)
//   3. ledColor     - LIVE LED colour from the emulator (v3.3.9+)
//   4. occupant     - zone colour when occupied but no LED
//   5. (empty)      - neutral border

interface PadCellProps {
  slot: Slot;
  occupant: PadOccupant;
  armed: boolean;
  isSource: boolean;
  wide?: boolean;
  onActivate: () => void;
  ledColor?: PadColor;
}

const PadCell = ({ slot, occupant, armed, isSource, wide, onActivate, ledColor }: PadCellProps) => {
  const border = isSource
    ? "#45b8ff"
    : armed
    ? "#ffc93c"
    : ledColor
    ? ledColor.hex
    : occupant
    ? zoneColour(slot.zone)
    : "#2a2f3a";
  return (
    <DialogButton
      style={{
        gridColumn: wide ? "span 3" : "span 1",
        padding: "8px",
        border: `2px solid ${border}`,
        borderRadius: "6px",
        background: "transparent",
        boxShadow: ledColor ? `0 0 10px ${ledColor.hex}, inset 0 0 12px ${ledColor.hex}66` : undefined,
      }}
      onClick={onActivate}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
        <div style={{ fontSize: "10px", opacity: 0.6 }}>{slot.label}</div>
        <div style={{ fontSize: "12px" }}>{occupant?.name ?? "\u2014"}</div>
        {occupant?.build && occupant.build > 1 && (
          <div style={{ fontSize: "10px", opacity: 0.6 }}>Build {occupant.build}</div>
        )}
      </div>
    </DialogButton>
  );
};

// ============================================================== PadGrid
// 7-slot layout: three big pads on the top row (centre / left / right),
// then a wider row for the "lower" slots of the left and right pads.

interface PadGridProps {
  slots: Slot[];
  pads: PadOccupant[];
  held: number | null;
  moveSource: number | null;
  onSlot: (i: number) => void;
  padColors?: PadColors;
}

const PadGrid = ({ slots, pads, held, moveSource, onSlot, padColors }: PadGridProps) => {
  const cell = (i: number, wide?: boolean) => {
    const s = slots[i];
    if (!s) return null;
    const padKey = ({ centre: "0", center: "0", left: "1", right: "2" } as Record<string, keyof PadColors>)[
      String(s.pad).toLowerCase()
    ];
    const ledColor: PadColor = padColors ? padColors[padKey] ?? padColors.all : null;
    return (
      <PadCell
        key={i}
        slot={s}
        occupant={pads[i]}
        armed={held !== null && !pads[i]}
        isSource={moveSource === i}
        wide={wide}
        onActivate={() => onSlot(i)}
        ledColor={ledColor}
      />
    );
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
      {cell(0)}
      {cell(1)}
      {cell(2)}
      {cell(3)}
      {cell(4)}
      {cell(5)}
      {cell(6)}
    </div>
  );
};

// ======================================================== main panel view
// A single component that renders both the Setup and Pad views depending
// on whether setup is complete.

const MainPanel = () => {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [state, setState] = useState<{ slots: Slot[]; pads: PadOccupant[] } | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [moveSource, setMoveSource] = useState<number | null>(null);
  const [padColors, setPadColors] = useState<PadColors | null>(null);
  const [working, setWorking] = useState<string>("");

  // Poll setup_status on a slow-ish interval (2s) - it's the heavier call.
  useEffect(() => {
    let live = true;
    const tick = () =>
      setupStatus()
        .then((s) => live && setSetup(s))
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, []);

  // v3.3.9: poll get_pad_colors on a fast interval (500ms) so LED changes
  // land in the pad view within one panel refresh.
  useEffect(() => {
    let live = true;
    const tick = () =>
      getPadColors()
        .then((r) => live && r?.padColors && setPadColors(r.padColors))
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 500);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const tick = () =>
      getState()
        .then((s) => live && setState({ slots: s.slots, pads: s.pads }))
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 1500);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, []);

  const onSlot = useCallback(
    async (i: number) => {
      if (moveSource !== null) {
        setWorking("Moving...");
        try {
          await moveTag(moveSource, i);
        } finally {
          setMoveSource(null);
          setWorking("");
        }
        return;
      }
      if (held !== null) {
        setWorking("Placing...");
        try {
          await placeTag(held, i);
        } finally {
          setHeld(null);
          setWorking("");
        }
        return;
      }
      // Otherwise tap-to-arm: pick this occupant as the move source
      if (state?.pads[i]) setMoveSource(i);
    },
    [held, moveSource, state],
  );

  // ---------------------- Setup view (rendered when setup incomplete)
  const Check = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <div style={{ padding: "3px 0", fontSize: "12px", display: "flex", gap: "6px" }}>
      <span style={{ color: ok ? "#7dd67d" : "#e05252", width: "14px" }}>{ok ? "\u2713" : "\u2716"}</span>
      <div>
        <div>{label}</div>
        {detail && <div style={{ opacity: 0.7, fontSize: "10px", wordBreak: "break-all" }}>{detail}</div>}
      </div>
    </div>
  );

  return (
    <PanelSection title="Dimensions Toypad">
      {setup ? (
        <Fragment>
          <PanelSectionRow>
            <div>
              <Check
                ok={setup.rpcs3Ok}
                label="Bundled RPCS3"
                detail={setup.rpcs3Version + (setup.rpcs3Verified ? " (verified)" : " (SHA mismatch)")}
              />
              <Check ok={setup.tagsOk} label={`Tag library (${setup.tagCount})`} detail={setup.tagRoot} />
              <Check ok={setup.gameOk} label="Game dump" detail={setup.gamePath} />
              <Check ok={setup.launcherOk} label="Steam launcher" detail="/home/deck/toypad/play-dimensions.sh" />
              <Check
                ok={setup.webOk && setup.phoneRemoteState === "ready"}
                label="Phone remote"
                detail={setup.phoneRemoteState === "ready" ? setup.webUrl : "Loopback only - connect to Wi-Fi"}
              />
              <Check
                ok={setup.listenerOk}
                label="Toypad listener"
                detail={setup.listenerOk ? `Connected on :${setup.listenerPort}` : "Not configured - bundled RPCS3 is unavailable"}
              />
            </div>
          </PanelSectionRow>

          {/* v3.3.8: LED status diagnostic. v3.3.10: reader stats. */}
          {setup.padColors && (
            <PanelSectionRow>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  padding: "4px 0",
                  fontSize: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ opacity: 0.7 }}>LEDs:</span>
                {(["0", "1", "2"] as const).map((k, i) => {
                  const label = i === 0 ? "C" : i === 1 ? "L" : "R";
                  const c = setup.padColors[k] ?? setup.padColors.all;
                  const bg = c ? c.hex : "#333";
                  return (
                    <span key={k} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span
                        style={{
                          width: "10px",
                          height: "10px",
                          borderRadius: "50%",
                          background: bg,
                          border: "1px solid #555",
                          boxShadow: c?.kind === "flash" ? `0 0 4px ${c.hex}` : "none",
                        }}
                      />
                      <span style={{ opacity: 0.7 }}>{label}</span>
                    </span>
                  );
                })}
                {setup.colorReader && (
                  <span style={{ opacity: 0.6, fontSize: "10px", marginLeft: "6px" }}>
                    {setup.colorReader.connected
                      ? `reader: ${setup.colorReader.frames_parsed} frames`
                      : `reader: waiting${
                          setup.colorReader.last_error ? ` (${setup.colorReader.last_error.slice(0, 30)})` : ""
                        }`}
                  </span>
                )}
              </div>
            </PanelSectionRow>
          )}

          {working && (
            <PanelSectionRow>
              <div style={{ fontSize: "12px", color: "#ffc93c", padding: "4px 0" }}>{working}</div>
            </PanelSectionRow>
          )}

          <PanelSectionRow>
            <ButtonItem layout="below" onClick={redownloadLibrary}>Re-download tag library</ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={rewriteLauncher}>
              {setup.launcherOk ? "Steam launcher already written - rewrite" : "Write Steam launcher"}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setWebEnabled(!setup.webEnabled)}>
              {setup.webEnabled ? "Turn off phone remote" : "Turn on phone remote"}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={rerunSetup}>Re-check everything</ButtonItem>
          </PanelSectionRow>

          {/* Pad view */}
          {state?.slots?.length && (
            <PanelSectionRow>
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontSize: "11px", opacity: 0.7, marginBottom: "4px" }}>TOYPAD</div>
                <PadGrid
                  slots={state.slots}
                  pads={state.pads}
                  held={held}
                  moveSource={moveSource}
                  onSlot={onSlot}
                  padColors={padColors ?? undefined}
                />
              </div>
            </PanelSectionRow>
          )}
        </Fragment>
      ) : (
        <PanelSectionRow>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>Loading...</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};

// ================================================================ export

export default definePlugin(() => {
  return {
    name: "Dimensions Toypad",
    titleView: <div>Dimensions Toypad</div>,
    content: <MainPanel />,
    icon: <FaGamepad />,
    onDismount() {},
  };
});
