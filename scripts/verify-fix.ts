/**
 * The fix, against real physics — run headlessly with `npm run verify:fix`.
 *
 * The fix on the die is a forecast: the throw is real and is left alone, a copy
 * of the world is run to the end of the roll, and the chosen position is dealt
 * onto the face that copy says will be up. Everything about that is checked
 * elsewhere except the one claim it all rests on, which is physical rather than
 * logical and cannot be checked by reasoning about the code:
 *
 *   **the face the forecast names is the face the die comes to rest on.**
 *
 * If that drifts, nothing breaks and nothing throws. The fix simply stops
 * working some of the time, silently, in the one situation where nobody is going
 * to be watching a debugger. So it is measured.
 *
 * A restored snapshot is very nearly — not exactly — the world it came from, and
 * a die roll amplifies "very nearly": measured over ten thousand throws, six
 * ended up somewhere the forecast did not expect. That is why this asserts a
 * rate rather than perfection, and why the app is written so a missed forecast
 * is a round where the fix quietly does not happen rather than one where the die
 * and the announcement disagree.
 *
 * The tray is built here the way Tray.tsx builds it, from the bounds the phone
 * really gets, because the fix has to survive the die bouncing off things.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { getDieGeometry } from "../lib/dice/geometry";
import { readFace } from "../lib/dice/faceDetection";
import { forecastFace, FORECAST_RETRIES } from "../lib/dice/forecast";
import { isStill, SETTLE_TIMEOUT, STILL_FRAMES } from "../lib/dice/settle";
import { DIE_TYPES, type DieType } from "../lib/dice/types";
import { computeTrayBounds, type TrayBounds } from "../lib/scene/bounds";
import { restingAt, randomThrow, tumbleFor } from "../lib/dice/throw";
import {
  DIE_ANGULAR_DAMPING,
  DIE_DENSITY,
  DIE_LINEAR_DAMPING,
  DIE_SURFACE,
  FELT_SURFACE,
  PHYSICS_STEP,
  RIM_SURFACE,
} from "../lib/scene/physics";

const ROLLS = Number(process.env.ROLLS ?? 400);

/**
 * How often the forecast has to be right.
 *
 * Measured at 99.94% across all five solids, ten thousand throws. The bar sits
 * well below that so an ordinary run never flakes, and far enough above chance —
 * a d4 would reach 25% by guessing — that anything actually broken lands
 * underneath it with room to spare.
 */
const MIN_HIT_RATE = 0.98;

/** A phone in portrait, which is the shape this app is really played in. */
const ASPECT = 390 / 844;

const GRAVITY = { x: 0, y: -34, z: 0 };

// Tray.tsx's own numbers. The walls stand on the play boundary, so a die that
// bounces here bounces where it bounces on the phone.
const FLOOR_EXTENT = 60;
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 0.5;
const CEILING = 8;

function buildTray(bounds: TrayBounds) {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = PHYSICS_STEP;

  const midZ = (bounds.zMin + bounds.zMax) / 2;
  const halfZ = (bounds.zMax - bounds.zMin) / 2;
  const spanX = bounds.halfX + WALL_THICKNESS * 2;
  const spanZ = halfZ + WALL_THICKNESS * 2;

  const felt = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(FLOOR_EXTENT / 2, 0.25, FLOOR_EXTENT / 2)
      .setTranslation(0, -0.25, midZ)
      .setFriction(FELT_SURFACE.friction)
      .setRestitution(FELT_SURFACE.restitution),
    felt,
  );

  const rim = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const walls: [number[], number[]][] = [
    [
      [WALL_THICKNESS, WALL_HEIGHT, spanZ],
      [bounds.halfX + WALL_THICKNESS, WALL_HEIGHT, midZ],
    ],
    [
      [WALL_THICKNESS, WALL_HEIGHT, spanZ],
      [-bounds.halfX - WALL_THICKNESS, WALL_HEIGHT, midZ],
    ],
    [
      [spanX, WALL_HEIGHT, WALL_THICKNESS],
      [0, WALL_HEIGHT, bounds.zMax + WALL_THICKNESS],
    ],
    [
      [spanX, WALL_HEIGHT, WALL_THICKNESS],
      [0, WALL_HEIGHT, bounds.zMin - WALL_THICKNESS],
    ],
    // The lid, so a hard throw cannot leave over the top.
    [
      [spanX, WALL_THICKNESS, spanZ],
      [0, CEILING, midZ],
    ],
  ];

  for (const [size, at] of walls) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0], size[1], size[2])
        .setTranslation(at[0], at[1], at[2])
        .setFriction(RIM_SURFACE.friction)
        .setRestitution(RIM_SURFACE.restitution),
      rim,
    );
  }

  return world;
}

