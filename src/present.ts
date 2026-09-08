/**
 * Holding a die up to be read.
 *
 * A die that has answered is not much use lying flat on a table you are looking
 * at from the side — the face that decided it is the one face you cannot see
 * properly. So the die rises off the felt, turns the landed face square-on, and
 * holds it where the placard is about to print it.
 *
 * "Where the placard is about to print it" is meant exactly. The pose is solved
 * from a rectangle on the screen — the card the result will open out into — so
 * the die arrives sitting precisely in that card's place, and the card can then
 * grow out of the face rather than land on top of it. Nothing here is tuned to
 * a screen size, because the layout is asked rather than assumed.
 */

import * as THREE from "three";
import { FACE_NORMALS, FACE_UPS } from "./faces";
import { DIE_HALF } from "./physics";

export interface Hold {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Where on the screen the die should end up, in CSS pixels. */
export interface Slot {
  left: number;
  top: number;
  width: number;
  height: number;
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const normal = new THREE.Vector3();
const faceUp = new THREE.Vector3();
const localBasis = new THREE.Matrix4();
const targetBasis = new THREE.Matrix4();

/**
 * The pose that puts face `index` square-on to the camera, filling `slot`.
 *
 * The distance comes out of the field of view rather than being a number
 * somebody liked: a face one world unit across covers `slot.height` pixels only
 * at one distance, and that distance is different on a phone and a laptop
 * because the camera is not standing in the same place.
 */
export function holdFor(
  camera: THREE.PerspectiveCamera,
  slot: Slot,
  index: number,
  viewport: { width: number; height: number },
): Hold {
  camera.updateMatrixWorld();
  camera.getWorldDirection(forward);
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  const half = Math.tan((camera.fov * Math.PI) / 360);
  const face = DIE_HALF * 2;
  // Where the *face* has to be for it to cover the slot — and then half a die
  // further out, because it is the front of the die that has to land there and
  // the pose is the middle of it. Eight per cent, at the distance this works
  // out to, which is the difference between a card that opens out of the face
  // and one that opens out of slightly inside it.
  const toFace = (face * viewport.height) / (2 * slot.height * half);
  const distance = toFace + DIE_HALF;

  // How much world one pixel is worth out at the face, which turns the card's
  // offset from the middle of the screen into an offset from the middle of the
  // frame. Taken at the face for the same reason the distance was.
  const perPixel = (2 * toFace * half) / viewport.height;
  const acrossPx = slot.left + slot.width / 2 - viewport.width / 2;
  const downPx = slot.top + slot.height / 2 - viewport.height / 2;

  const position = camera.position
    .clone()
    .addScaledVector(forward, distance)
    .addScaledVector(right, acrossPx * perPixel)
    .addScaledVector(up, -downPx * perPixel);

  return { position, quaternion: squareOn(index) };
}

/**
 * The turn that points face `index` at the camera, printed way up.
 *
 * Two frames and the rotation between them. The face's own — where its picture
 * has its right, its top, and which way it looks — and the one we want those
 * three to end up as on screen: the camera's right, the camera's up, and back
 * toward the camera. R = T · Lᵀ takes the first onto the second.
 */
function squareOn(index: number): THREE.Quaternion {
  const n = FACE_NORMALS[index]!;
  const u = FACE_UPS[index]!;
  normal.set(n.x, n.y, n.z);
  faceUp.set(u.x, u.y, u.z);
  localBasis.makeBasis(
    new THREE.Vector3().crossVectors(faceUp, normal).normalize(),
    faceUp,
    normal,
  );

  const toCamera = forward.clone().negate();
  const screenUp = up.clone().addScaledVector(toCamera, -up.dot(toCamera)).normalize();
  targetBasis.makeBasis(
    new THREE.Vector3().crossVectors(screenUp, toCamera),
    screenUp,
    toCamera,
  );

  return new THREE.Quaternion().setFromRotationMatrix(
    targetBasis.multiply(localBasis.transpose()),
  );
}

/** Leaves the table quickly, arrives gently. */
export function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}
