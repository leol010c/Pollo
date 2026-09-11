"use client";

import * as THREE from "three";

/**
 * The candles: wax, and the flame on top of it.
 *
 * There has been a candle in this scene for a while, but only as a light — a
 * warm point source low and off to one side, with nothing there to be emitting
 * it. The reasoning at the time was that every prop tried in the middle of the
 * frame competed with the die, so the flame was kept and the candle thrown away.
 *
 * What that reasoning missed is that an unmotivated light is why the room never
 * read as a room. A warm glow with no source in shot is just a coloured lamp;
 * the same glow with a flame above it is somewhere you are. Now that the props
 * solve their positions into the margins (props.ts) the object can come back
 * without landing anywhere near the die.
 *
 * Everything here is procedural and module-cached, like the velvet and the gobo
 * — there are no asset files in this project and a strict CSP would block
 * fetching any.
 */

// --- Wax ---------------------------------------------------------------------

/**
 * Half-section of a candle, revolved.
 *
 * Unit height and unit radius, so one buffer serves both the taper and the
 * pillar at whatever proportions they are given.
 *
 * The top three points are the part that matters. A cylinder cut flat across
 * reads as a dowel; what says "candle" is the dip — wax burns down into a small
 * pool and leaves a raised rim around it. It costs two vertices and it is most
 * of the silhouette at this size.
 */
const PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.98, 0.0],
  [1.0, 0.06],
  [0.97, 0.3],
  [0.95, 0.55],
  [0.93, 0.78],
  [0.92, 0.9],
  [0.9, 0.96],
  [0.82, 0.99],
  [0.5, 0.955],
  [0.16, 0.94],
  [0.0, 0.945],
];

/** Low. These are a few dozen pixels across on a phone. */
const LATHE_SEGMENTS = 14;

let cachedWax: THREE.BufferGeometry | null = null;

export function getWaxGeometry(): THREE.BufferGeometry {
  if (cachedWax) return cachedWax;

  const geometry = new THREE.LatheGeometry(
    PROFILE.map(([x, y]) => new THREE.Vector2(x, y)),
    LATHE_SEGMENTS,
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  cachedWax = geometry;
  return geometry;
}

const EMISSIVE_SIZE = 64;

let cachedGlow: THREE.Texture | null = null;

/**
 * Where the wax glows from within.
 *
 * Wax is translucent, and near a flame the top centimetre of it lights up from
 * the inside — that is most of what distinguishes a candle from a painted
 * cylinder of the same colour. The honest way to get it is `transmission`,
 * which means rendering the object twice through a refraction pass; on a phone,
 * for something this small, that is a lot to spend on an effect nobody can
 * resolve.
 *
 * So it is faked with an emissive that is dark up the shaft and warm at the top.
 * A lathe's V runs along its profile, base to rim, which is exactly the axis the
 * gradient needs — one narrow strip of texture does it.
 */
export function getWaxGlowMap(): THREE.Texture {
  if (cachedGlow) return cachedGlow;

  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = EMISSIVE_SIZE;
  const ctx = canvas.getContext("2d")!;

  // Textures are flipped on load, so row 0 of the canvas is V=1 — the rim.
  const gradient = ctx.createLinearGradient(0, 0, 0, EMISSIVE_SIZE);
  gradient.addColorStop(0, "#ffb877");
  gradient.addColorStop(0.06, "#c9662e");
  gradient.addColorStop(0.22, "#3a1408");
  gradient.addColorStop(1, "#000000");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, EMISSIVE_SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  cachedGlow = texture;
  return texture;
}

export function getWaxMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    // Warm cream rather than white. A white candle in a room lit this warm
    // reads as the brightest, coolest thing on screen and pulls the eye
    // straight off the die.
    color: "#e8d5bd",
    roughness: 0.66,
    metalness: 0,
    emissive: new THREE.Color("#ffffff"),
    emissiveMap: getWaxGlowMap(),
    emissiveIntensity: 0.9,
  });
}

// --- Flame -------------------------------------------------------------------

const FLAME_SIZE = 64;

let cachedFlame: THREE.Texture | null = null;

/**
 * Half-width of the flame at a height, 0 at the wick and 1 at the tip.
 *
 * `sin` alone would put the widest point exactly halfway up and give a symmetric
 * lozenge; weighting it toward the base drags the maximum down to about a third
 * and draws the top out into a point, which is the shape a flame actually has.
 * Both ends still close, so the texture never has a hard edge to clip against.
 */
function flameWidth(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t) ** 0.75 * (1 - t) ** 0.35;
}

export function getFlameMap(): THREE.Texture {
  if (cachedFlame) return cachedFlame;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = FLAME_SIZE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(FLAME_SIZE, FLAME_SIZE);

  for (let y = 0; y < FLAME_SIZE; y++) {
    // Row 0 is the top of the canvas, which is the tip once the texture flips.
    const t = 1 - (y + 0.5) / FLAME_SIZE;
    const half = flameWidth(t) * 0.5;

    for (let x = 0; x < FLAME_SIZE; x++) {
      const u = ((x + 0.5) / FLAME_SIZE) * 2 - 1;
      const k = half > 0 ? Math.abs(u) / half : 2;

      // Squared falloff across the width, so the flame has a bright spine
      // rather than an evenly lit blob.
      const density = k >= 1 ? 0 : (1 - k * k) ** 1.5;
      // The core is hottest low down; by the tip the whole width has cooled to
      // orange. Without this the flame is one colour and reads as a sticker.
      const core = density * (1 - t) ** 0.8;

      const i = (y * FLAME_SIZE + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = Math.round(170 + 82 * core);
      image.data[i + 2] = Math.round(45 + 175 * core * core);
      image.data[i + 3] = Math.round(density * 235);
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  cachedFlame = texture;
  return texture;
}

/**
 * The flame's surface.
 *
 * A sprite rather than a quad in the world. A flame has no orientation to get
 * wrong — it should look like an upright flame from wherever you are — and a
 * sprite is screen-aligned, so it stays upright by construction. A billboarded
 * plane facing a camera pitched 66° down would instead lie back toward the lens
 * and read as a puddle.
 *
 * Unlit, because a flame emits: shading it by the scene's lights would come out
 * darkest in the dark room it is supposed to be lighting.
 *
 * `toneMapped: false` keeps it hot. Tone mapping is deliberately rolling the
 * highlights off everywhere else, and a flame that has been rolled off is a warm
 * smudge; this is the one thing on screen allowed to sit at the top of the
 * range. It never writes depth, so two overlapping flames don't cut each other
 * out.
 */
export function getFlameMaterial(): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: getFlameMap(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Flame proportions, relative to the candle's own radius.
 *
 * Taller than a flame really is against its candle. At true scale on a taper
 * about five centimetres across, the flame came out a couple of pixels on a
 * phone — technically correct and completely invisible, which defeats the point
 * of having lit the scene from it. Overscaling the one part of the prop that is
 * meant to be looked at is the cheaper compromise.
 */
export const FLAME_HEIGHT = 2.6;
export const FLAME_WIDTH = 1.25;