/** The die, built the way Die.tsx builds it. */
function addDie(world: RAPIER.World, type: DieType, bounds: TrayBounds) {
  const { hull } = getDieGeometry(type);
  const at = restingAt({ x: bounds.home[0], z: bounds.home[2] });

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y, at.z)
      .setLinearDamping(DIE_LINEAR_DAMPING)
      .setAngularDamping(DIE_ANGULAR_DAMPING)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.convexHull(hull)!
      .setDensity(DIE_DENSITY)
      .setFriction(DIE_SURFACE.friction)
      .setRestitution(DIE_SURFACE.restitution),
    body,
  );
  return body;
}

const scratch = new THREE.Quaternion();

/** The scene's settle test, run over a world stepped by hand. */
function runToRest(world: RAPIER.World, body: RAPIER.RigidBody, type: DieType) {
  const limit = Math.ceil(SETTLE_TIMEOUT / PHYSICS_STEP);
  let stillFrames = 0;

  for (let step = 0; step < limit && stillFrames < STILL_FRAMES; step++) {
    world.step();
    stillFrames =
      body.isSleeping() || isStill(body.linvel(), body.angvel())
        ? stillFrames + 1
        : 0;
  }

  const r = body.rotation();
  return readFace(type, scratch.set(r.x, r.y, r.z, r.w));
}

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) return;
  console.error(`  FAIL  ${message}`);
  failures++;
}

async function main() {
  await RAPIER.init();
  console.log(
    `The fix — does the forecast name the face the die stops on?\n` +
      `Throwing ${ROLLS} of each solid on a ${Math.round(ASPECT * 1000) / 1000} screen…\n`,
  );

  const bounds = computeTrayBounds(ASPECT);

  for (const type of DIE_TYPES) {
    const world = buildTray(bounds);
    const die = addDie(world, type, bounds);
    // Let it come to rest first, so every throw starts from a die lying on the
    // cloth — which is the only state the app ever throws from.
    runToRest(world, die, type);

    let called = 0;
    let right = 0;
    let disturbed = 0;
    let elapsed = 0;
    let looks = 0;

    for (let roll = 0; roll < ROLLS; roll++) {
      const p = die.translation();
      const from = { x: p.x, z: p.z };
      const another = () => {
        const linvel = randomThrow(from, bounds);
        return { linvel, angvel: tumbleFor(linvel.x, linvel.z) };
      };

      /*
       * throwWith's loop, with the same retry — see Die.tsx.
       *
       * Nothing is stepped inside it, so this is one throw being reconsidered
       * before it happens rather than the die being thrown four times.
       */
      let velocity = another();
      let forecast: number | null = null;

      for (let attempt = 0; ; attempt++) {
        die.wakeUp();
        die.setLinvel(velocity.linvel, true);
        die.setAngvel(velocity.angvel, true);

        // The forecast must be a spectator. If reading the world ahead nudged
        // the die in it, every throw would be subtly the app's own doing.
        const before = snapshotOf(die);
        const started = performance.now();
        forecast = forecastFace(world, RAPIER.World, die.handle, type);
        elapsed += performance.now() - started;
        looks++;
        if (!sameState(before, snapshotOf(die))) disturbed++;

        if (forecast !== null || attempt >= FORECAST_RETRIES) break;
        velocity = another();
      }

      const landed = runToRest(world, die, type);

      if (forecast !== null) {
        called++;
        if (forecast === landed.value) right++;
      }
    }

    const rate = called > 0 ? right / called : 0;
    console.log(
      `  ${type}: forecast right on ${right}/${called} of the throws it called ` +
        `(${(rate * 100).toFixed(1)}%), ` +
        `${ROLLS - called} left uncalled, ` +
        `${(looks / ROLLS).toFixed(2)} looks per throw at ` +
        `${(elapsed / looks).toFixed(2)}ms each`,
    );

    check(
      ROLLS - called <= 1,
      `${type}: the fix could not call ${ROLLS - called} of ${ROLLS} throws — ` +
        `with ${FORECAST_RETRIES} retries it should run out of cocked ones`,
    );
    check(
      rate >= MIN_HIT_RATE,
      `${type}: the forecast was right ${(rate * 100).toFixed(1)}% of the time, ` +
        `under the ${(MIN_HIT_RATE * 100).toFixed(0)}% this needs to be a fix`,
    );
    check(
      disturbed === 0,
      `${type}: the forecast moved the die it was reading, on ${disturbed} throws`,
    );

    world.free();
  }

  if (failures > 0) {
    console.error(`\n${failures} problem(s) with the fix.`);
    process.exit(1);
  }
  console.log("\n  OK  the die lands where the fix says it will");
}

interface State {
  t: { x: number; y: number; z: number };
  r: { x: number; y: number; z: number; w: number };
  lv: { x: number; y: number; z: number };
  av: { x: number; y: number; z: number };
}

function snapshotOf(body: RAPIER.RigidBody): State {
  return {
    t: { ...body.translation() },
    r: { ...body.rotation() },
    lv: { ...body.linvel() },
    av: { ...body.angvel() },
  };
}

function sameState(a: State, b: State) {
  return JSON.stringify(a) === JSON.stringify(b);
}

main();
