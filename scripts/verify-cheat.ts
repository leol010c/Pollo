/**
 * A loaded die, thousands of times, with no screen attached.
 *
 * The cheat makes one claim, and it is a strong one: the throw is untouched.
 * Not toned down, not steered, not re-thrown until it agrees — the same solver
 * run, watched instead of rehearsed. That claim is only worth anything if it is
 * checked against the real Dice on the real felt, so this runs the page's own
 * throw and the page's own rig().
 *
 * It fails on any of four things:
 *
 *   1. a loaded throw that did not land on one of the allowed faces. The whole
 *      thing rests on the watched roll being the rehearsed roll, and this is
 *      what says it is;
 *   2. the solid favouring a side while it is being loaded. The printing is
 *      allowed to be rigged; the *physics* has to stay as flat as it was, or
 *      the tumble itself is carrying the answer and anyone watching it fall a
 *      hundred times could tell;
 *   3. dice needing to be laid flat more often than honest ones do;
 *   4. the same throw thrown twice, from the same wound state, going anywhere
 *      different. Every step is compared, not just the last one.
 *
 * Run with: pnpm verify:cheat
 */

import { Dice, type Roller } from "../src/roll";
import { rig, showing } from "../src/cheat";
import { PHYSICS_STEP } from "../src/physics";
import { SETTLE_TIMEOUT } from "../src/settle";
import { readFace } from "../src/faces";
import { playFor } from "../src/framing";
import type { Play } from "../src/throw";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1440, height: 900 },
];

const ROUNDS_PER_TABLE = 500;

/** The honest die is laid flat on about 1% of throws; this is the same limit. */
const CORRECTED_LIMIT = 0.02;

/** Chi-square at five degrees of freedom, p = 0.001. As verify-roll. */
const CHI_SQUARE_LIMIT = 20.515;

const maxSteps = Math.ceil((SETTLE_TIMEOUT + 1) / PHYSICS_STEP);

/** A different set of allowed faces every round, including single ones. */
function wanted(): number[] {
  const size = 1 + Math.floor(Math.random() * 3);
  const set = new Set<number>();
  while (set.size < size) set.add(1 + Math.floor(Math.random() * 6));
  return [...set];
}

interface Tally {
  /** Which side of the solid finished up, printing aside. */
  sides: number[];
  landed: number;
  missed: number;
  corrected: number;
  turned: number;
}

const blank = (): Tally => ({ sides: [0, 0, 0, 0, 0, 0], landed: 0, missed: 0, corrected: 0, turned: 0 });

function run(play: Play, rounds: number) {
  const dice = new Dice(play);
  const what = dice.add();
  const where = dice.add();
  what.rest({ x: -0.95, z: play.halfZ * 0.28 });
  where.rest({ x: 0.95, z: play.halfZ * 0.28 });

  const tallies: Record<string, Tally> = { what: blank(), where: blank() };
  const misses: string[] = [];

  const throwOne = (name: string, thrown: Roller, other: Roller, round: number) => {
    const tally = tallies[name]!;
    const allowed = wanted();
    const before = thrown.facing;

    // Both gestures the page has: half the throws are taps, half are flicks.
    const clear = { x: other.body.position.x, z: other.body.position.z };
    if (round % 2 === 0) thrown.throwDie(undefined, clear);
    else thrown.flickDie({ x: (Math.random() - 0.5) * 6, z: -Math.random() * 6 }, clear);
    rig(dice, thrown, allowed);
    if (thrown.facing !== before) tally.turned++;

    for (let steps = 0; dice.rolling && steps < maxSteps; steps++) dice.step(PHYSICS_STEP);

    const result = thrown.result;
    if (!result) {
      misses.push(`round ${round} ${name}: no reading at all`);
      tally.missed++;
      return;
    }

    tally.landed++;
    tally.sides[readFace(thrown.body.quaternion).index]! += 1;
    if (result.corrected) tally.corrected++;

    if (!allowed.includes(result.value)) {
      tally.missed++;
      if (misses.length < 4) {
        misses.push(`round ${round} ${name}: asked for ${allowed.join("/")}, got ${result.value}`);
      }
    }
    // The placard reads the die the same way the cheat expects it to be read.
    const printed = showing(readFace(thrown.body.quaternion).index, thrown.facing);
    if (printed !== result.value) {
      misses.push(`round ${round} ${name}: die shows ${printed}, result says ${result.value}`);
    }
  };

  for (let round = 0; round < rounds; round++) {
    throwOne("what", what, where, round);
    throwOne("where", where, what, round);
  }

  return { tallies, misses };
}

