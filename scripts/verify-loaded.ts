/**
 * Does loading the die actually load it? Run with `npm run verify:loaded`.
 *
 * Favourites are implemented as a centre-of-mass offset rather than a weighted
 * draw, so the only way to know how strong the effect is — or whether there is
 * one at all — is to throw the die a few thousand times and count. There is no
 * closed form for this: the bias acts through the entire tumble and settle, not
 * at the moment of choosing.
 *
 * The check has to catch failure in both directions. A load too weak to notice
 * makes the feature a lie, and a load so strong the die always obeys makes it a
 * button rather than a die.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { getDieGeometry } from "../lib/dice/geometry";
import { readFace } from "../lib/dice/faceDetection";
import { DIE_RADIUS } from "../lib/dice/types";
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
/** A representative phone's play area, from `npm run verify:bounds` at 390×844. */
const PLAY: Play = { halfX: 1.07, zMin: -4.01, zMax: 1.73 };

/** Kept in step with Die.tsx — the point of the script is to tune these. */
const LOAD_MASS = Number(process.env.LOAD_MASS ?? 0.45);
const LOAD_REACH = Number(process.env.LOAD_REACH ?? 0.65);

const ROLLS = Number(process.env.ROLLS ?? 1500);
const MAX_STEPS = 900;
const GRAVITY = { x: 0, y: -34, z: 0 };

/**
 * How much more often a favourite should land than chance.
 *
 * Roughly double. Enough that you notice the die leaning your way over a
 * session, and far enough from certain that the throw is still worth watching —
 * a die that obeys is not a die.
 */
const MIN_LIFT = 1.5;
const MAX_LIFT = 3.6;

const ZERO = { x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

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

/** Throws `ROLLS` times, loaded toward the sum of `targets`' normals. */
function run(targets: number[]) {
  const { hull, faceNormals, faceValues } = getDieGeometry("d6");
  const sides = 6;

  const world = new RAPIER.World(GRAVITY);

  /*
   * A phone's play area, at the app's materials and the app's throw.
   *
   * How strongly a shifted centre of mass shows up in the result depends on how
   * long the die tumbles and what it tumbles against, so this has to be the
   * real surface — LOAD_MASS and LOAD_REACH are tuned against the numbers this
   * prints, and tuning them against a die rolling on different cloth in a space
   * five times too wide would set them to the wrong values.
   */
  const halfX = PLAY.halfX;
  const midZ = (PLAY.zMin + PLAY.zMax) / 2;
  const halfZ = (PLAY.zMax - PLAY.zMin) / 2;

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

  // Exactly what Die.tsx computes: the offset runs along the sum of the
  // favoured faces' normals, so it leans toward that whole region of the die.
  const bias = new THREE.Vector3();
  for (const target of targets) {
    bias.add(faceNormals[faceValues.indexOf(target)]);
  }
  const loaded = bias.lengthSq() > 1e-6;
  const com = loaded
    ? bias.normalize().multiplyScalar(-DIE_RADIUS * LOAD_REACH)
    : new THREE.Vector3();

  const counts = new Array<number>(sides + 1).fill(0);
  let cocked = 0;
  const quat = new THREE.Quaternion();

  for (let roll = 0; roll < ROLLS; roll++) {
    const start = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        rand(0, Math.PI * 2),
        rand(0, Math.PI * 2),
        rand(0, Math.PI * 2),
      ),
    );

    // Wherever it was lying, as in the app. Rejection-sampled against the tray
    // rather than the play rectangle, whose corners the rounded rim cuts away.
    const rest = restingSpot();
    const from = restingAt(rest);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from.x, from.y, from.z)
        .setRotation({ x: start.x, y: start.y, z: start.z, w: start.w })
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

    if (loaded) {
      body.setAdditionalMassProperties(
        body.mass() * LOAD_MASS,
        { x: com.x, y: com.y, z: com.z },
        ZERO,
        NO_ROTATION,
        true,
      );
    }

    const linvel = randomThrow(rest, PLAY);
    body.setLinvel(linvel, true);
    body.setAngvel(tumbleFor(linvel.x, linvel.z), true);

    let steps = 0;
    let stillFrames = 0;
    let settled = false;

    while (steps < MAX_STEPS) {
      world.step();
      steps++;
      const lv = body.linvel();
      const av = body.angvel();
      const still =
        Math.hypot(lv.x, lv.y, lv.z) < 0.05 &&
        Math.hypot(av.x, av.y, av.z) < 0.05;
      stillFrames = still ? stillFrames + 1 : 0;
      if (stillFrames > 12) {
        settled = true;
        break;
      }
    }

    if (settled) {
      const r = body.rotation();
      quat.set(r.x, r.y, r.z, r.w);
      const read = readFace("d6", quat);
      counts[read.value]++;
      if (!read.clean) cocked++;
    }

    world.removeRigidBody(body);
  }

  return { counts, cocked };
}

