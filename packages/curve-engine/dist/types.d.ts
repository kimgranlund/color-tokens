export type Channel = 'L' | 'C' | 'H';
export type CompoundOp = 'mul' | 'add';
export type Gamut = 'srgb' | 'p3';
export type BaseFamily = {
    kind: 'sine';
    a: number;
    b: number;
    c: number;
    d: number;
} | {
    kind: 'linear';
} | {
    kind: 'gamma';
    gamma: number;
} | {
    kind: 'smoothstep';
} | {
    kind: 'published';
    system: 'tailwind-v4' | 'radix-3';
    channel: Channel;
} | {
    kind: 'cusp-anchored';
    falloff: number;
} | {
    kind: 'gamut-max';
} | {
    kind: 'tent';
    peakT: number;
    peakC: number;
    low: {
        x: number;
        y: number;
    };
    high: {
        x: number;
        y: number;
    };
} | {
    kind: 'lookup';
    values: number[];
};
/** Cubic-Bézier easing warp in normalized [0,1]×[0,1] space (SPEC §5.2).
 *  Endpoints implicit: P0=(0,0), P3=(1,1). Identity (no warp) = the linear
 *  easing p1=(1/3,1/3), p2=(2/3,2/3). x must be monotone: 0 < p1.x ≤ p2.x < 1. */
export interface BezierWarp {
    p1: {
        x: number;
        y: number;
    };
    p2: {
        x: number;
        y: number;
    };
}
export interface ChannelStack {
    channel: Channel;
    base: BaseFamily;
    bezier: BezierWarp;
    /** stopIndex -> signed delta (identity-omitted: mul→1, add→0). */
    overrides: Record<number, number>;
    op: CompoundOp;
    /** 'gamut' = clamp C to peakC(L,H) at evaluation time (SPEC §7). */
    bounds: {
        min: number;
        max: number | 'gamut';
    };
}
/** The entire serializable state (URL-encodable). SPEC §11. */
export interface PaletteSpec {
    version: '0.1.0';
    hue: number;
    count: number;
    stops?: number[];
    channels: {
        L: ChannelStack;
        C: ChannelStack;
        H: ChannelStack;
    };
    displayGamut: Gamut;
}
export interface Swatch {
    index: number;
    key: string;
    oklch: {
        L: number;
        C: number;
        H: number;
    };
    hex: string;
    inGamut: {
        srgb: boolean;
        p3: boolean;
    };
    clampedChromaDelta: number;
}
export interface Palette {
    spec: PaletteSpec;
    swatches: Swatch[];
}
/** Ephemeral UI state — NOT persisted in PaletteSpec (SPEC §8.1, §11). */
export interface ViewState {
    canvasMode: 'overlay' | 'single';
    activeChannel: Channel;
}
export type CurveRampErrorCode = 'degenerate' | 'invalid-field' | 'gamut' | 'export';
export declare class CurveRampError extends Error {
    readonly code: CurveRampErrorCode;
    readonly field?: string | undefined;
    constructor(code: CurveRampErrorCode, message: string, field?: string | undefined);
}
