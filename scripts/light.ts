/**
 * The colour arithmetic the light checks share.
 *
 * Extracted when `verify:themes` was written, because it needed the same four
 * functions `verify:hue` already had and two rooms' worth of the same reasoning
 * had already gone wrong once by being written out twice. Nothing here is
 * app code — it is the measuring instrument, and it lives in `scripts/` so that
 * is unambiguous.
 */
import * as THREE from "three";

/**
 * A colour in the space the shader multiplies in.
 *
 * `setStyle` already converts out of sRGB into the renderer's linear working
 * space — it is the same call three makes for a material's colour, which is the
 * point of using it rather than writing the transfer function out here. Calling
 * `convertSRGBToLinear` on the result as well applies the curve twice and
 * roughly halves every ratio that follows, which is worth a comment because it
 * looked plausible enough to ship once.
 */
export const linear = (hex: string) =>
  new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

export function hueDegrees(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.h * 360;
}

export function saturation(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.s;
}

export function lightness(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.l;
}

/** Shortest way round the wheel. Red sits at 0, so 359° and 1° are 2° apart. */
export function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/**
 * How much of a light lands on a horizontal surface.
 *
 * Lambert's cosine law, which for a floor whose normal is straight up reduces
 * to the light's height over its distance. Leaving it out is wrong rather than
 * merely conservative: a rim mounted low and behind delivers about a quarter of
 * what its intensity suggests, and counting it at full strength makes the fill
 * look like it is dominating a frame it barely touches.
 *
 * Both light types this is used on are positioned as directions rather than
 * places — a directional light has no position in the physical sense, and the
 * spot has `decay: 0` — so distance drops out and only the angle matters.
 */
export function incidence(position: readonly [number, number, number]): number {
  const [x, y, z] = position;
  const length = Math.hypot(x, y, z);
  return length > 0 ? Math.max(0, y / length) : 0;
}
