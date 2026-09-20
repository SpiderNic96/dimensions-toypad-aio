let currentModalClose = null;
let currentModalObj = null;
let loadingModal = false;
const manifest = {"name":"Dimensions Toypad"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const addEventListener = api.addEventListener;
const removeEventListener = api.removeEventListener;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

// The backend returns relative asset paths so the phone remote resolves them
// against the Deck. Steam's UI has its own origin, so the panel needs them
// absolute.
const PLUGIN_ORIGIN = "http://127.0.0.1:8765";
const assetUrl = (p) => !p ? "" : (p.startsWith("http") ? p : PLUGIN_ORIGIN + p);
const getSlots = callable("get_slots");
const getLists = callable("get_lists");
const getCustom = callable("get_custom_tags");
const getSelection = callable("get_selection");
const setSelection = callable("set_selection");
const tagStates$1 = callable("tag_states");
const loadFig = callable("load_figure");
const clearOne = callable("clear_slot");
const clearAll = callable("clear_all");
const moveFig = callable("move_figure");
const toggleFav = callable("toggle_favourite");
const nextFree = callable("next_free_slot");
const ovPad = callable("overlay_set_pad_cursor");
// Cached, not live: the listener serves one connection at a time, so polling
// it here as well made the modal and the overlay take turns and both lag.
const getLed = callable("get_led_cached");
// Pad geometry, matching LAYOUT[] in toypad-overlay.c so the two views agree.
//   (O) centre portal on top; [0] over [3][4] left, [2] over [5][6] right.
// Positions as percentages of a FIXED-ASPECT box (below), not of the viewport.
// Sizing height in % of a container whose height is a % of the screen made
// every "square" a wide rectangle — that was the squashing.
// A region is `s`% of the box WIDTH and square, so at aspect 2.6 it is
// s * 2.6 percent of the box HEIGHT. At the old 15% / aspect 2.4 that made
// each tile 36% tall while the rows sat 32% apart — so they overlapped and
// the bottom row ran off the box. Rows now sit 42% apart with 13% tiles.
const PAD_ASPECT = 2.6;
const PADS = [
    { index: 0, x: 20, y: 32, s: 13, circle: false },
    { index: 1, x: 50, y: 6, s: 16, circle: true },
    { index: 2, x: 80, y: 32, s: 13, circle: false },
    { index: 3, x: 20, y: 72, s: 13, circle: false },
    { index: 4, x: 34, y: 72, s: 13, circle: false },
    { index: 5, x: 66, y: 72, s: 13, circle: false },
    { index: 6, x: 80, y: 72, s: 13, circle: false },
];
// The four figures in the boxed Starter Pack. Worth its own tile: it is what
// most people own, and hunting them across three franchises is silly.
const STARTER = [
    "WORLD_DC_COMICS_CHAR_BATMAN_BIN",
    "WORLD_THE_LEGO_MOVIE_CHAR_WYLDSTYLE_BIN",
    "WORLD_THE_LORD_OF_THE_RINGS_CHAR_GANDALF_THE_GREY_BIN",
    "WORLD_DC_COMICS_VEH_BATMOBILE_1_BIN",
];
const ABILITY_FILTERS = ["All", "Common", "Uncommon", "Exclusive",
    "Vehicular", "One-Timed"];
/*
 * Steam's DialogButton sets width:100% in its own stylesheet, so four of them
 * in a flex row still stacked as four full-width bars — about 160px of height
 * that pushed the pad off the bottom and made the whole modal scroll.
 * Wrapping in a shrink-to-fit box and overriding width is what makes them
 * sit side by side.
 */
function Bar({ label, disabled, onClick, style }) {
    return (SP_JSX.jsx("div", { style: { flex: "0 0 auto", ...style }, children: SP_JSX.jsx(DFL.DialogButton, { disabled: disabled, onClick: onClick, style: {
                width: "auto", minWidth: 0, padding: "3px 15px",
                fontSize: 13, lineHeight: 1.5,
            }, children: label }) }));
}
function Tile({ label, sub, image, glyph, colour, accent, onClick, onSecondary, onFocus }) {
    return (
    // DialogButton has no onFocus in its prop types, so the wrapper carries
    // focus and hover. onFocusCapture catches the button's own focus event
    // bubbling up, which is what controller navigation fires.
    SP_JSX.jsx("div", { onFocusCapture: onFocus, onMouseEnter: onFocus, onFocus: onFocus, style: { width: "100%", display: "flex" }, children: SP_JSX.jsxs(DFL.DialogButton, { onClick: onClick, onSecondaryButton: onSecondary, ...{ onFocus }, style: {
                width: "100%", minHeight: 104, padding: 7, position: "relative",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 6,
                background: accent ? "#3a2f10" : "#131a21",
                border: "1px solid " + (accent ? "#c8a13a" : (colour || "#28323b")),
                borderColor: accent ? "#c8a13a" : (colour || "#28323b"),
                borderRadius: 10,
            }, children: [image ? (SP_JSX.jsx("img", { src: image, alt: "", style: { maxWidth: "86%", maxHeight: 46,
                        objectFit: "contain" }, onError: (e) => { e.target.style.display = "none"; } })) : glyph ? (SP_JSX.jsx("span", { style: { fontSize: 26 }, children: glyph })) : null, SP_JSX.jsx("span", { style: { fontSize: 12, lineHeight: 1.2, textAlign: "center" }, children: label }), sub !== undefined && (SP_JSX.jsx("span", { style: {
                        position: "absolute", right: 8, bottom: 6,
                        fontSize: 11, opacity: 0.55,
                    }, children: sub }))] }) }));
}
function ToypadModal({ catalog, abilities, closeModal }) {
    SP_REACT.useEffect(() => {
        currentModalClose = closeModal;
        return () => { currentModalClose = null; };
    }, [closeModal]);
    const [slots, setSlots] = SP_REACT.useState([]);
    const [slot, setSlot] = SP_REACT.useState(1);
    const [dest, setDest] = SP_REACT.useState({ kind: "home" });
    // Tags carrying in-game progress, so a rebuilt vehicle is distinguishable
    // from a stock one at a glance.
    const [modifiedTags, setModifiedTags] = SP_REACT.useState([]);
    const [tagsWritable, setTagsWritable] = SP_REACT.useState(true);
    // Abilities peek: which tile is being held.
    const [peek, setPeek] = SP_REACT.useState(null);
    const [custom, setCustom] = SP_REACT.useState([]);
    const [customFolder, setCustomFolder] = SP_REACT.useState("");
    const [favourites, setFavourites] = SP_REACT.useState([]);
    const [recents, setRecents] = SP_REACT.useState([]);
    const [favIds, setFavIds] = SP_REACT.useState([]);
    const [filter, setFilter] = SP_REACT.useState("All");
    const [query, setQuery] = SP_REACT.useState("");
    const [moveFrom, setMoveFrom] = SP_REACT.useState(null);
    const [leds, setLeds] = SP_REACT.useState({});
    const lastWorldRef = SP_REACT.useRef(-1);
    const lastLocalSlotRef = SP_REACT.useRef(0);
    const [busy, setBusy] = SP_REACT.useState(false);
    // Which figure tile the cursor is on. onSecondaryButton / Y never fired on
    // this Steam build however it was wired, so favouriting gets an explicit
    // button that acts on whatever is focused — deterministic, and discoverable.
    const [focused, setFocused] = SP_REACT.useState("");
    const shellRef = SP_REACT.useRef(null);
    /*
     * Center modal shell and prevent dialog sliding.
     *
     * Walk only the DIRECT ANCESTOR chain up to <body> (never touching siblings
     * or the on-screen keyboard webview). Every direct container is given
     * full viewport width/height with flexbox centering, and restored on unmount.
     */
    SP_REACT.useEffect(() => {
        const styleId = "toypad-backdrop-blur-fix";
        let styleEl = document.getElementById(styleId);
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = styleId;
            styleEl.textContent = `
        .ModalPosition_Backdrop,
        div[class*="DialogBackdrop"],
        div[class*="ModalPosition_Backdrop"],
        div[class*="backdrop"],
        div[class*="Backdrop"],
        ._DialogBackdrop {
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          filter: none !important;
          background: rgba(0, 0, 0, 0.5) !important;
        }
      `;
            document.head.appendChild(styleEl);
        }
        const touched = [];
        const pin = (el, css) => {
            touched.push({ el, css: el.style.cssText });
            Object.assign(el.style, css);
        };
        let node = shellRef.current?.parentElement ?? null;
        for (let i = 0; i < 8 && node && node !== document.body; i++) {
            pin(node, {
                width: "100vw", height: "100vh",
                maxWidth: "none", maxHeight: "none",
                minWidth: "0", minHeight: "0",
                padding: "0", margin: "0",
                borderRadius: "0", border: "none", background: "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                overflow: "hidden", touchAction: "none", overscrollBehavior: "none",
                transform: "none",
            });
            node = node.parentElement;
        }
        return () => {
            for (const s of touched)
                s.el.style.cssText = s.css;
            const el = document.getElementById(styleId);
            if (el)
                el.remove();
        };
    }, []);
    const refresh = SP_REACT.useCallback(async () => {
        const [s, l, c] = await Promise.all([getSlots(), getLists(), getCustom()]);
        setSlots(s);
        setFavourites(l.favourites);
        setRecents(l.recents);
        setFavIds(l.favourites.map((f) => f.stableId));
        setCustom(c.tags);
        setCustomFolder(c.folder);
        try {
            const ts = await tagStates$1();
            setModifiedTags(ts.modified);
            setTagsWritable(ts.writable);
        }
        catch { /* backend reloading */ }
    }, []);
    SP_REACT.useEffect(() => { void refresh(); }, [refresh]);
    SP_REACT.useEffect(() => {
        void ovPad(slot);
        void setSelection(5, slot).catch(() => { });
    }, [slot]);
    // Direct backend LED state synchronization (polled at ~30 FPS).
    // get_led_cached() in main.py already computes instantaneous RGB color and
    // brightness at 60 FPS via animated_frame(). Binding directly eliminates
    // client clock phase-resets and IPC stutter.
    SP_REACT.useEffect(() => {
        let alive = true;
        let slotTickCounter = 0;
        const tick = async () => {
            if (!alive)
                return;
            try {
                const snap = await getLed();
                if (snap.ok && snap.regions) {
                    const next = {};
                    for (const r of snap.regions) {
                        const b = typeof r.brightness === "number" ? r.brightness : (r.mode === 0 ? 0 : 1.0);
                        next[r.pad] = {
                            rgb: r.display,
                            brightness: b,
                        };
                    }
                    setLeds(next);
                }
            }
            catch { /* keep the last frame */ }
            // Poll slots every ~500ms so external placements/removals sync live
            slotTickCounter++;
            if (slotTickCounter >= 15) {
                slotTickCounter = 0;
                try {
                    const s = await getSlots();
                    setSlots(s);
                }
                catch { /* backend reloading */ }
            }
            if (alive) {
                window.setTimeout(tick, 33);
            }
        };
        void tick();
        return () => { alive = false; };
    }, []);
    const entriesOf = (f) => [...f.characters, ...f.vehicles.flatMap((g) => g.builds)];
    const everything = SP_REACT.useMemo(() => catalog.flatMap(entriesOf), [catalog]);
    // Two-way cursor sync. The phone writes the shared selection as it browses;
    // polling here makes the Deck follow, and navigating here pushes back.
    // Also synchronizes active slot when user taps/loads from phone!
    SP_REACT.useEffect(() => {
        const id = setInterval(async () => {
            try {
                const sel = await getSelection();
                if (typeof sel.slot === "number" &&
                    sel.slot >= 0 &&
                    sel.slot <= 6 &&
                    sel.slot !== slot &&
                    Date.now() - lastLocalSlotRef.current > 1200) {
                    setSlot(sel.slot);
                }
                if (dest.kind === "home" && sel.world >= 0 && sel.world !== lastWorldRef.current) {
                    lastWorldRef.current = sel.world;
                    const f = catalog[sel.world];
                    if (f)
                        setDest({ kind: "list", title: f.name, entries: entriesOf(f) });
                }
            }
            catch { /* backend reloading */ }
        }, 350);
        return () => clearInterval(id);
    }, [dest.kind, catalog, slot]);
    const starter = SP_REACT.useMemo(() => STARTER.map((id) => everything.find((e) => e.stableId === id))
        .filter(Boolean), [everything]);
    const searchHits = SP_REACT.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return null;
        return everything.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 120);
    }, [query, everything]);
    const shownAbilities = SP_REACT.useMemo(() => abilities.filter((a) => filter === "All" || a.section === filter), [abilities, filter]);
    const place = async (entry) => {
        setBusy(true);
        try {
            const res = await loadFig(slot, entry.stableId);
            if (!res.ok) {
                toaster.toast({ title: "Could not place", body: res.error || entry.name });
            }
            else {
                // Advance to the next empty region. Without this, picking three
                // figures in a row targets the same pad each time and the plugin's
                // picture of the pad loses the first two.
                const next = await nextFree(slot);
                if (next >= 0) {
                    lastLocalSlotRef.current = Date.now();
                    setSlot(next);
                    void setSelection(5, next).catch(() => { });
                }
            }
            await refresh();
        }
        finally {
            setBusy(false);
        }
    };
    const onPadClick = async (index) => {
        if (moveFrom !== null && moveFrom !== index) {
            const res = await moveFig(moveFrom, index);
            if (!res.ok) {
                toaster.toast({ title: "Move failed", body: res.error || "unknown" });
            }
            else if (res.swapped) {
                toaster.toast({ title: "Swapped", body: res.note || "" });
            }
            setMoveFrom(null);
            await refresh();
            return;
        }
        lastLocalSlotRef.current = Date.now();
        setSlot(index);
        void setSelection(5, index).catch(() => { });
    };
    // Browsing a 101-item ability list through a 170px window is miserable, and
    // the pad is only a reference once a region is chosen — so shrink it while
    // browsing and give the list the space instead.
    const browsing = dest.kind !== "home" || !!searchHits;
    const atHome = dest.kind === "home" && !query && moveFrom === null;
    const goBack = SP_REACT.useCallback(() => {
        if (query) {
            setQuery("");
            return;
        }
        if (moveFrom !== null) {
            setMoveFrom(null);
            return;
        }
        if (dest.kind === "ability") {
            setDest({ kind: "abilities" });
            setPeek(null);
            return;
        }
        if (dest.kind !== "home") {
            lastWorldRef.current = -1;
            void setSelection(1, -1);
            setDest({ kind: "home" });
            setPeek(null);
            return;
        }
        closeModal?.();
    }, [query, moveFrom, dest, closeModal]);
    const current = slots[slot];
    const hint = moveFrom !== null
        ? "Pick a destination — an occupied pad swaps"
        : dest.kind === "home" && !searchHits
            ? "Select a pad, then pick a figure · B closes"
            : "A places · Y favourites · B goes back";
    // Active figure for abilities display: peeked figure if any, otherwise the figure in the current slot
    const activeFigure = SP_REACT.useMemo(() => {
        if (peek)
            return peek;
        const occ = slots[slot]?.occupant;
        if (occ) {
            return everything.find((e) => e.stableId === occ.stableId) || null;
        }
        return null;
    }, [peek, slots, slot, everything]);
    const activeAbilities = SP_REACT.useMemo(() => {
        if (!activeFigure || !activeFigure.abilities || !activeFigure.abilities.length)
            return [];
        return activeFigure.abilities.map((i) => abilities[i]?.name).filter(Boolean);
    }, [activeFigure, abilities]);
    SP_REACT.useEffect(() => {
        if (searchHits && searchHits.length > 0) {
            setPeek(searchHits[0]);
            setFocused(searchHits[0].stableId);
        }
    }, [searchHits]);
    const figureGrid = (entries) => entries.map((e) => (SP_JSX.jsx(Tile, { label: e.name, sub: [
            e.build > 0 ? "build " + e.build : "",
            // A rebuilt vehicle's tag no longer matches the catalog seed, so it
            // carries progress. Only meaningful while writable tags are on.
            tagsWritable && modifiedTags.includes(e.stableId) ? "\u25CF saved" : "",
        ].filter(Boolean).join(" \u00B7 ") || undefined, image: assetUrl(e.portrait), colour: e.ringColor, accent: favIds.includes(e.stableId), onClick: () => void place(e), onFocus: () => { setFocused(e.stableId); setPeek(e); }, onSecondary: async () => {
            const r = await toggleFav(e.stableId);
            setFavIds(r.favourites);
            await refresh();
        } }, e.stableId)));
    return (
    /*
     * Two layers, and both matter.
     *
     * Outer: position fixed, inset 0, and a flex centre. ModalRoot positions
     * and pads its own child, so a 100vw box inside it lands off-centre and
     * runs off the edge — which is exactly what happened. `fixed` escapes
     * that entirely and owns the viewport.
     *
     * Inner: a capped shell, not a full-bleed one. min(1080px, 100vw - 56px)
     * keeps it centred with a margin on a 1280-wide panel instead of bleeding
     * past both edges, and maxHeight 88vh leaves the chrome visible.
     */
    SP_JSX.jsx(DFL.ModalRoot, { closeModal: closeModal, 
        // ModalRoot's own cancel still closes the dialog after calling onCancel,
        // so B can't be intercepted here. The Focusable below claims it first.
        bDestructiveWarning: false, bAllowFullSize: true, children: SP_JSX.jsx(DFL.Focusable, { onCancelButton: goBack, onCancelActionDescription: atHome ? "Close" : "Back", style: { display: "contents" }, children: SP_JSX.jsxs("div", { ref: shellRef, style: {
                    display: "flex", flexDirection: "column", gap: 8,
                    margin: "auto",
                    width: "min(1180px, 94vw)",
                    maxWidth: "94vw",
                    height: "min(720px, 88vh)",
                    maxHeight: "88vh",
                    boxSizing: "border-box",
                    padding: "12px 18px", color: "#e7e9ea",
                    borderRadius: 18,
                    background: "linear-gradient(180deg,rgba(20,24,34,.98),rgba(10,12,17,.99))",
                    boxShadow: "0 24px 60px rgba(0,0,0,.8)",
                }, children: [SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "baseline", gap: 14,
                            flex: "0 0 auto" }, children: [SP_JSX.jsx("strong", { style: { fontSize: 19 }, children: "Dimensions Toypad" }), SP_JSX.jsx("span", { style: { marginLeft: "auto", opacity: 0.5, fontSize: 12 }, children: hint })] }), SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", gap: 6, alignItems: "center",
                            flex: "0 0 auto", flexWrap: "nowrap", overflowX: "auto" }, children: [SP_JSX.jsxs("span", { style: { fontSize: 12, opacity: 0.7, minWidth: 140, maxWidth: 240,
                                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: [current ? current.label : "Slot " + slot, current?.writeCapable && " · writes tags", current?.occupant ? " · " + current.occupant.name : " · empty"] }), (dest.kind !== "home" || !!query) && (SP_JSX.jsx(Bar, { label: "Back", onClick: goBack })), SP_JSX.jsx(Bar, { label: "Favourite", disabled: !focused, onClick: async () => {
                                    if (!focused)
                                        return;
                                    const r = await toggleFav(focused);
                                    setFavIds(r.favourites);
                                    await refresh();
                                } }), SP_JSX.jsx(Bar, { label: "Remove", disabled: !current?.occupant, onClick: async () => { await clearOne(slot); await refresh(); } }), SP_JSX.jsx(Bar, { label: moveFrom === slot ? "Cancel move"
                                    : moveFrom !== null ? "Move here" : "Move", disabled: !current?.occupant, onClick: () => setMoveFrom(moveFrom === slot ? null : slot) }), SP_JSX.jsx(Bar, { label: "Clear all", onClick: async () => { await clearAll(); await refresh(); } }), SP_JSX.jsx(Bar, { label: "Close", style: { marginLeft: "auto" }, onClick: () => closeModal?.() })] }), SP_JSX.jsx("div", { style: {
                            display: "flex", alignItems: "center", gap: 8,
                            minHeight: 28, maxHeight: 28, padding: "3px 12px", borderRadius: 8,
                            background: activeFigure ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.03)",
                            border: "1px solid " + (activeFigure ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.06)"),
                            fontSize: 12, flex: "0 0 auto", overflow: "hidden",
                        }, children: activeFigure ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs("span", { style: { fontWeight: 700, color: "#74b9ff", whiteSpace: "nowrap" }, children: [activeFigure.name, ":"] }), SP_JSX.jsx("span", { style: { opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, children: activeAbilities.length > 0 ? activeAbilities.join(" · ") : "Standard (no special abilities)" })] })) : (SP_JSX.jsx("span", { style: { opacity: 0.45 }, children: "Highlight a character or choose an occupied pad slot to view abilities" })) }), SP_JSX.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, flex: "1 1 0", overflowY: "auto", overflowX: "hidden", minHeight: 0, paddingRight: 6 }, children: [SP_JSX.jsx("div", { style: { display: "flex", justifyContent: "center",
                            flex: "0 0 auto", minHeight: 0 }, children: SP_JSX.jsx("div", { style: { position: "relative", width: "100%",
                                maxWidth: browsing ? 320 : 500,
                                transition: "max-width 120ms ease",
                                aspectRatio: String(PAD_ASPECT) }, children: PADS.map((p) => {
                                const info = slots[p.index];
                                const focused = p.index === slot;
                                const source = p.index === moveFrom;
                                const ledData = leds[p.index === 1 ? 1 : (p.x < 50 ? 2 : 3)] || { rgb: [0, 0, 0], brightness: 0 };
                                const rgb = ledData.rgb;
                                const intensity = typeof ledData.brightness === "number" ? ledData.brightness : 0;
                                const on = (rgb[0] + rgb[1] + rgb[2] > 12) && intensity > 0.004;
                                const ledColor = on ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : "transparent";
                                const ledIntensity = on ? intensity : 0;
                                const borderRadius = p.circle ? "50%" : 12;
                                return (SP_JSX.jsxs(DFL.Focusable, { onOKActionDescription: "Select Pad", onOKButton: () => void onPadClick(p.index), onClick: () => void onPadClick(p.index), onActivate: () => void onPadClick(p.index), onFocus: () => {
                                        if (info?.occupant) {
                                            const occFig = everything.find((e) => e.stableId === info.occupant?.stableId);
                                            if (occFig) {
                                                setPeek(occFig);
                                                setFocused(occFig.stableId);
                                            }
                                        }
                                        else {
                                            setPeek(null);
                                        }
                                    }, style: {
                                        position: "absolute",
                                        left: p.x + "%", top: p.y + "%",
                                        transform: "translate(-50%, 0)",
                                        width: p.s + "%", aspectRatio: "1 / 1",
                                        borderRadius: borderRadius,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        background: "linear-gradient(180deg, rgba(31, 45, 61, 0.96), rgba(10, 15, 22, 0.98))",
                                        border: focused
                                            ? "2px solid #4a9eff"
                                            : source
                                                ? "2px solid #f0a232"
                                                : on
                                                    ? `1px solid rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0.4, intensity)})`
                                                    : "1px solid rgba(255, 255, 255, 0.22)",
                                        boxShadow: focused
                                            ? "0 0 14px rgba(74, 158, 255, 0.8), 0 14px 26px rgba(0, 0, 0, 0.5)"
                                            : source
                                                ? "0 0 14px rgba(240, 162, 50, 0.8), 0 14px 26px rgba(0, 0, 0, 0.5)"
                                                : on
                                                    ? `0 0 16px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.45 * intensity}), 0 14px 26px rgba(0, 0, 0, 0.5)`
                                                    : "0 14px 26px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
                                    }, children: [SP_JSX.jsx("div", { style: {
                                                position: "absolute",
                                                inset: "-22%",
                                                borderRadius: borderRadius,
                                                pointerEvents: "none",
                                                zIndex: 0,
                                                opacity: Math.min(1.0, ledIntensity * 0.9),
                                                background: `radial-gradient(circle, ${ledColor} 0%, transparent 72%)`,
                                                filter: "blur(4px)",
                                                transition: "opacity 60ms linear",
                                            } }), SP_JSX.jsx("div", { style: {
                                                position: "absolute",
                                                inset: 0,
                                                borderRadius: borderRadius,
                                                pointerEvents: "none",
                                                zIndex: 1,
                                                opacity: Math.min(0.55, ledIntensity * 0.55),
                                                background: ledColor,
                                                transition: "opacity 60ms linear",
                                            } }), SP_JSX.jsx("div", { style: {
                                                position: "relative",
                                                zIndex: 2,
                                                width: "100%",
                                                height: "100%",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                pointerEvents: "none",
                                            }, children: info?.occupant ? (SP_JSX.jsx("img", { src: assetUrl(info.occupant.portrait), alt: "", style: {
                                                    maxWidth: p.circle ? "74%" : "80%",
                                                    maxHeight: p.circle ? "74%" : "80%",
                                                    aspectRatio: "1 / 1",
                                                    borderRadius: "50%",
                                                    objectFit: "cover",
                                                    background: "rgba(8, 12, 18, 0.86)",
                                                    boxShadow: "0 0 0 2px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.6)",
                                                }, onError: (e) => { e.target.style.visibility = "hidden"; } })) : (SP_JSX.jsx("span", { style: {
                                                    opacity: 0.6,
                                                    fontSize: browsing ? 0 : 10,
                                                    fontWeight: 600,
                                                    color: "#c8d4df",
                                                    textAlign: "center",
                                                    lineHeight: 1.1,
                                                }, children: info ? info.label.replace(" - ", " · ") : "" })) })] }, p.index));
                            }) }) }), SP_JSX.jsx(DFL.Focusable, { style: { flex: "0 0 auto" }, children: SP_JSX.jsx(DFL.TextField, { label: "Search all figures", value: query, onChange: (e) => setQuery(e.target.value) }) }), dest.kind === "abilities" && (SP_JSX.jsx(DFL.Focusable, { style: { display: "flex", gap: 6, flex: "0 0 auto",
                            overflowX: "auto", overflowY: "hidden",
                            paddingBottom: 2 }, children: ABILITY_FILTERS.map((f) => (SP_JSX.jsx(Bar, { label: f, onClick: () => setFilter(f) }, f))) })), SP_JSX.jsxs(DFL.Focusable, { style: { display: "grid", gap: 10,
                            gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
                            gridAutoRows: "min-content",
                            flex: "0 0 auto", minHeight: 190,
                            alignContent: "start" }, children: [searchHits
                                ? figureGrid(searchHits)
                                : dest.kind === "home" ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(Tile, { label: "Starter Pack", glyph: "\u2605", accent: true, sub: String(starter.length), onClick: () => {
                                                setDest({ kind: "list", title: "Starter Pack", entries: starter });
                                                if (starter.length > 0) {
                                                    setPeek(starter[0]);
                                                    setFocused(starter[0].stableId);
                                                }
                                            } }), SP_JSX.jsx(Tile, { label: "Favourites", glyph: "\u2665", sub: String(favourites.length), onClick: () => {
                                                setDest({ kind: "list", title: "Favourites", entries: favourites });
                                                if (favourites.length > 0) {
                                                    setPeek(favourites[0]);
                                                    setFocused(favourites[0].stableId);
                                                }
                                            } }), SP_JSX.jsx(Tile, { label: "Recent", glyph: "\u21BB", sub: String(recents.length), onClick: () => {
                                                setDest({ kind: "list", title: "Recent", entries: recents });
                                                if (recents.length > 0) {
                                                    setPeek(recents[0]);
                                                    setFocused(recents[0].stableId);
                                                }
                                            } }), SP_JSX.jsx(Tile, { label: "Abilities", glyph: "\u2726", sub: String(abilities.length), onClick: () => setDest({ kind: "abilities" }) }), SP_JSX.jsx(Tile, { label: "Custom", glyph: "\u2B21", sub: String(custom.length), onClick: () => {
                                                setDest({ kind: "list", title: "Custom", entries: custom });
                                                if (custom.length > 0) {
                                                    setPeek(custom[0]);
                                                    setFocused(custom[0].stableId);
                                                }
                                            } }), catalog.map((f, i) => (SP_JSX.jsx(Tile, { label: f.name, image: assetUrl(f.logo), sub: String(entriesOf(f).length), onClick: () => {
                                                // Push so the phone follows the Deck too.
                                                void setSelection(1, i).catch(() => { });
                                                const entries = entriesOf(f);
                                                setDest({ kind: "list", title: f.name, entries });
                                                if (entries.length > 0) {
                                                    setPeek(entries[0]);
                                                    setFocused(entries[0].stableId);
                                                }
                                            } }, f.name)))] })) : dest.kind === "abilities" ? (shownAbilities.map((a) => {
                                    const index = abilities.indexOf(a);
                                    const count = everything.filter((e) => e.abilities.includes(index)).length;
                                    return (SP_JSX.jsx(Tile, { label: a.name, 
                                        // Section under the name, count in the corner. An ability
                                        // whose icon fails to load must still be usable, so the
                                        // tile never depends on the image rendering.
                                        glyph: a.icon ? undefined : "✦", image: assetUrl(a.icon) || undefined, sub: String(count), onClick: () => {
                                            if (count > 0) {
                                                setDest({ kind: "ability", index });
                                                const hits = everything.filter((e) => e.abilities.includes(index));
                                                if (hits.length > 0) {
                                                    setPeek(hits[0]);
                                                    setFocused(hits[0].stableId);
                                                }
                                            }
                                        } }, a.name));
                                })) : dest.kind === "ability" ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs("div", { style: { gridColumn: "1 / -1", fontSize: 13, opacity: 0.7,
                                                padding: "2px 4px 6px" }, children: [abilities[dest.index]?.name, abilities[dest.index]?.section
                                                    ? " · " + abilities[dest.index].section : ""] }), figureGrid(everything.filter((e) => e.abilities.includes(dest.index)))] })) : (figureGrid(dest.entries)), !searchHits && dest.kind === "list" && !dest.entries.length && (SP_JSX.jsx("div", { style: { opacity: 0.45, fontSize: 13, padding: 14,
                                    gridColumn: "1 / -1" }, children: dest.title === "Favourites"
                                    ? "Nothing favourited yet — use the Favourite button."
                                    : dest.title === "Custom"
                                        ? `Drop .bin tags into ${customFolder} and they appear here.`
                                        : "Nothing here yet." }))] })] }), busy && SP_JSX.jsx("div", { style: { opacity: 0.6, fontSize: 12 }, children: "Placing\u2026" })] }) }) }));
}

