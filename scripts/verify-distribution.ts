/**
 * End-to-end physics check, run headlessly with `npm run verify:distribution`.
 *
 * This exercises the real pipeline — the same convex hulls, the same throw
 * impulses, the same readFace() — against Rapier in Node. It is the only test
 * that can catch a die whose collider does not match its mesh, or whose face
 * normals are rotated relative to its numerals.
 *
 * Note on what this proves: true-physics dice are not perfectly uniform, and
 * this is not a fairness proof. It is looking for a *broken* die — a face that
 * never lands, or one that dominates — plus dice that fail to settle at all.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { getDieGeometry } from "../lib/dice/geometry";
import { readFace } from "../lib/dice/faceDetection";
import { isStill, STILL_FRAMES } from "../lib/dice/settle";
import { DIE_SIDES, DIE_TYPES, type DieType } from "../lib/dice/types";
import {
  restingAt,
  randomThrow,
  tumbleFor,
  type Play,
} from "../lib/dice/throw";
import {
  DIE_ANGULAR_DAMPING,
  DIE_DENSITY,
  DIE_LINEAR_DAMPING,
  DIE_SURFACE,
  FELT_SURFACE,
  RIM_SURFACE,
} from "../lib/scene/physics";

const ROLLS = Number(process.env.ROLLS ?? 1000);
const MAX_STEPS = 900;
const GRAVITY = { x: 0, y: -34, z: 0 };

/**
 * A representative phone's play area, from `npm run verify:bounds` at 390×844.
 *
 * Both the throw and the tray are built from these, so the die is thrown the
 * distance it is really thrown, into walls that are really where they are.
 */
const PLAY_HALF_X = 1.07;
const PLAY_Z_MIN = -4.01;
const PLAY_Z_MAX = 1.73;
const PLAY: Play = {
  halfX: PLAY_HALF_X,
  zMin: PLAY_Z_MIN,
  zMax: PLAY_Z_MAX,
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** Somewhere the die could genuinely be lying, anywhere on screen. */
function restingSpot(): { x: number; z: number } {
  return {
    x: rand(-PLAY.halfX, PLAY.halfX),
    z: rand(PLAY.zMin, PLAY.zMax),
  };
}

interface Outcome {
  counts: number[];
  cocked: number;
  neverSettled: number;
  escaped: number;
  meanSteps: number;
}

function runType(type: DieType): Outcome {
  const sides = DIE_SIDES[type];
  const { hull } = getDieGeometry(type);

  const world = new RAPIER.World(GRAVITY);

  /*
   * A phone's play area, at the phone's materials.
   *
   * This used to be 5.4 × 3.1 — nearly five times the width a phone actually
   * gives the die — under a comment claiming it matched the scene. On a surface
   * that size the die rarely touched a wall, so nothing here exercised the
   * bouncing, which is now most of what a throw does. The materials are
   * imported for the same reason: they had already drifted, with the die
   * simulated at restitution 0.32 against 0.34 in the app.
   */
  const halfX = PLAY_HALF_X;
  const midZ = (PLAY_Z_MIN + PLAY_Z_MAX) / 2;
  const halfZ = (PLAY_Z_MAX - PLAY_Z_MIN) / 2;

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX + 2, 0.25, halfZ + 2)
      .setTranslation(0, -0.25, midZ)
      .setFriction(FELT_SURFACE.friction)
      .setRestitution(FELT_SURFACE.restitution),
  );

  // The screen's edges, as four walls — the same arrangement the scene has.
  for (const [x, z, sx, sz] of [
    [halfX + 0.5, midZ, 0.5, halfZ + 1],
    [-halfX - 0.5, midZ, 0.5, halfZ + 1],
    [0, PLAY.zMax + 0.5, halfX + 1, 0.5],
    [0, PLAY.zMin - 0.5, halfX + 1, 0.5],
  ]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx, 5, sz)
        .setTranslation(x, 5, z)
        .setFriction(RIM_SURFACE.friction)
        .setRestitution(RIM_SURFACE.restitution),
    );
  }

  const counts = new Array<number>(sides + 1).fill(0);
  let cocked = 0;
  let neverSettled = 0;
  let escaped = 0;
  let totalSteps = 0;

  const quat = new THREE.Quaternion();

  for (let roll = 0; roll < ROLLS; roll++) {
    // Start from a uniformly random attitude. In the app a die keeps whatever
    // orientation it last landed in; spawning every test roll from identity
    // would measure that one starting pose rather than the physics.
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        rand(0, Math.PI * 2),
        rand(0, Math.PI * 2),
        rand(0, Math.PI * 2),
      ),
    );

    /*
     * A die lying somewhere on screen, thrown from exactly there.
     *
     * The resting spot is randomised across the whole surface because the aim
     * depends on it — the throw goes to whichever edge is further away, so a
     * die already at the far end is thrown back the other way.
     */
    const rest = restingSpot();
    const from = restingAt(rest);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(from.x, from.y, from.z)
      .setRotation({ x: start.x, y: start.y, z: start.z, w: start.w })
      .setLinearDamping(DIE_LINEAR_DAMPING)
      .setAngularDamping(DIE_ANGULAR_DAMPING)
      .setCcdEnabled(true);
    const body = world.createRigidBody(bodyDesc);

    world.createCollider(
      RAPIER.ColliderDesc.convexHull(hull)!
        .setDensity(DIE_DENSITY)
        .setFriction(DIE_SURFACE.friction)
        .setRestitution(DIE_SURFACE.restitution),
      body,
    );

    /*
     * The real launch profile, imported rather than copied.
     *
     * This used to be two hand-written rand() ranges under a comment claiming
     * they matched Die.tsx. That was tolerable while the spin was three
     * independent random axes — but the tumble is now derived from the throw
     * direction, and a spin correlated with the velocity is exactly the kind of
     * thing that can bias which face lands. A check holding its own copy of the
     * launch could never see that, so it holds none.
     *
     * The play area passed in is a representative phone's, since what is under
     * test is the shape of the throw rather than any one viewport.
     */
    const linvel = randomThrow(rest, PLAY);
    body.setLinvel(linvel, true);
    body.setAngvel(tumbleFor(linvel.x, linvel.z), true);

    let steps = 0;
    let settled = false;
    let stillFrames = 0;

    while (steps < MAX_STEPS) {
      world.step();
      steps++;

      // The app's own test for a die that has stopped, imported for the same
      // reason the throw and the materials are — see lib/dice/settle.ts.
      stillFrames =
        body.isSleeping() || isStill(body.linvel(), body.angvel())
          ? stillFrames + 1
          : 0;

      if (stillFrames >= STILL_FRAMES) {
        settled = true;
        break;
      }
    }

    totalSteps += steps;

    const t = body.translation();
    // Anything outside the tray or below the floor tunnelled through. Measured
    // from the tray's own centre, which is not the origin — the play area sits
    // behind it, so testing |z| would have started reporting escapes as soon as
    // the die got near the far wall it is now deliberately aimed at.
    if (
      Math.abs(t.x) > halfX + 1 ||
      Math.abs(t.z - midZ) > halfZ + 1 ||
      t.y < -0.5
    ) {
      escaped++;
    }

    if (!settled) {
      neverSettled++;
    } else {
      const r = body.rotation();
      quat.set(r.x, r.y, r.z, r.w);
      const reading = readFace(type, quat);
      if (!reading.clean) cocked++;
      counts[reading.value]++;
    }

    world.removeRigidBody(body);
  }

  return {
    counts,
    cocked,
    neverSettled,
    escaped,
    meanSteps: totalSteps / ROLLS,
  };
}

