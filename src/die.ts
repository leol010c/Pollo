/**
 * The objects on the table: two rounded cubes, one printed with drawings and
 * one printed with words, and the bookkeeping that keeps each standing where
 * the physics says it is.
 *
 * Both are the same solid and the same size. Only the ink differs — a matched
 * pair from the same maker, which is what makes it obvious they are meant to be
 * thrown one after the other.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type * as CANNON from "cannon-es";
import { FACE_VALUES } from "./faces";
import { DIE_HALF } from "./physics";
import { positionFor } from "./positions";
import { locationFor } from "./locations";
import { pipCells } from "./pips";
import { BONE, CYAN, INK, PINK, SLATE } from "./palette";

/**
 * Pixels per face.
 *
 * The die can fill a good part of a laptop screen, so a face is a few hundred
 * device pixels across; 256 left the pictograms visibly soft, and the artwork is
 * only 252 wide to begin with, so this is as far as it is worth going.
 */
const CELL = 512;

/** How much of the face the drawing takes, leaving a printed margin. */
const ART_INSET = 0.075;

/** The corner cluster: small enough to be a maker's mark, not a second subject. */
const PIP_BOX = 0.235 * CELL;
const PIP_MARGIN = 0.055 * CELL;
const PIP_RADIUS = PIP_BOX * 0.125;

/** Softens the bevel so what is printed does not wrap around a hard edge. */
const CORNER_RADIUS = 0.085;

/** Type on a face: heavy, wide, and set to whatever width is left. */
const WORD_FONT = '700 128px Archivo, "Helvetica Neue", Helvetica, Arial, sans-serif';
const WORD_TRACKING = 0.04;
const WORD_WIDTH = 0.78;

interface Ink {
  /** The face itself. */
  body: string;
  /** The corner pips. */
  pips: string;
  roughness: number;
}

const PICTURE_INK: Ink = { body: BONE, pips: CYAN, roughness: 0.44 };
const WORD_INK: Ink = { body: INK, pips: PINK, roughness: 0.38 };

function paintPips(ctx: CanvasRenderingContext2D, value: number, ink: Ink) {
  ctx.fillStyle = ink.pips;
  const step = PIP_BOX / 3;
  for (const cell of pipCells(value)) {
    const cx = PIP_MARGIN + (0.5 + (cell % 3)) * step;
    const cy = PIP_MARGIN + (0.5 + Math.floor(cell / 3)) * step;
    ctx.beginPath();
    ctx.arc(cx, cy, PIP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function face(ink: Ink): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = CELL;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = ink.body;
  ctx.fillRect(0, 0, CELL, CELL);
  return ctx;
}

function paintPicture(value: number, art: HTMLImageElement): HTMLCanvasElement {
  const ctx = face(PICTURE_INK);
  // The pips, top left, so the die still reads as a die at the size it is
  // actually seen — a face of pictogram alone is a tile.
  paintPips(ctx, value, PICTURE_INK);

  const inset = CELL * ART_INSET;
  const box = CELL - inset * 2;
  const scale = Math.min(box / art.naturalWidth, box / art.naturalHeight);
  const width = art.naturalWidth * scale;
  const height = art.naturalHeight * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(art, (CELL - width) / 2, (CELL - height) / 2, width, height);

  return ctx.canvas;
}

/**
 * A word across a face, set as large as it will go.
 *
 * The names are between three and seven letters, which at one fixed size is the
 * difference between filling the face and rattling around on it, so the type is
 * measured and scaled to the width that is left rather than chosen.
 */
function paintWord(value: number, word: string): HTMLCanvasElement {
  const ctx = face(WORD_INK);
  paintPips(ctx, value, WORD_INK);

  const letters = word.toUpperCase();
  ctx.font = WORD_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${WORD_TRACKING * 128}px`;

  const measured = ctx.measureText(letters).width;
  const scale = (CELL * WORD_WIDTH) / Math.max(measured, 1);
  const size = Math.min(128 * scale, CELL * 0.3);

  ctx.font = WORD_FONT.replace("128px", `${Math.round(size)}px`);
  ctx.letterSpacing = `${WORD_TRACKING * size}px`;
  ctx.fillStyle = BONE;
  // A shade below centre: the pips sit above the word, and dead centre reads as
  // low once they are there.
  ctx.fillText(letters, CELL / 2, CELL * 0.55);

  // A hairline under the word, the width of the word. It is the one thing that
  // makes a face of type look printed rather than typed.
  const rule = ctx.measureText(letters).width;
  ctx.fillStyle = SLATE;
  ctx.fillRect((CELL - rule) / 2, CELL * 0.72, rule, Math.max(2, size * 0.035));

  return ctx.canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

export interface Die {
  mesh: THREE.Mesh;
  /**
   * Copies the body's pose onto the mesh. When the die had to be laid flat, the
   * mesh eases into the new orientation instead of cutting to it — the fix is
   * rare, and it should look like the die tipping over rather than like a bug.
   */
  sync(body: CANNON.Body, easing: boolean): void;
}

function build(
  renderer: THREE.WebGLRenderer,
  ink: Ink,
  faces: HTMLCanvasElement[],
): Die {
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  const materials = faces.map((canvas) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: ink.roughness,
      metalness: 0.02,
      envMapIntensity: 0.55,
    });
  });

  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 6, CORNER_RADIUS),
    materials,
  );
  mesh.castShadow = true;
  mesh.position.set(0, DIE_HALF, 0);

  const target = new THREE.Quaternion();

  return {
    mesh,
    sync(body, easing) {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      target.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
      if (easing) mesh.quaternion.slerp(target, 0.18);
      else mesh.quaternion.copy(target);
    },
  };
}

// FACE_VALUES is in BoxGeometry's group order, so mapping over it lands each
// value on the face whose normal faces.ts reads.
export async function createPositionDie(renderer: THREE.WebGLRenderer): Promise<Die> {
  const faces = await Promise.all(
    FACE_VALUES.map(async (value) =>
      paintPicture(value, await loadImage(positionFor(value).src)),
    ),
  );
  return build(renderer, PICTURE_INK, faces);
}

export async function createLocationDie(renderer: THREE.WebGLRenderer): Promise<Die> {
  // The face is type, so it cannot be painted until the typeface is here.
  // If it never arrives the fallback stack still measures and prints.
  await document.fonts.load(WORD_FONT).catch(() => {});
  const faces = FACE_VALUES.map((value) => paintWord(value, locationFor(value).name));
  return build(renderer, WORD_INK, faces);
}
