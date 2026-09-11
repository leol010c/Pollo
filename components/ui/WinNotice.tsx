"use client";

import { useEffect, useId, useRef } from "react";
import gsap from "gsap";
import { Heart } from "lucide-react";
import { useDiceStore, useSettledBet } from "@/lib/store";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useDialogFocus } from "@/lib/useDialogFocus";

/**
 * The won bet, said out loud.
 *
 * The twin of ForfeitNotice, and it exists because the two outcomes were not
 * being told to you with anything like the same clarity. Losing opened a notice
 * and asked you to acknowledge it; winning just threw the die again, and the
 * throw you had bet for arrived looking exactly like a throw you had asked for.
 * The bet was won without anybody noticing it had been settled.
 *
 * It serves both gambles. The coin and the card mode's call stake and pay
 * exactly the same thing, so everything structural here is shared and only the
 * two lines of copy branch — see settledBet, which is what spares this file
 * from knowing which one is underneath it.
 *
 * Where it differs from its twin is the one place the two outcomes genuinely
 * differ: this one is not owed anything. A joker has to be acknowledged because
 * somebody now holds it, so that notice waits. This is news, not a debt — it
 * says what happened, holds long enough to be read, and gets on with the throw
 * it promised. Making somebody tap to collect a prize they already won is the
 * anticlimax the automatic re-throw was written to avoid in the first place.
 */

/** Matches the reveal and the joker notice, so all three arrive alike. */
const FADE_TRAVEL = 12;

/**
 * How long the notice stands before the die is thrown, in milliseconds.
 *
 * Long enough to read four words and register what they mean, short enough that
 * it is a beat in the round rather than a screen you wait through. The bar
 * across the bottom of it runs for exactly this long, so the wait is visibly
 * finite and nobody starts hunting for the button that dismisses it.
 */
const DWELL_MS = 1900;

/** How much of the tail of that dwell is spent getting out of the way. */
const LEAVE_SECONDS = 0.36;

/**
 * What each gamble calls a win.
 *
 * The second line is identical because what was won is identical — a fresh
 * result, and the one that just stood is gone. Only the first line names what
 * happened, because only that differs.
 */
const WON = {
  coin: {
    headline: "You won the flip.",
    line: "Throwing again — the position that just stood is gone.",
  },
  highlow: {
    headline: "You called it.",
    line: "Drawing again — the position that just stood is gone.",
  },
} as const;

