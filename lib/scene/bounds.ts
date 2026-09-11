import * as THREE from "three";
import { DIE_RADIUS } from "@/lib/dice/types";

/**
 * Camera framing and the play area it implies.
 *
 * These are solved together rather than fixed, because a phone held upright and
 * a desktop window are very different shapes and one framing cannot serve both.
 * The scene and the verification script both build from here, so they can never
 * disagree about where the walls are.
 */

export const CAMERA_TARGET: [number, number, number] = [0, 0.3, 0];
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 60;

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface TrayBounds {
  halfX: number;
  /** Far edge, away from the camera. */
  zMin: number;
  /** Near edge, toward the camera. */
  zMax: number;
  /**
   * Where the die lives when it isn't going anywhere: the centre of the play
   * area, which is *not* the world origin. The camera looks down at an angle,
   * so the patch of floor it frames sits behind the origin — spawning the die
   * at 0,0 would put it outside its own play area.
   */
  home: [number, number, number];
}

/**
 * Height of a resting die's centre, and the highest a low bounce carries it.
 *
 * Only the settled and rolling die is framed, not the peak of the throw. A die
 * at the top of its arc is briefly near the top of the frame, which is fine and
 * is what a real throw looks like; demanding it be framed there shrinks the
 * play area to nothing, because at that height the back of the tray sits above
 * the top of the view no matter where the walls go.
 */
const REST_HEIGHT = DIE_RADIUS * 0.6;
const ROLL_HEIGHT = REST_HEIGHT + 0.12;

/**
 * Distance from a cube's centre to a face, given its circumradius. The wall
 * collider stops the die's *face*, so its centre never gets closer to the wall
 * than this — treating the whole bounding sphere as reaching the wall would
 * shrink the play area by a third for no reason.
 */
const DIE_INRADIUS = DIE_RADIUS / Math.sqrt(3);

/** Height the die drops from on load and is lifted to on each throw. */
export const SPAWN_HEIGHT = 2.2;

// --- Framing ---------------------------------------------------------------

/** Aspect ratios the two reference framings are authored for. */
const WIDE_ASPECT = 1.6;
const TALL_ASPECT = 0.55;

/**
 * Angle below horizontal that the camera looks down at.
 *
 * A shallow angle gives a landscape-shaped view of the floor, which suits a
 * wide window. Steepening it toward overhead turns the visible floor upright,
 * so on a tall screen the die's travel runs along the screen's long axis
 * instead of across its short one — using the space the phone actually has
 * rather than fighting for width it doesn't.
 */
const PITCH_WIDE = 47.6;
const PITCH_TALL = 66;

/** A slightly wider lens on narrow screens buys floor without moving further
 *  back, which would shrink the die more than necessary. */
const FOV_WIDE = 30;
const FOV_TALL = 38;

const DISTANCE_WIDE = 5.56;
/** Ceiling on pulling back, past which the die is too small to enjoy. */
const DISTANCE_MAX = 9.5;

/**
 * How much room the die should have to travel sideways, in circumradii.
 * Below roughly this the die can only shuffle in place, which is what a fixed
 * camera produced on a phone.
 */
const TARGET_HALF_X = DIE_RADIUS * 2.8;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 at wide-screen framing, 1 at tall-screen framing. */
function tallness(aspect: number) {
  return clamp01((WIDE_ASPECT - aspect) / (WIDE_ASPECT - TALL_ASPECT));
}

function poseAt(
  aspect: number,
  distance: number,
  lookAtZ = CAMERA_TARGET[2],
): CameraPose {
  const t = tallness(aspect);
  const pitch = (mix(PITCH_WIDE, PITCH_TALL, t) * Math.PI) / 180;
  const target = new THREE.Vector3(CAMERA_TARGET[0], CAMERA_TARGET[1], lookAtZ);

  return {
    position: [
      target.x,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(pitch) * distance,
    ],
    target: [target.x, target.y, target.z],
    fov: mix(FOV_WIDE, FOV_TALL, t),
  };
}

