import type { TrayBounds } from "./bounds";
import { smoothNoise } from "./velvet";

/**
 * The rumple in the cloth.
 *
 * The floor was a mathematically flat plane, and that is most of why the scene
 * read as a *surface* rather than a place: with nothing for the raking key to
 * break across, everything outside the pool was the same cloth getting dimmer,
 * so the falloff read as a dimmer rather than as distance. Bedding has folds,
 * and folds are what turn one light into a hundred small highlights.
 *
 * This is geometry, not a normal map, and it has to be. The velvet normal map
 * tiles every 0.3 world units — the pile is fine — so a fold baked into it
 * would repeat forty times across the frame. Folds are the opposite scale:
 * metres, not millimetres. And three applies `bumpMap` only when there is no
 * `normalMap`, so the two cannot simply be layered.
 *
 * ## Why this is safe to do at all
 *
 * The die is confined by the tray walls to the play area, and nothing else in
 * the scene touches the floor. So the amplitude is ramped to *exactly* zero
 * across that rectangle and only rises outside it. The die therefore rolls on
 * cloth that is provably flat, while the cloth it is surrounded by is not — and
 * the flat part is the lit pool, which is the one place a fold would have
 * fought the light rather than caught it.
 *
 * `verify:props` asserts the zero, at every viewport shape.
 */

/** How far outside the play area the cloth takes to reach full rumple. */
export const FOLD_RAMP = 1.9;

/** Peak displacement, in world units, once the ramp is complete. */
export const FOLD_AMPLITUDE = 0.34;

/**
 * How far a point lies outside the play rectangle, in world units.
 *
 * Zero anywhere inside it — including well inside, which is the property the
 * whole approach rests on.
 */
export function outsidePlay(x: number, z: number, bounds: TrayBounds): number {
  const dx = Math.max(0, Math.abs(x) - bounds.halfX);
  const dz = Math.max(0, Math.max(bounds.zMin - z, z - bounds.zMax));
  return Math.hypot(dx, dz);
}

/** Smoothstep, so the cloth lifts out of the flat pool without a crease. */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * The fold field, before it is ramped. Roughly -1..1.
 *
 * Three scales, deliberately at unrelated angles and periods. Bedding does not
 * fold in a regular corrugation — it has a few broad hills where the fabric has
 * been pushed, finer creases running off them, and no repeat you can find by
 * looking. Two sine waves at right angles would be a tablecloth on a stall.
 */
export function foldField(x: number, z: number): number {
  // The broad hills. Long wavelengths, rotated off the axes so nothing lines
  // up with the frame edge.
  const a = Math.sin(x * 0.42 + z * 0.19) * Math.cos(z * 0.35 - x * 0.11);
  // Creases running off them, finer and at another angle.
  const b = Math.sin(x * 0.16 - z * 0.83 + 1.7) * 0.55;
  // Irregularity, so the two above never resolve into a pattern. The same
  // deterministic noise the pile uses — no Math.random, so the cloth is
  // identical every load and the geometry can be built during render.
  const c = (smoothNoise(x * 0.55 + 11, z * 0.55 + 7, 4096) - 0.5) * 0.9;
  return a * 0.62 + b + c;
}

/**
 * Height of the cloth at a point.
 *
 * Always exactly 0 within the play area, whatever the field says.
 */
export function foldAt(x: number, z: number, bounds: TrayBounds): number {
  const ramp = ease(outsidePlay(x, z, bounds) / FOLD_RAMP);
  if (ramp === 0) return 0;
  return foldField(x, z) * ramp * FOLD_AMPLITUDE;
}
