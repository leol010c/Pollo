/**
 * The initial conditions of a throw.
 *
 * A throw here is not a force applied over time — it is one velocity and one
 * spin handed to the solver, exactly like a hand opening. That makes the throw
 * a pure function of the gesture, which is what lets scripts/verify-roll.ts
 * perform the page's real throw rather than an imitation of it.
 */

import { DIE_HALF } from "./physics";

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** The felt the throw is aimed within, centred on the origin. */
export interface Play {
  halfX: number;
  halfZ: number;
}

export interface Launch {
  position: Vec;
  velocity: Vec;
  angular: Vec;
}

/** Height the die leaves the hand at. */
const RELEASE_HEIGHT = 2.4;

/**
 * Upward kick at release, world units per second.
 *
 * Gravity here is 30, so this buys roughly half a second of air on top of the
 * release height — long enough to read as a throw rather than a drop, short
 * enough that nobody waits for it.
 */
const LIFT_MIN = 2.4;
const LIFT_MAX = 4.2;

/**
 * How much of a true rolling spin the die is given.
 *
 * A die in the air is not rolling on anything, so this is a look rather than a
 * law: the tumble lines up with the direction of travel, because a die that
 * flies one way while spinning another reads as broken.
 */
const ROLL_TRANSFER = 1.6;

/** Random share mixed into each axis, so no two throws tumble identically. */
const WOBBLE = 0.45;

/**
 * How far a throw starts from the die already on the table.
 *
 * The dice are thrown one at a time, so the second one is regularly released
 * over the first. Landing on it is fine and often good to watch — it is the
 * *release point* that wants clearing, because a die dropped straight down onto
 * another one mostly just teeters on it.
 */
const LAUNCH_CLEARANCE = 1.8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const jitter = (amount: number) => (Math.random() - 0.5) * 2 * amount;

/** An unbiased tumble, for when there is no direction to derive one from. */
function freeSpin(): Vec {
  return { x: jitter(17), y: jitter(17), z: jitter(17) };
}

/**
 * The spin of a die tumbling the way it was thrown.
 *
 * A body rolling along v turns about up x v — thrown away from you, it goes
 * over the front. The rate is ground speed over rolling radius, which is what
 * rolling without slipping means.
 */
export function tumbleFor(vx: number, vz: number): Vec {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-4) return freeSpin();

  const rate = (speed / DIE_HALF) * ROLL_TRANSFER;
  const wobble = () => jitter(rate * WOBBLE);

  return {
    x: (vz / speed) * rate + wobble(),
    // A die rolling forward does not also spin about the vertical, so yaw is
    // wobble alone.
    y: wobble(),
    z: (-vx / speed) * rate + wobble(),
  };
}

/**
 * Where a throw is aimed when nobody aimed it: the far half of the felt, never
 * dead centre, so repeated throws do not trace the same line.
 */
function idleAim(play: Play): { x: number; z: number } {
  return {
    x: jitter(play.halfX * 0.6),
    z: -play.halfZ * (0.35 + Math.random() * 0.5),
  };
}

/**
 * A throw from the near edge toward a point on the felt.
 *
 * Speed is set from the distance the die has to cover rather than fixed, so it
 * arrives on a tall phone and does not fire off a wide desktop — the play area
 * changes depth by a factor of two across viewports.
 */
/** Slides a release point sideways until it is not over the other die. */
function stepAside(x: number, z: number, play: Play, clear?: { x: number; z: number }): number {
  if (!clear) return x;
  if (Math.hypot(x - clear.x, z - clear.z) >= LAUNCH_CLEARANCE) return x;

  const limit = play.halfX - DIE_HALF * 2;
  const away = x >= clear.x ? 1 : -1;
  const aside = clamp(clear.x + away * LAUNCH_CLEARANCE, -limit, limit);
  // If sliding that way ran into a rail, there is always room on the other side.
  return Math.abs(aside - clear.x) >= LAUNCH_CLEARANCE
    ? aside
    : clamp(clear.x - away * LAUNCH_CLEARANCE, -limit, limit);
}

export function launch(
  play: Play,
  aim?: { x: number; z: number },
  clear?: { x: number; z: number },
): Launch {
  const target = aim ?? idleAim(play);

  const z = play.halfZ - DIE_HALF * 2;
  const spawnX = clamp(
    target.x * 0.35 + jitter(play.halfX * 0.25),
    -play.halfX + DIE_HALF * 2,
    play.halfX - DIE_HALF * 2,
  );

  const position: Vec = {
    x: stepAside(spawnX, z, play, clear),
    y: RELEASE_HEIGHT,
    z,
  };

  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const distance = Math.hypot(dx, dz) || 1;

  // Enough pace to reach the far rail with something left to come back with,
  // capped so a deep table does not turn into a cannon.
  const speed = clamp(distance * 1.15, 3, 7.5) * (0.88 + Math.random() * 0.24);

  const vx = (dx / distance) * speed + jitter(0.5);
  const vz = (dz / distance) * speed;

  return {
    position,
    velocity: { x: vx, y: LIFT_MIN + Math.random() * (LIFT_MAX - LIFT_MIN), z: vz },
    angular: tumbleFor(vx, vz),
  };
}

/**
 * A flick: the same throw, but the pointer's drag sets where it goes and how
 * hard. Direction comes from the drag, distance from how far it travelled,
 * both clamped so a violent swipe is still a throw and not an escape attempt.
 */
export function flick(
  play: Play,
  drag: { x: number; z: number },
  clear?: { x: number; z: number },
): Launch {
  const distance = Math.hypot(drag.x, drag.z);
  if (distance < 1e-3) return launch(play, undefined, clear);

  const reach = clamp(distance * 1.6, 2, play.halfZ * 2);
  const aim = {
    x: clamp((drag.x / distance) * reach, -play.halfX * 0.8, play.halfX * 0.8),
    z: clamp((drag.z / distance) * reach - play.halfZ * 0.5, -play.halfZ * 0.85, play.halfZ * 0.5),
  };
  return launch(play, aim, clear);
}