function cameraFrom(pose: CameraPose, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    pose.fov,
    aspect,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

// --- Play area -------------------------------------------------------------

/**
 * The largest patch of floor the die can occupy while staying fully in frame,
 * for a given camera.
 *
 * Two things make this harder than intersecting the view with the floor plane.
 * The die is a solid, not a point, so its extent has to clear the frustum
 * rather than its centre; and it has height, so a raised corner projects
 * further toward the edge of the frame than its footprint suggests — which is
 * why a fixed inset from the visible floor area is not enough.
 *
 * So the frustum's four side planes are used directly and the box is shrunk
 * until the die clears all of them. The search is numeric because the
 * constraint couples halfX and the z range through the perspective divide; it
 * runs once per viewport size, not per frame.
 */
function boundsFor(pose: CameraPose, aspect: number): TrayBounds {
  const camera = cameraFrom(pose, aspect);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
  // Planes 0–3 are the sides; 4 and 5 are near and far, which never bind here.
  const sides = frustum.planes.slice(0, 4);

  // Seed from where the view meets the resting plane, then shrink from there.
  const eye = new THREE.Vector3(...pose.position);
  const forward = new THREE.Vector3(...pose.target).sub(eye).normalize();
  const right = new THREE.Vector3()
    .crossVectors(forward, new THREE.Vector3(0, 1, 0))
    .normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan((pose.fov * Math.PI) / 360);

  const hits: THREE.Vector3[] = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const dir = forward
      .clone()
      .addScaledVector(right, sx * tanV * aspect)
      .addScaledVector(up, sy * tanV)
      .normalize();
    if (dir.y >= -1e-4) continue;
    hits.push(eye.clone().addScaledVector(dir, (REST_HEIGHT - eye.y) / dir.y));
  }

  if (hits.length < 4) {
    return { halfX: 0.8, zMin: -0.8, zMax: 0.8, home: [0, SPAWN_HEIGHT, 0] };
  }

  const seedHalfX = Math.min(...hits.map((h) => Math.abs(h.x)));
  const zLow = Math.min(...hits.map((h) => h.z));
  const zHigh = Math.max(...hits.map((h) => h.z));
  const seedHalfZ = (zHigh - zLow) / 2;
  const midZ = (zHigh + zLow) / 2;

  const point = new THREE.Vector3();

  /**
   * True when every extreme of the die stays inside the view. Its centre is
   * confined to the play area inset by the inradius, and the solid extends a
   * circumradius beyond that centre in any direction.
   */
  const fits = (hx: number, hz: number) => {
    const reachX = Math.max(0, hx - DIE_INRADIUS) + DIE_RADIUS;
    const reachZ = Math.max(0, hz - DIE_INRADIUS) + DIE_RADIUS;

    for (const x of [-reachX, reachX]) {
      for (const dz of [-reachZ, reachZ]) {
        for (const y of [REST_HEIGHT - DIE_RADIUS, ROLL_HEIGHT + DIE_RADIUS]) {
          point.set(x, y, midZ + dz);
          for (const plane of sides) {
            if (plane.distanceToPoint(point) < 0) return false;
          }
        }
      }
    }
    return true;
  };

  const maxHalfX = (hz: number) => {
    if (!fits(0, hz)) return -1;
    let lo = 0;
    let hi = seedHalfX;
    if (fits(hi, hz)) return hi;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid, hz)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  // x and z trade off against each other through the corners, so a single
  // uniform shrink leaves a lot on the table — it collapses the axis that isn't
  // binding along with the one that is. Sweep the depth and keep whichever
  // pairing yields the most floor.
  let best = { halfX: 0, halfZ: 0, area: -1 };
  const STEPS = 32;
  for (let i = 1; i <= STEPS; i++) {
    const hz = (seedHalfZ * i) / STEPS;
    const hx = maxHalfX(hz);
    if (hx <= 0) continue;
    const area = hx * hz;
    if (area > best.area) best = { halfX: hx, halfZ: hz, area };
  }

  if (best.area < 0) {
    return {
      halfX: 0.4,
      zMin: midZ - 0.4,
      zMax: midZ + 0.4,
      home: [0, SPAWN_HEIGHT, midZ],
    };
  }

  return {
    halfX: best.halfX,
    zMin: midZ - best.halfZ,
    zMax: midZ + best.halfZ,
    home: [0, SPAWN_HEIGHT, midZ],
  };
}

