/**
 * When a thrown die counts as having come to rest.
 *
 * Kept apart from the scene because two things have to agree on it exactly: the
 * page, which reveals a position the moment it is true, and
 * scripts/verify-roll.ts, which throws the die two thousand times and counts
 * how often it never becomes true.
 */

/** Consecutive fixed steps of near-stillness before a throw is over. */
export const STILL_STEPS = 14;

/** Speeds below which a step counts as still. World units, radians. */
export const LINEAR_STILL = 0.12;
export const ANGULAR_STILL = 0.2;

/**
 * How long a throw is given before the stillness test starts loosening, in
 * seconds.
 *
 * Nine throws in ten are over inside two and a half. The long tail is not a die
 * still bouncing — it is one creeping along the cloth or rocking against its
 * neighbour, jittering at a speed just above the test. Damping does not end
 * that, because the solver puts the speed back every step.
 *
 * So past this point the test is what gives, a little more each second. A die
 * that has been almost still for three seconds is still, and insisting
 * otherwise only makes somebody wait for a die they can see has stopped.
 */
export const PATIENCE = 2.5;

/** How much looser the test gets for each further second. */
export const RELAX_PER_SECOND = 1.4;

/** Hard stop, in seconds, so a die wedged on an edge can never hang the page. */
export const SETTLE_TIMEOUT = 5;

/** How far the stillness test has loosened by the given point in a throw. */
export function tolerance(elapsed: number): number {
  return 1 + Math.max(0, elapsed - PATIENCE) * RELAX_PER_SECOND;
}

interface Speeds {
  x: number;
  y: number;
  z: number;
}

/**
 * Both halves matter. A die sliding flat across the felt has almost no spin,
 * and a die spinning on one corner has almost no travel, and neither has
 * stopped.
 */
export function isStill(linear: Speeds, angular: Speeds, tolerance = 1): boolean {
  return (
    Math.hypot(linear.x, linear.y, linear.z) < LINEAR_STILL * tolerance &&
    Math.hypot(angular.x, angular.y, angular.z) < ANGULAR_STILL * tolerance
  );
}