var DefaultContext = {
  color: undefined,
  size: undefined,
  className: undefined,
  style: undefined,
  attr: undefined
};
var IconContext = SP_REACT.createContext && /*#__PURE__*/SP_REACT.createContext(DefaultContext);

var _excluded = ["attr", "size", "title"];
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), true).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function Tree2Element(tree) {
  return tree && tree.map((node, i) => /*#__PURE__*/SP_REACT.createElement(node.tag, _objectSpread({
    key: i
  }, node.attr), Tree2Element(node.child)));
}
function GenIcon(data) {
  return props => /*#__PURE__*/SP_REACT.createElement(IconBase, _extends({
    attr: _objectSpread({}, data.attr)
  }, props), Tree2Element(data.child));
}
function IconBase(props) {
  var elem = conf => {
    var attr = props.attr,
      size = props.size,
      title = props.title,
      svgProps = _objectWithoutProperties(props, _excluded);
    var computedSize = size || conf.size || "1em";
    var className;
    if (conf.className) className = conf.className;
    if (props.className) className = (className ? className + " " : "") + props.className;
    return /*#__PURE__*/SP_REACT.createElement("svg", _extends({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, conf.attr, attr, svgProps, {
      className: className,
      style: _objectSpread(_objectSpread({
        color: props.color || conf.color
      }, conf.style), props.style),
      height: computedSize,
      width: computedSize,
      xmlns: "http://www.w3.org/2000/svg"
    }), title && /*#__PURE__*/SP_REACT.createElement("title", null, title), props.children);
  };
  return IconContext !== undefined ? /*#__PURE__*/SP_REACT.createElement(IconContext.Consumer, null, conf => elem(conf)) : elem(DefaultContext);
}

// THIS FILE IS AUTO GENERATED
function FaBorderAll (props) {
  return GenIcon({"attr":{"viewBox":"0 0 448 512"},"child":[{"tag":"path","attr":{"d":"M416 32H32A32 32 0 0 0 0 64v384a32 32 0 0 0 32 32h384a32 32 0 0 0 32-32V64a32 32 0 0 0-32-32zm-32 64v128H256V96zm-192 0v128H64V96zM64 416V288h128v128zm192 0V288h128v128z"},"child":[]}]})(props);
}

const listBackends = callable("list_backends");
const setActive = callable("set_active_backend");
const installBackend = callable("install_backend");
const getSettings = callable("get_settings");
const setSetting = callable("set_setting");
const getCatalog = callable("get_catalog");
const toggleOverlay = callable("toggle_overlay");
const getAbilities = callable("get_abilities");
const findGames = callable("find_games");
const findGamesAll = callable("find_games_all");
const setGamePath = callable("set_game_path");
const prepareBackend = callable("prepare_backend");
const setupStatus = callable("backend_setup_status");
const shortcutPlan = callable("shortcut_plan");
/*
 * Ask Steam to add the shortcut rather than editing shortcuts.vdf ourselves.
 *
 * The file cannot be written while Steam is running — it rewrites the whole
 * thing from memory on exit — and this panel only exists while Steam IS
 * running. Editing the file from here could never work. SteamClient does it
 * in-process, so there is nothing to close and nothing to race.
 *
 * The API is undocumented and has changed shape before, so every call is
 * guarded and a failure reports rather than throwing into the panel.
 */
async function addSteamShortcut(name, exe, args, startDir) {
    const client = window.SteamClient;
    const apps = client?.Apps;
    if (!apps?.AddShortcut) {
        return { ok: false, error: "SteamClient.Apps.AddShortcut unavailable on this Steam build" };
    }
    try {
        const appid = await apps.AddShortcut(name, exe, startDir, args);
        if (typeof appid !== "number" || !appid) {
            return { ok: false, error: "Steam did not return an app id" };
        }
        // Steam names the entry after the executable unless told otherwise, which
        // is why the library showed "rpcs3-v0.0.42-9-..." instead of the game.
        // These are no-ops if AddShortcut already honoured its arguments.
        try {
            await apps.SetShortcutName?.(appid, name);
        }
        catch { /* optional */ }
        try {
            await apps.SetShortcutLaunchOptions?.(appid, args);
        }
        catch { /* optional */ }
        try {
            await apps.SetShortcutStartDir?.(appid, startDir);
        }
        catch { /* optional */ }
        return { ok: true, appid };
    }
    catch (err) {
        return { ok: false, error: String(err) };
    }
}
const listMods = callable("list_mods");
const toggleMod = callable("toggle_mod");
const installMods = callable("install_mods");
const uninstallAnomaly = callable("uninstall_anomaly");
const tagStates = callable("tag_states");
const resetAllTags = callable("reset_all_tags");
const hotkeyStatus = callable("hotkey_status");
const learnHotkey = callable("learn_hotkey");
const cancelLearn = callable("cancel_learn");
const STATE_STYLE = {
    running: { colour: "#5ba32b", label: "Running" },
    installed: { colour: "#8b929a", label: "Installed" },
    unsupported: { colour: "#c76f2b", label: "Needs update" },
    "not-installed": { colour: "#4c5054", label: "Not installed" },
    "not-configured": { colour: "#4c5054", label: "Not set up" },
};
function BackendRow({ info, active, onSelect, onInstall }) {
    const style = STATE_STYLE[info.state];
    const needsInstall = info.state === "not-installed" && info.managed;
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => (needsInstall ? onInstall(info.key) : onSelect(info.key)), children: SP_JSX.jsxs(DFL.Focusable, { style: { display: "flex", flexDirection: "column", gap: 3 }, children: [SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 7 }, children: [SP_JSX.jsx("div", { style: {
                                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                                    background: style.colour,
                                } }), SP_JSX.jsx("span", { style: { fontWeight: active ? 700 : 400 }, children: info.label }), SP_JSX.jsx("span", { style: { opacity: 0.5, fontSize: "0.78em" }, children: info.console }), SP_JSX.jsx("span", { style: {
                                    marginLeft: "auto", opacity: 0.7, fontSize: "0.78em",
                                    whiteSpace: "nowrap",
                                }, children: needsInstall ? "Install" : style.label })] }), info.detail && (SP_JSX.jsx("div", { style: { opacity: 0.5, fontSize: "0.72em", textAlign: "left" }, children: info.detail }))] }) }) }));
}
/*
 * Pick the dump, do not guess it.
 *
 * The first pass took games[0] and cheerfully made a shortcut that launched
 * Spyro, because RPCS3 had several games and "first match wins" is not a
 * heuristic — it is a coin toss. Ranking helps, but the user knows.
 */
