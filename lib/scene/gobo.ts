"use client";

import * as THREE from "three";
import { smoothNoise } from "./velvet";

/**
 * A gobo for the spotlight: the cone, broken up.
 *
 * Light in a room is almost never clean. It comes past a curtain, a doorway,
 * something on a shelf, and what lands on the floor is uneven in a way no
 * amount of tuning a bare cone reproduces. Projecting a soft dapple through the
 * spot buys that unevenness for one texture and puts nothing in the frame —
 * which matters here, because every accessory that *was* in the frame got
 * removed for reading as clutter.
 *
 * Deliberately vague. Anything you can identify — blinds, a lattice, leaves —
 * becomes a thing the room contains, and then you are back to owning a prop.
 * This is only meant to stop the pool being a perfect ellipse.
 *
 * Built the same way as the velvet: deterministic sin-hash noise, no
 * Math.random, cached at module level so it is made once per load.
 */

const SIZE = 256;

/**
 * How dark the dapple ever gets, as a fraction of full brightness.
 *
 * High on purpose. The whole atmosphere budget in this project runs on one
 * rule — a flicker you notice is a bug, one you don't is atmosphere — and a
 * gobo is the easiest thing here to overdo. At 0.72 the unevenness registers
 * without any patch of the felt looking like it is in shade.
 */
const FLOOR = 0.72;

/**
 * How much of the texture's edge is held at full brightness.
 *
 * The cone already fades to nothing at its rim via `penumbra: 1`. Letting the
 * dapple darken the same edge fades it twice, which pulls the pool in and makes
 * it read small and hard.
 */
const EDGE_GUARD = 0.18;

let cached: THREE.Texture | null = null;

/**
 * Brightness at a point in the cone.
 *
 * Two broad octaves and nothing finer. Fine detail is wrong twice over: the
 * texture is projected across a couple of world units so it would be magnified
 * into mush anyway, and small shapes are exactly the ones the eye starts trying
 * to name.
 */
function dapple(u: number, v: number): number {
  const broad = smoothNoise(u * 3, v * 3, 3);
  const drift = smoothNoise(u * 6 + 11, v * 6 + 7, 6);
  return broad * 0.65 + drift * 0.35;
}

export function getGoboMap(): THREE.Texture {
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;

      // Distance from the centre, 0 at the middle and 1 at the edge of the
      // inscribed circle — the cone is round, so the corners of this square are
      // never sampled and don't need to be right.
      const radius = Math.hypot(u - 0.5, v - 0.5) * 2;

      // Ease the dapple out toward the rim so the cone's own penumbra is the
      // only thing shaping its edge.
      const guard = Math.min(1, Math.max(0, (radius - (1 - EDGE_GUARD)) / EDGE_GUARD));
      const strength = 1 - guard * guard;

      const value = FLOOR + (1 - FLOOR) * (1 - dapple(u, v) * strength);
      const byte = Math.round(Math.min(1, value) * 255);

      const i = (y * SIZE + x) * 4;
      image.data[i] = byte;
      image.data[i + 1] = byte;
      image.data[i + 2] = byte;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  /*
   * Unlike the velvet maps, this one is colour: three multiplies the light by
   * it, so it wants the same colour management as anything else that ends up on
   * screen as brightness.
   */
  texture.colorSpace = THREE.SRGBColorSpace;
  // Clamped, not repeated — the texture spans the cone exactly once, and
  // wrapping would tile a second dapple around the outside of it.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;

  cached = texture;
  return texture;
}
