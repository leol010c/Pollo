/**
 * Every face of the die gets something dealt to it. Run with `npm run verify:deal`.
 *
 * This exists because of a bug that was invisible from the code and almost
 * invisible on screen: the deal filled a hardcoded six faces regardless of the
 * die, so a d12 got six entries and its other six faces, finding nothing dealt
 * to them, quietly fell back to drawing numerals. Half the die showed numbers,
 * and nothing anywhere reported a problem.
 *
 * A face with no entry is exactly the kind of failure that needs a check to
 * fire on it, so this asserts the invariant directly across every die and every
 * deck size it could be handed.
 */
import { dealFaces } from "../lib/dice/deck";
import { DIE_SIDES, DIE_TYPES, largestDieFor } from "../lib/dice/types";
import type { DeckEntry } from "../lib/dice/deck";

function fakeDeck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

const problems: string[] = [];

for (const type of DIE_TYPES) {
  const faces = DIE_SIDES[type];

  // Past DECK_SLOTS on purpose. That constant is the ceiling on *built-in*
  // artwork; positions somebody writes themselves are not bounded by it, so a
  // real deck can be larger than any number this file used to sweep.
  for (let available = 1; available <= 40; available++) {
    const deck = fakeDeck(available);
    const deal = dealFaces(deck, faces);

    // 1. Every face is filled. This is the invariant the bug broke.
    if (deal.length !== faces) {
      problems.push(
        `${type} with ${available} available: dealt ${deal.length} entries for ${faces} faces`,
      );
      continue;
    }
    if (deal.some((entry) => !entry)) {
      problems.push(`${type} with ${available} available: a face got nothing`);
      continue;
    }

    // 2. Everything dealt is actually in the deck it was dealt from.
    const ids = new Set(deck.map((entry) => entry.id));
    if (deal.some((entry) => !ids.has(entry.id))) {
      problems.push(`${type} with ${available} available: dealt an unknown entry`);
    }

    // 3. Repeats only when forced. With enough entries to go round, showing the
    //    same position on two faces would be a straightforward bug.
    const distinct = new Set(deal.map((entry) => entry.id)).size;
    const expected = Math.min(available, faces);
    if (distinct !== expected) {
      problems.push(
        `${type} with ${available} available: ${distinct} distinct on ${faces} faces, expected ${expected}`,
      );
    }
  }
}

/*
 * The die is never bigger than the deck.
 *
 * largestDieFor is what keeps that true as positions are switched off, so it
 * has to hold at every count — including counts below the smallest die, where
 * it still has to return something rather than refuse.
 */
for (let count = 0; count <= 20; count++) {
  const type = largestDieFor(count);
  const faces = DIE_SIDES[type];

  if (count >= 4 && faces > count) {
    problems.push(`largestDieFor(${count}) chose ${type}, which needs ${faces}`);
  }

  // The largest that fits, not merely one that fits.
  const better = DIE_TYPES.filter(
    (t) => DIE_SIDES[t] <= count && DIE_SIDES[t] > faces,
  );
  if (better.length > 0) {
    problems.push(
      `largestDieFor(${count}) chose ${type} when ${better.join("/")} also fit`,
    );
  }
}

console.log(`Deal fill — ${DIE_TYPES.length} die types x 40 deck sizes`);

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("  OK  every face filled, repeats only when forced");
