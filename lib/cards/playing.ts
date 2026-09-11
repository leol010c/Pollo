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
