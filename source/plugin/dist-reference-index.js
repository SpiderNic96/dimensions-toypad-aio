const manifest = {"name":"Dimensions Toypad"};
// Inject a one-time style block that fixes the "have-to-scroll-down-then-back-up"
// glitch on first plugin open. Steam's Quick Access scroll view sometimes reads
// stale content-height for a fresh PanelSection; forcing content-visibility to
// visible and giving each section a min-height nudges the layout engine to
// remeasure on mount instead of after the first scroll gesture.
if (typeof document !== "undefined" && !document.getElementById("dimensions-toypad-scrollfix")) {
    const s = document.createElement("style");
    s.id = "dimensions-toypad-scrollfix";
    s.textContent = ".quickaccess-list__container ._DEVjIx3rNJKz5nRxq7_1, .DialogBody { content-visibility: visible !important; contain: none !important; } .quickaccess-list__container [class*='PanelSection'] { min-height: 1px; }";
    (document.head || document.documentElement).appendChild(s);
}
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
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

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
function FaCubes (props) {
  return GenIcon({"attr":{"viewBox":"0 0 512 512"},"child":[{"tag":"path","attr":{"d":"M488.6 250.2L392 214V105.5c0-15-9.3-28.4-23.4-33.7l-100-37.5c-8.1-3.1-17.1-3.1-25.3 0l-100 37.5c-14.1 5.3-23.4 18.7-23.4 33.7V214l-96.6 36.2C9.3 255.5 0 268.9 0 283.9V394c0 13.6 7.7 26.1 19.9 32.2l100 50c10.1 5.1 22.1 5.1 32.2 0l103.9-52 103.9 52c10.1 5.1 22.1 5.1 32.2 0l100-50c12.2-6.1 19.9-18.6 19.9-32.2V283.9c0-15-9.3-28.4-23.4-33.7zM358 214.8l-85 31.9v-68.2l85-37v73.3zM154 104.1l102-38.2 102 38.2v.6l-102 41.4-102-41.4v-.6zm84 291.1l-85 42.5v-79.1l85-38.8v75.4zm0-112l-102 41.4-102-41.4v-.6l102-38.2 102 38.2v.6zm240 112l-85 42.5v-79.1l85-38.8v75.4zm0-112l-102 41.4-102-41.4v-.6l102-38.2 102 38.2v.6z"},"child":[]}]})(props);
}

