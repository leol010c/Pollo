"use client";

import * as THREE from "three";
import { PETAL_LENGTH, PETAL_WIDTH } from "./props";

/**
 * One rose petal, built rather than drawn.
 *
 * The temptation with something this small is a flat quad and an alpha-cut
 * texture, which is cheaper and looks it: a flat petal takes the same light
 * across its whole face, so a scatter of them reads as confetti — a set of
 * identically-bright shapes lying on the cloth. What makes a real petal read is
 * that it is a curved surface. It is brighter along the fold and darker in the
 * cup, and each one is turned a different way, so the same scatter comes out as
 * a range of tones from one light.
 *
 * That curvature is the entire reason for the geometry, and it is why the mesh
 * is a coarse grid rather than two triangles — a plane cannot bend.
 *
 * Cheap enough not to argue about: twenty-odd triangles each, all instanced off
 * this one buffer in a single draw call.
 */

const SEGMENTS_ACROSS = 4;
const SEGMENTS_ALONG = 6;

/** How far the long edges lift out of the plane, in world units. */
const CUP = 0.028;
/** How far the tip curls up on top of that. */
const CURL = 0.042;

/**
 * Width at the stem end, as a fraction of the widest point.
 *
 * A petal is not an ellipse — it is broad and round at the tip and pinched
 * where it was attached. Leaving it symmetric is the single thing that most
 * makes these read as generic leaves.
 */
const STEM_PINCH = 0.42;

let cachedGeometry: THREE.BufferGeometry | null = null;

export function getPetalGeometry(): THREE.BufferGeometry {
  if (cachedGeometry) return cachedGeometry;

  const geometry = new THREE.PlaneGeometry(
    PETAL_WIDTH,
    PETAL_LENGTH,
    SEGMENTS_ACROSS,
    SEGMENTS_ALONG,
  );
  // Lay it down. The instances only ever apply a yaw and a small tilt, so the
  // petal has to arrive already flat on the floor.
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const halfWidth = PETAL_WIDTH / 2;
  const halfLength = PETAL_LENGTH / 2;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);

    // -1 at the stem, +1 at the tip; -1..1 across.
    const along = z / halfLength;
    const across = x / halfWidth;

    // Rounded outline: an ellipse, pinched toward the stem end.
    const round = Math.sqrt(Math.max(0, 1 - along * along));
    const taper = STEM_PINCH + (1 - STEM_PINCH) * ((along + 1) / 2);

    position.setX(i, x * round * taper);
    // The cup rises toward the long edges; the curl lifts the tip on top of it.
    position.setY(
      i,
      CUP * across * across + CURL * Math.max(0, along) ** 2,
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  cachedGeometry = geometry;
  return geometry;
}

export interface PetalTint {
  color: string;
  sheenColor: string;
}

/**
 * The default rose.
 *
 * Scarlet, and brighter than the felt it lies on. Darkening these so they sat
 * *into* the velvet was tried and rejected: it is the contrast against the wine
 * that makes them read as roses rather than as marks on the cloth. A room that
 * overrides this inherits that rule along with the colour — see `Backdrop.petal`
 * in backdrops.ts.
 */
export const PETAL_TINT: PetalTint = {
  color: "#8c1330",
  sheenColor: "#e07a9a",
};

/**
 * Petal surface.
 *
 * `sheen` rather than a low roughness, for the same reason the felt uses it: a
 * glossy lobe on a curved surface under a raking light is a hard specular
 * streak, and twenty of those spread across the floor look like wet plastic.
 * Sheen brightens the petal where it turns away from the eye instead, which is
 * how a real one catches — along its rolled edge rather than in a spot.
 *
 * Double-sided because they are one polygon thick and tilted, so a good number
 * of them are seen from underneath.
 */
export function getPetalMaterial(
  tint: PetalTint = PETAL_TINT,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: tint.color,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.6,
    sheenColor: new THREE.Color(tint.sheenColor),
    sheenRoughness: 0.45,
    side: THREE.DoubleSide,
  });
}
