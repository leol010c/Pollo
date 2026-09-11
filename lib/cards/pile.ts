import type { DeckEntry } from "../dice/deck";

/**
 * The draw pile, which is what makes cards a different game from the die.
 *
 * The die re-deals every throw, so it can land on the same position twice running
 * and there is no such thing as progress through the deck. A pile is drawn from
 * without replacement: every card comes up exactly once before any comes up again,
 * and the count going down is the shape of the evening.
 *
 * These are pure functions over ids, not a stateful pile object. Unlike the deal
 * in ../dice/deck.ts — which has to be module-level because it is read from inside
 * the r3f render loop — the pile is only ever read by React, so it lives in the
 * store where a component can actually react to it.
 */

/** Fisher–Yates, in place. Sorting by a random key is the common shortcut and is
 *  measurably biased — the same reason dealFaces() does it this way.
 *
 *  Exported because the playing deck in ./playing.ts needs the same guarantee
 *  and a second copy of this is a second thing to get subtly wrong. */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * A fresh shuffled pile of ids, in the order they'll be drawn.
 *
 * `avoidFirst` is the card that was face-up when the pile ran out. Dealing it
 * straight back as the first card of the new pile is the single most deflating
 * outcome of a reshuffle — you worked through the whole deck to arrive back where
 * you started — so it gets swapped away from the head.
 *
 * With one card in play there is nowhere to swap it to, and repeating it is then
 * the only honest answer. The same concession deal() makes.
 */
export function shuffledPile(
  inPlay: DeckEntry[],
  avoidFirst?: string | null,
): string[] {
  const pile = shuffle(inPlay.map((entry) => entry.id));

  if (pile.length > 1 && avoidFirst && pile[0] === avoidFirst) {
    // Swap with a random *other* position rather than always index 1, which
    // would make the second card of every reshuffle predictable.
    const swap = 1 + Math.floor(Math.random() * (pile.length - 1));
    [pile[0], pile[swap]] = [pile[swap], pile[0]];
  }

  return pile;
}

/**
 * Puts a position back into a pile that has already been part-drawn.
 *
 * Switching something back on mid-deck shouldn't cost you your place in the pile,
 * and it shouldn't announce itself either: appending would guarantee it comes last
 * and unshifting would guarantee it comes next, both of which tell you exactly
 * where it is. A random index leaves it genuinely unknown.
 */
export function insertInto(pile: string[], id: string): string[] {
  if (pile.includes(id)) return pile;

  const next = [...pile];
  next.splice(Math.floor(Math.random() * (next.length + 1)), 0, id);
  return next;
}

/** Takes a position out of the pile. Drawn cards aren't in it, so this is a no-op
 *  for anything already turned over. */
export function removeFrom(pile: string[], id: string): string[] {
  return pile.filter((entry) => entry !== id);
}