// ---------------------------------------------------------------- backend
const getState = callable("get_state");
const getFranchises = callable("get_franchises");
const getFigures = callable("get_figures");
const getIcon = callable("get_icon");
const getFranchiseLogo = callable("get_franchise_logo");
const loadFigure = callable("load_figure");
const removeFigure = callable("remove_figure");
const moveFigure = callable("move_figure");
const clearAll = callable("clear_all");
const resync = callable("resync");
const rescan = callable("rescan");
const checkListener = callable("check_listener");
callable("reset_progress");
const setupStatus = callable("setup_status");
const getPadColors = callable("get_pad_colors");
const installTags = callable("install_tags");
const installLauncher = callable("install_launcher");
const setWeb = callable("set_web");
const checkRpcs3Release = callable("check_rpcs3_release");
const installRpcs3 = callable("install_rpcs3");
const launchEmulatorGui = callable("launch_emulator_gui");
const setSixtyFps = callable("set_sixty_fps");
const setRpcs3Path = callable("set_rpcs3_path");
const resetPaths = callable("reset_paths");
const runSetup = callable("run_setup");
const getSixtyFps = callable("get_sixty_fps");
const setFullscreen = callable("set_fullscreen");
// ---------------------------------------------------------------- helpers
// The pad is 3/1/3: a tall centre flanked by two sections of three. Laying it
// out the way the hardware looks makes "Left · lower R" mean something at a
// glance, rather than being a label you have to decode.
const ZONE_ORDER = {
    left: [0, 3, 4],
    centre: [1],
    right: [2, 5, 6],
};
const zoneColour = (zone) => zone === "left" ? "#ff6b4a" : zone === "centre" ? "#ffc93c" : "#45b8ff";
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
`;
const Check = ({ ok, label, detail, pending }) => (SP_JSX.jsxs("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", padding: "3px 0" }, children: [SP_JSX.jsx("span", { style: { color: pending ? "#ffc93c" : ok ? "#5fd08a" : "#ff6b4a", fontSize: "13px", width: "14px" }, children: pending ? "•" : ok ? "\u2713" : "\u2717" }), SP_JSX.jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [SP_JSX.jsx("div", { style: { fontSize: "12px" }, children: label }), detail ? (SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.55, wordBreak: "break-all" }, children: detail })) : null] })] }));
// ---------------------------------------------------------------- pad grid
const PadCell = ({ slot, occupant, armed, isSource, wide, onActivate, ledColor }) => {
    const [art, setArt] = SP_REACT.useState("");
    // The portrait is the figure's own artwork, fetched by the id the pad is
    // holding, so the tile shows who is standing there rather than just a name.
    SP_REACT.useEffect(() => {
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
    return (SP_JSX.jsxs(DFL.Focusable, { onActivate: onActivate, focusClassName: "dt-pad-focus", style: {
            flex: wide ? "1 1 100%" : 1,
            position: "relative",
            minHeight: "58px",
            margin: "2px",
            padding: "6px",
            borderRadius: "6px",
            background: occupant ? "#141821" : "#101218",
            border: `2px solid ${isSource ? "#45b8ff" : armed ? "#ffc93c" :
                ledColor ? ledColor.hex :
                occupant ? zoneColour(slot.zone) : "#2a2f3a"}`,
            boxShadow: ledColor ? `0 0 10px ${ledColor.hex}, inset 0 0 12px ${ledColor.hex}66` : undefined,
            borderStyle: isSource ? "dashed" : "solid",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            overflow: "hidden",
        }, children: [art ? (SP_JSX.jsx("img", { src: art, alt: "", style: {
                    position: "absolute",
                    right: "4px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    height: "80%",
                    maxWidth: "52%",
                    objectFit: "contain",
                    opacity: 0.95,
                    pointerEvents: "none",
                } })) : null, SP_JSX.jsxs("div", { style: {
                    fontSize: "9px", opacity: 0.5, fontFamily: "monospace", zIndex: 1,
                }, children: [slot.pad, "/", slot.index] }), SP_JSX.jsx("div", { style: {
                    fontSize: "11px",
                    lineHeight: 1.2,
                    color: occupant ? "#e6e9ef" : "#7d8494",
                    wordBreak: "break-word",
                    zIndex: 1,
                    // Keep the name legible over the portrait behind it.
                    maxWidth: art ? "58%" : "100%",
                    textShadow: art ? "0 1px 3px #0b0d12" : undefined,
                }, children: occupant
                    ? occupant.name + (occupant.build > 1 ? ` \u00b7 B${occupant.build}` : "")
                    : slot.label })] }));
};
const PadGrid = ({ slots, pads, held, moveSource, onSlot, padColors }) => {
    const cell = (i, wide) => {
        const s = slots[i];
        if (!s)
            return null;
        var padKey = ({'centre':'0','center':'0','left':'1','right':'2'})[String(s.pad).toLowerCase()];
        var ledColor = padColors ? (padColors[padKey] || padColors.all) : null;
        return (SP_JSX.jsx(PadCell, { slot: s, occupant: pads[i], armed: held !== null && !pads[i], isSource: moveSource === i, wide: wide, onActivate: () => onSlot(i), ledColor: ledColor }, i));
    };
    // Laid out as three columns so the stick and D-pad move through the pad the
    // way it physically looks: left section, tall centre, right section.
    return (SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex", gap: "2px" }, children: [SP_JSX.jsxs(DFL.Focusable, { "flow-children": "vertical", style: { flex: 1, display: "flex", flexDirection: "column" }, children: [cell(ZONE_ORDER.left[0], true), SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex" }, children: [cell(ZONE_ORDER.left[1]), cell(ZONE_ORDER.left[2])] })] }), SP_JSX.jsx(DFL.Focusable, { "flow-children": "vertical", style: { flex: 0.8, display: "flex" }, children: cell(ZONE_ORDER.centre[0], true) }), SP_JSX.jsxs(DFL.Focusable, { "flow-children": "vertical", style: { flex: 1, display: "flex", flexDirection: "column" }, children: [cell(ZONE_ORDER.right[0], true), SP_JSX.jsxs(DFL.Focusable, { "flow-children": "horizontal", style: { display: "flex" }, children: [cell(ZONE_ORDER.right[1]), cell(ZONE_ORDER.right[2])] })] })] }));
};
// ---------------------------------------------------------------- franchise tile
const FranchiseRow = ({ franchise, onPick, }) => {
    const [logo, setLogo] = SP_REACT.useState("");
    const [dark, setDark] = SP_REACT.useState(false);
    const [failed, setFailed] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
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
    const [icon, setIcon] = SP_REACT.useState("");
    SP_REACT.useEffect(() => {
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
    const [slots, setSlots] = SP_REACT.useState([]);
    const [pads, setPads] = SP_REACT.useState(Array(7).fill(null));
    const [franchises, setFranchises] = SP_REACT.useState([]);
    const [figures, setFigures] = SP_REACT.useState([]);
    const [view, setView] = SP_REACT.useState("pad");
    const [franchise, setFranchise] = SP_REACT.useState("");
    const [search, setSearch] = SP_REACT.useState("");
    const [story, setStory] = SP_REACT.useState(false);
    const [held, setHeld] = SP_REACT.useState(null);
    const [padColors, setPadColors] = SP_REACT.useState(null);
    SP_REACT.useEffect(function() {
        var live = true;
        function tick() {
            getPadColors().then(function(r) {
                if (live && r && r.padColors) setPadColors(r.padColors);
            }).catch(function() {});
        }
        tick();
        var iv = setInterval(tick, 500);
        return function() { live = false; clearInterval(iv); };
    }, []);
    const [moveSource, setMoveSource] = SP_REACT.useState(null);
    const [removeMode, setRemoveMode] = SP_REACT.useState(false);
    const [moveArm, setMoveArm] = SP_REACT.useState(false);
    const [targetSlot, setTargetSlot] = SP_REACT.useState(null);
    const [listening, setListening] = SP_REACT.useState(null);
    const [count, setCount] = SP_REACT.useState(0);
    const [root, setRoot] = SP_REACT.useState(null);
    const [setup, setSetup] = SP_REACT.useState(null);
    const [setupError, setSetupError] = SP_REACT.useState("");
    const setupRefreshing = SP_REACT.useRef(false);
    const [working, setWorking] = SP_REACT.useState("");
    const [release, setRelease] = SP_REACT.useState(null);
    const [fps, setFps] = SP_REACT.useState(null);
    const [shortcutMsg, setShortcutMsg] = SP_REACT.useState("");
    const [customPath, setCustomPath] = SP_REACT.useState("");
    const [wizard, setWizard] = SP_REACT.useState(null);
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
        const s = await getState();
        setSlots(s.slots);
        setPads(s.pads);
        setCount(s.count);
        setRoot(s.libraryRoot);
        const l = await checkListener();
        setListening(l.listening);
        await refreshSetup();
        try {
            setFps(await getSixtyFps());
        }
        catch { /* ignore */ }
    };
    SP_REACT.useEffect(() => { refresh(); const timer = setInterval(() => { refreshSetup(); checkListener().then(l => setListening(l.listening)).catch(() => {}); }, 5000); return () => clearInterval(timer); }, []);
    // Keep the path box showing whatever is actually configured.
    SP_REACT.useEffect(() => {
        setCustomPath(setup?.rpcs3Custom ?? "");
    }, [setup?.rpcs3Custom]);
    SP_REACT.useEffect(() => {
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
        return (SP_JSX.jsx(SP_REACT.Fragment, { children: SP_JSX.jsxs(DFL.Focusable, { onCancel: () => setView("pad"), "flow-children": "vertical", children: [SP_JSX.jsxs(DFL.PanelSection, { title: "Setup", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("pad"), children: "Back to pad" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
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
                                    }, children: setup?.setupComplete ? "Setup complete · Re-run setup" : "Set everything up" }) }), wizard ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { padding: "2px 0" }, children: wizard.map((w, i) => (SP_JSX.jsx(Check, { ok: w.ok, label: w.label, detail: w.detail }, i))) }) })) : null, setup ? (SP_JSX.jsxs(SP_REACT.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { children: [SP_JSX.jsx(Check, { ok: setup.rpcs3Ok, label: "Bundled RPCS3", detail: setup.rpcs3Ok ? `${setup.rpcs3Version} · ${setup.rpcs3Path || setup.rpcs3ExpectedPath}` : `Missing: ${setup.rpcs3ExpectedPath || setup.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}` }), SP_JSX.jsx(Check, { ok: setup.tagsOk, label: `Tag library (${setup.tagCount})`, detail: setup.tagsOk ? setup.tagRoot : "Use Download tag library below" }), SP_JSX.jsx(Check, { ok: setup.gameOk, label: "Game dump", detail: setup.gameOk ? setup.gamePath : `Nothing under ${setup.gameRoot}` }), SP_JSX.jsx(Check, { ok: setup.launcherOk, label: "Steam launcher", detail: setup.launcherOk ? setup.launcherPath : "Use Write launcher below" }), SP_JSX.jsx(Check, { ok: setup.webOk, label: "Phone remote", detail: setup.webOk ? setup.webUrl : "Disabled" }), SP_JSX.jsx(Check, { ok: setup.listenerOk, pending: setup.listenerState === "waiting", label: "Toypad listener", detail: setup.listenerState === "connected"
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
                                            }, children: setup.webEnabled ? "Turn off phone remote" : "Turn on phone remote" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: refresh, children: "Re-check everything" }) })] })) : (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", opacity: 0.7 }, children: "Checking..." }) }))] }), SP_JSX.jsxs(DFL.PanelSection, { title: "RPCS3", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "11px", opacity: 0.7, lineHeight: 1.4 }, children: setup?.rpcs3Ok
                                        ? `RPCS3 ✓ Bundled AppImage · ${setup.rpcs3Version}`
                                        : `RPCS3 ✗ Bundled AppImage missing · expected ${setup?.rpcs3ExpectedPath || setup?.rpcs3Path || "bundled/rpcs3/RPCS3-Toypad-x86_64.AppImage"}` }) }), !setup?.rpcs3Ok && release && release.ok ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", disabled: working !== "", onClick: async () => {
                                        setWorking("Downloading RPCS3, this takes a few minutes...");
                                        const res = await installRpcs3();
                                        setWorking("");
                                        notify(res);
                                        await refresh();
                                    }, children: ["Install patched RPCS3 (", release.sizeMB, " MB)"] }) })) : null, fps && fps.supported ? (SP_JSX.jsxs(SP_REACT.Fragment, { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                                const res = await setSixtyFps(!fps.enabled);
                                                notify(res);
                                                setFps(await getSixtyFps());
                                            }, children: fps.enabled ? "Back to 30 fps (Vblank 60 Hz)" : "Unlock 60 fps (Vblank 120 Hz)" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                                const res = await setFullscreen(!fps.fullscreen);
                                                notify(res);
                                                setFps(await getSixtyFps());
                                            }, children: fps.fullscreen
                                                ? "Start windowed"
                                                : "Start fullscreen (16:9 / 1280×720)" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.6 }, children: `Vblank: ${fps.vblankRate ?? (fps.enabled ? 120 : 60)} Hz · Frame limit: ${fps.frameLimit ?? (fps.enabled ? "60" : "Auto")} · 16:9 / 1280×720` }) })] })) : null, setup?.rpcs3Ok ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => notify(await launchEmulatorGui()), children: "Open RPCS3 interface" }) })) : null, SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "RPCS3 bundled AppImage (authoritative)", value: setup?.rpcs3Path ?? "", disabled: true }) })] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Play", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
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
        return (SP_JSX.jsx(SP_REACT.Fragment, { children: SP_JSX.jsx(DFL.Focusable, { onCancel: () => setView("pad"), "flow-children": "vertical", children: SP_JSX.jsxs(DFL.PanelSection, { title: "Choose a franchise", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("pad"), children: "Back to pad" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs(DFL.ButtonItem, { layout: "below", onClick: () => {
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
        return (SP_JSX.jsx(SP_REACT.Fragment, { children: SP_JSX.jsx(DFL.Focusable, { onCancel: () => setView(story ? "pad" : "franchises"), "flow-children": "vertical", children: SP_JSX.jsxs(DFL.PanelSection, { title: story ? "Story mode" : franchise || "All figures", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => setView("franchises"), children: "Back to franchises" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.TextField, { label: "Filter", value: search, onChange: (e) => setSearch(e.target.value) }) }), figures.length === 0 ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", opacity: 0.7, padding: "8px 0" }, children: "Nothing matches." }) })) : null, figures.map((f) => (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(FigureRow, { figure: f, onPick: async () => {
                                    // Came from tapping a specific pad, so put it straight there
                                    // instead of making them pick the same pad twice.
                                    if (targetSlot !== null) {
                                        const slot = targetSlot;
                                        setTargetSlot(null);
                                        setView("pad");
                                        const res = await loadFigure(f.id, slot);
                                        if (notify(res) && res.pads)
                                            setPads(res.pads);
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
    // -------------------------------------------------------------- pad view
    const heldFigure = figures.find((f) => f.id === held);
    return (SP_JSX.jsxs(SP_REACT.Fragment, { children: [SP_JSX.jsx("style", { children: FOCUS_CSS }), SP_JSX.jsxs(DFL.PanelSection, { title: "Toypad", children: [listening === false ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", color: "#ff6b4a", padding: "4px 0" }, children: "Not connected. Start LEGO Dimensions and get past the intro." }) })) : null, held !== null ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "12px", color: "#ffc93c", padding: "4px 0" }, children: ["Holding ", heldFigure?.name ?? "a figure", " \u2014 pick a pad"] }) })) : null, moveArm ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", color: "#45b8ff", padding: "4px 0" }, children: "Tap the figure you want to move" }) })) : null, removeMode ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "12px", color: "#ff6b4a", padding: "4px 0" }, children: "Tap a pad to take its figure off" }) })) : null, moveSource !== null ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "12px", color: "#45b8ff", padding: "4px 0" }, children: ["Moving ", pads[moveSource]?.name, " \u2014 pick the destination"] }) })) : null, SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(PadGrid, { slots: slots, pads: pads, held: held, moveSource: moveSource, onSlot: onSlot, padColors: padColors }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => { setTargetSlot(null); openBrowser(); }, children: "Browse figures" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => {
                                setRemoveMode(false);
                                setHeld(null);
                                const filled = pads.findIndex((p) => p !== null);
                                if (filled < 0) {
                                    toaster.toast({ title: "Toypad", body: "Nothing on the pad to move" });
                                    return;
                                }
                                setMoveSource(null);
                                toaster.toast({ title: "Toypad", body: "Tap the figure to move" });
                                setMoveArm(true);
                            }, children: "Move a figure" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => {
                                setHeld(null);
                                setMoveArm(false);
                                setRemoveMode(!removeMode);
                                if (!removeMode) {
                                    toaster.toast({ title: "Toypad", body: "Tap a pad to take its figure off" });
                                }
                            }, children: removeMode ? "Cancel take off" : "Take a figure off" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const res = await clearAll();
                                if (notify(res) && res.pads)
                                    setPads(res.pads);
                            }, children: "Clear all pads" }) }), held !== null || moveSource !== null || moveArm ? (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => {
                                setHeld(null);
                                setMoveSource(null);
                                setMoveArm(false);
                                setRemoveMode(false);
                                setTargetSlot(null);
                            }, children: "Cancel" }) })) : null] }), SP_JSX.jsxs(DFL.PanelSection, { title: "Library", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "11px", opacity: 0.7, padding: "2px 0" }, children: [count, " tags", root ? ` · ${root.replace(/^\/home\/[^/]+/, "~")}` : ""] }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "10px", opacity: 0.45, padding: "0 0 4px" }, children: "Dimensions Toypad by MetalNic96" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const res = await rescan();
                                notify(res);
                                refresh();
                            }, children: "Rescan" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: async () => {
                                const res = await resync();
                                if (notify(res) && res.pads)
                                    setPads(res.pads);
                            }, children: "Resync pad view" }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: () => { refreshSetup(); refreshRelease(); setView("setup"); }, children: "Setup & phone remote" }) })] })] }));
};
var index = definePlugin(() => ({
    name: "Dimensions Toypad",
    titleView: SP_JSX.jsx("div", { children: "Dimensions Toypad" }),
    content: SP_JSX.jsx(Content, {}),
    icon: SP_JSX.jsx(FaCubes, {}),
    onDismount() { },
}));

export { index as default };
//# sourceMappingURL=index.js.map
