/**
 * Where the scenery stands.
 *
 * The scene has had props before and lost them three times, always for the same
 * reason: something was placed near the die, and anything near the die competes
 * with it. The conclusion drawn then was that props don't work here. The
 * conclusion drawn now is that the *middle* of the frame doesn't work — which is
 * a much narrower claim, and one the geometry can enforce.
 *
 * So nothing here is authored as a world position. Every prop solves its place
 * from the same two rectangles the rest of the scene is built on:
 *
 *   - the play area (bounds.ts), which is where the die may go, and
 *   - the visible floor (bounds.ts), which is what the camera can see.
 *
 * Scenery lives in the difference between them. That band is generous on a
 * desktop window and thin on a phone, and it moves substantially between the
 * two, which is exactly why hardcoded positions kept ending up either on top of
 * the die or off the edge of the picture.
 *
 * Everything is deterministic — the same sin-hash the velvet and the gobo use,
 * never Math.random. A scatter that reshuffles on every load is a scatter you
 * can't verify, and `verify:props` has to be able to measure the arrangement the
 * scene actually draws.
 */

import * as THREE from "three";
import { DIE_INRADIUS, DIE_RADIUS } from "@/lib/dice/types";
import type { FloorQuad, TrayBounds } from "./bounds";
import { hash } from "./velvet";

/**
 * How far past the play boundary the die's own body can reach.
 *
 * The wall collider stops the die's nearest *face*, so its centre never gets
 * closer to the wall than the inradius — but the corners carry on past it. This
 * is the difference, and it is the real edge of the die's territory. Measuring
 * clearance from `halfX` alone would let a petal sit exactly where a corner
 * lands.
 */
export const DIE_OVERHANG = DIE_RADIUS - DIE_INRADIUS;

/**
 * Gap between the die's territory and the nearest scenery.
 *
 * Small, because the margin it is spent out of is small: on a phone there are
 * about 0.29 world units between the play area and the side of the frame, so a
 * generous-sounding clearance would leave nowhere for anything to stand.
 */
const CLEARANCE = DIE_OVERHANG + 0.07;

// --- Petals ------------------------------------------------------------------

export interface Petal {
  /** Resting on the nap, not embedded in it. */
  position: [number, number, number];
  /** Rotation in the plane of the floor. */
  yaw: number;
  /** Lift off flat, radians, about x and z. A petal is never quite lying down. */
  tilt: [number, number];
  scale: number;
}

/** Dimensions of an unscaled petal. The length also sets its clearance. */
export const PETAL_LENGTH = 0.19;
export const PETAL_WIDTH = 0.135;

const PETAL_COUNT = 44;

/**
 * Tries per petal before giving up on it.
 *
 * Generous, because the usable region is a thin frame around a large hole and
 * a uniform sample lands inside the hole most of the time. Giving up is a real
 * outcome rather than an error: on a very tight viewport the honest answer is
 * fewer petals, not petals pushed somewhere they don't fit.
 */
const PETAL_ATTEMPTS = 64;

/**
 * How far past the frame edge a petal may sit, as a fraction of the half-width.
 *
 * Deliberately over one. Petals that all sit tidily inside the picture read as
 * an arrangement someone made for the camera; a few clipped by the edge read as
 * a floor that carries on past it.
 */
const OVERSPILL = 1.12;

/**
 * Pulls the scatter toward the far band.
 *
 * The margin is not evenly distributed: beyond the play area's far edge there is
 * about a unit of floor on every viewport, while the sides are only a few
 * tenths. Biasing toward the far end is therefore mostly just following the room
 * that exists.
 *
 * Spreading them more evenly down the side strips was tried, on the reasoning
 * that a phone's lower half is otherwise an unbroken field of velvet. It looked
 * worse: petals strung down both edges read as a border around the picture,
 * where a drift concentrated at the head of the frame reads as petals thrown on
 * a bed. The empty half is doing work.
 */
const FAR_BIAS = 1.7;

const PETAL_SCALE = [0.72, 1.28] as const;
/** High enough to sit on the pile, low enough not to float above it. */
const PETAL_LIFT = 0.006;
const PETAL_MAX_TILT = 0.22;

/**
 * A deterministic number in 0..1 for a given sample and channel.
 *
 * The multipliers are only there to keep the two arguments from marching in step
 * with each other; hash is a sine, and feeding it two nearly equal ramps gives
 * visibly correlated output.
 */
