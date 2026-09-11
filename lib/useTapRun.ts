"use client";

import { useEffect, useRef } from "react";

/**
 * How long a run has between taps before it starts over.
 *
 * Short on purpose. These runs sit on controls that get tapped in the ordinary
 * course of using the app, and the only thing separating a hidden gesture from
 * an accident is that nobody taps the same button four times in under a second
 * without meaning to.
 */
export const TAP_WINDOW_MS = 800;

/**
 * Tap it again, quickly.
 *
 * All three of the fix's hidden gestures are runs of these — arming on the dice
 * segment, disarming on the speaker, and choosing on the title of the deck panel.
 * All three used to be long presses, and a hold turned out to be the wrong shape
 * for every one of them on a phone: it says nothing while it counts down, so a
 * press that is working is indistinguishable from a control that is broken, and
 * the thumb has to stay still on a small target while the OS decides whether it
 * would rather show a callout of its own.
 *
 * Taps have the opposite shape. Each one is a complete, instant thing, and each
 * one either does the control's ordinary visible job or is a plain no-op — which
 * is also why this hook counts rather than intercepts. There is no click to
 * swallow, because the taps in the run *are* the ordinary clicks.
 *
 * What makes them safe as secrets is the window rather than the count: three or
 * five taps in the same second on the same target is not something a thumb does
 * while browsing, and the run resets the moment the rhythm breaks.
 *
 * The window is checked against the clock on the next tap rather than armed with
 * a timer. A run that is abandoned half way simply goes stale where it stands,
 * so there is nothing to cancel on unmount and no timer to leak.
 */
export function useTapRun(count: number, onRun: () => void) {
  const run = useRef(0);
  const last = useRef(0);
  /** Held in a ref so a changing callback never resets a run in progress. */
  const callback = useRef(onRun);
  useEffect(() => {
    callback.current = onRun;
  }, [onRun]);

  return {
    /**
     * Call from the host control's own click handler, alongside whatever that
     * control ordinarily does. Returns how many taps of the run have landed,
     * which nothing needs yet and is safe to ignore — it exists because a run
     * you cannot see is otherwise impossible to debug without a banner.
     */
    tap: () => {
      const now = Date.now();
      run.current = now - last.current > TAP_WINDOW_MS ? 1 : run.current + 1;
      last.current = now;
      const reached = run.current;
      if (reached >= count) {
        // Zeroed before firing, so the tap after a completed run starts a fresh
        // one instead of re-firing on every tap from here on.
        run.current = 0;
        callback.current();
      }
      return reached;
    },
    /** Abandon a run because a tap landed somewhere that breaks it. */
    reset: () => {
      run.current = 0;
      last.current = 0;
    },
  };
}
