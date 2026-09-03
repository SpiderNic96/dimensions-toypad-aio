// SPDX-License-Identifier: MIT
// Shared shapes used across modules. The plugin's RPC responses are loosely
// typed on the Python side, so these stay permissive rather than modelling
// every field - add to them as real type errors demand it.

export interface LedColor {
    r?: number;
    g?: number;
    b?: number;
    hex?: string;
    kind?: "off" | "color" | "flash" | "fade" | string;
    onMs?: number;
    offMs?: number;
    speedMs?: number;
    speedTicks?: number;
    count?: number;
    serial?: number;
    timestamp?: number;
    from_r?: number;
    from_g?: number;
    from_b?: number;
    fromRgb?: number[];
}

export interface PadColors {
    "0"?: LedColor | null;
    "1"?: LedColor | null;
    "2"?: LedColor | null;
    all?: LedColor | null;
    serial?: number;
    tickMs?: number;
}

export interface Slot {
    slot: number;
    pad: number;
    index: number;
    zone: "left" | "centre" | "right";
    label: string;
}

export interface PadOccupant {
    name: string;
    build?: number;
    hasIcon?: boolean;
    franchise: string;
    figure: number;
    saves?: boolean;
}
