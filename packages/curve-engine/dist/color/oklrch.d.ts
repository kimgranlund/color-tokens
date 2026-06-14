/** OKLab L → Lr (toe). L,Lr ∈ [0,1]. */
export declare function toe(L: number): number;
/** Lr → OKLab L (inverse toe). */
export declare function toeInv(Lr: number): number;
export interface Oklch {
    L: number;
    C: number;
    H: number;
}
export interface Oklrch {
    Lr: number;
    C: number;
    H: number;
}
export declare const toOklch: (c: Oklrch) => Oklch;
export declare const toOklrch: (c: Oklch) => Oklrch;
