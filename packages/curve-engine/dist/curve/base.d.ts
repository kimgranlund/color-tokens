import type { BaseFamily, Gamut } from '../types.js';
export interface BaseCtx {
    min: number;
    max: number;
    hue: number;
    L?: number;
    /** Resolved gamut cap peakC(L, hue, gamut), threaded by the caller so the
     *  gamut-tracking bases never recompute peakC (M0.7 — PLAN §3.4 budget). */
    cap?: number;
    gamut: Gamut;
}
export declare function evalBase(base: BaseFamily, t: number, ctx: BaseCtx): number;
