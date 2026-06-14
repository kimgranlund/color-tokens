import type { BezierWarp } from '../types.js';
/** The identity warp — a straight line, equivalent to no warp. */
export declare const IDENTITY_WARP: BezierWarp;
export declare function validateWarp(w: BezierWarp): void;
/** Returns an easing function x∈[0,1] → y, for the cubic with control x's/y's. */
export declare function easing(w: BezierWarp): (x: number) => number;
