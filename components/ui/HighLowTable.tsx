"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useDiceStore } from "@/lib/store";
import {
  BET_CARD_GAP_PX,
  BET_CARD_WIDTH,
  CALL_RESERVE_REM,
} from "@/lib/cards/layout";
import {
  cardLabel,
  isRed,
  rankLabel,
  type Call,
  type PlayingCard,
} from "@/lib/cards/playing";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { hapticShuffle, hapticThrow } from "@/lib/haptics";
import { playFlip, playShuffle } from "@/lib/audio";
import { CARD_SHADOW, CardBack, FACE, FACE_INK, FACE_RULE, INK } from "./CardStock";
import { SuitMark } from "./SuitMark";

/**
 * The card mode's bet: two cards on the felt, higher or lower.
 *
 * The twin of the coin, and it is worth being clear about what it is *not*. It
 * does not use the position deck. Positions are not more or less than one
 * another — the only ordered thing on a DeckEntry is a three-value intensity,
 * which would make a third of every pair a tie — so the bet brought its own
 * deck of fifty-two ordinary playing cards, the way the coin brought a coin.
 * See lib/cards/playing.ts.
 *
 * A layer of its own rather than a branch inside CardTable. That file has the
 * position deck to look after, twelve hundred lines of it, and two rules about
 * what may touch a preserve-3d subtree that were both paid for in bugs nobody
 * could see. This borrows the rules and none of the state.
 *
 * It owns the turn and reports back with turnHighLow(), exactly as CardTable
 * owns the draw and reports back with settleCard(). The store never reaches in
 * here.
 */

/** The turn, matching CardTable's so a card behaves the same wherever it is. */
const FLIP_DURATION = 0.6;

/** How far a card travels on its way in, in px. */
const DEAL_TRAVEL = 44;
/** And the beat between the two of them, so it reads as a hand dealing. */
const DEAL_STAGGER = 0.09;

/** How long the layer takes to leave once the bet is settled. */
const EXIT_SECONDS = 0.32;
const EXIT_MS = EXIT_SECONDS * 1000;

/**
 * The moment the calls become pressable.
 *
 * PresentControls' delay, so the two bets in this app hand you their choices on
 * the same beat — one after the picture has opened out, one after the card you
 * are calling against has turned face-up.
 */
const CALLS_DELAY = 0.78;

/**
 * One playing card's face.
 *
 * The index — rank over pip — stamped into two diagonally opposite corners and
 * the pip again in the middle, which is the entire visual grammar of a playing
 * card and the same arrangement CardFace uses for a position. A single corner
 * would read as a label on a rectangle; two read as a card.
 *
 * Red is the room's wine rather than a primary red, and black is the same very
 * dark wine the position cards set their names in. Both come off CardStock, so
 * the two decks on this table are demonstrably printed on one press.
 */
function PlayingCardFace({ card }: { card: PlayingCard }) {
  const colour = isRed(card.suit) ? INK : FACE_INK;

  /*
   * A corner: the rank with its pip beneath it.
   *
   * One block used twice, the second rotated a half turn — a real card's index
   * is the same stamp of ink applied twice, and building the two separately is
   * how they drift apart.
   */
  const corner = (
    <div
      className="absolute left-[8%] top-[5.5%] flex w-[18%] flex-col items-center gap-[0.15em] leading-none"
      style={{ color: colour }}
    >
      <span className="font-[family-name:var(--font-display)] text-[clamp(0.95rem,4.6cqw,1.6rem)] font-semibold leading-none">
        {rankLabel(card.rank)}
      </span>
      <span className="w-[62%]">
        <SuitMark suit={card.suit} />
      </span>
    </div>
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl"
      style={{
        background: FACE,
        // The card is turned, so its face is mirrored unless it is flipped back.
        transform: "rotateY(180deg)",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        // So the index can be sized off the card rather than off the viewport —
        // these are half the width of a position card and `vw` type would come
        // out twice as large relative to the stock it is printed on.
        containerType: "inline-size",
      }}
    >
      {/* The rule. Every card has one, and it is most of why a white rectangle
          reads as card stock rather than as paper. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3.5%] rounded-[0.45rem] border"
        style={{ borderColor: FACE_RULE }}
      />

      {/* The artwork carries nothing a screen reader can use — ResultAnnouncer
          names both cards the moment the second one turns. */}
      <div aria-hidden="true" className="absolute inset-0">
        {corner}
        <div className="absolute inset-0 rotate-180">{corner}</div>
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center"
        style={{ color: colour }}
      >
        <div className="w-[42%]">
          <SuitMark suit={card.suit} />
        </div>
      </div>
    </div>
  );
}

/**
 * One card of the pair.
 *
 * The shadow and the perspective sit on the outer box, which never moves, and
 * the turn happens on the inner one. That split is not tidiness: a 44px-blur
 * shadow on an element being rotateY'd is re-rasterised every frame of the
 * turn, and it is also simply how a card behaves — it casts its shadow on the
 * table rather than carrying one round with it.
 */
