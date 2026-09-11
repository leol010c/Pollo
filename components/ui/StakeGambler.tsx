"use client";

import { useEffect, useRef, useState } from "react";
import { Coins, X } from "lucide-react";
import { STAKES, useDiceStore } from "@/lib/store";
import type { Measure } from "@/lib/dice/deck";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { hapticSettle } from "@/lib/haptics";

/**
 * Gambles how much of the position you get.
 *
 * The die decides what; this decides how much — and you don't get to choose.
 * That's the whole appeal: committing before you know the number is a different
 * feeling from setting it yourself, and it turns a single roll into a round.
 *
 * What "how much" means comes from the position, not from a setting. Most are
 * counted in strokes; the slow and mutual ones keep a clock. See Measure in
 * lib/dice/deck.ts for why that is a property of the position.
 *
 * Was TimeGambler, when a duration was the only thing on offer. The rename is
 * the point: a duration is the one thing in this app that can only be *watched*,
 * and a clock draining on screen keeps the phone in the room at exactly the
 * moment it should be face-down. A count doesn't — you are told a number and the
 * screen has no further business.
 */

/** How long the wheel spins before it settles. */
const SPIN_MS = 1100;

/** The clock, as m:ss — or bare seconds under a minute, where m:ss is fussy. */
function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/** What the wheel shows mid-spin, in either unit. */
function formatStake(measure: Measure, amount: number) {
  return measure === "time" ? formatTime(amount) : String(amount);
}

/**
 * A stake that has been taken, until it is cancelled or the round ends.
 *
 * Its own component so that it can be **keyed on the deadline**, which is what
 * keeps the countdown honest. `now` starts at whatever the clock said when this
 * mounted, and a component that outlived its deadline would go on measuring
 * against a clock read before the stake existed — the first frame after
 * committing would then be too high by however long somebody sat looking at the
 * result before deciding to gamble, and would snap downward 250ms later.
 *
 * Remounting per deadline makes that unrepresentable rather than merely fixed:
 * there is no path by which `now` predates the `endsAt` it is compared with.
 * (Inherited from TimeGambler, which had the flinch. Caught by seeding a
 * 62-second stake on a page left open a while and watching it render 1:26.)
 */
