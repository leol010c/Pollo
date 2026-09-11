"use client";

/**
 * Vibration is fired only on meaningful moments — throw and settle — never on
 * every collision. Overused haptics read as a malfunction rather than feedback.
 */

function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    // Desktop browsers expose the API but do nothing with it.
    matchMedia("(hover: none) and (pointer: coarse)").matches &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function hapticThrow() {
  if (canVibrate()) navigator.vibrate(12);
}

/**
 * A deck being riffled: a short stutter rather than a tap.
 *
 * Deliberately the only patterned haptic besides a multi-die settle. A shuffle
 * is the one gesture here that is made of many small events instead of one, and
 * a single buzz would make it feel like any other button.
 */
export function hapticShuffle() {
  if (canVibrate()) navigator.vibrate([8, 30, 8, 26, 10, 22, 14]);
}

/**
 * Something came to rest.
 *
 * `strength` runs 0 to 1: a full landing at 1, a bounce on the way to one
 * lower. That is what both callers were already asking for — the coin passes
 * 0.4 for its bounces — and for a while it was not what they got. The parameter
 * used to be a dice count, back when a throw could put several on the table,
 * and the only thing it decided was single tick versus double. So a coin asking
 * for a softer tap got the same 18ms as a landing, and the caller reading
 * `0.4` had no way to know.
 *
 * One die now, so there is no count left to branch on. The scale is duration,
 * which is the only dimension the Vibration API gives — floored at 6ms, below
 * which a buzz is not a sensation, and a bounce that registers as nothing is
 * worse than one that registers as light.
 */
export function hapticSettle(strength = 1) {
  if (!canVibrate()) return;
  const clamped = Math.min(1, Math.max(0, strength));
  if (clamped <= 0) return;
  navigator.vibrate(Math.max(6, Math.round(clamped * 18)));
}
