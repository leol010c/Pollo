import type { PrizeRung } from "@/lib/store";

/**
 * What each rung of the prize ladder is called, and what it does.
 *
 * Its own module because two screens need the same words and neither should own
 * them. HighLowTable prints the name under the take button, so somebody
 * deciding whether to push can see what they are already holding; PrizeNotice
 * prints both when the run is collected.
 *
 * The names are verbs from the player's side, not amounts. That is the whole
 * shape of this reward: the run does not pay you *more*, it pays you further up
 * a ladder of who decides — which is the only currency this app has ever had.
 */
export const RUNG_COPY: Record<PrizeRung, { name: string; blurb: string }> = {
  again: {
    name: "Draw again",
    blurb: "Put it back and turn over another one.",
  },
  two: {
    name: "Choose from two",
    blurb: "Two come up. Take whichever you like.",
  },
  any: {
    name: "Pick anything",
    blurb: "The whole deck opens. Take any of it.",
  },
  theirs: {
    name: "Pick theirs as well",
    blurb: "One for you, and one you hand to them.",
  },
};