function RunningStake({
  measure,
  amount,
  endsAt,
  gambled,
  won,
}: {
  measure: Measure;
  amount: number;
  endsAt?: number;
  gambled?: boolean;
  won?: boolean;
}) {
  const clearStake = useDiceStore((s) => s.clearStake);
  const doubleOrNothing = useDiceStore((s) => s.doubleOrNothing);

  const timed = endsAt !== undefined;
  const [now, setNow] = useState(() => Date.now());

  /*
   * Counts down against a wall-clock deadline rather than decrementing.
   *
   * A phone locks, the tab backgrounds, timers throttle — an interval that
   * subtracts a second each tick quietly drifts and ends up wrong. Ticking a
   * clock and deriving the remainder from the deadline stays correct however
   * long the tab was away.
   *
   * Only ever runs for a timed stake. A count has no deadline to chase, so this
   * does not start at all — which is the saving, not an edge case.
   */
  useEffect(() => {
    if (!timed) return;

    let id: ReturnType<typeof setTimeout>;

    /*
     * One render per second shown, aimed at the boundary rather than sampled
     * four times over it.
     *
     * This was a flat 250ms interval, which re-rendered this subtree four times
     * for every change it could possibly display — the readout is whole seconds
     * and the drain bar is derived from them. A stake can be live for minutes,
     * and every one of those renders was competing with the room for the same
     * frame. Scheduling against the deadline instead means the value is never
     * stale *and* never redrawn for a number that has not moved.
     *
     * The wall-clock reasoning above is untouched: this still derives the
     * remainder from `endsAt` rather than decrementing, so a phone that locked
     * for a minute comes back correct.
     */
    const tick = () => {
      setNow(Date.now());

      const left = endsAt - Date.now();
      // Spent. Nothing further will change, so nothing further is scheduled.
      if (left <= 0) return;

      // Where the displayed second next turns over, plus a hair so the timer
      // fires just after the boundary rather than a millisecond short of it and
      // having to come back for the same value.
      id = setTimeout(tick, (left % 1000 || 1000) + 20);
    };

    const left = endsAt - Date.now();
    id = setTimeout(tick, left <= 0 ? 0 : (left % 1000 || 1000) + 20);

    return () => clearTimeout(id);
  }, [timed, endsAt]);

  const remaining = timed ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const done = timed && remaining === 0;

  // One buzz when the time runs out, not one per tick. Timed stakes only —
  // nothing "ends" on a count, so there is no moment to mark.
  const rang = useRef(false);
  useEffect(() => {
    if (done && !rang.current) {
      rang.current = true;
      hapticSettle(1);
    }
  }, [done]);

  // The drain, for a clock only. A count does not deplete on its own — whoever
  // is counting is the only thing that knows how far through it is.
  const progress = timed && amount > 0 ? remaining / amount : 0;

  return (
    <div className="pointer-events-auto flex w-full max-w-[22rem] flex-col items-center gap-2">
      <div className="flex w-full items-center gap-3">
        <div className="panel relative flex h-12 flex-1 items-center justify-center overflow-hidden rounded-full">
          {/* Drains left to right. A bar rather than a ring: it reads at a glance
            from across a room, which a thin arc does not. Timed stakes only. */}
          {timed && (
            <span
              className="absolute inset-y-0 left-0 bg-brand/20 transition-[width] duration-200 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          )}
          <span
            className={`relative flex items-baseline gap-1.5 ${
              done ? "text-brand" : "text-foreground"
            }`}
          >
            <span className="tabular text-lg font-semibold">
              {timed ? (done ? "Time" : formatTime(remaining)) : amount}
            </span>
            {/* The unit, said once. A bare "40" on a pill is not a sentence, and
                this is a number somebody has to carry away from the screen and
                remember — so it says what it is. The clock needs no such label;
                a draining bar under m:ss explains itself. */}
            {!timed && (
              <span className="text-xs font-medium text-muted-foreground">
                strokes
              </span>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={clearStake}
          aria-label={timed ? "Cancel timer" : "Cancel the count"}
          className="panel press grid size-12 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/*
        The second gamble, offered once — and for a clock, only while there is
        still time to stake. Taking it after the clock has run out would be
        staking nothing, and a button that does nothing is worse than no button.

        A count has no such expiry: it is over when the two of you say it is, and
        the app has no view on when that was. So the offer simply stands until it
        is taken.
      */}
      {!gambled && !done && (
        <button
          type="button"
          onClick={doubleOrNothing}
          className="press inline-flex min-h-11 items-center gap-1.5 px-4 text-xs text-muted-foreground transition-colors hover:text-brand"
        >
          <Coins className="size-3.5" aria-hidden="true" />
          Double or nothing
        </button>
      )}

      {gambled && (
        <p
          className={`text-xs font-medium ${
            won ? "text-brand" : "text-muted-foreground"
          }`}
        >
          {won
            ? "Doubled."
            : `Nothing — down to ${formatStake(measure, amount)}${
                measure === "strokes" ? " strokes" : ""
              }.`}
        </p>
      )}
    </div>
  );
}

export function StakeGambler() {
  const stake = useDiceStore((s) => s.stake);
  const startStake = useDiceStore((s) => s.startStake);
  // Subscribed to, so the button relabels when the result under it changes.
  useDiceStore((s) => s.value);
  useDiceStore((s) => s.drawn);
  const reduced = useReducedMotion();

  /*
   * Which unit is on the table.
   *
   * From the position while nothing is staked, and from the stake itself once
   * one is — because the stake is the authority the moment it exists, and a
   * running count must not change units underneath itself if the entry beneath
   * it is ever cleared.
   *
   * Absent means time. That is the safe default rather than an oversight: a
   * duration applies to anything, including a wild that names no activity and a
   * picture nobody has written an entry for yet.
   */
  const entry = useDiceStore.getState().currentEntry();
  const measure: Measure = stake?.measure ?? entry?.measure ?? "time";

  const wheel = STAKES[measure];
  const [spinning, setSpinning] = useState(false);
  const [shown, setShown] = useState(wheel[0]);

  // Deciding here rather than inside an effect: the spin is something the tap
  // starts, not something that follows from a state change.
  const gamble = () => {
    if (reduced) {
      const landed = wheel[Math.floor(Math.random() * wheel.length)];
      setShown(landed);
      startStake(measure, landed);
      return;
    }
    setSpinning(true);
  };

  /*
   * The spin. Cycles the face value, decelerating, then commits.
   *
   * Scheduled to the next change rather than polled every frame. It used to
   * re-arm `requestAnimationFrame` on all sixty frames of every second and
   * decide on each of them whether enough time had passed to show a different
   * number — which is fifty-odd wake-ups a second doing nothing, on top of the
   * ten or so that actually render. The room is being drawn underneath this.
   *
   * The deceleration is unchanged: the gap between values still opens from 45ms
   * to 195ms across the spin, and it is still measured against the wall clock
   * rather than counted in frames, so the spin lasts SPIN_MS however the
   * scheduler behaves.
   */
  useEffect(() => {
    if (!spinning) return;

    const started = Date.now();
    let id: ReturnType<typeof setTimeout>;
    const roll = () => wheel[Math.floor(Math.random() * wheel.length)];

    const step = () => {
      const elapsed = Date.now() - started;

      if (elapsed >= SPIN_MS) {
        const landed = roll();
        setShown(landed);
        setSpinning(false);
        startStake(measure, landed);
        return;
      }

      setShown(roll());
      // Slows as it goes, so it reads as settling rather than stopping dead.
      const gap = 45 + (elapsed / SPIN_MS) * 150;
      id = setTimeout(step, gap);
    };

    id = setTimeout(step, 45);
    return () => clearTimeout(id);
  }, [spinning, startStake, measure, wheel]);

  if (stake) {
    return (
      // Keyed on the deadline, which is what guarantees the countdown starts
      // from a clock read after the stake existed. See RunningStake.
      <RunningStake
        key={stake.endsAt ?? "count"}
        measure={stake.measure}
        amount={stake.amount}
        endsAt={stake.endsAt}
        gambled={stake.gambled}
        won={stake.won}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={gamble}
      disabled={spinning}
      className="panel press pointer-events-auto flex h-12 w-full max-w-[22rem] items-center justify-center rounded-full text-sm font-medium text-foreground transition-colors hover:text-brand disabled:opacity-80"
    >
      {spinning ? (
        <span className="tabular">{formatStake(measure, shown)}</span>
      ) : measure === "strokes" ? (
        "Gamble the strokes"
      ) : (
        "Gamble the time"
      )}
    </button>
  );
}
