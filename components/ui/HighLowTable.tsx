"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RUN_LIMIT, rungsFor, useDiceStore } from "@/lib/store";
import {
  BET_CARD_GAP_PX,
  BET_CARD_WIDTH,
  CALL_RESERVE_REM,
} from "@/lib/cards/layout";
import {
  cardLabel,
  isRed,
  payoutFor,
  potLabel,
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
import { RUNG_COPY } from "./prizeCopy";

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
 *
 * ## The run
 *
 * One call was a coin with cards painted on it — better than a coin, because
 * you could see what you were calling against, but still one yes or no. It is a
 * run now: win, and the card you just won on becomes the card you call against,
 * with a fresh one face-down beside it. Take the pot or push it, up to
 * RUN_LIMIT calls.
 *
 * Two things carry the whole idea, and both are the store's rather than this
 * file's — see oddsFor and payoutFor:
 *
 *  - **The percentages on the buttons are true.** The shoe is dealt without
 *    replacement and survives between bets, so they are counted off the cards
 *    nobody has seen, not read from a table. By the fourth call they are
 *    genuinely not a fresh deck's numbers.
 *
 *  - **The price is the inverse of the chance**, so the app has no edge. It
 *    also means the safe side of a call pays nothing worth having, and a seven
 *    pays the same either way — a run that lasts has to take a real risk
 *    whether or not the person taking it wanted one.
 *
 * What that buys at the end is a rung of the prize ladder, and PrizeNotice
 * handles that. This layer's job ends when the run is collected.
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
  const runAgain = useDiceStore((s) => s.runAgain);
  const collectRun = useDiceStore((s) => s.collectRun);
  const reduced = useReducedMotion();

  const layerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const lyingRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLDivElement>(null);
  const callsRef = useRef<HTMLDivElement>(null);

  /*
   * The pair, held past the end of the bet.
   *
   * Collecting clears `bet` in the store — the prize ladder opens over it, or a
   * loss pays the forfeit — and a layer that read straight off it would blank
   * its two cards on that frame, mid-fade, with the notice above it already
   * halfway out of the way. So the last pair is kept and the exit plays against
   * it. The same reason the store keeps `drawn` past layDown().
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
   * prize or forfeit notice is already opening and wants focus for itself.
   * Handing it back the moment the run ends is what lets the next dialog take
   * it cleanly rather than fighting a layer that is on its way out.
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
  const choosing = bet?.choosing ?? false;

  /*
   * The deal, and the first card turning over.
   *
   * Keyed on betId so every call of the run replays — the same reason
   * CardTable's reveal depends on rollId.
   */
  useEffect(() => {
    const layer = layerRef.current;
    const lying = lyingRef.current;
    const next = nextRef.current;
    const calls = callsRef.current;
    if (!layer || !lying || !next || !calls || !open) return;

    hapticShuffle();

    /*
     * Whether this deal is a run being pushed rather than a bet being opened.
     *
     * The distinction the whole entrance turns on. A first call is two cards
     * arriving on an empty felt and one of them turning over. A pushed call is
     * neither: the layer is already up, and the card on the left is the one
     * that was face-up on the right a moment ago — it has been *seen*, and
     * dealing it face-down to turn it over a second time would be the app
     * pretending not to know something it just showed you.
     *
     * Read off the store here rather than computed in render, and that is not a
     * shortcut — it is what keeps it out of this effect's dependencies. As a
     * rendered value it changes the instant the card turns and again the
     * instant the first call is won, and either would re-run the deal in the
     * middle of a flip: both cards set back to face-down, the timeline reverted
     * underneath itself, the pair re-dealt over a call somebody is watching.
     * A deal depends on the deal, which is `betId` and nothing else.
     */
    const pushed = (useDiceStore.getState().bet?.won ?? 0) > 0;

    const ctx = gsap.context(() => {
      /*
       * Face-down first, every time — except the card that is already known.
       *
       * A second bet finds the left card sitting at 180° from the last one, and
       * a tween *to* 180° from 180° animates nothing at all: the card would
       * simply pop. CardTable's reveal opens with the same set, for the same
       * reason. On a pushed call the set goes the other way, because there the
       * left card is *meant* to start face-up.
       */
      gsap.set(next, { rotateY: 0, x: 0, y: 0, scale: 1 });
      gsap.set(lying, { rotateY: pushed ? 180 : 0, x: 0, y: 0, scale: 1 });

      /*
       * And the layer is up. Stated for every path, before any of them branch.
       *
       * This looks redundant and is the opposite. A gsap.context **reverts on
       * cleanup**, so the first thing that happens when betId changes is that
       * the previous deal's tweens are undone — including the layer's fade from
       * the `opacity: 0` it is authored at. Cleanup puts it back to 0, and any
       * path that does not fade it in again leaves the whole bet invisible.
       *
       * That is not a cosmetic failure. `bet` is still set while the layer is
       * invisible, so bettingNow() has every control in the app standing down
       * with nothing on screen to explain why — a live position deck that
       * refuses every tap, and no way out but a reload. It shipped exactly once,
       * on the pushed call, which was the one path written on the assumption
       * that the layer was "already up".
       *
       * So it is hoisted above the branches rather than repaired inside the one
       * that was wrong, and the next path added here inherits it. The fade below
       * still starts from 0 explicitly, so the opening is unchanged.
       */
      gsap.set([layer, scrimRef.current], { opacity: 1 });

      if (reduced) {
        gsap.set(lying, { rotateY: 180 });
        gsap.set(calls, { opacity: 1, y: 0 });
        return;
      }

      const tl = gsap.timeline();

      /*
       * A pushed call: the winner slides across, and one card joins it.
       *
       * What moves is the card: it was on the right, it is on the left now, and
       * it travels the width of the gap rather than teleporting. The layer is
       * not re-faded — a fresh fade between calls would read as the screen
       * reloading, which is precisely the feeling a run should not have.
       *
       * Note what is *not* here: a fade of the layer. It is held visible by the
       * set above, which every path shares — see the note there, and the bug
       * that came of this branch assuming it instead.
       *
       * The slide distance is measured rather than computed: BET_CARD_WIDTH is
       * a CSS `min()` over mixed units, which is a number only the browser has.
       */
      if (pushed) {
        const step = lying.parentElement
          ? lying.parentElement.getBoundingClientRect().width + BET_CARD_GAP_PX
          : 0;

        tl.fromTo(
          lying,
          { x: step },
          { x: 0, duration: 0.42, ease: "power3.out" },
          0,
        );
        tl.call(playShuffle, undefined, 0.05);
        tl.fromTo(
          next,
          { y: DEAL_TRAVEL, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.34, ease: "power3.out" },
          0.12,
        );
        // Straight to the calls. There is nothing to turn over — that is the
        // point of pushing — so the delay that exists to stop you calling
        // blind has nothing to wait for.
        tl.fromTo(
          calls,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.34, ease: "power1.out" },
          0.34,
        );
        return;
      }

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
   * The won call, and the two moves it opens.
   *
   * The calls faded out when the card was called; this brings the same strip
   * back with take and push in it. A separate effect because it is triggered by
   * the *store* deciding the call was right, which happens a beat after the
   * turn finishes — and because the deal's context must not be reverted to make
   * room for it.
   */
  useEffect(() => {
    const calls = callsRef.current;
    if (!calls || !choosing) return;

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(calls, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        calls,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.34, ease: "power2.out" },
      );
    });

    return () => ctx.revert();
  }, [choosing, betId, reduced]);

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
  const { odds, pot, won } = showing;

  /*
   * One call, priced.
   *
   * Both numbers come off the bet rather than being recomputed here — see
   * `odds` on HighLow. The percentage is what this call's chance actually is on
   * the shoe as it stands, and the multiplier is what taking it is worth, which
   * is its inverse.
   *
   * A call that cannot win is turned off rather than offered at long odds.
   * Late in a shoe, "lower than a two" can genuinely be a card that is not in
   * there any more, and a button reading 0% is worse than no button: it invites
   * the tap it is going to refuse.
   */
  const callButton = (which: Call, label: string) => {
    const chance = odds[which];
    const pays = payoutFor(chance);
    const dead = chance <= 0;

    return (
      <button
        type="button"
        onClick={() => guessHighLow(which)}
        disabled={called || dead}
        aria-label={`Call the next card ${which} than the ${cardLabel(
          showing.lying,
        )} — ${Math.round(chance * 100)} percent, paying ${pays.toFixed(2)} times`}
        className="press pointer-events-auto flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-dim text-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <span className="text-sm font-semibold leading-none">{label}</span>
        <span
          aria-hidden="true"
          className="text-[0.68rem] leading-none text-muted-foreground"
        >
          {dead ? "not in the shoe" : `${Math.round(chance * 100)}% · ${potLabel(pays)}`}
        </span>
      </button>
    );
  };

  /*
   * What the pot is already worth, named.
   *
   * The best rung it reaches, printed under the take button. Somebody deciding
   * whether to push is deciding between a thing they can have now and a thing
   * they might have — and that is not a decision anybody can make against a
   * bare number. See RUNG_COPY.
   */
  const reached = rungsFor(pot);
  const best = reached[reached.length - 1];

  return (
    // z-40, the layer the reveals use. The notices are siblings after this one
    // in DiceApp, so a settled run is spoken about over the top of the pair it
    // was settled by rather than in place of it.
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

        ## Why this one takes a tap, when the rule elsewhere is that it must not

        A scrim over a bet has always been inert here, and the reason is good: a
        stray tap on the felt must not be able to *spend* a bet somebody has
        taken. That reason does not reach the state below it, and leaving it
        unexamined left a hole worth more than the rule.

        A run stopped on a win holds `bet` non-null, and `bettingNow()` is
        derived from exactly that — so while the run waits, every control in the
        app stands down. Before the run there was no such state: a won call
        settled itself after a dwell, so nothing could ever wait indefinitely. A
        run waits by design, and waits on two buttons. If those buttons are ever
        missed — a tap that lands badly, a strip drawn somewhere unexpected on a
        viewport nobody tried — there is no other way out and the whole app is
        simply dead, with no clue that the cards are what is holding it. That
        reads as a freeze, because it is one.

        So the scrim is an escape, and it escapes in the only direction that is
        safe: it **collects**. Never a call, never a push, never a loss — the
        worst a stray tap can do is bank a run somebody was still thinking about
        pushing, which is the same thumb on the same side of the scale as a
        match counting as a win. And only while the run is stopped: with a call
        still live there is no handler at all and the old rule applies unchanged.

        What does not change either way is that the scrim goes on *absorbing*
        taps. It is opaque to them whether or not it does anything with one, and
        turning that off to make the inert case literal would drop the tap
        through onto the position deck underneath — a live table with a card on
        it, and the one thing this layer exists to cover.
      */}
      <div
        ref={scrimRef}
        aria-hidden="true"
        className="absolute inset-0"
        onClick={choosing ? collectRun : undefined}
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.91) 0%, rgba(16,5,11,0.94) 55%, rgba(7,2,5,0.97) 100%)",
        }}
      />

      {/*
        The run so far: how many calls are in it, and what they are worth.

        In the space the centring already reserves at the top — see
        CALL_RESERVE_REM, which is taken off both ends precisely so a centred
        card keeps its air. Nothing here may grow past it or the cards move.

        Hidden entirely on the first call, when there is no run yet and a row of
        empty pips over a ×1.00 would be the interface promising a game that has
        not started.
      */}
      {won > 0 && (
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1.5 px-4 pt-[max(1rem,env(safe-area-inset-top))]"
      >
        <div aria-hidden="true" className="flex items-center gap-1.5">
          {Array.from({ length: RUN_LIMIT }, (_, i) => (
            <span
              key={i}
              className="size-1.5 rounded-full transition-colors"
              style={{
                background: i < won ? "var(--brand)" : "rgba(255,255,255,0.22)",
              }}
            />
          ))}
        </div>
        <p className="font-[family-name:var(--font-display)] text-2xl font-semibold leading-none text-foreground">
          {potLabel(pot)}
        </p>
      </div>
      )}

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
        {choosing ? (
          <>
            <p className="text-center text-xs text-muted-foreground">
              {won >= RUN_LIMIT
                ? "That is the run. Collect it."
                : `${RUN_LIMIT - won} more ${
                    RUN_LIMIT - won === 1 ? "call" : "calls"
                  } if you want them — lose one and the run goes with it.`}
            </p>
            <div className="flex w-full max-w-[22rem] gap-2">
              <button
                type="button"
                onClick={collectRun}
                aria-label={`Take the run, ${potLabel(pot)} — ${RUNG_COPY[best].name}`}
                className="press pointer-events-auto flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand text-foreground transition-opacity hover:opacity-90"
              >
                <span className="text-sm font-semibold leading-none">
                  Take {potLabel(pot)}
                </span>
                <span
                  aria-hidden="true"
                  className="text-[0.68rem] leading-none opacity-70"
                >
                  {RUNG_COPY[best].name}
                </span>
              </button>
              {won < RUN_LIMIT && (
                <button
                  type="button"
                  onClick={runAgain}
                  aria-label="Go again, staking the whole run on one more call"
                  className="press pointer-events-auto flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand-dim text-foreground transition-opacity hover:opacity-90"
                >
                  <span className="text-sm font-semibold leading-none">Go again</span>
                  <span
                    aria-hidden="true"
                    className="text-[0.68rem] leading-none text-muted-foreground"
                  >
                    all of it
                  </span>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-center text-xs text-muted-foreground">
              {won > 0
                ? "Call it again. A match still counts as a win."
                : "Win and you choose — lose and they do."}
            </p>
            <div className="flex w-full max-w-[22rem] gap-2">
              {callButton("lower", "Lower")}
              {callButton("higher", "Higher")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