// --- Solving the two together ----------------------------------------------

const poseCache = new Map<number, CameraPose>();

/**
 * Pulls the camera back only as far as the die needs to have room to roll.
 *
 * On a wide window the default distance already clears the target and nothing
 * moves. On a narrow one the play area would otherwise be thinner than the die
 * itself, so the camera retreats — capped, because a die that has room but is
 * too small to see is no better than one that can't move.
 */
export function cameraPoseFor(aspect: number): CameraPose {
  const key = Math.round(aspect * 100);
  const cached = poseCache.get(key);
  if (cached) return cached;

  let pose = poseAt(aspect, DISTANCE_WIDE);

  if (boundsFor(pose, aspect).halfX < TARGET_HALF_X) {
    let lo = DISTANCE_WIDE;
    let hi = DISTANCE_MAX;

    if (boundsFor(poseAt(aspect, hi), aspect).halfX < TARGET_HALF_X) {
      // Even fully retreated it can't hit the target — take the most room
      // available and accept a smaller die.
      lo = hi;
    } else {
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (boundsFor(poseAt(aspect, mid), aspect).halfX >= TARGET_HALF_X) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      lo = hi;
    }

    pose = poseAt(aspect, lo);
  }

  /*
   * Re-aim at the middle of the play area.
   *
   * The camera looks down at an angle, so the floor it frames sits behind the
   * origin — aiming at the origin leaves the die high in the frame with a band
   * of empty surface beneath it. One correction pass is enough: moving the
   * target shifts the play area only slightly, so a second would barely differ.
   */
  const settled = boundsFor(pose, aspect);
  const midZ = (settled.zMin + settled.zMax) / 2;
  const distance = new THREE.Vector3(...pose.position).distanceTo(
    new THREE.Vector3(...pose.target),
  );
  pose = poseAt(aspect, distance, midZ);

  poseCache.set(key, pose);
  return pose;
}

export function sceneCamera(aspect: number): THREE.PerspectiveCamera {
  return cameraFrom(cameraPoseFor(aspect), aspect);
}

export function computeTrayBounds(aspect: number): TrayBounds {
  return boundsFor(cameraPoseFor(aspect), aspect);
}

// --- The floor you can actually see -----------------------------------------

/**
 * The patch of floor inside the frame, as a trapezoid.
 *
 * Distinct from the play area above it, and larger: the play area is where the
 * *die* may go, inset far enough that a raised corner of it still clears the
 * frustum. What is left over — the band between that boundary and the edge of
 * the picture — is the only place scenery can stand without getting in the way
 * of a throw, so the props solve their positions from this.
 *
 * It comes out wider at the far edge than the near one, which is the opposite
 * of the usual receding-floor intuition and worth stating: the camera looks
 * steeply *down*, so the top of the frame is the part of the floor furthest
 * from the lens, and a frustum is widest where it is deepest.
 *
 * Every corner ray strikes the plane on every viewport this ships for — the
 * camera never sees the horizon, let alone above it. That is why there is no
 * wall or curtain behind the scene: there is nowhere on screen to put one.
 */
export interface FloorQuad {
  /** Toward the camera — the bottom edge of the frame. */
  zNear: number;
  /** Away from the camera — the top edge of the frame. */
  zFar: number;
  /** Half-width of the visible floor at `zNear`. */
  halfXNear: number;
  /** Half-width at `zFar`. Larger than `halfXNear`. */
  halfXFar: number;
}

/**
 * Fallback for a camera pitched so shallowly that the upper corner rays miss
 * the floor entirely. Unreachable at the pitches in this file — the shallowest
 * is 47.6° — but a frustum corner that never intersects the plane would
 * otherwise produce an Infinity that propagates silently into every prop
 * position, and a scene full of NaN is much harder to diagnose than a small
 * one.
 */
const FLOOR_FALLBACK: FloorQuad = {
  zNear: 1,
  zFar: -3,
  halfXNear: 1.2,
  halfXFar: 2,
};

