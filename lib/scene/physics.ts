/**
 * What everything in the tray is made of.
 *
 * These live here for the same reason the throw and the table outline do:
 * scripts/verify-distribution.ts simulates a thousand rolls against them, and
 * it can only prove something about the real die if it is holding the real
 * numbers. They had already drifted once — the script was rolling a die with
 * restitution 0.32 while the app used 0.34.
 */

export interface Surface {
  friction: number;
  restitution: number;
}

/**
 * How much time one step of the solver covers.
 *
 * Fixed rather than the frame's own delta, so a throw plays out identically on a
 * 60Hz phone and a 120Hz one — the world always advances in sixtieths however
 * often the screen is redrawn.
 *
 * That is also what makes the roll *predictable*, which the fix depends on: the
 * forecast steps a copy of the world to a standstill in one go, and it can only
 * be the same throw the table is about to have if it is stepping at the same
 * rate. See lib/dice/forecast.ts.
 */
export const PHYSICS_STEP = 1 / 60;

/**
 * The die itself.
 *
 * Deliberately springier than resin has any right to be. Rapier *averages* the
 * restitution of the two surfaces in a contact, so the die's own figure sets
 * the ceiling for every bounce it will ever have — leaving it realistic caps
 * the felt and the rim no matter how lively those are made.
 *
 * Damping started at 0.16 linear and 0.10 angular, enough drag that the die
 * gave up its momentum roughly where it landed and the throw read as a drop.
 * At a tenth of that a throw carries: it travels, tumbles, and skitters before
 * it comes to rest.
 *
 * These are tuned against scripts/verify-distribution.ts rather than guessed.
 * The failure modes are not subtle — too bouncy and the die never satisfies the
 * stillness test, or squeezes through the rim — and both are counted there.
 */
export const DIE_SURFACE: Surface = { friction: 0.55, restitution: 0.34 };
export const DIE_DENSITY = 1.6;
export const DIE_LINEAR_DAMPING = 0.08;
export const DIE_ANGULAR_DAMPING = 0.06;

/**
 * The felt.
 *
 * Was 0.7 friction and 0.22 restitution: grippy and dead, which is the single
 * biggest reason a throw used to stop where it landed. Against the die above
 * this now returns about three-quarters of each impact, which is far more than
 * cloth really does — but a throw you watch bounce half a dozen times is the
 * thing being built here, not a simulation of baize.
 */
export const FELT_SURFACE: Surface = { friction: 0.4, restitution: 0.35 };

/**
 * The rim.
 *
 * Springier than the felt and much slicker, so a die arriving at speed comes
 * off it with nearly everything it brought and crosses the table again. A wall
 * that absorbs the throw ends the roll on contact; this one keeps it going.
 *
 * The low friction matters as much as the bounce: a grippy wall converts the
 * die's travel into spin and it drops at the foot of the rim, which looks like
 * it got stuck rather than like it rebounded.
 */
export const RIM_SURFACE: Surface = { friction: 0.28, restitution: 0.72 };

/** Marks the rim's body, so an impact can tell cloth from wall and sound it. */
export const RIM_TAG = { rim: true } as const;
