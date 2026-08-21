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

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** a then b, applied to a vector as rotate(multiply(a, b), v). */
export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * The shortest turn that takes one direction onto another.
 *
 * Both are unit vectors. Directly opposite ones have no shortest turn — every
 * half turn about something perpendicular does it — so one perpendicular is
 * picked, which for the axes this is called with is again an axis.
 */
function arc(from: Vec3Like, to: Vec3Like): Quat {
  const dot = from.x * to.x + from.y * to.y + from.z * to.z;
  if (dot > 0.999999) return IDENTITY;

  let axis = {
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
  };
  let w = 1 + dot;

  if (dot < -0.999999) {
    // Half a turn about whichever axis `from` leans on least.
    const helper =
      Math.abs(from.x) < 0.5
        ? { x: 1, y: 0, z: 0 }
        : { x: 0, y: 1, z: 0 };
    axis = {
      x: from.y * helper.z - from.z * helper.y,
      y: from.z * helper.x - from.x * helper.z,
      z: from.x * helper.y - from.y * helper.x,
    };
    w = 0;
  }

  const len = Math.hypot(axis.x, axis.y, axis.z, w) || 1;
  return { x: axis.x / len, y: axis.y / len, z: axis.z / len, w: w / len };
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
  // Already there, or exactly upside down — which cannot happen for a winning
  // normal, since it would have lost to its opposite.
  return multiply(arc(rotate(q, FACE_NORMALS[index]!), UP), q);
}

/** Which face of the die carries a value. */
export function faceOf(value: number): number {
  const index = FACE_VALUES.indexOf(value);
  if (index < 0) throw new Error(`No face carries ${value}`);
  return index;
}

/**
 * Turning the die in the hand: the rotation that carries one face round to
 * where another one is now.
 *
 * A quarter turn, a half turn, or nothing — always one of the twenty-four ways
 * a cube can be set down, so it maps the solid exactly onto itself. Applied on
 * the right of an orientation it moves the printing and leaves the shape, the
 * silhouette and the shadow untouched.
 */
export function turn(from: number, to: number): Quat {
  return arc(FACE_NORMALS[from]!, FACE_NORMALS[to]!);
}
