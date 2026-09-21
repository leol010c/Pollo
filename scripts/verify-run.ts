/**
 * The run: what it pays, what it costs, and what it cannot do.
 *
 * verify:highlow checks the arithmetic in isolation — the odds are the shoe's,
 * the price is the inverse of the chance. This drives the store, which is where
 * the arithmetic meets the rules, and it exists because almost everything that
 * could go wrong with a run is invisible in a single call:
 *
 *  - a pot that resets instead of carrying, which looks fine until call four
 *  - a run that can be pushed past its ceiling
 *  - \`betUsed\` handed back mid-run, which turns one bet into unlimited ones
 *  - a loss that pays out anyway, or a win that pays the wrong rung
 *  - the top rung overwriting your own position with the one you handed over,
 *    which is the bug the \`handed\` field on Prize exists because of
 *
 * The shoe is stacked rather than shuffled throughout. A run is a sequence of
 * specific cards and there is no way to check a sequence you do not control —
 * \`freshShoe()\` is checked for fairness in verify:highlow, and this needs the
 * opposite thing entirely.
 *
 * Run with `npm run verify:run`.
 */
import {
  PRIZE_LADDER,
  RUN_LIMIT,
  rungsFor,
  useDiceStore,
  type PrizeRung,
} from "../lib/store";
import {
  calledRight,
  oddsFor,
  payoutFor,
  type PlayingCard,
} from "../lib/cards/playing";
import { setBuiltinEntries, type DeckEntry } from "../lib/dice/deck";

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${line}`);
};

const store = useDiceStore;

function deck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    intensity: 2 as const,
    source: [`/dice/image-${i + 1}.png`],
    measure: "time" as const,
  }));
}

const card = (rank: number): PlayingCard => ({ rank, suit: "spades" });

/**
 * A table in card mode with a card drawn, a stacked shoe, and a bet available.
 *
 * `openHighLow` refuses without all of that — deliberately, since there has to
 * be a result to be unhappy with before there is anything to bet against it.
 */
function table(ranks: number[]) {
  setBuiltinEntries([], []);
  const entries = deck(13);
  store.setState({
    mode: "cards",
    discreet: false,
    deck: entries,
    deckIn: true,
    disabled: [],
    pool: "all",
    own: [],
    phase: "settled",
    drawn: entries[0].id,
    lastPositionId: entries[0].id,
    chosenEntry: null,
    history: [],
    coin: null,
    bet: null,
    prize: null,
    forfeit: null,
    stake: null,
    betUsed: false,
    betPrize: false,
    shoe: ranks.map(card),
  });
}

/** Calls, and turns the card over. The screen's two taps, in one. */
function call(which: "higher" | "lower") {
  store.getState().guessHighLow(which);
  store.getState().turnHighLow();
}

console.log("The run — what it pays, what it costs, and what it cannot do\n");

// --- The pot carries, and is priced at the offer -----------------------------

/*
 * Four calls, checked against the odds each was *offered* at.
 *
 * The pot is recomputed here from the odds the store recorded at each deal, not
 * from a table — so this catches a pot that resets, a pot that multiplies twice,
 * and a pot repriced against the card after it turned over.
 */
{
  /*
   * Climbing, but never to a certainty, and every call taken the winning way.
   *
   * Both halves of that are needed and the first is easy to get wrong. A simply
   * ascending shoe makes every "higher" a sure thing — the run survives, and
   * pays ×1.00 four times, which is correct behaviour and measures nothing. So
   * there are low cards left underneath throughout: each call is a real
   * question that happens to be answered right.
   */
  table([7, 9, 11, 13, 1, 2, 3]);
  store.getState().openHighLow();

  let expected = 1;
  const seen: number[] = [];

  for (let i = 0; i < 4; i++) {
    const bet = store.getState().bet;
    if (!bet) break;
    // The direction that wins, read off the pair rather than assumed — the
    // fourth call is against a king, where "higher" is not merely unlikely but
    // impossible.
    const which = calledRight("higher", bet.lying, bet.next) ? "higher" : "lower";
    expected *= payoutFor(bet.odds[which]);
    call(which);
    seen.push(store.getState().bet?.pot ?? 0);
    if (i < 3) store.getState().runAgain();
  }

  const bet = store.getState().bet;
  report(bet?.won === 4, `four right calls leave the run four deep — ${bet?.won}`);
  report(
    bet !== null && Math.abs(bet.pot - expected) < 1e-9,
    `the pot is the product of what each call was offered at — ×${bet?.pot.toFixed(
      3,
    )} against ×${expected.toFixed(3)}`,
  );
  /*
   * It never falls, and a run of real calls ends well above where it started.
   *
   * Not "climbs every call", which would be asserting something false: a call
   * the shoe makes a certainty pays ×1.00 and leaves the pot exactly where it
   * was, on purpose. The fourth call here is one of those.
   */
  report(
    seen.every((pot, i) => i === 0 || pot >= seen[i - 1]) &&
      seen[seen.length - 1] > seen[0],
    `it never falls, and ends above where it started — ${seen
      .map((p) => p.toFixed(2))
      .join(" → ")}`,
  );
}

/*
 * And it is priced *before* the card turns.
 *
 * The property that stops the app quietly giving itself an edge. If the odds
 * were recounted at settle time, the card that just turned would be known, and
 * a call that won would be repriced as if it had always been a certainty —
 * paying ×1.00 for something that was genuinely a gamble.
 */
{
  table([7, 13, 5]);
  store.getState().openHighLow();
  const offered = store.getState().bet?.odds.higher ?? 0;
  call("higher");
  const pot = store.getState().bet?.pot ?? 0;
  report(
    Math.abs(pot - payoutFor(offered)) < 1e-9 && pot > 1.5,
    `a won call pays the price it was offered at, not the certainty it became — ×${pot.toFixed(2)}`,
  );
}

// --- The ceiling -------------------------------------------------------------

console.log("");

/*
 * A run that reaches the limit collects itself.
 *
 * Inline in turnHighLow rather than left for the screen, so that "go again" is
 * never drawn at a point where it would be refused.
 */
{
  // Every call a certainty, so the run gets there without the shoe arguing.
  table([1, 13, 13, 13, 13, 13, 13]);
  store.getState().openHighLow();

  for (let i = 0; i < RUN_LIMIT; i++) {
    call("higher");
    if (store.getState().bet) store.getState().runAgain();
  }

  const s = store.getState();
  report(s.bet === null, "the run collects itself at the ceiling");
  report(
    s.prize?.calls === RUN_LIMIT,
    `and the prize says how long it was — ${s.prize?.calls} calls`,
  );

  // And pushing past it is refused even if something asks.
  const before = store.getState().prize;
  store.getState().runAgain();
  report(
    store.getState().prize === before && store.getState().bet === null,
    "runAgain past the ceiling does nothing at all",
  );
}

// --- The cost ----------------------------------------------------------------

console.log("");

/*
 * A wrong call takes the whole pot, however deep the run was.
 *
 * The entire risk, and the thing that makes taking it a decision. It also has
 * to land as an *ordinary* lost bet — the forfeit machinery is what pays it,
 * and that machinery knows nothing about runs.
 */
{
  table([7, 9, 11, 2, 5]);
  store.getState().openHighLow();
  call("higher");
  store.getState().runAgain();
  call("higher");
  const deep = store.getState().bet;
  store.getState().runAgain();

  // 2 after an 11: calling higher is wrong, and there is no tie to save it.
  call("higher");

  const s = store.getState();
  report(
    (deep?.pot ?? 0) > 1 && s.prize === null,
    `a run worth ×${deep?.pot.toFixed(2)} pays nothing when a call goes wrong`,
  );
  report(
    s.bet?.turned === true && s.bet.choosing === false,
    "the lost call stops the run rather than offering to continue it",
  );

  // The forfeit takes it from here, exactly as it does for a single lost call.
  store.getState().forfeitPick(deck(13)[3]);
  report(
    store.getState().forfeit?.stage === "amount" &&
      store.getState().chosenEntry?.id === "entry-4",
    "and their pick lands as the round's result, by the ordinary route",
  );
}

/*
 * One bet per round, however many calls are in it.
 *
 * `betUsed` is spent when the run opens and must not come back while it is
 * running — otherwise a run is a way to farm unlimited bets out of one round.
 */
{
  table([7, 9, 11, 3]);
  store.getState().openHighLow();
  call("higher");
  const first = store.getState().bet?.betId;
  store.getState().runAgain();

  store.getState().openHighLow();
  report(
    store.getState().bet?.betId !== undefined &&
      store.getState().bet?.won === 1 &&
      store.getState().bet?.betId !== first,
    "a second openHighLow mid-run is refused — the run carries on",
  );
  report(store.getState().betUsed === true, "the bet stays spent for the whole run");
}

// --- The ladder --------------------------------------------------------------

console.log("");

{
  report(
    rungsFor(1).join() === "again" &&
      rungsFor(2).join() === "again,two" &&
      rungsFor(4).join() === "again,two,any" &&
      rungsFor(8).join() === "again,two,any,theirs",
    "each threshold opens exactly one more rung",
  );
  report(
    rungsFor(7.99).join() === "again,two,any",
    "a pot just short of a rung does not reach it",
  );
  report(
    PRIZE_LADDER.every((step, i) => i === 0 || step.at > PRIZE_LADDER[i - 1].at),
    "the ladder only ever goes up",
  );
}

/**
 * A run, won and collected, at one of two sizes.
 *
 * Both shoes are stacked to a purpose and neither is obvious, so they are worth
 * spelling out — an earlier version of this helper tried to *search* for a big
 * pot by always taking the long shot, which is a description of losing.
 *
 * `small` is a single certainty: higher than an ace, against a shoe of kings.
 * It cannot lose and it pays ×1.00 exactly, which is the point — it is the run
 * that reaches only the bottom rung.
 *
 * `big` is two long shots that both land, and it works because **a match
 * wins**. Calling lower against an ace is priced off how few cards can match or
 * beat it — one in seven, then one in six — while the card actually waiting is
 * another ace. So each call is genuinely a long shot at the moment it is taken
 * and genuinely a tie when it turns: ×3.5, then ×6, for a pot of ×21 and the
 * whole ladder.
 */
function won(size: "small" | "big"): void {
  if (size === "small") {
    table([1, 13, 13, 13, 13]);
    store.getState().openHighLow();
    call("higher");
  } else {
    table([1, 1, 1, 13, 13, 13, 13, 13]);
    store.getState().openHighLow();
    call("lower");
    store.getState().runAgain();
    call("lower");
  }
  store.getState().collectRun();
}

/*
 * The cheapest rung is what a won bet has always bought, and it must still be
 * exempt from buying another one.
 */
{
  won("small");
  const pot = store.getState().prize?.pot ?? 0;
  store.getState().spendPrize("again");
  const s = store.getState();
  report(
    s.prize === null && s.phase === "rolling",
    `×${pot.toFixed(2)} spent, and the deck is drawing`,
  );
  /*
   * And the draw it bought cannot buy another bet.
   *
   * `betPrize` is checked by its absence, which is the whole mechanism: it is
   * set on the way in and consumed by drawCard, whose only job with it is to
   * decide *not* to hand the bet back. So the thing to assert afterwards is not
   * that the token is still there — it is spent — but that `betUsed` survived
   * the draw it exempted.
   */
  report(
    s.betUsed === true && s.betPrize === false,
    "and the draw it bought cannot buy another bet",
  );
}

{
  won("big");
  store.getState().spendPrize("two");
  const offer = store.getState().prize?.offer;
  report(
    offer?.length === 2 && offer[0].id !== offer[1].id,
    `two distinct positions are offered — ${offer?.map((e) => e.name).join(" / ")}`,
  );

  store.getState().prizePick(offer![1]);
  const s = store.getState();
  report(
    s.chosenEntry?.id === offer![1].id && s.phase === "settled" && s.prize === null,
    "and the one taken lands as the round's result",
  );
}

{
  won("big");
  store.getState().spendPrize("any");
  report(store.getState().prize?.stage === "pick", "the top-but-one rung opens the deck");

  store.getState().prizePick(deck(13)[6]);
  const s = store.getState();
  report(
    s.chosenEntry?.id === "entry-7" && s.prize === null && s.history.length === 1,
    "any position at all can be taken, and it counts as a result",
  );
}

/*
 * The top rung, and the bug it was built around.
 *
 * Two positions are live at once here — yours and the one you hand over — and
 * the app has exactly one slot for a result. The first implementation ran the
 * second pick through the forfeit, which writes to that slot, so handing
 * somebody a position silently replaced your own with it. Hence `handed`.
 */
{
  won("big");
  store.getState().spendPrize("theirs");
  store.getState().prizePick(deck(13)[1]);

  report(
    store.getState().chosenEntry?.id === "entry-2" &&
      store.getState().prize?.stage === "hand",
    "your own pick lands first, and then it asks for theirs",
  );

  store.getState().handPick(deck(13)[9]);
  store.getState().handAmount(90);

  const s = store.getState();
  report(
    s.chosenEntry?.id === "entry-2",
    `handing one over leaves your own result alone — ${s.chosenEntry?.name}`,
  );
  report(
    s.prize?.handed?.entry.id === "entry-10" && s.prize.handed.amount === 90,
    `and theirs is held beside it — ${s.prize?.handed?.entry.name}, ${s.prize?.handed?.amount}`,
  );
  report(
    s.stake === null,
    "their number is not started as a stake — the clock on the table is not theirs",
  );
  report(s.prize?.stage === "done", "which is the end of the run");
}

/*
 * A rung the pot never reached cannot be spent, whatever asks for it.
 */
{
  won("small");
  const pot = store.getState().prize?.pot ?? 0;
  const reach = rungsFor(pot);
  const missing = (["again", "two", "any", "theirs"] as PrizeRung[]).filter(
    (rung) => !reach.includes(rung),
  );
  for (const rung of missing) store.getState().spendPrize(rung);
  report(
    store.getState().prize?.taken === null,
    `a ×${pot.toFixed(2)} run cannot spend ${missing.join(", ") || "anything it did not win"}`,
  );
}

// --- Odds are quoted against what has not been seen --------------------------

console.log("");

/*
 * The face-down card is part of the population it was drawn from.
 *
 * Subtle and easy to get wrong in the direction that looks tidier: `rest` is
 * right there, and pricing against it would be quoting odds on a card already
 * excluded from the pile it came out of.
 */
{
  table([7, 9, 11, 2, 5, 3, 13]);
  store.getState().openHighLow();
  const bet = store.getState().bet!;
  const unseen = [bet.next, ...store.getState().shoe];
  const counted = oddsFor(bet.lying, unseen);
  report(
    Math.abs(bet.odds.higher - counted.higher) < 1e-12 &&
      Math.abs(bet.odds.lower - counted.lower) < 1e-12,
    `the face-down card is counted among the unknowns — ${(bet.odds.higher * 100).toFixed(0)}% / ${(bet.odds.lower * 100).toFixed(0)}%`,
  );
  report(
    store.getState().shoe.length === 5,
    `and only the two dealt cards left the shoe — ${store.getState().shoe.length} of 7 remain`,
  );
}

console.log(
  `\n${
    failures === 0
      ? "  OK  the run carries, the ceiling holds, and a lost call takes all of it\n"
      : `  ${failures} check(s) failed — the run is not paying what it says\n`
  }`,
);
process.exit(failures === 0 ? 0 : 1);