export function visibleFloor(aspect: number): FloorQuad {
  const camera = sceneCamera(aspect);
  const eye = camera.position.clone();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();

  /** Where the ray through a normalised-device point meets the floor. */
  const strike = (ndcX: number, ndcY: number): THREE.Vector3 | null => {
    const direction = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(camera)
      .sub(eye)
      .normalize();
    ray.set(eye, direction);
    return ray.intersectPlane(plane, hit) ? hit.clone() : null;
  };

  // ndcY of -1 is the bottom of the frame, which is the floor nearest the
  // camera; +1 is the top, which is the floor furthest away.
  const near = [strike(-1, -1), strike(1, -1)];
  const far = [strike(-1, 1), strike(1, 1)];
  if (near.some((p) => !p) || far.some((p) => !p)) return FLOOR_FALLBACK;

  const nearPoints = near as THREE.Vector3[];
  const farPoints = far as THREE.Vector3[];

  return {
    zNear: Math.max(...nearPoints.map((p) => p.z)),
    zFar: Math.min(...farPoints.map((p) => p.z)),
    halfXNear: Math.max(...nearPoints.map((p) => Math.abs(p.x))),
    halfXFar: Math.max(...farPoints.map((p) => Math.abs(p.x))),
  };
}

// --- The pool --------------------------------------------------------------

/**
 * How far the spot's cone reaches past the play area, as a multiple of it.
 *
 * Just over one, and the whole treatment turns on that. Below one the far
 * corners of the play area sit outside the cone and the die can roll into
 * genuine darkness; far above one the falloff happens entirely off-screen and
 * the surface is lit dead flat.
 *
 * That second failure is not hypothetical — it is what the scene shipped with.
 * A fixed `angle: 0.66` put the cone's edge about five world units out while
 * the play area reaches barely one and a half, so only the innermost quarter of
 * the cone was ever in shot: its brightest, flattest part. The backdrop was
 * written around a pool that never rendered.
 */
export const POOL_SPREAD = 1.15;

/**
 * How far the die can get from the light's aim point, on the floor.
 *
 * The corner of the play area rather than its edge, since that is the furthest
 * the die can actually be, plus its own radius so the far side of the die is
 * still inside the pool when it rests against a wall.
 */
export function poolReach(bounds: TrayBounds, aimZ: number): number {
  const reachZ = Math.max(
    Math.abs(bounds.zMin - aimZ),
    Math.abs(bounds.zMax - aimZ),
  );
  return Math.hypot(bounds.halfX, reachZ) + DIE_RADIUS;
}

/**
 * Half-angle for a spotlight at `position` aimed at [0, 0, aimZ] whose cone
 * lands on the play area.
 *
 * Derived rather than authored, for the same reason the camera and the shadow
 * box are: a phone held upright and a desktop window frame very different
 * patches of floor, and one hardcoded cone cannot pool on both. A number tuned
 * to look right on a wide window leaves the far end of a tall one unlit.
 *
 * The light's height is deliberately part of this: moving it up widens the cone
 * to cover the same floor, so the pool stays put when the light is repositioned.
 */
export function poolAngle(
  position: readonly [number, number, number],
  bounds: TrayBounds,
  aimZ: number,
): number {
  const distance = new THREE.Vector3(...position).distanceTo(
    new THREE.Vector3(0, 0, aimZ),
  );
  return Math.atan((poolReach(bounds, aimZ) * POOL_SPREAD) / distance);
}

/**
 * Where the play area's corner falls within the cone, as a fraction of its
 * radius. 1 is exactly on the cone's edge.
 *
 * This is the number that reveals whether a pool is visible at all: with
 * `penumbra: 1` three attenuates smoothly from the cone's centre to its edge,
 * so a corner sitting at half the radius is still near full brightness and the
 * falloff is off-screen. It is what `verify:pool` asserts on.
 */
export function poolCornerRatio(
  position: readonly [number, number, number],
  bounds: TrayBounds,
  aimZ: number,
  angle: number,
): number {
  const distance = new THREE.Vector3(...position).distanceTo(
    new THREE.Vector3(0, 0, aimZ),
  );
  return poolReach(bounds, aimZ) / (distance * Math.tan(angle));
}