export function WinNotice() {
  const bet = useSettledBet();
  const settleBet = useDiceStore((s) => s.settleBet);
  const reduced = useReducedMotion();

  const scrimRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // settledBet is already gated on the result being on screen — a coin that has
  // landed, a card that has turned — so this is only asking which way it went.
  // The outcome is decided at the toss and at the deal respectively, so without
  // that gate the notice would open over a coin still in the air.
  const showing = bet?.outcome === "won";
  const betId = bet?.id;
  const words = WON[bet?.kind ?? "coin"];

  // Nothing in here to focus — this notice has no controls, it collects itself
  // on a timer. So focus lands on the dialog itself, which is what its
  // tabIndex={-1} below is for.
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(showing, dialogRef);
  const headingId = useId();

  useEffect(() => {
    const scrim = scrimRef.current;
    const mark = markRef.current;
    const text = textRef.current;
    const bar = barRef.current;
    if (!scrim || !mark || !text || !bar || !showing) return;

    // context().revert() rather than kill(), for the reason FullPicture gives:
    // a `from`-style tween applies its start state immediately, so tearing one
    // down mid-flight would strand what it was animating invisible.
    const ctx = gsap.context(() => {
      const targets = [scrim, mark, text];

      if (reduced) {
        gsap.set(targets, { opacity: 1, y: 0 });
        gsap.set(mark, { scale: 1 });
        gsap.set(bar, { scaleX: 1 });
        return;
      }

      const tl = gsap.timeline();

      tl.fromTo(
        scrim,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power1.out" },
      );
      // The mark opens rather than fades, so the news arrives rather than
      // appearing to have been there.
      tl.fromTo(
        mark,
        { opacity: 0, scale: 0.7 },
        { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" },
        0.06,
      );
      tl.fromTo(
        text,
        { opacity: 0, y: FADE_TRAVEL },
        { opacity: 1, y: 0, duration: 0.4, ease: "power1.out" },
        0.24,
      );
      // Linear, and running the whole dwell: this is a clock, and a clock that
      // eases is lying about how much time is left.
      tl.fromTo(
        bar,
        { scaleX: 0 },
        { scaleX: 1, duration: DWELL_MS / 1000, ease: "none" },
        0,
      );

      /*
       * And it clears before the throw rather than being cut off by it.
       *
       * settleBet fires at the end of the dwell and the next result is on its
       * way on the frame after, so a notice still at full opacity when that
       * happens is a hard cut from a lit screen to a throw already in progress.
       * Leaving early means the room is back before anything moves in it.
       */
      tl.to(
        [scrim, mark, text],
        { opacity: 0, duration: LEAVE_SECONDS, ease: "power1.in" },
        DWELL_MS / 1000 - LEAVE_SECONDS,
      );
      tl.to(bar, { opacity: 0, duration: LEAVE_SECONDS, ease: "power1.in" }, "<");
    });

    return () => ctx.revert();
    // betId, so a second won bet replays rather than sitting there already
    // faded in.
  }, [showing, betId, reduced]);

  /*
   * The throw the flip bought, on its own timer.
   *
   * Deliberately not the animation's onComplete. The dwell is how long the news
   * stands, which is a thing somebody has to be able to read, and under reduced
   * motion there is no animation to hang it off — a notice that dismissed
   * itself instantly there would be a result nobody was shown. settleBet is
   * idempotent for a bet already collected, so a late timer cannot throw twice.
   */
  useEffect(() => {
    if (!showing) return;
    const timer = setTimeout(settleBet, DWELL_MS);
    return () => clearTimeout(timer);
  }, [showing, betId, settleBet]);

  if (!showing) return null;

  return (
    // z-40, the same layer the reveal and the joker notice use — no two of the
    // three are ever up together.
    <div
      ref={dialogRef}
      // Focusable programmatically, never in the tab order. There is nothing to
      // tab to in here, so this is where focus has to land for aria-modal to be
      // telling the truth.
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      {/* The reveal's scrim, unchanged: graded and warm rather than a flat
          wash, so the room is dimmed rather than replaced. No click handler —
          there is nothing to dismiss, it is already leaving. */}
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

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6">
        <div
          ref={markRef}
          aria-hidden="true"
          className="grid size-24 place-items-center rounded-full bg-brand-dim/20 text-brand"
          style={{ opacity: 0 }}
        >
          {/* Filled, where the joker's crown is drawn in outline. The heart is
              the winning face of the coin itself — under a won flip this is the
              same mark lying on the table beneath the scrim — and it is the
              right one for a won call too, on a table whose other suits are
              printed in the same wine. */}
          <Heart className="size-10" fill="currentColor" />
        </div>

        <div
          ref={textRef}
          className="flex flex-col items-center gap-3"
          style={{ opacity: 0 }}
        >
          {/* The display serif, as every other name and title in the app is
              set. This is news, not interface. */}
          <p
            id={headingId}
            className="text-center font-[family-name:var(--font-display)] text-[clamp(2rem,8.5vw,2.75rem)] font-medium leading-[1.1] text-foreground"
          >
            {words.headline}
          </p>
          <p className="max-w-[22rem] text-balance text-center text-sm leading-relaxed text-muted-foreground">
            {words.line}
          </p>
        </div>
      </div>

      {/* Where the joker notice puts its button, so the two moments end in the
          same place. A bar rather than a control: the difference between the
          two outcomes is that this one is not waiting for you. */}
      <div className="relative flex shrink-0 flex-col items-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
        <div
          aria-hidden="true"
          className="h-1 w-full max-w-[22rem] overflow-hidden rounded-full bg-surface-raised"
        >
          <div
            ref={barRef}
            className="h-full w-full rounded-full bg-brand-dim"
            style={{ transform: "scaleX(0)", transformOrigin: "left center" }}
          />
        </div>
      </div>
    </div>
  );
}