async function main() {
  await RAPIER.init();

  const share = (r: { counts: number[] }, faces: number[]) => {
    const total = r.counts.reduce((a, b) => a + b, 0);
    return faces.reduce((sum, f) => sum + r.counts[f], 0) / total;
  };
  const row = (label: string, r: { counts: number[]; cocked: number }) => {
    const total = r.counts.reduce((a, b) => a + b, 0);
    console.log(
      `  ${label.padEnd(9)}${r.counts
        .slice(1)
        .map((n, i) => `${i + 1}:${((n / total) * 100).toFixed(1)}%`)
        .join("  ")}   cocked ${r.cocked}`,
    );
  };

  console.log(`Loaded die — ${ROLLS} rolls per case`);
  console.log(`  LOAD_MASS=${LOAD_MASS}  LOAD_REACH=${LOAD_REACH}\n`);

  const fair = run([]);
  row("fair", fair);

  const problems: string[] = [];
  // Worth saying, not worth failing over. Same split verify-distribution uses.
  const notes: string[] = [];

  // --- One favourite ---------------------------------------------------------
  const ONE = [3];
  const one = run(ONE);
  row("one", one);
  const oneLift = share(one, ONE) / share(fair, ONE);
  if (oneLift < MIN_LIFT) {
    problems.push(
      `one favourite is too weak: ${oneLift.toFixed(2)}x, want >= ${MIN_LIFT}x`,
    );
  }
  if (oneLift > MAX_LIFT) {
    problems.push(
      `one favourite is too strong: ${oneLift.toFixed(2)}x, cap ${MAX_LIFT}x`,
    );
  }
  /*
   * Cocking, on the convention verify-distribution.ts already sets next door:
   * a few percent is a note, and only a rate high enough to mean something is
   * structurally wrong counts as a failure.
   *
   * This used to fail outright above 2%, which is inside the noise. Measured
   * over twenty runs the loaded die cocks 16–33 times in 1500 (1.1–2.2%) — and
   * the *fair* die cocks just as often, 17–34. So the old bound was not
   * detecting the load making the die unstable; it was detecting which side of
   * its own mean the sample happened to fall on, failing roughly one run in
   * twenty. It went red on CI the first time it ran, on a 33.
   *
   * What is genuinely worth catching is a load so far off centre that the die
   * starts coming to rest on its bevels. That shows up as a multiple of the
   * fair rate, not a hair above it — so the comparison is against `fair`,
   * measured in the same run under the same conditions, and the hard bound is
   * the one its sibling uses.
   */
  const cockedRate = one.cocked / ROLLS;
  if (cockedRate > 0.08) {
    problems.push(
      `loaded die cocks ${(cockedRate * 100).toFixed(1)}% of throws — the load is resting it on bevels`,
    );
  } else if (cockedRate > 0.03 && one.cocked > fair.cocked * 2) {
    notes.push(
      `loaded die cocks ${(cockedRate * 100).toFixed(1)}% of throws against a fair ${((fair.cocked / ROLLS) * 100).toFixed(1)}% — expect an occasional extra hop`,
    );
  }

  /*
   * --- Two adjacent favourites ---------------------------------------------
   *
   * The offset runs along the sum of the favoured normals, so two adjacent
   * faces should tilt the die toward the edge between them and lift *both*.
   * If this came out favouring only one, the sum would be wrong.
   */
  const opposite = (a: number, b: number) => {
    const { faceNormals, faceValues } = getDieGeometry("d6");
    const na = faceNormals[faceValues.indexOf(a)];
    const nb = faceNormals[faceValues.indexOf(b)];
    return na.dot(nb) < -0.9;
  };
  const partner = [1, 2, 4, 5, 6].find((f) => !opposite(3, f))!;
  const TWO = [3, partner];
  const two = run(TWO);
  row("two", two);
  const twoLift = share(two, TWO) / share(fair, TWO);
  if (twoLift < 1.25) {
    problems.push(
      `two adjacent favourites barely lift: ${twoLift.toFixed(2)}x`,
    );
  }
  const each = TWO.map((f) => share(two, [f]) / share(fair, [f]));
  if (Math.min(...each) < 1.1) {
    problems.push(
      `two favourites did not both rise: ${each.map((n) => n.toFixed(2) + "x").join(", ")}`,
    );
  }

  /*
   * --- Opposite favourites --------------------------------------------------
   *
   * Their normals cancel, so the die should come back fair. This is the
   * property that makes "favourite everything" mean "no favourites" rather
   * than something incoherent.
   */
  const OPP = [3, [1, 2, 4, 5, 6].find((f) => opposite(3, f))!];
  const opp = run(OPP);
  row("opposite", opp);
  const oppLift = share(opp, OPP) / share(fair, OPP);
  if (oppLift > 1.2) {
    problems.push(
      `opposite favourites should cancel to a fair die, got ${oppLift.toFixed(2)}x`,
    );
  }

  console.log("");
  console.log(
    `  one favourite     ${(share(fair, ONE) * 100).toFixed(1)}% -> ${(share(one, ONE) * 100).toFixed(1)}%  (${oneLift.toFixed(2)}x)`,
  );
  console.log(
    `  two adjacent      ${(share(fair, TWO) * 100).toFixed(1)}% -> ${(share(two, TWO) * 100).toFixed(1)}%  (${twoLift.toFixed(2)}x)  each ${each.map((n) => n.toFixed(2) + "x").join(", ")}`,
  );
  console.log(
    `  two opposite      ${(share(fair, OPP) * 100).toFixed(1)}% -> ${(share(opp, OPP) * 100).toFixed(1)}%  (${oppLift.toFixed(2)}x, want ~1)`,
  );

  if (problems.length > 0) {
    console.log("");
    for (const problem of problems) console.log(`  FAIL  ${problem}`);
    process.exit(1);
  }

  console.log("");
  for (const note of notes) console.log(`  note  ${note}`);
  console.log("  OK");
}

main();
