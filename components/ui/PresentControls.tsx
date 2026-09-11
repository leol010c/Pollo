"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Coins, Heart, Spade } from "lucide-react";
import { useBetOffer, useDiceStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { StakeGambler } from "./StakeGambler";

/**
 * What you can do with a result: gamble how much of it you get, rule it out, go
 * again, or put it back.
 *
 * Ordered by intent rather than by weight. The gamble is the thing worth doing
 * *with* the position; the pair below are ways of leaving it; putting it back is
 * the quietest, because tapping anywhere already does the same.
 *
 * Shared by both modes without a branch anywhere except the word on one button.
 * That is what currentEntry() in the store buys: the bar acts on a position, and
 * a position is the same object whether a die landed on it or a card was turned
 * over to find it.
 */
export function PresentControls() {
  const phase = useDiceStore((s) => s.phase);
  const mode = useDiceStore((s) => s.mode);
  // Subscribed to rather than read once: currentEntry() is a getter over state
  // the component must re-render on, and neither of these is otherwise read
  // here, so without them the bar would keep acting on the previous result.
  useDiceStore((s) => s.value);
  useDiceStore((s) => s.drawn);
  const layDown = useDiceStore((s) => s.layDown);
  const play = useDiceStore((s) => s.play);
  const notTonight = useDiceStore((s) => s.notTonight);
  const favourites = useDiceStore((s) => s.favourites);
  const toggleFavourite = useDiceStore((s) => s.toggleFavourite);
  const flipCoin = useDiceStore((s) => s.flipCoin);
  const openHighLow = useDiceStore((s) => s.openHighLow);
  // Asked rather than restated. betOffer() in the store is the single place
  // these conditions live, so nothing here can drift out of step with it.
  const offer = useBetOffer();
  const reduced = useReducedMotion();

  // Wilds can be favoured like anything else — the load is applied to whatever
  // face carries them, and a wild is a face like any other.
  const landed = useDiceStore.getState().currentEntry();
  const favoured = landed ? favourites.includes(landed.id) : false;

  const barRef = useRef<HTMLDivElement>(null);

  const presenting = phase === "settled" && Boolean(landed);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !presenting) return;

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(bar, { opacity: 1, y: 0 });
        return;
      }
      // Arrives after the picture and its name, so the eye goes to the result
      // first and the choices last.
      gsap.fromTo(
        bar,
        // Small travel, matching the rest of the reveal — past ~16px a fade
        // starts reading as a slide.
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power1.out", delay: 0.78 },
      );
    });

    return () => ctx.revert();
  }, [presenting, reduced]);

  return (
    <div
      ref={barRef}
      // A row in the die's reveal, an overlay in card mode. CardTable wraps it;
      // FullPicture lets it sit in the column.
      className="pointer-events-none relative z-30 flex shrink-0 flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
      style={{
        opacity: 0,
        /*
         * Hidden outright when there is no result, not merely transparent.
         *
         * `opacity: 0` hides a control from the eye and from nothing else: the
         * buttons inside carry `pointer-events: auto` and went on swallowing
         * every tap that landed on them. That cost nothing while this was a row
         * in a flex column with its own band of the screen to itself — there
         * was never anything underneath it to swallow taps from. As an overlay
         * over a centred card it sits directly on top of the pile count, and it
         * silently ate the Shuffle chip.
         *
         * FullPicture has always gated its whole layer this way. This is the
         * same fix one level down.
         */
        visibility: presenting ? "visible" : "hidden",
      }}
    >
      {/*
        The bet, above the gamble, above the plain actions.

        Both of these stake something and the ordering between them is the order
        you would reach for them in: this one is about whether you keep the
        position at all, and the gamble below is about how much of it you get —
        so the question this answers comes first.

        One slot, one bet, and which one depends on what is on the table: the
        die gets a coin, the cards get a call. They are the same offer at the
        same stake, and betOffer() is the single place that decides which — a
        second copy of that reasoning here is how the two would end up both
        showing, or neither. Both actions refuse in the store regardless of what
        is rendered; this keeps a button that could do nothing off the screen.
      */}
      {offer === "flip" && (
        <button
          type="button"
          onClick={flipCoin}
          title="Flip a coin — win and the die throws again, lose and they pick"
          className="panel press pointer-events-auto flex h-12 w-full max-w-[22rem] items-center justify-center gap-2 rounded-full text-sm font-medium text-foreground transition-colors hover:text-brand"
        >
          <Coins className="size-4" aria-hidden="true" />
          Flip for another
        </button>
      )}

      {offer === "call" && (
        <button
          type="button"
          onClick={openHighLow}
          title="Call the next card higher or lower — win and the deck draws again, lose and they pick"
          className="panel press pointer-events-auto flex h-12 w-full max-w-[22rem] items-center justify-center gap-2 rounded-full text-sm font-medium text-foreground transition-colors hover:text-brand"
        >
          <Spade className="size-4" aria-hidden="true" />
          Higher or lower
        </button>
      )}

      {/* The gamble sits above the plain actions: it is the thing worth doing
          with a result, and the others are ways of leaving it. */}
      <StakeGambler />

      <div className="pointer-events-auto flex w-full max-w-[22rem] gap-2">
        {/*
          Weighting the die, opposite the ruling-out beside it. Icon-only
          because the pair of words next to it already crowd a phone — the
          label lives in aria-label and title so it is never icon-alone to a
          screen reader.
        */}
        <button
          type="button"
          onClick={() => landed && toggleFavourite(landed.id)}
          disabled={!landed}
          aria-pressed={favoured}
          // Says what favouriting actually does, which is different per mode:
          // the die is physically weighted toward a favourite, while a pile is
          // drawn through in full regardless — there it is a note, not a thumb
          // on the scales. Claiming otherwise in card mode would be a lie the
          // user could catch by counting.
          aria-label={
            favoured
              ? "Remove from favourites"
              : mode === "cards"
                ? "Favourite this position"
                : "Favourite — the die will lean toward this"
          }
          title={
            favoured
              ? mode === "cards"
                ? "Favourited"
                : "Favourited — the die leans toward this"
              : mode === "cards"
                ? "Favourite this position"
                : "Favourite — weight the die toward this"
          }
          className={`panel press grid size-12 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 ${
            favoured
              ? "text-brand"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Heart
            className="size-4"
            fill={favoured ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>

        {/*
          No icon. A thumbs-down on a picture of two people is a rating gesture
          borrowed from a review app, and it was the one thing in this row that
          was actively wrong in tone rather than merely busy. The words are
          clear on their own.
        */}
        <button
          type="button"
          onClick={notTonight}
          className="panel press flex h-12 flex-1 items-center justify-center rounded-full text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Not tonight
        </button>

        {/*
          `--brand-dim` rather than `--brand`.

          The full brand at #ec5f86 filled as a solid slab was the loudest thing
          on the screen after the artwork — a flat hot pink that belongs to a
          sign-up button, sitting directly under a candlelit photograph. The dim
          variant has been defined and unused since the palette was written, and
          this is the case it was for: still unmistakably the primary action,
          without shouting over the thing it is an action on.
        */}
        <button
          type="button"
          onClick={play}
          className="press flex h-12 flex-1 items-center justify-center rounded-full bg-brand-dim text-sm font-semibold text-foreground transition-opacity hover:opacity-90"
        >
          {mode === "cards" ? "Draw again" : "Roll again"}
        </button>
      </div>

      {/* Small type, full-size target. The text stays quiet — this is the
          quietest action on the screen — but the box a thumb has to hit is the
          same 44px as everything else. */}
      <button
        type="button"
        onClick={layDown}
        className="press pointer-events-auto inline-flex min-h-11 items-center px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Put back
      </button>
    </div>
  );
}
