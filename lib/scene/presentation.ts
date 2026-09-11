import * as THREE from "three";
import { DIE_RADIUS } from "@/lib/dice/types";
import type { TrayBounds } from "./bounds";

/**
 * Where the die goes to show its result.
 *
 * Rather than a card covering the scene, the die itself becomes the readout: it
 * rises toward the camera and turns its landed face square-on. That keeps the
 * object you were watching as the thing that answers you, and on a phone it
 * avoids putting a modal over the whole screen every few seconds.
 */

/** Fraction of the viewport's height the presented die should fill. */
const SCREEN_FILL = 0.46;
/**
 * Vertical offset from dead centre.
 *
 * Zero: the die holds in the middle of the frame, which is what lets the full
 * picture that opens over it be centred too. Controls and caption sit below,
 * clear of it.
 */
const RISE = 0;

const scratchUp = new THREE.Vector3();
const localBasis = new THREE.Matrix4();
const targetBasis = new THREE.Matrix4();

export interface PresentationPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * How far in front of the camera the die holds.
 *
 * A sphere of radius R subtends 2·atan(R/d); solving that for the share of the
 * vertical fov we want gives the distance. Exported rather than inlined because
 * anything else that holds in front of the camera has to know where the die
 * already is — the coin sits deliberately in front of this, and a check that
 * recomputed this number from a copy of SCREEN_FILL would go on passing after
 * someone changed the real one.
 */
export function presentationDistance(fov: number): number {
  return holdDistance(fov, DIE_RADIUS, SCREEN_FILL);
}

/**
 * The same solve, for anything that holds in front of the camera.
 *
 * The die is not the only thing that presents itself any more — the coin lands
 * on the table and then comes up to be read exactly as the die does, and it is
 * a different size. One solve rather than two copies of the trigonometry, so a
 * change to how presenting works cannot apply to only half of what presents.
 */
export function holdDistance(
  fov: number,
  radius: number,
  fill: number,
): number {
  return radius / Math.tan((fill * fov * Math.PI) / 360);
}

/**
 * The orientation that turns `faceNormal` square-on to the camera.
 *
 * Split out of presentationPose because where a thing holds and how it is
 * turned are separate questions, and the aside pose below needs the second
 * answer with a different first one.
 */
export function faceCameraQuaternion(
  camera: THREE.PerspectiveCamera,
  faceNormal: THREE.Vector3,
  faceUp: THREE.Vector3,
): THREE.Quaternion {
  camera.updateMatrixWorld();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const up = scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  const toCamera = forward.clone().negate();
  const screenUp = up
    .clone()
    .addScaledVector(toCamera, -up.dot(toCamera))
    .normalize();

  // Local frame of the face: (e1, e2, normal), matching how the UVs were built.
  const e2 = faceUp.clone().normalize();
  const e1 = new THREE.Vector3().crossVectors(e2, faceNormal).normalize();
  localBasis.makeBasis(e1, e2, faceNormal);

  // Target frame: that face's axes, where we want them to end up on screen.
  const targetX = new THREE.Vector3().crossVectors(screenUp, toCamera);
  targetBasis.makeBasis(targetX, screenUp, toCamera);

  // R = T · Lᵀ takes the face's local axes onto the target ones.
  const rotation = targetBasis.multiply(localBasis.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(rotation);
}

/** How far the die's edge keeps off the rails when it stands aside. */
const ASIDE_GAP = 0.06;

/**
 * Where the die waits while the coin decides the round: the far right of the
 * felt, in under the candle that stands just outside that corner.
 *
 * A place on the table rather than a place in the frame, and the difference is
 * the whole point. The first version of this held the die in front of the
 * camera at the top-right of the picture, which is a perfectly good way to park
 * a piece of interface and entirely the wrong thing for an object in a room: it
 * floated, it belonged to the screen rather than the scene, and being pinned to
 * the frame is exactly what let it end up over the edge of one.
 *
 * Solved from the play area, so it cannot be off screen — the tray is framed by
 * construction, and the die keeps its own resting height and orientation, so
 * what happens is that it goes and sits down next to the candle.
 */
export function asideSpot(bounds: TrayBounds): { x: number; z: number } {
  const inset = DIE_RADIUS + ASIDE_GAP;
  return {
    x: bounds.halfX - inset,
    // zMin is the far edge, away from the camera. Back and to the right is
    // where the candle is, and it is the corner furthest from where the coin
    // comes down — which is the middle.
    z: bounds.zMin + inset,
  };
}

/**
 * Computes where and how the die should hold to present `faceNormal`.
 *
 * The distance is solved from the camera's field of view rather than fixed, so
 * the die fills the same share of the frame on a phone as on a desktop — the
 * phone's wider lens and further camera would otherwise make it look small
 * exactly where it matters most.
 */
export function presentationPose(
  camera: THREE.PerspectiveCamera,
  faceNormal: THREE.Vector3,
  faceUp: THREE.Vector3,
  // The coin is a different size and presents at its own distance. Omitted
  // everywhere else, which is the die and means "as far as the die holds".
  distance = presentationDistance(camera.fov),
): PresentationPose {
  camera.updateMatrixWorld();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  // Screen up, taken from the camera rather than the world, so the framing is
  // correct at any camera pitch.
  const up = scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const halfAngle = (SCREEN_FILL * camera.fov * Math.PI) / 360;

  const position = camera.position
    .clone()
    .addScaledVector(forward, distance)
    .addScaledVector(up, distance * RISE * Math.tan(halfAngle) * 2);

  return {
    position,
    quaternion: faceCameraQuaternion(camera, faceNormal, faceUp),
  };
}

/** Eases the rise, so it leaves the table quickly and arrives gently. */
export function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}
