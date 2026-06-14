// OKLrCh ↔ OKLCh — SPEC §7. Internal working space = OKLrCh (Ottosson Lr toe);
// wire/output = OKLCh. Curve math (esp. L) runs in Lr; convert at the boundary.
// Ottosson's "Lr" toe — reference-white-anchored remap of OKLab L so equal Lr
// steps read as equal perceived lightness. https://bottosson.github.io (Lr post).
const K1 = 0.206;
const K2 = 0.03;
const K3 = (1 + K1) / (1 + K2);
/** OKLab L → Lr (toe). L,Lr ∈ [0,1]. */
export function toe(L) {
    return 0.5 * (K3 * L - K1 + Math.sqrt((K3 * L - K1) ** 2 + 4 * K2 * K3 * L));
}
/** Lr → OKLab L (inverse toe). */
export function toeInv(Lr) {
    return (Lr * Lr + K1 * Lr) / (K3 * (Lr + K2));
}
export const toOklch = (c) => ({ L: toeInv(c.Lr), C: c.C, H: c.H });
export const toOklrch = (c) => ({ Lr: toe(c.L), C: c.C, H: c.H });
