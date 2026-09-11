import type { World } from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { readFace } from "./faceDetection";
import { isStill, SETTLE_TIMEOUT, STILL_FRAMES } from "./settle";
import { PHYSICS_STEP } from "../scene/physics";
import type { DieType } from "./types";

/**
 * Extra throws the fix may look at before settling for one it cannot call.
 *
 * The forecast declines a roll it predicts will land cocked, which is about one
 * throw in a hundred: the app nudges a cocked die and rolls it on from where it
 * lies, and that second roll is not the one that was forecast. Nothing has
 * happened yet at the point the forecast runs, though — no step, no sound, no
 * repaint — so the cheap answer is to look at a different throw instead. Three
 * more, at a third of a millisecond each, take "the fix quietly didn't happen"
 * from one round in a hundred to never.
 *
 * Lives here rather than in the scene because it is a property of the forecast,
 * and because scripts/verify-fix.ts measures the retry with the real number.
 */
export const FORECAST_RETRIES = 3;

/**
 * Which face a throw already under way is going to come to rest on.
 *
 * This is the whole of the fix on the die, and it does not touch the die at all.
 * The throw has already left the hand when this is called — same solver, same
 * impulse, same tumble — and all that happens here is that a *copy* of the
 * physics world is run forward to the end of the roll to see where it lands.
 * The deal then puts the fixed position on that face (see `deal` in the store),
 * so the die genuinely rolls to a stop showing it. Nothing is swapped
 * afterwards and nothing is turned toward the camera that was not already up.
 *
 * That is the difference from what this replaced. The old fix let the throw be
 * honest and then announced a different face than the one the die had settled
 * on — invisible if you weren't looking, and obvious the moment somebody was.
 *
 * ## Why a copy of the world rather than a simulation of it
 *
 * A hand-built shadow world would have to reproduce the tray's colliders, its
 * materials, the die's hull, its damping, and whatever the centre of mass is
 * currently doing — and would silently stop predicting anything the day one of
 * those changed on the other side. A snapshot has no such seam: it *is* the
 * table, mid-throw, including the velocities that were just handed to the die.
 *
 * It is also cheap enough to do in the throw itself. A roll is around a hundred
 * steps of one dynamic body against six static colliders — a fraction of a
 * millisecond, taken once, on the frame the die leaps.
 *
 * ## What it will not do
 *
 * Return a face it is not sure of. A restored snapshot is very nearly, but not
 * exactly, the world it came from, and a die roll amplifies "very nearly" — a
 * few throws in ten thousand end up somewhere else. Nothing is done about that
 * on purpose: the deal is honest either way, so a missed forecast is a round
 * where the fix quietly does not happen rather than a round where the die and
 * the announcement disagree. That is the whole point of moving the fix in front
 * of the throw, and it is the failure mode worth having.
 *
 * Cocked and never-settled rolls come back null for the same reason — the app
 * nudges those and throws again from wherever they were, which is a fresh roll
 * this forecast knows nothing about. Those are worth retrying rather than
 * accepting; see FORECAST_RETRIES. And see scripts/verify-fix.ts, which measures
 * all of this against real physics rather than assuming it.
 */
export function forecastFace(
  world: World,
  /** The `World` class off the Rapier module — `useRapier().rapier.World`. */
  Rapier: { restoreSnapshot(data: Uint8Array): World },
  /** The die's body, which keeps its handle across the snapshot. */
  handle: number,
  type: DieType,
): number | null {
  let shadow: World | undefined;
  try {
    shadow = Rapier.restoreSnapshot(world.takeSnapshot());
    // Carried over by the snapshot already; set again so this reads as a
    // deliberate rate rather than as something inherited.
    shadow.timestep = PHYSICS_STEP;

    const ghost = shadow.getRigidBody(handle);
    if (!ghost) return null;

    const limit = Math.ceil(SETTLE_TIMEOUT / PHYSICS_STEP);
    let stillFrames = 0;
    let step = 0;

    // The same test the scene applies, frame for frame — see ./settle.ts.
    for (; step < limit && stillFrames < STILL_FRAMES; step++) {
      shadow.step();
      stillFrames =
        ghost.isSleeping() || isStill(ghost.linvel(), ghost.angvel())
          ? stillFrames + 1
          : 0;
    }

    // Ran out of patience. In the app that is the settle timeout, which accepts
    // whatever reading it has; here there is no reason to guess.
    if (stillFrames < STILL_FRAMES) return null;

    const r = ghost.rotation();
    const reading = readFace(type, scratchQuat.set(r.x, r.y, r.z, r.w));
    return reading.clean ? reading.value : null;
  } finally {
    // WASM memory, so this is not the garbage collector's to reclaim.
    shadow?.free();
  }
}

const scratchQuat = new THREE.Quaternion();
