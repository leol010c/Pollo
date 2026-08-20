/**
 * Thousands of throws, with no screen attached.
 *
 * The page makes one promise — throw a die and it lands on a side — and that is
 * a claim about the physics, not about the rendering. This runs the real Dice
 * on the real felt, in the real order (a position, then a place, then a
 * position again, with the other die sitting where it last stopped), and fails
 * on any of the four ways the promise breaks: a throw that never stops, a die
 * that leaves the table, a die that has to be laid flat too often, and a die
 * that favours a face.
 *
 * The second die is the reason the order matters. A throw onto an empty felt
 * and a throw onto a felt with something already on it are not the same throw,
 * and only one of them is the one anybody makes.
 *
 * Run with: pnpm verify
 */

import { Dice, type Roller } from "../src/roll";
import { PHYSICS_STEP, DIE_HALF } from "../src/physics";
import { SETTLE_TIMEOUT } from "../src/settle";
import { playFor } from "../src/framing";
import type { Play } from "../src/throw";

/**
 * Real viewports, run through the page's own framing, so these are the tables
 * the dice are actually thrown on rather than three convenient rectangles.
 */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1440, height: 900 },
];

/** Each round is two throws: what, then where. */
const ROUNDS_PER_TABLE = 500;

/** How often a die may need laying flat before the throw is not good enough. */
const CORRECTED_LIMIT = 0.02;

/**
 * Chi-square at five degrees of freedom, p = 0.001.
 *
 * Loose enough that a fair die practically never trips it by chance, tight
 * enough to catch a die that leans — a bias big enough to notice while playing
 * is far past this.
 */
const CHI_SQUARE_LIMIT = 20.515;

interface Tally {
  faces: number[];
  landed: number;
  corrected: number;
  slowest: number;
  totalSeconds: number;
  timeouts: number;
}

const blank = (): Tally => ({
  faces: [0, 0, 0, 0, 0, 0, 0],
  landed: 0,
  corrected: 0,
  slowest: 0,
  totalSeconds: 0,
  timeouts: 0,
});

function run(play: Play, rounds: number) {
  const dice = new Dice(play);
  const what = dice.add();
  const where = dice.add();
  what.rest({ x: -0.95, z: play.halfZ * 0.28 });
  where.rest({ x: 0.95, z: play.halfZ * 0.28 });

  const tallies: Record<string, Tally> = { what: blank(), where: blank() };
  const escapes: string[] = [];
  let closest = Infinity;

  // A little past the rail, since a die resting against it is legitimately
  // half its width beyond the plane.
  const outX = play.halfX + DIE_HALF * 1.8;
  const outZ = play.halfZ + DIE_HALF * 1.8;
  const maxSteps = Math.ceil((SETTLE_TIMEOUT + 1) / PHYSICS_STEP);

  const throwOne = (name: string, thrown: Roller, other: Roller, round: number) => {
    const tally = tallies[name]!;
    thrown.throwDie(undefined, {
      x: other.body.position.x,
      z: other.body.position.z,
    });

    for (let steps = 0; dice.rolling && steps < maxSteps; steps++) {
      dice.step(PHYSICS_STEP);
      const { x, y, z } = thrown.body.position;
      if (Math.abs(x) > outX || Math.abs(z) > outZ || y < -0.2 || y > 14) {
        escapes.push(
          `round ${round} ${name}: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
        );
        break;
      }
    }

    const result = thrown.result;
    if (!result) {
      tally.timeouts++;
      return;
    }

    tally.landed++;
    tally.faces[result.value]! += 1;
    if (result.corrected) tally.corrected++;
    tally.totalSeconds += result.seconds;
    tally.slowest = Math.max(tally.slowest, result.seconds);

    // Two dice inside one another would mean a correction pushed one through
    // the other. Measured in three dimensions on purpose: a die that came to
    // rest on top of its neighbour is directly above it and perfectly legal.
    closest = Math.min(
      closest,
      Math.hypot(
        what.body.position.x - where.body.position.x,
        what.body.position.y - where.body.position.y,
        what.body.position.z - where.body.position.z,
      ),
    );
  };

  for (let round = 0; round < rounds; round++) {
    throwOne("what", what, where, round);
    throwOne("where", where, what, round);
  }

  return { tallies, escapes, closest };
}

function chiSquare(faces: number[], landed: number): number {
  const expected = landed / 6;
  let total = 0;
  for (let value = 1; value <= 6; value++) {
    const diff = faces[value]! - expected;
    total += (diff * diff) / expected;
  }
  return total;
}

let failed = false;

const fail = (message: string) => {
  failed = true;
  console.error(`  FAIL  ${message}`);
};

for (const { name, width, height } of VIEWPORTS) {
  const play = playFor(width / height);
  console.log(
    `\n${name} ${width}x${height}` +
      `  felt ${(play.halfX * 2).toFixed(1)} x ${(play.halfZ * 2).toFixed(1)} units`,
  );

  const started = Date.now();
  const { tallies, escapes, closest } = run(play, ROUNDS_PER_TABLE);

  for (const [die, tally] of Object.entries(tallies)) {
    const spread = tally.faces
      .slice(1)
      .map((count, i) => `${i + 1}:${String(count).padStart(3)}`)
      .join(" ");
    const chi = chiSquare(tally.faces, tally.landed);

    console.log(
      `  ${die.padEnd(5)} ${spread}` +
        `   chi ${chi.toFixed(2).padStart(5)}` +
        `   mean ${(tally.totalSeconds / tally.landed).toFixed(2)}s` +
        `   slowest ${tally.slowest.toFixed(2)}s` +
        `   laid flat ${((tally.corrected / tally.landed) * 100).toFixed(1)}%`,
    );

    if (tally.timeouts > 0) fail(`${die}: ${tally.timeouts} throws produced no reading`);
    if (tally.corrected / tally.landed > CORRECTED_LIMIT) {
      fail(
        `${die}: laid flat on ${((tally.corrected / tally.landed) * 100).toFixed(1)}%` +
          ` of throws (limit ${CORRECTED_LIMIT * 100}%)`,
      );
    }
    if (chi > CHI_SQUARE_LIMIT) fail(`${die}: not a flat distribution, chi-square ${chi.toFixed(2)}`);
  }

  console.log(
    `  dice came within ${closest.toFixed(2)} units of each other` +
      `   ${((Date.now() - started) / 1000).toFixed(1)}s wall`,
  );

  if (escapes.length > 0) {
    fail(`${escapes.length} throws left the table`);
    for (const escape of escapes.slice(0, 3)) console.error(`        ${escape}`);
  }
  // Two axis-aligned one-unit cubes resting on or beside each other have their
  // centres one unit apart; tilted ones can legitimately be a little closer.
  if (closest < DIE_HALF * 2 * 0.82) fail(`dice overlapped: centres ${closest.toFixed(2)} apart`);
}

console.log("");
if (failed) process.exit(1);
console.log("all good\n");
