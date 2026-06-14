// Stop key labels — SPEC §4, §11. keyForIndex(i, N) → '050' | '100' | … | '950'.
const TAILWIND_11 = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
/** Canonical Tailwind keys for N=11; otherwise an even spread across [50, 950]
 *  rounded to the nearest 10. Always zero-padded to 3 digits ('050'). */
export function keyForIndex(i, n) {
    if (n < 2)
        throw new RangeError('count must be >= 2');
    if (n === 11)
        return pad(TAILWIND_11[i]);
    const t = i / (n - 1);
    const raw = 50 + t * (950 - 50);
    return pad(Math.round(raw / 10) * 10);
}
export function keysFor(n) {
    return Array.from({ length: n }, (_, i) => keyForIndex(i, n));
}
/** Display key for an explicit positional stop (D-32): the stop value itself,
 *  zero-padded to ≥3 digits ('050', '075', '825', '950'). Key uniqueness follows
 *  from the strictly-ascending stops invariant (validateSpec). */
export function keyForStop(stopValue) {
    return pad(stopValue);
}
function pad(v) {
    return String(v).padStart(3, '0');
}
