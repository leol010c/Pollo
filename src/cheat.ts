/**
 * Loading the dice.
 *
 * Nothing here touches the physics, and that is the whole design. A die is a
 * symmetric solid: which picture is printed on which face has no bearing at all
 * on how it falls, what it hits, or where it stops. So the throw is left
 * completely alone and the *printing* is what moves.
 *
 * The order is: the die is released, the throw is run to its end with nothing
 * drawn, the die is put back on that same throw, and the picture that is wanted
 * is turned round to the face the throw is about to land on. Then it rolls, for
 * real, exactly as it was going to.
 *
 * That leaves nothing to notice. The tumble is the tumble the solver produced,
 * the rail bounces are its bounces, the die can still come down on its edge and
 * be knocked loose, and the turn applied to the printing is one of the
 * twenty-four ways a cube can be set down — so opposite faces still sum to
 * seven and the object on the table is the same object, held a different way
 * round.
 *
 * No DOM in here, so scripts/verify-cheat.ts can throw a loaded die ten
 * thousand times with no screen attached — the same split the rest of the first
 * half of the program keeps.
 */

import { FACE_NORMALS, FACE_VALUES, faceOf, rotate, turn, type Quat } from "./faces";
import type { Dice, Roller } from "./roll";

/** The value printed on one face of the solid, for a die held this way round. */
export function showing(landed: number, facing: Quat): number {
  const up = FACE_NORMALS[landed]!;
  let best = 0;
  let closest = -Infinity;

  for (let i = 0; i < FACE_NORMALS.length; i++) {
    const n = rotate(facing, FACE_NORMALS[i]!);
    const dot = n.x * up.x + n.y * up.y + n.z * up.z;
    if (dot > closest) {
      closest = dot;
      best = i;
    }
  }

  return FACE_VALUES[best]!;
}

/**
 * Decides what a throw already in the air is going to say.
 *
 * `allowed` empty means the die is honest and this does nothing whatsoever —
 * not a foretold throw, not a turn, nothing. So a page with the menu untouched
 * runs the code it always ran.
 *
 * A throw that was going to land on something allowed anyway is left alone
 * too. There is no reason to turn a die that is already doing as it is told.
 */
export function rig(dice: Dice, roller: Roller, allowed: readonly number[]): void {
  if (allowed.length === 0) return;

  const landed = dice.foretell(roller);
  const value = showing(landed, roller.facing);
  if (allowed.includes(value)) return;

  const want = allowed[Math.floor(Math.random() * allowed.length)]!;
  roller.facing = turn(faceOf(want), landed);
}
