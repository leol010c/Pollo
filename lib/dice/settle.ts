/**
 * When a thrown die counts as having come to rest.
 *
 * These used to live in Die.tsx, which was the right home while the scene was
 * the only thing watching a die stop. Two more things now have to agree with it
 * exactly. lib/dice/forecast.ts steps a copy of the world ahead of the real one
 * and reads the face off it — a copy that stopped watching at a different moment
 * would be predicting a different throw. And scripts/verify-distribution.ts
 * simulates a thousand rolls against the same test, which is only a check on the
 * app's die if it is the app's test.
 *
 * Both of those were holding their own transcribed copies of these numbers.
 */

/** Consecutive near-motionless frames before the die counts as settled. */
export const STILL_FRAMES = 12;
export const LINEAR_STILL = 0.09;
export const ANGULAR_STILL = 0.16;
/** Hard stop, in seconds, so a die wedged on an edge can never hang the roll. */
export const SETTLE_TIMEOUT = 6;

interface Vector {
  x: number;
  y: number;
  z: number;
}

/**
 * Whether this frame counts as a still one.
 *
 * Both halves matter: a die sliding flat across the cloth has almost no spin,
 * and a die spinning on a corner has almost no travel, and neither has stopped.
 */
export function isStill(linvel: Vector, angvel: Vector) {
  return (
    Math.hypot(linvel.x, linvel.y, linvel.z) < LINEAR_STILL &&
    Math.hypot(angvel.x, angvel.y, angvel.z) < ANGULAR_STILL
  );
}
