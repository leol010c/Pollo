"use client";

import { useDiceStore, useSettledBet } from "@/lib/store";
import { cardLabel, potLabel } from "@/lib/cards/playing";

/**
 * The accessible result.
 *
 * The die presenting itself to the camera says nothing to a screen reader — a
 * canvas is opaque to assistive tech — and a card is a turning box that says
 * little more. This live region is the entire non-visual path for both, so it
 * falls back to the face's number when a position has no name: an outcome is
 * never unannounced.
 *
 * It is also the only place a position is ever spoken out loud, which makes it
 * the one part of the disguise that has to be got right in a file with no
 * pixels in it. Discreet mode announces the number instead — a disguise that
 * held on screen and not in a screen reader would be no disguise at all, and
 * would fail the person relying on it most.
 */
export function ResultAnnouncer() {
  const phase = useDiceStore((s) => s.phase);
  const mode = useDiceStore((s) => s.mode);
  const discreet = useDiceStore((s) => s.discreet);
  const settled = useSettledBet();
  const bet = useDiceStore((s) => s.bet);
  // Subscribed to so the getter below re-runs when the result changes.
  const value = useDiceStore((s) => s.value);
  useDiceStore((s) => s.drawn);

  const landed = useDiceStore.getState().currentEntry();
  const cards = mode === "cards";
  // The entry still exists while disguised — nothing is removed from the deck —
  // so this reads past it to the face rather than relying on there being nothing
  // to say.
  const result = discreet ? value : (landed?.name ?? value ?? "");
  /*
   * The line that says what the position asks for, spoken.
   *
   * The one place it is *always* said. On screen it appears on the card face and
   * nowhere else — the die's reveal has no room for a fourth row — so in dice
   * mode this is not a transcript of what is visible but the only account of it
   * there is. That is the right way round rather than an inconsistency: the
   * reveal drops the line because it has a picture doing the same job, and a
   * screen reader has no picture.
   *
   * Suppressed while disguised for the same reason the name is — a description
   * is the most nameable thing there is, and speaking it would undo the disguise
   * more completely than the name ever could.
   */
  const blurb = discreet ? null : (landed?.hint ?? landed?.description);

  /*
   * The bet, which is the one moment the app takes something away.
   *
   * It says nothing until the result is on screen, for the same reason the
   * notices do not open until then: the outcome exists a second and a half
   * before anybody can see it, and announcing it early would hand the result to
   * a screen reader user while everyone else is still watching it turn.
   *
   * It takes priority over the roll below because it is what is happening. The
   * throw or draw a won bet triggers announces itself a moment later on its own.
   */
  /*
   * A won call, which settledBet() deliberately does not report.
   *
   * The run stops on a win with two moves open, so there is no settled bet to
   * speak about — and the thing that has actually happened is invisible without
   * this. A sighted player sees the card turn, the pips fill and the pot climb;
   * a screen reader user would otherwise get silence and then two buttons whose
   * labels assume they know what the pot is.
   *
   * Ahead of `settled` below for the same reason that block is ahead of the
   * roll: this is what is happening now.
   */
  if (bet?.choosing && bet.call) {
    return (
      <p role="status" aria-live="polite" className="sr-only">
        {`${cardLabel(bet.lying)}, called ${bet.call} — ${cardLabel(
          bet.next,
        )}. Called it. The run is ${potLabel(bet.pot)} over ${bet.won} ${
          bet.won === 1 ? "call" : "calls"
        }.`}
      </p>
    );
  }

  if (settled) {
    /*
     * The two cards, named.
     *
     * Not decoration: the whole bet is a comparison between two cards, and both
     * of them are pips drawn in CSS with nothing an assistive technology can
     * read. Without this the announcement would be "won" or "lost" with no
     * account of why — which is the one outcome in this app somebody might
     * reasonably want to check.
     */
    const cards =
      settled.kind === "highlow" && bet?.call
        ? `${cardLabel(bet.lying)}, called ${bet.call} — ${cardLabel(bet.next)}. `
        : "";

    return (
      <p role="status" aria-live="polite" className="sr-only">
        {settled.kind === "highlow"
          ? // Only ever a loss now. A won call is spoken above, and a won *run*
            // is a ladder PrizeNotice puts on screen and focuses.
            `${cards}Wrong call — the run is gone, and they pick the position`
          : settled.outcome === "won"
            ? "Coin flip won — rolling again"
            : "Coin flip lost — they hold a joker and pick the position"}
      </p>
    );
  }

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {phase === "rolling"
        ? cards
          ? "Drawing"
          : "Rolling"
        : phase === "settled" && landed
          ? `${cards ? "Drew" : "Rolled"} ${result}${blurb ? `. ${blurb}` : ""}`
          : ""}
    </p>
  );
}
