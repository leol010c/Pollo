/**
 * The draw pile actually draws through. Run with `npm run verify:pile`.
 *
 * Card mode's entire claim over the die is "nothing repeats until the deck runs
 * out". That claim is invisible from one draw, invisible from two, and only
 * falsifiable by counting a whole pass — which is exactly the kind of thing that
 * would ship broken and be noticed weeks later as a vague sense that the cards
 * repeat. So it gets counted here, at every deck size, many times over.
 *
 * The reshuffle boundary is checked separately because it is the one moment the
 * no-repeat rule cannot hold on its own: a fresh pile knows nothing about the
 * card still face-up from the pile before it.
 */
import { insertInto, removeFrom, shuffledPile } from "../lib/cards/pile";
import { DECK_SLOTS } from "../lib/dice/deck";

/**
 * How large a deck is swept, which is not DECK_SLOTS.
 *
 * DECK_SLOTS is the ceiling on built-in artwork — sixteen files in public/dice.
 * Positions somebody writes themselves have no file and no slot, so a real deck
 * can be bigger than that, and a pile that only ever proved itself up to the
 * artwork ceiling would stop proving anything the moment somebody wrote a
 * seventeenth.
 */
const MAX_DECK = DECK_SLOTS + 24;
import type { DeckEntry } from "../lib/dice/deck";

/** Enough passes that a one-in-N ordering fluke can't hide a real bias. */
const RUNS = 400;

function fakeDeck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

const problems: string[] = [];
const note = (msg: string) => {
  // One line per distinct failure, not per run — a broken invariant at
  // RUNS=400 would otherwise bury every other failure under 400 copies.
  if (!problems.includes(msg)) problems.push(msg);
};

// --- A full pass deals everything, exactly once ----------------------------

for (let size = 1; size <= MAX_DECK; size++) {
  const deck = fakeDeck(size);
  const ids = new Set(deck.map((entry) => entry.id));

  for (let run = 0; run < RUNS; run++) {
    const pile = shuffledPile(deck);

    if (pile.length !== size) {
      note(`size ${size}: pile held ${pile.length}`);
      continue;
    }
    if (new Set(pile).size !== size) {
      note(`size ${size}: pile repeated a card within one pass`);
    }
    if (pile.some((id) => !ids.has(id))) {
      note(`size ${size}: pile held a card that isn't in the deck`);
    }
  }
}

// --- Every card actually comes up -----------------------------------------
//
// A shuffle that quietly favoured the front of the array would still pass the
// checks above — every pass would be complete and unique, and you'd simply
// never notice that entry-12 arrived last every single time.

for (const size of [4, 6, 12, 16]) {
  const deck = fakeDeck(size);
  // How often each card lands in each position of the pile.
  const seenAt = new Map<string, number[]>(
    deck.map((entry) => [entry.id, Array(size).fill(0)]),
  );

  for (let run = 0; run < RUNS * 5; run++) {
    shuffledPile(deck).forEach((id, index) => {
      seenAt.get(id)![index]++;
    });
  }

  const expected = (RUNS * 5) / size;
  for (const [id, counts] of seenAt) {
    counts.forEach((count, index) => {
      // Generous bounds — this is looking for a stuck position, not measuring
      // uniformity. A biased shuffle pins a card to an index outright.
      if (count < expected * 0.55 || count > expected * 1.45) {
        note(
          `size ${size}: ${id} landed at position ${index} ${count} times, expected ~${expected.toFixed(0)}`,
        );
      }
    });
  }
}

// --- A reshuffle never hands back the card you just had -------------------

for (let size = 2; size <= MAX_DECK; size++) {
  const deck = fakeDeck(size);

  for (const entry of deck) {
    for (let run = 0; run < 40; run++) {
      const pile = shuffledPile(deck, entry.id);
      if (pile[0] === entry.id) {
        note(`size ${size}: reshuffle dealt ${entry.id} straight back`);
      }
      if (new Set(pile).size !== size) {
        note(`size ${size}: the avoid-first swap lost or duplicated a card`);
      }
    }
  }
}

/*
 * With one card in play, repeating it is the only honest answer.
 *
 * Asserted rather than left implicit because the obvious defensive fix — refuse
 * to deal a card matching avoidFirst — would leave a one-position deck unable to
 * draw at all, which is worse than a repeat.
 */
{
  const deck = fakeDeck(1);
  const pile = shuffledPile(deck, "entry-1");
  if (pile.length !== 1 || pile[0] !== "entry-1") {
    note("size 1: a single-card pile must still deal that card");
  }
}

// --- Editing the deck mid-pile --------------------------------------------

for (let run = 0; run < RUNS; run++) {
  const deck = fakeDeck(12);
  // Part-drawn: five turned over, seven to come.
  const pile = shuffledPile(deck).slice(5);
  const before = [...pile];

  // Switching one off removes it and disturbs nothing else.
  const target = pile[3];
  const shortened = removeFrom(pile, target);
  if (shortened.includes(target)) {
    note("removeFrom left the card in the pile");
  }
  if (shortened.length !== before.length - 1) {
    note("removeFrom changed the pile by more than one card");
  }
  if (shortened.join() !== before.filter((id) => id !== target).join()) {
    note("removeFrom reordered the remaining cards");
  }

  // Switching it back on puts it somewhere unknown, exactly once.
  const restored = insertInto(shortened, target);
  if (restored.length !== shortened.length + 1) {
    note("insertInto changed the pile by more than one card");
  }
  if (new Set(restored).size !== restored.length) {
    note("insertInto duplicated a card");
  }
  if (restored.filter((id) => id === target).length !== 1) {
    note("insertInto did not put the card back exactly once");
  }

  // Already in the pile — must be a no-op, or toggling twice would stack copies.
  if (insertInto(restored, target) !== restored) {
    note("insertInto added a card the pile already held");
  }
}

/*
 * And it lands somewhere different each time.
 *
 * Appending or unshifting would pass every check above while telling you
 * precisely where the card you just switched back on is going to turn up.
 */
{
  const pile = shuffledPile(fakeDeck(8));
  const indices = new Set<number>();
  for (let run = 0; run < 200; run++) {
    indices.add(insertInto(pile, "restored").indexOf("restored"));
  }
  if (indices.size < pile.length) {
    note(
      `insertInto only ever used ${indices.size} of ${pile.length + 1} possible positions`,
    );
  }
}

console.log(`Draw pile — ${MAX_DECK} deck sizes x ${RUNS} passes`);

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("  OK  full pass deals everything once, reshuffle never repeats");
