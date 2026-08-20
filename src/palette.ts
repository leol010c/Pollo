/**
 * The palette, taken from the artwork rather than chosen next to it.
 *
 * CYAN and PINK are the two inks the pictograms are actually drawn in, sampled
 * out of the PNGs. Everything else is built around them: a petrol felt close
 * enough to the cyan to sit in the same family, and a bone die so the drawings
 * read as printed on it.
 *
 * styles.css repeats these as custom properties. Two copies, because CSS and
 * WebGL cannot share one — change a value here and change it there.
 */

export const CYAN = "#2eb3e6";
export const PINK = "#f56fa2";

/** The die body. */
export const BONE = "#f2efe9";

/** The felt, lit in the middle and falling away at the rails. */
export const FELT = "#12455c";
export const FELT_EDGE = "#071b25";

/** The rails, and the floor the table stands on. */
export const RAIL = "#0d2b3a";
export const INK = "#070c11";

/** Small print, and the rule under a word on the location die. */
export const SLATE = "#7e97a6";
