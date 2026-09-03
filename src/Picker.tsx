// SPDX-License-Identifier: MIT
import * as DFL from "@decky/ui";
import { useState, useEffect } from "react";
import { getFranchiseLogo, getIcon, getFullArt } from "./api";

// ---------------------------------------------------------------- franchise tile
export const FranchiseRow = ({ franchise, onPick }: any) => {
    const [logo, setLogo] = useState("");
    const [dark, setDark] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        if (franchise.hasLogo) {
            getFranchiseLogo(franchise.name)
                .then((d: any) => {
                    if (!live)
                        return;
                    if (d && d.icon) {
                        setLogo(d.icon);
                        setDark(!!d.dark);
                    }
                    else
                        setFailed(true);
                })
                .catch(() => { if (live) setFailed(true); });
        }
        return () => { live = false; };
    }, [franchise.name, franchise.hasLogo]);
    const showArt = franchise.hasLogo && !failed;
    return (
        <DFL.ButtonItem {...({ className: "dt-tag-card" } as any)} layout="below" onClick={onPick}>
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minHeight: showArt ? "52px" : undefined,
            }}>
                {showArt ? (
                    <div style={{
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
                    }}>
                        {logo ? (
                            <img src={logo} alt={franchise.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", filter: "drop-shadow(0 0 1px rgba(255,255,255,.55))" }} />
                        ) : null}
                    </div>
                ) : null}
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontSize: "13px", lineHeight: 1.25 }}>{franchise.name}</div>
                    <div style={{ fontSize: "10px", opacity: 0.55 }}>{franchise.count} tags</div>
                </div>
            </div>
        </DFL.ButtonItem>
    );
};

// ---------------------------------------------------------------- figure row
export const FigureRow = ({ figure, onPick }: any) => {
    const [icon, setIcon] = useState("");
    useEffect(() => {
        let live = true;
        if (figure.hasIcon) {
            getIcon(figure.id).then((d: any) => { if (live) setIcon(d); }).catch(() => { });
        }
        return () => { live = false; };
    }, [figure.id, figure.hasIcon]);
    return (
        <DFL.ButtonItem {...({ className: "dt-tag-card" } as any)} layout="below" onClick={onPick}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }} className="dt-row">
                {icon ? (
                    <img src={icon} style={{ width: "28px", height: "28px", objectFit: "contain" }} />
                ) : (
                    <div style={{ width: "28px" }} />
                )}
                <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: "13px" }}>
                        {figure.name}
                        {figure.build > 1 ? (
                            <span style={{ opacity: 0.6 }}>{` · Build ${figure.build}`}</span>
                        ) : null}
                    </div>
                    {figure.kind ? (
                        <div style={{ fontSize: "10px", opacity: 0.55 }}>{figure.kind}</div>
                    ) : null}
                </div>
            </div>
        </DFL.ButtonItem>
    );
};

// --- the toypad modal -------------------------------------------------------
// v3.3.14: this was a routerHook global component, which renders but never
// receives gamepad focus - hence a dead B button and no navigation. A modal
// via showModal is the supported way to take exclusive controller focus, and
// ModalRoot wires B/Escape to close for free.
export const ModalFranchiseTile = ({ franchise, onPick }: any) => {
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

export const ModalFigureRow = ({ fig, onPick, isFav, onToggleFav, builds }: any) => {
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
                        onClick={(e: any) => {
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
