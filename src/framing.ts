/**
 * How much table there is, and where the camera stands to see all of it.
 *
 * Pure geometry, and deliberately so: scripts/verify-roll.ts throws its
 * thousands of dice on the felt this produces for a real phone and a real
 * laptop, rather than on a table nobody ever plays on.
 */

import type { Play } from "./throw";

const DEG = Math.PI / 180;

/** Long enough to flatten the tumble a little, short enough to keep depth. */
export const FOV = 40;

/**
 * How far above the horizon the camera sits.
 *
 * Shallower and the far rail hides the die behind it; steeper and the throw
 * loses its depth and reads as a die sliding around a flat picture. At 52 you
 * can see the whole felt and still watch the die come toward you.
 */
export const PITCH = 52 * DEG;

/** Fraction of the frame the felt is allowed to occupy. */
const HORIZONTAL_FILL = 0.96;

/**
 * Less, vertically, because the top and bottom of the screen belong to the
 * chrome — and more of a tall screen than a wide one, since the placard rises
 * from the bottom edge of a phone and only floats over a laptop.
 */
const verticalFill = (aspect: number) => (aspect >= 1 ? 0.88 : 0.84);

/** Height the fit has to account for — the rail, plus a die in the air. */
const HEADROOM = 1.4;

/**
 * The rails stand outside the felt, so the frame has to hold a little more
 * table than the play area. Kept here rather than imported from the scene
 * because this file has to stay free of anything that needs a browser.
 */
const RAIL_ALLOWANCE = 0.36;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export interface Framing {
  play: Play;
  /** Camera position; it always looks at the origin. */
  camera: { x: number; y: number; z: number };
  fov: number;
}

/**
 * The shape of the felt for a given viewport.
 *
 * Two things are being traded. The die is one world unit across, so a wider
 * table means a smaller die on screen — on a phone the table has to stay narrow
 * or the die is a speck. And the felt is seen at an angle, so its depth is
 * foreshortened by cos(pitch); matching the screen's proportions means being
 * roughly that much deeper than it is wide.
 */
export function playFor(aspect: number): Play {
  const halfX = clamp(1.6 + aspect * 1.2, 2.0, 4.6);
  const halfZ = clamp(halfX / Math.max(aspect * 0.62, 0.05), 3.3, 5.2);
  return { halfX, halfZ };
}

/**
 * The distance at which every corner of the felt is inside the frame.
 *
 * Fitting the bounding *sphere* is the usual shortcut and it is badly wrong
 * here: a long narrow table has a sphere far larger than the table, and on a
 * phone that pushes the camera back until the die is unreadable. So each corner
 * is placed in camera space and asked what distance it needs, and the greediest
 * corner wins.
 *
 * In camera space the view axis is fixed, so a corner p sits at a height q.y, a
 * side offset q.x and a depth q.z that do not depend on the distance at all —
 * only the camera's own position slides along that axis. A corner is in frame
 * when |q.x| <= (d - q.z) * tan(hfov/2), which solves straight out for d.
 */
function fit(play: Play, aspect: number): number {
  const tanV = Math.tan((FOV * DEG) / 2) * verticalFill(aspect);
  const tanH = Math.tan((FOV * DEG) / 2) * aspect * HORIZONTAL_FILL;

  const sin = Math.sin(PITCH);
  const cos = Math.cos(PITCH);

  const edgeX = play.halfX + RAIL_ALLOWANCE;
  const edgeZ = play.halfZ + RAIL_ALLOWANCE;

  let distance = 0;
  for (const x of [-edgeX, edgeX]) {
    for (const z of [-edgeZ, edgeZ]) {
      for (const y of [0, HEADROOM]) {
        const qy = y * cos - z * sin;
        const qz = y * sin + z * cos;
        distance = Math.max(
          distance,
          qz + Math.abs(x) / tanH,
          qz + Math.abs(qy) / tanV,
        );
      }
    }
  }
  return distance;
}

export function frame(width: number, height: number): Framing {
  const aspect = width / Math.max(height, 1);
  const play = playFor(aspect);
  const distance = fit(play, aspect);

  return {
    play,
    camera: {
      x: 0,
      y: distance * Math.sin(PITCH),
      z: distance * Math.cos(PITCH),
    },
    fov: FOV,
  };
}
