/**
 * The stake is counted in the right unit, and doubling it behaves.
 * Run with `npm run verify:stake`.
 *
 * The gamble used to be a duration for everything, so there was one unit and
 * nothing to get wrong. Now the unit is a property of the position — strokes
 * for most of the deck, a clock for the slow and mutual ones — and that
 * introduces exactly the kind of seam worth checking headlessly:
 *
 *  - a timed stake needs a deadline and a counted one must not have one, since
 *    an `endsAt` on a count would start a countdown nobody asked for and the
 *    number would silently drain away while it was being worked through;
 *  - double-or-nothing has to fall back to *that measure's* floor, and a single
 *    shared floor was the obvious first mistake — 30 strokes is not the same
 *    concession as 30 seconds;
 *  - the floors claim in their doc comment to be the smallest thing on their
 *    own wheel, and a claim in a comment is worth nothing unless something
 *    checks it.
 *
 * Math.random is stubbed rather than sampled, so both sides of the coin are
 * exercised deterministically instead of hoping a run sees each.
 */
import { useDiceStore, DOUBLE_OR_NOTHING_FLOOR, STAKES } from "../lib/store";
import { POSITIONS, type Measure } from "../lib/dice/deck";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

const store = useDiceStore;
const MEASURES: Measure[] = ["strokes", "time"];

/** Runs `fn` with the coin forced one way. */
function withCoin<T>(win: boolean, fn: () => T): T {
  const real = Math.random;
  Math.random = () => (win ? 0.0 : 0.99);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

console.log("Stake — the unit comes from the position, and doubling behaves\n");

// --- The wheels ------------------------------------------------------------
for (const measure of MEASURES) {
  const wheel = STAKES[measure];
  check(wheel.length > 0, `${measure}: wheel is empty`);
  check(
    wheel.every((n) => Number.isInteger(n) && n > 0),
    `${measure}: wheel has a non-positive or fractional entry`,
  );
  // The floor is what a lost double drops to, and dropping somebody *below*
  // the cheapest thing the wheel could have given them would make losing worse
  // than never having spun.
  check(
    DOUBLE_OR_NOTHING_FLOOR[measure] === Math.min(...wheel),
    `${measure}: floor ${DOUBLE_OR_NOTHING_FLOOR[measure]} is not the wheel's smallest (${Math.min(...wheel)})`,
  );
  console.log(
    `  ${measure.padEnd(7)} wheel ${wheel.join(", ")}   floor ${DOUBLE_OR_NOTHING_FLOOR[measure]}`,
  );
}

// --- A deadline, only where there is a clock -------------------------------
for (const measure of MEASURES) {
  store.setState({ stake: null });
  store.getState().startStake(measure, 40);
  const stake = store.getState().stake;

  check(stake !== null, `${measure}: startStake did not take`);
  check(stake?.measure === measure, `${measure}: stake recorded another unit`);
  check(stake?.amount === 40, `${measure}: stake recorded another amount`);

  if (measure === "time") {
    check(
      typeof stake?.endsAt === "number" && stake.endsAt > Date.now(),
      "time: a timed stake has no deadline in the future",
    );
  } else {
    check(
      stake?.endsAt === undefined,
      "strokes: a counted stake was given a deadline it would drain against",
    );
  }
}

// --- Doubling, and the floor it falls to -----------------------------------
for (const measure of MEASURES) {
  // Won: twice as much, and still the same unit.
  store.setState({ stake: null });
  store.getState().startStake(measure, 40);
  withCoin(true, () => store.getState().doubleOrNothing());
  let stake = store.getState().stake;
  check(stake?.amount === 80, `${measure}: a won double did not double 40`);
  check(stake?.won === true, `${measure}: a won double was not recorded as won`);
  check(stake?.gambled === true, `${measure}: double was not marked as taken`);
  check(stake?.measure === measure, `${measure}: doubling changed the unit`);

  // Lost: down to this measure's own floor, not the other one's.
  store.setState({ stake: null });
  store.getState().startStake(measure, 100);
  withCoin(false, () => store.getState().doubleOrNothing());
  stake = store.getState().stake;
  check(
    stake?.amount === DOUBLE_OR_NOTHING_FLOOR[measure],
    `${measure}: a lost double fell to ${stake?.amount}, not the floor ${DOUBLE_OR_NOTHING_FLOOR[measure]}`,
  );
  check(stake?.won === false, `${measure}: a lost double was not recorded`);

  // A timed stake that has been re-staked needs its deadline moved with it,
  // or the clock keeps running against the amount it replaced.
  if (measure === "time") {
    check(
      typeof stake?.endsAt === "number" && stake.endsAt > Date.now(),
      "time: a lost double left the old deadline in place",
    );
  } else {
    check(
      stake?.endsAt === undefined,
      "strokes: doubling introduced a deadline",
    );
  }

  // Once per stake. A second press is the same gamble arriving twice.
  const before = store.getState().stake?.amount;
  withCoin(true, () => store.getState().doubleOrNothing());
  check(
    store.getState().stake?.amount === before,
    `${measure}: the double was taken twice`,
  );
}

// --- The deck actually declares units --------------------------------------
const declared = Object.entries(POSITIONS);
const bad = declared.filter(
  ([, p]) => p.measure !== undefined && !MEASURES.includes(p.measure),
);
check(bad.length === 0, `positions with an unknown measure: ${bad.map(([id]) => id).join(", ")}`);

const strokes = declared.filter(([, p]) => p.measure === "strokes").length;
const timed = declared.filter(([, p]) => p.measure === "time").length;
const unset = declared.length - strokes - timed;
console.log(
  `\n  deck: ${strokes} counted in strokes, ${timed} on a clock, ${unset} unset (default time)`,
);
// Not a rule about taste, a guard against the whole feature silently reverting:
// if nothing is counted in strokes, the gamble is the duration it used to be.
check(strokes > 0, "no position is counted in strokes — the gamble is a timer again");

if (problems.length > 0) {
  console.log("");
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("\n  OK  the unit follows the position, and the floors hold");
