/**
 * The call, the odds it is offered at, and the price of taking it.
 *
 * The script `calledRight` has claimed in a comment for as long as it has
 * existed — "pure and total, so verify:highlow can enumerate all 13 × 13 × 2
 * combinations against a plain comparison rather than trusting a sample" — and
 * which was never actually written. It is now, and it does that; the run built
 * on top of it is the reason it finally had to be.
 *
 * What is worth checking here is not that 9 beats 4. It is the two properties
 * the run rests on and that nothing else can see:
 *
 *  - **The odds are the shoe's, not a table's.** The deck is dealt without
 *    replacement and the shoe survives between bets, so the fourth call of a run
 *    is genuinely offered at different odds from the first. If oddsFor ever
 *    quietly went back to a fixed table nothing on screen would look wrong —
 *    the numbers would simply stop being true. So they are counted here against
 *    an exhaustive walk of the same cards.
 *
 *  - **The price is fair.** payoutFor is 1/p, which makes every call worth
 *    exactly what it costs and the whole run worth exactly what it costs. That
 *    is checked as an expectation over every call available on a full shoe: a
 *    house edge would show up as a number below one, and there is no house.
 *
 * Run with `npm run verify:highlow`.
 */
import {
  calledRight,
  freshShoe,
  oddsFor,
  payoutFor,
  MAX_RANK,
  MIN_RANK,
  SUITS,
  type Call,
  type PlayingCard,
} from "../lib/cards/playing";

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${line}`);
};

const CALLS: Call[] = ["higher", "lower"];

console.log("Higher or lower — the call, the odds, and the price\n");

// --- The call itself ---------------------------------------------------------

/*
 * All 13 × 13 × 2, against a comparison written out a second time.
 *
 * Deliberately a second expression of the rule rather than a reuse of the
 * first: a check that calls calledRight to decide what calledRight should have
 * said is only checking that the function is deterministic.
 */
{
  let wrong = 0;
  let ties = 0;

  for (let lying = MIN_RANK; lying <= MAX_RANK; lying++) {
    for (let next = MIN_RANK; next <= MAX_RANK; next++) {
      for (const call of CALLS) {
        const expected =
          next === lying || (call === "higher" ? next > lying : next < lying);
        const got = calledRight(
          call,
          { rank: lying, suit: "spades" },
          { rank: next, suit: "hearts" },
        );
        if (got !== expected) wrong++;
        if (next === lying && call === "higher") ties++;
      }
    }
  }

  report(wrong === 0, `all ${MAX_RANK * MAX_RANK * 2} calls agree — ${wrong} wrong`);
  report(ties === MAX_RANK, `every one of the ${ties} matches is a win, both ways`);
}

/*
 * The suit never gets a vote.
 *
 * Worth stating because the cards carry one and the faces print it: a bet that
 * quietly broke ties by suit would look exactly like this one until the night
 * somebody noticed hearts always winning.
 */
{
  let disagreed = 0;
  for (const a of SUITS) {
    for (const b of SUITS) {
      for (let lying = MIN_RANK; lying <= MAX_RANK; lying++) {
        for (let next = MIN_RANK; next <= MAX_RANK; next++) {
          for (const call of CALLS) {
            const base = calledRight(call, { rank: lying, suit: "spades" }, { rank: next, suit: "spades" });
            if (calledRight(call, { rank: lying, suit: a }, { rank: next, suit: b }) !== base) {
              disagreed++;
            }
          }
        }
      }
    }
  }
  report(disagreed === 0, `suit changes nothing, over all ${SUITS.length ** 2} pairings`);
}

// --- The odds ----------------------------------------------------------------

console.log("");

/** Every card of the deck, in order, as a stand-in for an untouched shoe. */
function fullDeck(): PlayingCard[] {
  const cards: PlayingCard[] = [];
  for (const suit of SUITS) {
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) cards.push({ rank, suit });
  }
  return cards;
}

/*
 * The odds are what an exhaustive count of the same cards says they are.
 *
 * This is the one that matters. It walks `unseen` itself and asks calledRight
 * about every card in it — the question the player is actually asking — and
 * requires oddsFor to have arrived at the same number.
 */
{
  let worst = 0;

  const shoes: { name: string; unseen: PlayingCard[] }[] = [
    { name: "a full shoe", unseen: fullDeck() },
    // A shoe eleven cards deep into a session, which is where a table would
    // start being a lie.
    { name: "a shoe 11 cards down", unseen: fullDeck().slice(11) },
    // And one stripped of a whole rank, the sharpest case: every remaining
    // eight is gone, so calls against a seven and a nine both move.
    { name: "a shoe with no eights", unseen: fullDeck().filter((c) => c.rank !== 8) },
  ];

  for (const { name, unseen } of shoes) {
    let off = 0;
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
      const lying: PlayingCard = { rank, suit: "clubs" };
      const odds = oddsFor(lying, unseen);
      for (const call of CALLS) {
        const wins = unseen.filter((card) => calledRight(call, lying, card)).length;
        const counted = wins / unseen.length;
        const delta = Math.abs(counted - odds[call]);
        if (delta > 1e-12) off++;
        worst = Math.max(worst, delta);
      }
    }
    report(off === 0, `${name}: all ${MAX_RANK * 2} calls priced by count — ${off} off`);
  }

  report(worst < 1e-12, `the largest disagreement anywhere is ${worst.toExponential(1)}`);
}

/*
 * And they move when the shoe moves.
 *
 * The property a hard-coded table would fail while every check above it passed.
 */
{
  const full = oddsFor({ rank: 7, suit: "clubs" }, fullDeck());
  const stripped = oddsFor(
    { rank: 7, suit: "clubs" },
    fullDeck().filter((card) => card.rank <= 7),
  );
  report(
    stripped.higher < full.higher && stripped.lower > full.lower,
    `a shoe with nothing above a seven reprices it — higher ${(full.higher * 100).toFixed(1)}% → ${(stripped.higher * 100).toFixed(1)}%`,
  );
}

/*
 * The tie overlap, stated rather than discovered.
 *
 * The two numbers sum to one plus the tie rate, and somebody reading 52.9 and
 * 52.9 off the screen deserves to have that be on purpose in writing.
 */
{
  const unseen = fullDeck();
  let worstSum = 0;
  for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
    const lying: PlayingCard = { rank, suit: "clubs" };
    const { higher, lower } = oddsFor(lying, unseen);
    const ties = unseen.filter((card) => card.rank === rank).length / unseen.length;
    worstSum = Math.max(worstSum, Math.abs(higher + lower - (1 + ties)));
  }
  report(
    worstSum < 1e-12,
    "the two chances sum to one plus the tie rate, at every rank",
  );
}

// --- The price ---------------------------------------------------------------

console.log("");

/*
 * A fair price, checked as an expectation.
 *
 * Take a call at chance p and it pays 1/p: p of the time you multiply by 1/p,
 * and the rest of the time you have nothing. The expected multiplier is
 * therefore exactly 1 — no edge, in either direction, on every call the deck
 * can offer. A rounding or a cap sneaked into payoutFor shows up here as a
 * number that is no longer one.
 */
{
  const unseen = fullDeck();
  let worst = 0;
  let priced = 0;

  for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
    const odds = oddsFor({ rank, suit: "clubs" }, unseen);
    for (const call of CALLS) {
      const chance = odds[call];
      if (chance <= 0) continue;
      priced++;
      worst = Math.max(worst, Math.abs(chance * payoutFor(chance) - 1));
    }
  }

  report(
    worst < 1e-12,
    `every one of the ${priced} calls on a full shoe is an even-money bet`,
  );
}

/*
 * The two ends of the range, named.
 *
 * Not arithmetic for its own sake — these are the numbers the buttons print,
 * and both are load-bearing. The ×1.00 end is the app admitting a call is not a
 * bet, and it is what stops a run being farmed by always taking the safe side.
 * The middle is why a run that lasts cannot avoid risk.
 */
{
  const unseen = fullDeck();

  const ace = oddsFor({ rank: 1, suit: "clubs" }, unseen);
  report(
    Math.abs(payoutFor(ace.higher) - 1) < 1e-12,
    `higher than an ace pays ${payoutFor(ace.higher).toFixed(2)} — a call that is not a bet`,
  );
  report(
    payoutFor(ace.lower) > 10,
    `lower than an ace pays ×${payoutFor(ace.lower).toFixed(2)}`,
  );

  const seven = oddsFor({ rank: 7, suit: "clubs" }, unseen);
  report(
    Math.abs(payoutFor(seven.higher) - payoutFor(seven.lower)) < 1e-12 &&
      payoutFor(seven.higher) > 1.5,
    `a seven pays ×${payoutFor(seven.higher).toFixed(2)} whichever way you call it — there is no safe side`,
  );
}

/*
 * A call that cannot win is not priced at all.
 *
 * Reachable late in a shoe, and the one input where 1/p is not a number. It has
 * to come back as nothing so the button can be turned off rather than offered
 * at odds of infinity.
 */
{
  const nothingAbove = fullDeck().filter((card) => card.rank < 5);
  const odds = oddsFor({ rank: 13, suit: "clubs" }, nothingAbove);
  report(
    odds.higher === 0 && payoutFor(odds.higher) === 0,
    "a call that cannot win pays nothing rather than infinity",
  );
  report(
    oddsFor({ rank: 7, suit: "clubs" }, []).higher === 0,
    "an empty shoe prices nothing, rather than dividing by zero",
  );
}

// --- The shoe itself ---------------------------------------------------------

console.log("");

{
  const shoe = freshShoe();
  const ids = new Set(shoe.map((card) => `${card.rank}${card.suit}`));
  report(shoe.length === 52 && ids.size === 52, `a fresh shoe is ${ids.size} distinct cards`);
}

console.log(
  `\n${
    failures === 0
      ? "  OK  the odds are the shoe's own, and every call is priced at what it is worth\n"
      : `  ${failures} check(s) failed — the bet is not offering what it says it is\n`
  }`,
);
process.exit(failures === 0 ? 0 : 1);