function GamePicker({ games, onPick, closeModal }) {
    return (SP_JSX.jsx(DFL.ConfirmModal, { strTitle: "Which dump?", strOKButtonText: "Cancel", bAlertDialog: true, closeModal: closeModal, children: SP_JSX.jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6,
                maxHeight: 420, overflowY: "auto" }, children: games.map((g) => (SP_JSX.jsxs(DFL.DialogButton, { onClick: () => { onPick(g.path); closeModal?.(); }, style: { textAlign: "left", padding: "8px 12px" }, children: [SP_JSX.jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [SP_JSX.jsx("span", { style: { fontSize: 14 }, children: g.title || "(untitled)" }), SP_JSX.jsx("span", { style: {
                                    fontSize: 10, padding: "1px 6px", borderRadius: 4,
                                    background: g.confident ? "#2d4a1f" : "#4a3a1f",
                                    opacity: 0.9,
                                }, children: g.confident ? "confirmed" : "by name" }), SP_JSX.jsx("span", { style: { marginLeft: "auto", fontSize: 10, opacity: 0.55 }, children: g.title_id || g.container })] }), SP_JSX.jsx("div", { style: { fontSize: 11, opacity: 0.45, wordBreak: "break-all" }, children: g.path })] }, g.path))) }) }));
}
function Content() {
    const [backends, setBackends] = SP_REACT.useState(null);
    const [settings, setSettings] = SP_REACT.useState(null);
    const [catalog, setCatalog] = SP_REACT.useState([]);
    const [keys, setKeys] = SP_REACT.useState(null);
    const [setup, setSetup] = SP_REACT.useState(null);
    const [modList, setModList] = SP_REACT.useState(null);
    const [tags, setTags] = SP_REACT.useState(null);
    const mounted = SP_REACT.useRef(true);
    SP_REACT.useEffect(() => () => { mounted.current = false; }, []);
    const refresh = SP_REACT.useCallback(async () => {
        try {
            const [b, s] = await Promise.all([listBackends(), getSettings()]);
            if (!mounted.current)
                return;
            setBackends(b);
            setSettings(s);
        }
        catch (err) {
            toaster.toast({ title: "Dimensions Toypad", body: String(err) });
        }
    }, []);
    SP_REACT.useEffect(() => {
        void refresh();
        void getCatalog().then((c) => { if (mounted.current)
            setCatalog(c.franchises); });
    }, [refresh]);
    SP_REACT.useEffect(() => {
        if (!settings)
            return;
        setSetup(null);
        setModList(null);
        void setupStatus(settings.activeBackend)
            .then((s) => { if (mounted.current)
            setSetup(s); })
            .catch(() => { });
        void listMods(settings.activeBackend)
            .then((m) => { if (mounted.current)
            setModList(m); })
            .catch(() => { });
        void tagStates()
            .then((s) => { if (mounted.current)
            setTags(s); })
            .catch(() => { });
    }, [settings?.activeBackend]);
    const openModal = SP_REACT.useCallback(async () => {
        try {
            const ab = await getAbilities();
            DFL.showModal(SP_JSX.jsx(ToypadModal, { catalog: catalog, abilities: ab.abilities }));
        }
        catch (err) {
            toaster.toast({ title: "Toy Pad", body: String(err) });
        }
    }, [catalog]);
    // The hardware keys are read in Python, so the panel polls for two things:
    // the current binding text, and a counter the backend bumps when the modal
    // hotkey is pressed. Opening a React modal from a worker thread is not
    // possible, so the flag crosses the boundary instead.
    SP_REACT.useEffect(() => {
        let alive = true;
        const tick = async () => {
            if (!alive)
                return;
            try {
                // Binding text only — opening the modal is handled by the
                // plugin-scope event listener, which works with the panel closed.
                const status = await hotkeyStatus();
                if (alive)
                    setKeys(status);
            }
            catch { /* backend reloading */ }
            window.setTimeout(tick, 600);
        };
        void tick();
        return () => { alive = false; };
    }, []);
    const change = async (key, value) => {
        setSettings(await setSetting(key, value));
    };
    if (!backends || !settings) {
        return SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.Spinner, {}) }) });
    }
    const active = backends.find((b) => b.key === settings.activeBackend);
    const ready = active ? active.state === "running" : false;
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Toy Pad", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: !ready, onClick: () => void openModal(), children: ready ? "Open Toy Pad" : "Emulator not running" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.55 }, children: "Full pad, worlds, favourites and abilities. The overlay mirrors it." }) })] }), settings.activeBackend === "shadps4" && setup?.needsSetup && (SP_JSX.jsxs(DFL.PanelSection, { title: "shadPS4 setup", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const games = await findGames("shadps4");
                                const res = await prepareBackend("shadps4", games[0]?.path ?? "");
                                toaster.toast({
                                    title: res.ok ? "shadPS4 configured" : "Failed",
                                    body: res.ok
                                        ? (res.changed?.join(" · ") || res.note || "already set up")
                                        : (res.error || "unknown error"),
                                });
                                setSetup(await setupStatus("shadps4"));
                            }, children: "Enable Toy Pad in shadPS4" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.55 }, children: setup.running
                                ? "Close shadPS4 first — it rewrites its config on exit."
                                : "Sets the USB backend and registers your dump. No Qt browsing." }) })] })), settings.activeBackend === "cemu" && setup?.needsSetup && (SP_JSX.jsxs(DFL.PanelSection, { title: "Cemu setup", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const games = await findGames("cemu");
                                const res = await prepareBackend("cemu", games[0]?.path ?? "");
                                toaster.toast({
                                    title: res.ok ? "Cemu configured" : "Failed",
                                    body: res.ok
                                        ? (res.changed?.join(" · ") || res.note || "already set up")
                                        : (res.error || "unknown error"),
                                });
                                setSetup(await setupStatus("cemu"));
                            }, children: "Enable Toy Pad in Cemu" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.55 }, children: setup.running
                                ? "Close Cemu first — it rewrites settings.xml on exit."
                                : "Enables emulated Toy Pad (port 9191), game path, and 60fps graphic pack." }) })] })), SP_JSX.jsxs(DFL.PanelSection, { title: "Game Mode shortcut", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const key = settings.activeBackend;
                                toaster.toast({ title: "Scanning", body: "Looking for dumps\u2026" });
                                let games = await findGames(key);
                                if (!games.length) {
                                    // Fall back to showing everything we can see. "No game found"
                                    // is useless on its own; "here are the 4 dumps I can see, none
                                    // look like Dimensions" is actionable.
                                    games = await findGamesAll(key);
                                    if (!games.length) {
                                        toaster.toast({
                                            title: "No dumps found",
                                            body: "Nothing on internal storage or SD. Check the dump is readable.",
                                        });
                                        return;
                                    }
                                    toaster.toast({
                                        title: "No Dimensions dump recognised",
                                        body: "Showing everything found — pick yours and it will be remembered.",
                                    });
                                }
                                const finish = async (game) => {
                                    await setGamePath(key, game);
                                    // Do the emulator-side setup before the shortcut, so the
                                    // shortcut lands on something that will actually work. For
                                    // shadPS4 that is the Toy Pad backend and the install dir —
                                    // the steps that otherwise mean walking the Qt GUI.
                                    const prep = await prepareBackend(key, game);
                                    if (!prep.ok) {
                                        toaster.toast({ title: "Setup needed", body: prep.error || "failed" });
                                        return;
                                    }
                                    if (prep.changed?.length) {
                                        toaster.toast({ title: "Emulator configured",
                                            body: prep.changed.join(" · ") });
                                    }
                                    const plan = await shortcutPlan(key, game);
                                    if (!plan.ok) {
                                        toaster.toast({ title: "Failed", body: plan.error || "unknown error" });
                                        return;
                                    }
                                    const res = await addSteamShortcut(plan.name, plan.exe, plan.args, plan.startDir);
                                    toaster.toast({
                                        title: res.ok ? "Added to your library" : "Failed",
                                        body: res.ok ? plan.name : (res.error || "unknown error"),
                                    });
                                };
                                if (games.length === 1) {
                                    await finish(games[0].path);
                                }
                                else {
                                    DFL.showModal(SP_JSX.jsx(GamePicker, { games: games, onPick: (g) => void finish(g) }));
                                }
                            }, children: ["Add shortcut for ", active ? active.label : "backend"] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.55 }, children: "Pick the dump when asked. Added through Steam, so no restart." }) })] }), modList && modList.backend === settings.activeBackend && (modList.mods.length > 0 || modList.note
                || modList.anomaly || modList.cheats?.length) && (SP_JSX.jsxs(DFL.PanelSection, { title: settings.activeBackend === "cemu"
                    ? "Graphic Packs (Cemu)"
                    : settings.activeBackend === "shadps4"
                        ? "Mods & Cheats (shadPS4)"
                        : "Game Patches (RPCS3)", children: [modList.anomaly?.installed && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const r = await uninstallAnomaly();
                                toaster.toast({
                                    title: r.ok ? "Anomaly removed" : "Failed",
                                    body: r.ok ? "Your mods folder was left alone."
                                        : (r.error || "unknown"),
                                });
                                setModList(await listMods(settings.activeBackend));
                            }, children: "Remove Anomaly mod loader" }) })), modList.anomaly && !modList.anomaly.installed && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: !modList.anomaly.versionOk, onClick: async () => {
                                const r = await installMods(settings.activeBackend);
                                toaster.toast({
                                    title: r.ok ? "Anomaly installed" : "Failed",
                                    body: r.ok ? `${r.version} — drop mods in the mods folder`
                                        : (r.error || "unknown"),
                                });
                                setModList(await listMods(settings.activeBackend));
                            }, children: modList.anomaly.versionOk
                                ? "Install Anomaly mod loader"
                                : "Anomaly needs game 1.24" }) })), modList.mods.map((m) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: m.name, description: m.description || m.category, checked: m.enabled, onChange: async (v) => {
                                const r = await toggleMod(settings.activeBackend, m.ident, v);
                                if (!r.ok) {
                                    toaster.toast({ title: "Could not change", body: r.error || "" });
                                }
                                setModList(await listMods(settings.activeBackend));
                            } }) }, m.ident))), modList.sections.some((s) => s.installable && s.id === "packs") && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                toaster.toast({ title: "Fetching packs", body: "from the community repo\u2026" });
                                const r = await installMods(settings.activeBackend);
                                toaster.toast({
                                    title: r.ok ? "Packs installed" : "Failed",
                                    body: r.ok ? (r.installed?.join(", ") || "nothing matched")
                                        : (r.error || "unknown"),
                                });
                                setModList(await listMods(settings.activeBackend));
                            }, children: "Get graphic packs" }) })), modList.cheats?.map((c) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "0.75em" }, children: [c.name, " \u00B7 v", c.version, " \u00B7 ", c.cheats.length, " cheats", !c.applies && (SP_JSX.jsx("div", { style: { opacity: 0.6, fontSize: "0.9em" }, children: c.mismatch }))] }) }, c.name + c.version))), modList.note && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.6 }, children: modList.note }) }))] })), SP_JSX.jsxs(DFL.PanelSection, { title: "Vehicle tags", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Writable tags", description: "Upgrades a vehicle earns in-game are saved back to its tag and "
                                + "come back next time. Kept per backend, so the same figure can "
                                + "have different progress in each emulator.", checked: !!settings.writableTags, onChange: async (v) => {
                                const s = await setSetting("writableTags", v);
                                setSettings(s);
                                setTags(await tagStates());
                            } }) }), tags && tags.modified.length > 0 && (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "0.78em", opacity: 0.7 }, children: [tags.modified.length, " tag", tags.modified.length === 1 ? "" : "s", " ", "carry saved progress on this backend."] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => DFL.showModal(SP_JSX.jsx(DFL.ConfirmModal, { strTitle: "Reset every tag?", strDescription: "Every vehicle goes back to its stock build on this "
                                            + "backend. In-game upgrades saved to those tags are lost. "
                                            + "Other backends are untouched.", strOKButtonText: "Reset all", onOK: async () => {
                                            const r = await resetAllTags();
                                            toaster.toast({
                                                title: r.ok ? "Tags reset" : "Failed",
                                                body: r.ok ? `${r.cleared ?? 0} returned to stock` : "",
                                            });
                                            setTags(await tagStates());
                                        } })), children: "Reset all tags" }) })] }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Overlay", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: !settings.overlayAvailable, onClick: async () => {
                                const r = await toggleOverlay();
                                if (!r.ok)
                                    toaster.toast({ title: "Overlay", body: r.error || "failed" });
                            }, children: "Show / hide overlay" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Draw overlay", description: "Pad, LEDs and picker over the game.", checked: settings.overlayEnabled, onChange: (v) => void change("overlayEnabled", v) }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Backend", children: [backends.map((b) => (SP_JSX.jsx(BackendRow, { info: b, active: b.key === settings.activeBackend, onSelect: async (k) => {
                            const updated = await setActive(k);
                            setBackends((l) => (l ? l.map((i) => (i.key === k ? updated : i)) : l));
                            setSettings(await getSettings());
                        }, onInstall: async (k) => {
                            toaster.toast({ title: "Dimensions Toypad", body: "Downloading " + k + "\u2026" });
                            try {
                                const updated = await installBackend(k, false);
                                setBackends((l) => (l ? l.map((i) => (i.key === k ? updated : i)) : l));
                                if (updated.error) {
                                    toaster.toast({ title: "Install failed", body: updated.error });
                                }
                            }
                            catch (err) {
                                toaster.toast({ title: "Install failed", body: String(err) });
                            }
                        } }, b.key))), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", disabled: !active?.managed, onClick: async () => {
                                const k = settings.activeBackend;
                                toaster.toast({ title: "Re-downloading",
                                    body: (active?.label || k) + " \u2014 verifying against the published release" });
                                try {
                                    // force: ignore the installed copy even if it verifies. When
                                    // the pinned hash has moved to a new upstream build, this is
                                    // what proves the plugin's own download path works rather
                                    // than trusting whatever is already on disk.
                                    const updated = await installBackend(k, true);
                                    setBackends((l) => (l ? l.map((i) => (i.key === k ? updated : i)) : l));
                                    toaster.toast({
                                        title: updated.error ? "Reinstall failed" : "Reinstalled",
                                        body: updated.error || updated.detail || updated.state,
                                    });
                                }
                                catch (err) {
                                    toaster.toast({ title: "Reinstall failed", body: String(err) });
                                }
                            }, children: ["Reinstall ", active ? active.label : "backend"] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => void refresh(), children: "Refresh" }) })] }), active && active.notes.length > 0 && (SP_JSX.jsx(DFL.PanelSection, { title: active.label, children: active.notes.map((n, i) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.6 }, children: n }) }, i))) })), SP_JSX.jsx(DFL.PanelSection, { title: "Hotkeys", children: keys && !keys.available ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.6 }, children: "Can't read the hardware buttons. Decky needs permission on /dev/input." }) })) : (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                    if (keys?.learning === "hotkeyPeek")
                                        await cancelLearn();
                                    else
                                        await learnHotkey("hotkeyPeek");
                                    setKeys(await hotkeyStatus());
                                }, children: keys?.learning === "hotkeyPeek"
                                    ? "Press volume keys now…"
                                    : `Peek overlay — ${keys?.peek ?? "…"}` }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                    if (keys?.learning === "hotkeyModal")
                                        await cancelLearn();
                                    else
                                        await learnHotkey("hotkeyModal");
                                    setKeys(await hotkeyStatus());
                                }, children: keys?.learning === "hotkeyModal"
                                    ? "Press volume keys now…"
                                    : `Open Toy Pad — ${keys?.modal ?? "…"}` }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.72em", opacity: 0.55 }, children: "Volume Up, Volume Down, or both together." }) })] })) }), SP_JSX.jsxs(DFL.PanelSection, { title: "Options", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Mirror pad LEDs", description: "Needed for Locate Keystone. Polls while on.", checked: settings.ledEnabled, onChange: (v) => void change("ledEnabled", v) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Keep picker open", description: "Stay in the list after placing a figure.", checked: settings.fastLoad, onChange: (v) => void change("fastLoad", v) }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ToggleField, { label: "Phone remote", description: settings.remoteEnabled ? settings.remoteUrl
                                : "Serve the pad to your phone over LAN.", checked: settings.remoteEnabled, onChange: (v) => void change("remoteEnabled", v) }) })] })] }));
}
var index = definePlugin(() => {
    /*
     * Registered at plugin scope, not inside the panel.
     *
     * The panel's component tree is mounted only while the QAM is open, so a
     * listener living there is absent exactly when the hotkey is useful —
     * mid-game, panel closed. This one is set up once at load and persists.
     */
    const onHotkey = async () => {
        if (currentModalClose) {
            currentModalClose();
            return;
        }
        if (loadingModal) return;
        loadingModal = true;
        try {
            const [cat, ab] = await Promise.all([
                callable("get_catalog")(),
                callable("get_abilities")(),
            ]);
            currentModalObj = DFL.showModal(SP_JSX.jsx(ToypadModal, { catalog: cat.franchises, abilities: ab.abilities }));
        }
        catch (err) {
            toaster.toast({ title: "Toy Pad", body: String(err) });
        }
        finally {
            loadingModal = false;
        }
    };
    addEventListener("toypad_open_modal", onHotkey);
    return {
        name: "Dimensions Toypad",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "Dimensions Toypad" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(FaBorderAll, {}),
        onDismount() {
            removeEventListener("toypad_open_modal", onHotkey);
        },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
