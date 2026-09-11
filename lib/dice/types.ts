/**
 * The solids in play.
 *
 * No d20: the deck holds at most sixteen positions, so a twenty-face die could
 * never be filled without repeating a third of itself — every roll would be a
 * lie about how many outcomes there are.
 */
export type DieType = "d4" | "d6" | "d8" | "d10" | "d12";

export const DIE_TYPES: readonly DieType[] = [
  "d4",
  "d6",
  "d8",
  "d10",
  "d12",
] as const;

export const DIE_SIDES: Record<DieType, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
};

/**
 * The largest die that `count` positions can fill without repeating one.
 *
 * The same rule that rules out the d20 applies within a session: a die with
 * more faces than the deck has positions has to print something twice, and then
 * the die is no longer telling the truth about how many outcomes there are.
 *
 * Never returns nothing — with fewer than four positions a d4 still repeats,
 * but refusing to offer a die at all would be worse than a die that repeats.
 */
export function largestDieFor(count: number): DieType {
  let best: DieType = "d4";
  for (const type of DIE_TYPES) {
    if (DIE_SIDES[type] <= count) best = type;
  }
  return best;
}

/**
 * A d4 has no face pointing up when it comes to rest — it lands on a face with
 * a vertex at the apex. The convention here is single-numeral faces read off
 * the bottom, so face detection takes the *downward* normal for d4 only.
 */
export const READS_FACE_DOWN: Record<DieType, boolean> = {
  d4: true,
  d6: false,
  d8: false,
  d10: false,
  d12: false,
};

/**
 * Circumradius used for every die, in world units.
 *
 * Doubles as the scale reference for the play area: a smaller die needs less
 * clearance from the frame edge, so shrinking this widens the space it has to
 * roll in as well as making it smaller on screen.
 */
export const DIE_RADIUS = 0.47;

/**
 * Distance from the die's centre to a face — its radius when rolling.
 *
 * The circumradius reaches a corner, which is not what touches the cloth, so
 * anything about rolling (how fast a tumble has to be to match a given ground
 * speed) is measured from here instead.
 */
export const DIE_INRADIUS = DIE_RADIUS / Math.sqrt(3);

/**
 * How far each face is inset to form the chamfer, as a fraction of the distance
 * from a corner to its face centre. Real dice are never sharp-edged — the bevel
 * is what catches the light along an edge, and without it a die reads as a
 * render rather than an object.
 */
export const DIE_BEVEL = 0.09;

/**
 * Per-solid bevel, because a bevel's stability depends on the angle between the
 * faces it joins.
 *
 * On a cube the faces meet at 90°, so a bevel is a steep little ramp the die
 * immediately tips off. The more faces a solid has the shallower that angle
 * gets — a dodecahedron's pentagons meet at 116.6°, which makes its bevels
 * nearly flat and stable enough to rest on. A die balanced on a bevel has no
 * face up at all, so it has to be re-thrown; keeping those bevels narrow is
 * what stops that from happening often enough to notice.
 */
export const DIE_BEVELS: Record<DieType, number> = {
  d4: 0.09,
  d6: 0.09,
  d8: 0.06,
  d10: 0.08,
  d12: 0.05,
};

/**
 * Atlas layout. One cell per face value plus a trailing blank cell that the
 * bevel and corner faces sample, so chamfer geometry picks up the body colour
 * without any mark on it.
 *
 * Geometry and atlas must agree on this exactly or every numeral lands on the
 * wrong face, so it lives in one place.
 */
export function atlasGrid(sides: number) {
  const cells = sides + 1;
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  return { cols, rows, cells, blankCell: sides };
}
