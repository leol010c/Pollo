/**
 * Which face is up, read from the die's orientation alone.
 *
 * No DOM, no three.js — the headless check in scripts/verify-roll.ts reads its
 * rolls with this exact function, so what it proves is a property of the die
 * the page actually throws.
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * The six face normals in BoxGeometry's group order: +X, -X, +Y, -Y, +Z, -Z.
 *
 * three.js builds a box's material groups in that order, so this array and the
 * array of face materials in die.ts are indexed the same way. That shared order
 * is the whole link between what the physics says is up and what is drawn there.
 */
export const FACE_NORMALS: readonly Vec3Like[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/**
 * The value printed on each of those faces.
 *
 * Laid out the way a real die is: opposite faces sum to seven. It is not
 * decoration — it means the die can never show two low numbers in a row from a
 * half-turn, and it is the arrangement anybody's hand already expects.
 */
export const FACE_VALUES: readonly number[] = [1, 6, 2, 5, 3, 4];

/**
 * How square-on a face has to be pointing up before the reading counts.
 *
 * A die flat on the felt scores 1.0. Anything leaning on the rim or propped on
 * a corner scores well below this, and a value read off it is a guess.
 */
export const CLEAN_ALIGNMENT = 0.9;

const UP: Vec3Like = { x: 0, y: 1, z: 0 };

/** v rotated by q. */
export function rotate(q: Quat, v: Vec3Like): Vec3Like {
  // t = 2 * (qv x v); v' = v + q.w * t + (qv x t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export interface FaceReading {
  value: number;
  /** Dot of the winning normal with world up. 1.0 is dead flat. */
  alignment: number;
  /** False when the die is cocked and the value must not be committed. */
  clean: boolean;
  /** Index into FACE_NORMALS, for the correction below. */
  index: number;
}

export function readFace(q: Quat): FaceReading {
  let index = 0;
  let alignment = -Infinity;

  for (let i = 0; i < FACE_NORMALS.length; i++) {
    const dot = rotate(q, FACE_NORMALS[i]!).y;
    if (dot > alignment) {
      alignment = dot;
      index = i;
    }
  }

  return {
    value: FACE_VALUES[index]!,
    alignment,
    clean: alignment >= CLEAN_ALIGNMENT,
    index,
  };
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * The nearest orientation in which the die is lying flat on a face.
 *
 * The last resort for a die that will not come off its edge: the shortest turn
 * that takes the face it is closest to showing and points it straight up. Yaw
 * is untouched, so the die does not appear to spin — it just settles.
 */
export function upright(q: Quat): Quat {
  const { index } = readFace(q);
  const n = rotate(q, FACE_NORMALS[index]!);

  const dot = n.x * UP.x + n.y * UP.y + n.z * UP.z;
  // Already there, or exactly upside down (which cannot happen for a winning
  // normal, since it would have lost to its opposite).
  if (dot > 0.999999) return { ...q };

  // Shortest arc from n to up.
  const axis = {
    x: n.y * UP.z - n.z * UP.y,
    y: n.z * UP.x - n.x * UP.z,
    z: n.x * UP.y - n.y * UP.x,
  };
  const arc: Quat = { x: axis.x, y: axis.y, z: axis.z, w: 1 + dot };
  const len = Math.hypot(arc.x, arc.y, arc.z, arc.w) || 1;
  arc.x /= len;
  arc.y /= len;
  arc.z /= len;
  arc.w /= len;

  return multiply(arc, q);
}
