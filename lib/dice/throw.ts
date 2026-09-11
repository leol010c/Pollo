import { DIE_INRADIUS } from "./types";

/**
 * Upward kick, in world units per second.
 *
 * Nothing lifts the die before a throw any more — it leaps off the cloth under
 * its own steam, so this has to be enough to get it clear in one go. Gravity
 * here is 34, so the low end tops out around 0.9 above the table and the high
 * end about 1.4: a jump you watch rather than a hop.
 *
 * It also has to clear the cloth *fast*. A die that leaves slowly spends its
 * first frames grinding a corner along the floor while the tumble spins it,
 * which is the scrape the old pre-lift existed to avoid.
 */
const LEAP_MIN = 7.2;
const LEAP_MAX = 9.4;

/**
 * The initial conditions of a throw.
 *
 * A throw in this app is not a force applied over time — it is a velocity and a
 * spin handed to the solver once, exactly like a hand opening. That makes it a
 * pure function of the gesture, which is why it lives here rather than in the
 * component: scripts/verify-distribution.ts imports these, so the thousand
 * rolls it simulates are the same throw the app performs.
 *
 * That matters more than usual now that the spin is *correlated* with the
 * direction of travel. A tumble that lines up with the throw is the kind of
 * thing that could quietly bias which face lands, and a check that
 * reimplements the launch profile could never see it.
 */

/**
 * How much of a true rolling spin a thrown die is given.
 *
 * A die in the air is not rolling on anything, so this is a look rather than a
 * law. At 1 it turns as if glued to the ground it is flying over, which reads
 * as too busy; a little under carries the direction legibly without spinning
 * so fast that the faces blur.
 */
const ROLL_TRANSFER = 0.8;

/**
 * Random share mixed into each axis.
 *
 * Without it every throw at the same angle produces the identical tumble, which
 * looks mechanical after about three rolls — and, less obviously, would make
 * the outcome far more predictable from the gesture than it should be.
 */
const TUMBLE_WOBBLE = 0.35;

export interface Velocity {
  x: number;
  y: number;
  z: number;
}

/** A fast, unbiased tumble, for when there is no direction to derive one from. */
export function spin() {
  return (Math.random() - 0.5) * 34;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * The spin of a die tumbling in the direction it was thrown.
 *
 * A body rolling along **v** turns about **up × v** — throw it away from you
 * and it should turn away from you, top going over the front. The rate is the
 * ground speed divided by the rolling radius, which is what rolling without
 * slipping means.
 *
 * This replaced three independent random axes. Those were fine for a die that
 * appears from nowhere, but they read as wrong the moment the throw has a
 * direction you chose: the die would fly one way while spinning another.
 */
export function tumbleFor(vx: number, vz: number): Velocity {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-4) return { x: spin(), y: spin(), z: spin() };

  const rate = (speed / DIE_INRADIUS) * ROLL_TRANSFER;
  const wobble = () => (Math.random() - 0.5) * rate * TUMBLE_WOBBLE;

  // up × v, normalised by dividing through by the speed.
  return {
    x: (vz / speed) * rate + wobble(),
    // Yaw has no rolling component — a die rolling forward does not also spin
    // about the vertical — so this axis is wobble alone.
    y: wobble(),
    z: (-vx / speed) * rate + wobble(),
  };
}

/** The play area a throw is aimed within. */
export interface Play {
  halfX: number;
  /** Far edge, away from the camera. */
  zMin: number;
  /** Near edge, toward the camera. */
  zMax: number;
}

/** A die at rest on one of its faces, for placing one in a simulation. */
export function restingAt(from: { x: number; z: number }) {
  return { x: from.x, y: DIE_INRADIUS, z: from.z };
}

/**
 * The velocity of a throw nobody aimed: a tap, a shake, or "roll again".
 *
 * Aimed at whichever rail is *further away*, so the die always has the length
 * of the table to cross. An earlier version always aimed at the far rail, which
 * meant a die already resting up there had nowhere to go — and it only looked
 * right because the die was being teleported down to the near edge first, which
 * is a jump you can see and is not a throw.
 *
 * A throw that dies in the centre is one event; one that crosses the table,
 * cracks off a wall and comes back is a journey, and the rim is springy enough
 * (0.72) to return most of what it is given.
 *
 * Speed is set from the distance it has to cover so the die actually arrives —
 * a fixed impulse either stops short on a tall screen or fires across a short
 * one, and the play area's depth changes by a factor of two across viewports.
 */
export function randomThrow(
  from: { x: number; z: number },
  play: Play,
): Velocity {
  // Whichever end it is not already at.
  const aimZ =
    Math.abs(play.zMin - from.z) >= Math.abs(play.zMax - from.z)
      ? play.zMin
      : play.zMax;
  // Never dead centre, so repeated throws don't trace the same line.
  const aimX = (Math.random() - 0.5) * play.halfX * 1.4;

  const dx = aimX - from.x;
  const dz = aimZ - from.z;
  const distance = Math.hypot(dx, dz) || 1;

  // Enough to reach the wall with pace left to come back, capped so a deep
  // table doesn't turn into a cannon.
  const speed = clamp(distance * 1.15, 2.6, 6.2) * (0.85 + Math.random() * 0.3);

  return {
    x: (dx / distance) * speed + (Math.random() - 0.5) * 0.9,
    y: LEAP_MIN + Math.random() * (LEAP_MAX - LEAP_MIN),
    z: (dz / distance) * speed,
  };
}
