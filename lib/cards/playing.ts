import { shuffle } from "./pile";

/**
 * A real deck of playing cards, and nothing to do with the positions.
 *
 * The bet in card mode is higher-or-lower, and that needs something the position
 * deck does not have and should not be given: a rank. A position is not more or
 * less than another position — the only ordered thing on a DeckEntry is its
 * intensity, which has three values and would make a third of every pair a tie.
 *
 * So the bet gets its own deck, brought onto the table the way the coin is and
 * put away after. Nothing here knows what a DeckEntry is; nothing there knows
 * what a suit is. The two only meet in the store, where winning a call asks the
 * position deck for another card.
 */

export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];

/** Ace low through king. Thirteen, so a call is a real question. */
export const MIN_RANK = 1;
export const MAX_RANK = 13;

/**
 * One card.
 *
 * Rank order, deliberately not blackjack point values. Scoring a jack, queen
 * and king all as ten would collapse three of the thirteen answers into one and
 * push the tie rate from six percent to seventeen, in a game whose whole
 * question is which of two cards is bigger.
 */
export interface PlayingCard {
  rank: number;
  suit: Suit;
}

/** What was called. */
export type Call = "higher" | "lower";

/** A full deck, shuffled. Fifty-two distinct cards, every time. */
export function freshShoe(): PlayingCard[] {
  const cards: PlayingCard[] = [];
  for (const suit of SUITS) {
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
      cards.push({ rank, suit });
    }
  }
  return shuffle(cards);
}

/** How many cards a single bet takes off the shoe. */
export const CARDS_PER_BET = 2;

const RANK_LABELS = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

/** The index as it is printed in the corner. */
export function rankLabel(rank: number): string {
  return RANK_LABELS[rank - 1] ?? String(rank);
}

const RANK_WORDS = [
  "ace", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "jack", "queen", "king",
];

/**
 * The card, spoken.
 *
 * A screen reader gets nothing at all from a pip drawn in CSS, and the whole
 * bet is a comparison between two cards — so this is not a nicety, it is the
 * only way the game is playable without looking at it. See ResultAnnouncer.
 */
export function cardLabel(card: PlayingCard): string {
  return `${RANK_WORDS[card.rank - 1] ?? card.rank} of ${card.suit}`;
}

/** Which colour the suit is printed in. */
export function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/**
 * Whether the call was right.
 *
 * **A match wins.** It is about six percent of pairs on a fifty-two card deck,
 * and this is a bet somebody takes because they are unhappy with the position
 * they drew — a rule that has to break somewhere should break toward the person
 * who took it. The alternative is the casino's, and a house edge on a bet the
 * app itself is offering you is a strange thing for an app with no house.
 *
 * Pure and total, so verify:highlow can enumerate all 13 × 13 × 2 combinations
 * against a plain comparison rather than trusting a sample.
 */
export function calledRight(
  call: Call,
  lying: PlayingCard,
  next: PlayingCard,
): boolean {
  if (next.rank === lying.rank) return true;
  return call === "higher"
    ? next.rank > lying.rank
    : next.rank < lying.rank;
}

/**
 * The chance each call has of winning, off the cards nobody has seen.
 *
 * Not a table. The shoe is dealt without replacement and survives between bets
 * (see `shoe` in the store), so by the fourth call of a run the odds genuinely
 * are not the ones a fresh deck would give — and these are the real ones,
 * counted over what is actually left. Counting cards works in this app, which
 * is a strange and good thing for it to be able to say.
 *
 * `unseen` is every card the caller has not been shown, which is the face-down
 * card *plus* the rest of the shoe. The face-down one belongs in there: it was
 * dealt off the top and is exactly as unknown as the forty under it. Leaving it
 * out would be computing the odds of a card that had already been excluded from
 * the population it was drawn from.
 *
 * ## Why these two do not add up to one
 *
 * A match wins — see calledRight, which explains why. So a tie is counted for
 * *both* sides and the two numbers sum to one plus the tie rate. On a seven off
 * a full shoe that is 52.9% and 52.9%, and it is not an error: they are two
 * separate questions, each asking what this call would do, and a card that
 * matches would answer yes to either.
 */
export interface Odds {
  higher: number;
  lower: number;
}

export function oddsFor(lying: PlayingCard, unseen: PlayingCard[]): Odds {
  if (unseen.length === 0) return { higher: 0, lower: 0 };

  let higher = 0;
  let lower = 0;
  for (const card of unseen) {
    // Ties are added to both, deliberately. See the note above.
    if (card.rank >= lying.rank) higher++;
    if (card.rank <= lying.rank) lower++;
  }

  return { higher: higher / unseen.length, lower: lower / unseen.length };
}

/**
 * What a call pays, as a multiplier on the pot.
 *
 * The inverse of its chance, which is the fair price and therefore the only one
 * worth charging: this app has no house, and `calledRight` already argues at
 * length that a bet the app itself offers you should not carry an edge against
 * you. Ties winning tips it a few percent toward the caller, which is the same
 * thumb on the same side of the same scale.
 *
 * Nothing needs balancing on top of it, because the deck does the balancing. A
 * near-certain call pays ×1.00 and openly admits it is not a bet; a seven pays
 * ×1.89 whichever way you go, so a run that lasts has to take a real risk
 * whether or not the person taking it wanted one.
 *
 * A call that cannot win pays nothing rather than infinity — it is not a long
 * shot, it is a card that is not in the shoe, and the button offering it is
 * disabled rather than priced.
 */
export function payoutFor(chance: number): number {
  if (chance <= 0) return 0;
  return 1 / chance;
}

/** The pot, as it is printed: two decimals, and never "×1.0". */
export function potLabel(pot: number): string {
  return `×${pot.toFixed(2)}`;
}
