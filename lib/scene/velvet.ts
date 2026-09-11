"use client";

import * as THREE from "three";

/**
 * Procedural velvet: a normal map and a matching roughness map.
 *
 * Velvet is a dense directional pile. What makes it read as velvet rather than
 * as any other cloth is that the sheen *changes along the nap* — the pile lies
 * one way, so light skates along it and catches. A normal map alone gives
 * texture but not that sheen, which is why the roughness varies with the same
 * height field: the streaks are slightly smoother than the gaps between them.
 *
 * Both are geometric data rather than colour, so the surface colour stays
 * exactly as authored and only the way light lands on it changes.
 */

const SIZE = 256;
/** World units one tile spans. Small, because the pile is fine. */
export const VELVET_TILE = 0.3;

let cachedNormal: THREE.Texture | null = null;
let cachedRoughness: THREE.Texture | null = null;

/** Deterministic value noise — no Math.random, so the felt is identical every
 *  load and the texture can be built during render. */
export function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Wraps at `period` so the tile repeats seamlessly across the table. */
export function smoothNoise(x: number, y: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  // Smoothstep, so the interpolation has no visible grid creases.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const wrap = (v: number) => ((v % period) + period) % period;
  const a = hash(wrap(x0), wrap(y0));
  const b = hash(wrap(x0 + 1), wrap(y0));
  const c = hash(wrap(x0), wrap(y0 + 1));
  const d = hash(wrap(x0 + 1), wrap(y0 + 1));

  return (
    a * (1 - ux) * (1 - uy) +
    b * ux * (1 - uy) +
    c * (1 - ux) * uy +
    d * ux * uy
  );
}

/**
 * Height of the pile at a point.
 *
 * Mostly the brushed lay: felt on a real table gets swept in one direction, so
 * it shows faint streaks running across it rather than even speckle. Sampling
 * the noise stretched — many steps along one axis, few across it — is what
 * makes the grain elongate into those streaks.
 */
function height(u: number, v: number): number {
  // Strongly stretched: long, fine lines in the sweep direction.
  const brush = smoothNoise(u * 160, v * 10, 160);
  // A second, broader pass so the sweep isn't a single regular corduroy.
  const sweep = smoothNoise(u * 48, v * 6, 48);
  // A little isotropic grain underneath, or the surface reads as ribbed
  // plastic rather than cloth.
  const grain = smoothNoise(u * 96, v * 96, 96);

  return brush * 0.42 + sweep * 0.34 + grain * 0.24;
}

export function getVelvetNormalMap(): THREE.Texture {
  if (cachedNormal) return cachedNormal;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(SIZE, SIZE);

  // Slope from central differences on the height field, encoded the way a
  // tangent-space normal map is read: +x in red, +y in green, up in blue.
  const step = 1 / SIZE;
  const strength = 2.2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;

      const dx = (height(u + step, v) - height(u - step, v)) * strength;
      const dy = (height(u, v + step) - height(u, v - step)) * strength;

      const normal = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * SIZE + x) * 4;
      image.data[i] = (normal.x * 0.5 + 0.5) * 255;
      image.data[i + 1] = (normal.y * 0.5 + 0.5) * 255;
      image.data[i + 2] = (normal.z * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // Normals are geometric data, not colour — colour-managing them would bend
  // the light in the wrong direction.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;

  cachedNormal = texture;
  return texture;
}

/**
 * Roughness across the pile.
 *
 * Where the nap stands up the surface scatters more; where it lies flat it
 * catches the light. Mapping height to roughness inversely is what produces
 * velvet's shifting sheen instead of an evenly matte cloth.
 */
export function getVelvetRoughnessMap(): THREE.Texture {
  if (cachedRoughness) return cachedRoughness;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const h = height(x / SIZE, y / SIZE);
      // Narrow range: this modulates the material's own roughness rather than
      // replacing it, so the sheen is a shimmer and not a set of wet patches.
      const value = Math.round((0.62 + (1 - h) * 0.38) * 255);

      const i = (y * SIZE + x) * 4;
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;

  cachedRoughness = texture;
  return texture;
}