/**
 * The same throw, twice, step by step.
 *
 * foretell() rehearses a throw and then rewinds it, and everything the cheat
 * claims depends on the rewound throw being the rehearsed one down to the last
 * bit. Here the rehearsal is recorded and the second run compared against it.
 */
function replays(play: Play, rounds: number): string[] {
  const trouble: string[] = [];

  for (let round = 0; round < rounds; round++) {
    const dice = new Dice(play);
    const die = dice.add();
    const other = dice.add();
    die.rest({ x: -0.95, z: play.halfZ * 0.28 });
    other.rest({ x: 0.95, z: play.halfZ * 0.28 });

    die.throwDie(undefined, { x: other.body.position.x, z: other.body.position.z });

    const track: number[][] = [];
    for (let steps = 0; dice.rolling && steps < maxSteps; steps++) {
      dice.step(PHYSICS_STEP);
      const { position: p, quaternion: q } = die.body;
      track.push([p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
    }

    die.rewind();

    for (let steps = 0; dice.rolling && steps < maxSteps; steps++) {
      dice.step(PHYSICS_STEP);
      const { position: p, quaternion: q } = die.body;
      const then = track[steps];
      const now = [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
      if (!then || then.some((value, i) => value !== now[i])) {
        trouble.push(`round ${round}: step ${steps} differs on the second run`);
        break;
      }
    }
    if (track.length > 0 && trouble.length === 0 && die.result === null) {
      trouble.push(`round ${round}: the second run never finished`);
    }
  }

  return trouble;
}

function chiSquare(sides: number[], landed: number): number {
  const expected = landed / 6;
  let total = 0;
  for (const count of sides) {
    const diff = count - expected;
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
  console.log(`\n${name} ${width}x${height}`);

  const started = Date.now();
  const { tallies, misses } = run(play, ROUNDS_PER_TABLE);

  for (const [die, tally] of Object.entries(tallies)) {
    const spread = tally.sides.map((count, i) => `${i}:${String(count).padStart(3)}`).join(" ");
    const chi = chiSquare(tally.sides, tally.landed);

    console.log(
      `  ${die.padEnd(5)} sides ${spread}` +
        `   chi ${chi.toFixed(2).padStart(5)}` +
        `   turned ${((tally.turned / tally.landed) * 100).toFixed(0)}%` +
        `   laid flat ${((tally.corrected / tally.landed) * 100).toFixed(1)}%` +
        `   missed ${tally.missed}`,
    );

    if (tally.missed > 0) fail(`${die}: ${tally.missed} loaded throws did not do as they were told`);
    if (chi > CHI_SQUARE_LIMIT) fail(`${die}: the solid is favouring a side, chi-square ${chi.toFixed(2)}`);
    if (tally.corrected / tally.landed > CORRECTED_LIMIT) {
      fail(`${die}: laid flat on ${((tally.corrected / tally.landed) * 100).toFixed(1)}% of throws`);
    }
  }

  for (const miss of misses.slice(0, 4)) console.error(`        ${miss}`);

  const trouble = replays(play, 60);
  console.log(
    `  60 throws rehearsed and thrown again, step for step   ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s wall`,
  );
  for (const line of trouble.slice(0, 3)) fail(line);
}

console.log("");
if (failed) process.exit(1);
console.log("all good\n");