function BetCard({
  card,
  turnRef,
}: {
  card: PlayingCard;
  turnRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      className="relative aspect-[5/7] shrink-0"
      style={{
        width: BET_CARD_WIDTH,
        boxShadow: CARD_SHADOW,
        borderRadius: "1rem",
        perspective: "1400px",
      }}
    >
      {/*
        The element that turns, and the 3D context itself.

        Nothing may be added to this element's style that groups it: no filter,
        not even an identity `brightness(1)`, and no `will-change`. Both compute
        `transform-style` down to `flat`, which takes the two sides out of 3D
        space and leaves `backface-visibility: hidden` with nothing to hide — so
        the back stays visible through the front and the card turns without ever
        showing its face. CardTable paid for that twice; see shadeFor() and the
        note above its reveal timeline.
      */}
      <div
        ref={turnRef}
        className="relative size-full rounded-2xl"
        style={{ transformStyle: "preserve-3d" }}
      >
        <CardBack />
        <PlayingCardFace card={card} />
      </div>
    </div>
  );
}

export function HighLowTable() {
  const bet = useDiceStore((s) => s.bet);
  const guessHighLow = useDiceStore((s) => s.guessHighLow);
  const turnHighLow = useDiceStore((s) => s.turnHighLow);
  const reduced = useReducedMotion();

  const layerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const lyingRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const callsRef = useRef<HTMLDivElement>(null);

  /*
   * The pair, held past the end of the bet.
   *
   * Settling clears `bet` in the store — a win draws again, a loss pays the
   * joker — and a layer that read straight off it would blank its two cards on
   * that frame, mid-fade, with the notice above it already halfway out of the
   * way. So the last pair is kept and the exit plays against it. The same
   * reason the store keeps `drawn` past layDown().
   */
  const [held, setHeld] = useState(bet);

  /*
   * Whether this is on screen at all — which is not the same as whether a bet
   * is running. Arriving is easy; leaving is the part that needs state, because
   * a component that returns null cannot animate itself out. CardTable's
   * `present` does exactly this for the mode change.
   */
  const open = bet !== null;
  const [present, setPresent] = useState(open);

  /*
   * Focus follows the *bet*, not the layer.
   *
   * `open` rather than `present`, which is the distinction the two states above
   * exist for: `present` stays true through the exit animation, and by then the
   * win or joker notice is already opening and wants focus for itself. Handing
   * it back the moment the bet settles is what lets the next dialog take it
   * cleanly rather than fighting a layer that is on its way out.
   */
  useDialogFocus(open, layerRef);

  // Both adjusted during render rather than in an effect, so the markup and its
  // refs exist on the same commit the entrance is started from. State rather
  // than a ref because a ref written during render is a value React is not
  // allowed to see change — and this one decides what is drawn.
  if (bet && bet !== held) setHeld(bet);
  if (open && !present) setPresent(true);

  const showing = bet ?? held;

  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setPresent(false), EXIT_MS);
    return () => clearTimeout(id);
  }, [open]);

  const betId = showing?.betId;
  const call = bet?.call ?? null;

  /*
   * The deal, and the first card turning over.
   *
   * Keyed on betId so a second bet replays rather than opening already dealt —
   * the same reason CardTable's reveal depends on rollId.
   */
  useEffect(() => {
    const layer = layerRef.current;
    const lying = lyingRef.current;
    const next = nextRef.current;
    const calls = callsRef.current;
    if (!layer || !lying || !next || !calls || !open) return;

    hapticShuffle();

    const ctx = gsap.context(() => {
      // Face-down first, every time. A second bet finds the left card sitting
      // at 180° from the last one, and a tween *to* 180° from 180° animates
      // nothing at all — the card would simply pop. CardTable's reveal opens
      // with the same set, for the same reason.
      gsap.set([lying, next], { rotateY: 0, x: 0, y: 0, scale: 1 });

      if (reduced) {
        gsap.set(layer, { opacity: 1 });
        gsap.set(scrimRef.current, { opacity: 1 });
        gsap.set(lying, { rotateY: 180 });
        gsap.set(calls, { opacity: 1, y: 0 });
        return;
      }

      const tl = gsap.timeline();

      tl.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "power1.out" }, 0);
      tl.fromTo(
        scrimRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power1.out" },
        0,
      );

      // Dealt, not revealed: each card arrives from below with a beat between
      // them, which is the difference between a hand putting two cards down and
      // a dialog appearing.
      tl.call(playShuffle, undefined, 0.05);
      [lying, next].forEach((card, i) => {
        tl.fromTo(
          card,
          { y: DEAL_TRAVEL, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.34, ease: "power3.out" },
          0.05 + i * DEAL_STAGGER,
        );
      });

      // And the left one turns over, so there is something to call against.
      // Lifted, turned, set down — the three beats CardTable's flip uses.
      const turnAt = 0.05 + DEAL_STAGGER + 0.3;
      tl.call(playFlip, undefined, turnAt);
      tl.to(lying, { y: -18, scale: 1.05, duration: 0.18, ease: "power2.out" }, turnAt);
      tl.to(
        lying,
        { rotateY: 180, duration: FLIP_DURATION - 0.16, ease: "power2.inOut" },
        turnAt + 0.08,
      );
      tl.to(
        lying,
        { y: 0, scale: 1, duration: 0.26, ease: "power2.out" },
        turnAt + FLIP_DURATION - 0.26,
      );

      // Last, after the card they are about to be pressed against. Being able
      // to call before seeing what you are calling on would make the delay the
      // only thing standing between the bet and a coin flip.
      tl.fromTo(
        calls,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power1.out" },
        turnAt + CALLS_DELAY,
      );
    });

    return () => ctx.revert();
  }, [betId, open, reduced]);

  /*
   * The call, answered.
   *
   * Its own effect rather than a branch of the deal above: it is triggered by a
   * gesture at an unpredictable time, and reverting the deal's context to make
   * room for it would put both cards back face-down.
   */
  useEffect(() => {
    const next = nextRef.current;
    const calls = callsRef.current;
    if (!next || !calls || call === null) return;

    hapticThrow();

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(calls, { opacity: 0 });
        gsap.set(next, { rotateY: 180, y: 0, scale: 1 });
        turnHighLow();
        return;
      }

      const tl = gsap.timeline({ onComplete: turnHighLow });

      // The choices go first. They have been made, and leaving them under a
      // card that is turning invites a second press at the one moment nothing
      // could act on it.
      tl.to(calls, { opacity: 0, y: 8, duration: 0.2, ease: "power1.in" }, 0);

      tl.call(playFlip, undefined, 0.08);
      tl.to(next, { y: -18, scale: 1.05, duration: 0.18, ease: "power2.out" }, 0.08);
      tl.to(
        next,
        { rotateY: 180, duration: FLIP_DURATION - 0.16, ease: "power2.inOut" },
        0.16,
      );
      tl.to(
        next,
        { y: 0, scale: 1, duration: 0.26, ease: "power2.out" },
        0.08 + FLIP_DURATION - 0.26,
      );
      // A beat with both cards face-up before anything is said about them. The
      // comparison is the whole bet and it deserves to be seen being made.
      tl.to({}, { duration: 0.3 });
    });

    return () => ctx.revert();
  }, [call, betId, reduced, turnHighLow]);

  /*
   * Leaving.
   *
   * Deliberately not a gsap.context: reverting one on cleanup would restore the
   * layer to full opacity on the exact frame it is meant to be gone. Killing
   * the tween instead leaves it wherever it got to.
   */
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || open) return;

    if (reduced) {
      gsap.set(layer, { opacity: 0 });
      return;
    }
    gsap.to(layer, { opacity: 0, duration: EXIT_SECONDS, ease: "power1.in" });

    return () => {
      gsap.killTweensOf(layer);
    };
  }, [open, reduced]);

  if (!present || !showing) return null;

  const called = call !== null;

  const callButton = (which: Call, label: string) => (
    <button
      type="button"
      onClick={() => guessHighLow(which)}
      disabled={called}
      aria-label={`Call the next card ${which} than the ${cardLabel(showing.lying)}`}
      className="press pointer-events-auto flex h-12 flex-1 items-center justify-center rounded-full bg-brand-dim text-sm font-semibold text-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {label}
    </button>
  );

  return (
    // z-40, the layer the reveals use. The two notices are siblings after this
    // one in DiceApp, so a settled bet is spoken about over the top of the pair
    // it was settled by rather than in place of it.
    <div
      ref={layerRef}
      className="fixed inset-0 z-40 flex flex-col"
      style={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Higher or lower"
    >
      {/*
        The reveal's scrim at the notices' density rather than CardTable's.

        The position deck is directly underneath — its own card is turning back
        down as this opens — and two decks half-visible through each other is
        the one thing that would make a second deck on this table a mistake.
        No click handler: the bet has been taken, and a stray tap on the felt
        must not be able to spend it.
      */}
      <div
        ref={scrimRef}
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.91) 0%, rgba(16,5,11,0.94) 55%, rgba(7,2,5,0.97) 100%)",
        }}
      />

      {/*
        The pair, centred on the viewport — against the viewport itself and not
        against whatever space the calls leave over, which is the mistake
        verify:cards exists because of. The calls below are absolutely
        positioned for the same reason, and betCardWidthAt() reserves their
        height at both ends before choosing a width.
      */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ gap: BET_CARD_GAP_PX }}
      >
        <BetCard card={showing.lying} turnRef={lyingRef} />
        <BetCard card={showing.next} turnRef={nextRef} />
      </div>

      <div
        ref={callsRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
        style={{ opacity: 0, minHeight: `${CALL_RESERVE_REM}rem` }}
      >
        <p className="text-center text-xs text-muted-foreground">
          Win and the deck draws again — lose and they pick.
        </p>
        <div className="flex w-full max-w-[22rem] gap-2">
          {callButton("lower", "Lower")}
          {callButton("higher", "Higher")}
        </div>
      </div>
    </div>
  );
}
