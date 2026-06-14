/** Canonical Tailwind keys for N=11; otherwise an even spread across [50, 950]
 *  rounded to the nearest 10. Always zero-padded to 3 digits ('050'). */
export declare function keyForIndex(i: number, n: number): string;
export declare function keysFor(n: number): string[];
/** Display key for an explicit positional stop (D-32): the stop value itself,
 *  zero-padded to ≥3 digits ('050', '075', '825', '950'). Key uniqueness follows
 *  from the strictly-ascending stops invariant (validateSpec). */
export declare function keyForStop(stopValue: number): string;