async function main() {
  await RAPIER.init();

  let failures = 0;
  console.log(`Rolling ${ROLLS} of each die type…\n`);

  for (const type of DIE_TYPES) {
    const sides = DIE_SIDES[type];
    const { counts, cocked, neverSettled, escaped, meanSteps } = runType(type);

    const landed = counts.slice(1);
    const expected = ROLLS / sides;
    const missing = landed.filter((c) => c === 0).length;
    const min = Math.min(...landed);
    const max = Math.max(...landed);

    console.log(`${type}  (expected ~${expected.toFixed(0)} per face)`);
    console.log(`  faces: ${landed.join(", ")}`);
    console.log(
      `  min ${min}  max ${max}  cocked ${cocked}  unsettled ${neverSettled}  escaped ${escaped}  mean steps ${meanSteps.toFixed(0)}`,
    );

    const problems: string[] = [];
    const notes: string[] = [];

    // A face that never lands means broken geometry, not bad luck.
    if (missing > 0) problems.push(`${missing} face(s) never landed`);
    if (escaped > 0) problems.push(`${escaped} die/dice left the tray`);
    // Some slow settles are fine; a lot means the thresholds are wrong.
    if (neverSettled > ROLLS * 0.02)
      problems.push(`${neverSettled} failed to settle`);

    /*
     * Cocked readings are counted at first settle, with no nudging — but the
     * app nudges up to four times before accepting one, so the chance of a
     * cocked value actually being reported is this rate to the fifth power.
     * Vanishing.
     *
     * What the rate really predicts is how often the die visibly hops again
     * before coming to rest, which is a matter of polish. So a few percent is
     * a note, and only a rate high enough to mean the geometry or the
     * alignment threshold is wrong counts as a failure.
     */
    const cockedRate = cocked / ROLLS;
    if (cockedRate > 0.08) {
      problems.push(
        `${(cockedRate * 100).toFixed(1)}% cocked — bevels are resting stable`,
      );
    } else if (cockedRate > 0.03) {
      notes.push(
        `${(cockedRate * 100).toFixed(1)}% cocked; expect an occasional extra hop`,
      );
    }
    // Very loose bound — catches a dominant face, not mild physical bias.
    if (max > expected * 2.2 || min < expected * 0.3)
      problems.push(`face distribution badly skewed (${min}–${max})`);

    if (problems.length) {
      failures++;
      console.log(`  FAIL  ${problems.join("; ")}\n`);
    } else if (notes.length) {
      console.log(`  ok    (${notes.join("; ")})\n`);
    } else {
      console.log(`  ok\n`);
    }
  }

  console.log(
    failures === 0
      ? "All dice behave.\n"
      : `${failures} die type(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
