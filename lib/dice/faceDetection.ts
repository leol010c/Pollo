import * as THREE from "three";
import { getDieGeometry } from "./geometry";
import { READS_FACE_DOWN, type DieType } from "./types";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Vector3();

/**
 * A die resting cleanly has one face normal almost exactly aligned with world
 * up. Anything below this means it is leaning on an edge or propped against
 * another die, and the reading cannot be trusted.
 */
const CLEAN_ALIGNMENT = 0.86;

export interface FaceReading {
  value: number;
  /** Dot product of the winning normal with world up — 1.0 is dead flat. */
  alignment: number;
  /** False when the die is cocked and the value should not be committed. */
  clean: boolean;
}

/**
 * Reads the landed value from a die's orientation alone.
 *
 * For most dice the answer is the face pointing up. A d4 has a vertex up rather
 * than a face, so its numerals are read off the face resting on the tray — the
 * normal pointing most steeply *down*.
 */
export function readFace(
  type: DieType,
  quaternion: THREE.Quaternion,
): FaceReading {
  const { faceNormals, faceValues } = getDieGeometry(type);
  const faceDown = READS_FACE_DOWN[type];

  let bestIndex = 0;
  let bestDot = -Infinity;

  for (let i = 0; i < faceNormals.length; i++) {
    scratch.copy(faceNormals[i]).applyQuaternion(quaternion);
    // Reading the underside is the same search against world down.
    const dot = faceDown ? -scratch.dot(WORLD_UP) : scratch.dot(WORLD_UP);
    if (dot > bestDot) {
      bestDot = dot;
      bestIndex = i;
    }
  }

  return {
    value: faceValues[bestIndex],
    alignment: bestDot,
    clean: bestDot >= CLEAN_ALIGNMENT,
  };
}