function rand(sample: number, channel: number): number {
  return hash(sample * 1.618 + channel * 31.7, channel * 2.713 + sample * 0.409);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Half-width of the visible floor at a depth expressed as 0 (far) to 1 (near). */
function halfWidthAt(floor: FloorQuad, t: number): number {
  return mix(floor.halfXFar, floor.halfXNear, t);
}

/** Depth, from the same 0 (far) to 1 (near) parameter. */
function depthAt(floor: FloorQuad, t: number): number {
  return mix(floor.zFar, floor.zNear, t);
}

/** The rectangle no prop may enter: the play area plus the die's overhang. */
export function exclusion(bounds: TrayBounds) {
  return {
    halfX: bounds.halfX + CLEARANCE,
    zMin: bounds.zMin - CLEARANCE,
    zMax: bounds.zMax + CLEARANCE,
  };
}

export function clearsPlayArea(
  x: number,
  z: number,
  bounds: TrayBounds,
  padding = 0,
): boolean {
  const keep = exclusion(bounds);
  return (
    Math.abs(x) > keep.halfX + padding ||
    z < keep.zMin - padding ||
    z > keep.zMax + padding
  );
}

export function placePetals(bounds: TrayBounds, floor: FloorQuad): Petal[] {
  const petals: Petal[] = [];

  for (let i = 0; i < PETAL_COUNT; i++) {
    for (let attempt = 0; attempt < PETAL_ATTEMPTS; attempt++) {
      // One seed per attempt rather than per petal, so a petal that needs six
      // tries doesn't reuse the position that already failed.
      const seed = i * 131 + attempt;

      const t = Math.pow(rand(seed, 1), FAR_BIAS);
      const z = depthAt(floor, t);
      const x = (rand(seed, 2) * 2 - 1) * halfWidthAt(floor, t) * OVERSPILL;

      // The petal is a disc of its own, so its edge has to clear the die's
      // territory, not just its centre.
      const reach = (PETAL_LENGTH / 2) * PETAL_SCALE[1];
      if (!clearsPlayArea(x, z, bounds, reach)) continue;

      petals.push({
        position: [x, PETAL_LIFT, z],
        yaw: rand(seed, 3) * Math.PI * 2,
        tilt: [
          (rand(seed, 4) * 2 - 1) * PETAL_MAX_TILT,
          (rand(seed, 5) * 2 - 1) * PETAL_MAX_TILT,
        ],
        scale: mix(PETAL_SCALE[0], PETAL_SCALE[1], rand(seed, 6)),
      });
      break;
    }
  }

  return petals;
}

// --- Candles -----------------------------------------------------------------

/**
 * Two, and different heights.
 *
 * One candle is a light source. Two are a gesture — a pair of anything is read
 * as having been set out on purpose, which is most of what separates a room
 * that is occupied from one that merely has a lamp in it. Matched heights would
 * undo that by looking like a product shot, so one is a taper and the other a
 * squat pillar.
 *
 * Both stand in the far band, past the play area's far edge, which is the one
 * piece of margin that is comfortably present on every viewport. Their clearance
 * therefore comes from depth rather than from the thin gaps at the sides, and
 * holds even on a phone where those gaps nearly close.
 */
export interface CandlePlacement {
  /** The base, on the floor. */
  position: [number, number, number];
  height: number;
  radius: number;
  /** Height of the flame above the base. Slightly below the rim: wax burns down. */
  wick: number;
  /** Scales the flame and the light, so the pair is not two identical copies. */
  strength: number;
}

/**
 * How far out to the sides, as a fraction of the visible half-width there.
 *
 * Well out. A candle near the centre line of the frame sits directly above the
 * play area on screen even though it is behind it in world space, and then it is
 * back to competing with the die — which is the exact failure every previous
 * prop hit. `verify:props` asserts the result lands outside the middle of the
 * picture rather than trusting this number.
 */
const CANDLE_OFFSET = 0.76;

/**
 * Where the flame should sit vertically in the picture, in clip space.
 *
 * High, but not at the edge: 1.0 is exactly the top of the frame. This is the
 * number that makes the pair read as standing *in the room* rather than as two
 * objects placed at the back of a set.
 */
const FLAME_SCREEN_Y = 0.84;

const TAPER = { height: 0.56, radius: 0.078, strength: 1 };
const PILLAR = { height: 0.34, radius: 0.098, strength: 0.82 };

/**
 * The depth at which an object of a given height puts its top at `targetY` on
 * screen, searched rather than derived.
 *
 * Solved, because guessing at it does not survive contact with the viewports.
 * Standing a candle a fixed fraction into the far band put its flame off the top
 * of the picture on all seven shapes — the far band ends where the *floor* meets
 * the top of the frame, so anything with height standing there is already above
 * it. How much further forward that pushes the candle depends on the camera's
 * pitch, which ranges from 47.6° to 66°, so it is not one number.
 *
 * Clip-space y is independent of world x here: the camera sits on the x=0 plane
 * and never rolls, so moving a candle sideways cannot change how high up the
 * picture it appears. That is what lets the depth be solved first and the
 * sideways offset applied afterwards.
 */
function depthForScreenY(
  camera: THREE.Camera,
  height: number,
  targetY: number,
  zFar: number,
  zNear: number,
): number {
  const probe = new THREE.Vector3();
  const screenY = (z: number) => probe.set(0, height, z).project(camera).y;

  // Moving toward the camera moves the top of the object down the picture, so
  // this is monotonic and a bisection is safe.
  if (screenY(zNear) > targetY) return zNear;
  if (screenY(zFar) < targetY) return zFar;

  let lo = zFar;
  let hi = zNear;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (screenY(mid) > targetY) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Breathing room between a candle's wax and the die's territory. */
const CANDLE_GAP = 0.04;

/**
 * How far past the frame edge a candle's centre may sit.
 *
 * Barely over one, unlike the petals: a petal clipped in half still reads as a
 * petal, whereas a candle sliced down its axis reads as a mistake.
 */
const CANDLE_SPILL = 1.02;

export function placeCandles(
  bounds: TrayBounds,
  floor: FloorQuad,
  camera: THREE.Camera,
): CandlePlacement[] {
  const keep = exclusion(bounds);
  const depth = Math.max(1e-6, floor.zNear - floor.zFar);

  const stand = (
    spec: typeof TAPER,
    wickDrop: number,
    side: number,
    lean: number,
  ): CandlePlacement => {
    const wick = spec.height - wickDrop;

    /*
     * Depth first, from where the flame should sit in the picture — over the
     * whole visible floor rather than only the band behind the play area.
     *
     * Restricting it to that band is the obvious reading of "keep out of the
     * way" and it is wrong on a phone: the band is under a unit deep there, so
     * the candle gets pinned against the top of the frame with only its base in
     * shot. There is a second piece of margin the band ignores — the strip down
     * each side of the play area — and standing in it is just as far out of the
     * die's way while being somewhere you can actually see.
     */
    let z = depthForScreenY(camera, wick, FLAME_SCREEN_Y - lean, floor.zFar, floor.zNear);
    let halfW = halfWidthAt(floor, (z - floor.zFar) / depth);

    /*
     * Then sideways, out of the die's reach and back inside the picture.
     *
     * When both can be satisfied the candle stands in the side strip and the
     * depth solved above survives. When they cannot — a viewport whose side
     * strip is narrower than the candle — the lateral constraint is the one that
     * has to give way, so it retreats behind the play area instead and accepts
     * sitting higher in frame than intended.
     */
    const minX = keep.halfX + spec.radius + CANDLE_GAP;
    const maxX = halfW * CANDLE_SPILL - spec.radius;
    let x = Math.abs(halfW * CANDLE_OFFSET);

    if (minX <= maxX) {
      x = Math.min(Math.max(x, minX), maxX);
    } else {
      z = Math.min(z, keep.zMin - spec.radius - CANDLE_GAP);
      halfW = halfWidthAt(floor, (z - floor.zFar) / depth);
      x = Math.min(x, halfW * CANDLE_SPILL - spec.radius);
    }

    return { position: [x * side, 0, z], ...spec, wick };
  };

  return [
    stand(TAPER, 0.03, -1, 0),
    // Not a mirror image. A symmetric pair reads as a rig; sitting the shorter
    // one a little lower in frame keeps them a pair without making them a
    // diagram.
    stand(PILLAR, 0.025, 1, 0.07),
  ];
}

export interface SceneProps {
  petals: Petal[];
  candles: CandlePlacement[];
}

export function placeProps(
  bounds: TrayBounds,
  floor: FloorQuad,
  camera: THREE.Camera,
): SceneProps {
  return {
    petals: placePetals(bounds, floor),
    candles: placeCandles(bounds, floor, camera),
  };
}
