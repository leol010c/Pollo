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
import { FACE_VALUES, type Quat } from "./faces";
import { easeOut, type Hold } from "./present";
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

/**
 * How long a die takes to leave the table, in seconds.
 *
 * A die is dismissed at the same instant the next one is released, and a throw
 * spends about half a second in the air before it touches anything, so the one
 * going is gone well before the one coming lands. Nothing waits on this.
 */
const FADE_SECONDS = 0.26;

/** How far a leaving die shrinks, so its shadow goes with it. */
const GONE_SCALE = 0.86;

/** How long the die takes to rise off the felt and turn its face to you. */
const RISE_SECONDS = 0.62;

/** And to go back down, which is a plainer move than coming up was. */
const LAY_SECONDS = 0.44;

/**
 * A turn thrown in on the way up.
 *
 * The shortest path between two orientations is correct and completely
 * undramatic — the die turns the least it can get away with. Winding a whole
 * extra revolution in at the start and unwinding it across the rise makes the
 * reveal a small performance instead. A turn of 2π is the identity, so both
 * ends of the move are exactly where they would have been.
 */
const FLOURISH_TURNS = 1;

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
   * Lifts the die off the felt to hold its landed face square-on to the camera.
   *
   * Nothing about the physics changes: the body stays frozen where it landed,
   * and this is the picture of it going up. There is nothing else on the table
   * for it to have to still be part of.
   */
  present(hold: Hold, flourish: boolean): void;
  /** Puts it back down where the body has been sitting all along. */
  lay(): void;
  /** Drops the hold at once, for a die that is being thrown again. */
  release(): void;
  /** True once the rise is over and the die is holding still to be read. */
  readonly arrived: boolean;
  /** True whenever the die is anywhere other than where its body is. */
  readonly held: boolean;
  /** Puts the die back on the table at full strength. */
  appear(): void;
  /**
   * Starts it leaving. The body is off the felt already; this is the picture.
   * `now` takes it away without the fade, for a die that was never seen.
   */
  dismiss(now?: boolean): void;
  /** Advances the fade by one frame. */
  advance(dt: number): void;
  /** True while there is still something of it left to draw. */
  readonly leaving: boolean;
  /**
   * Copies the body's pose onto the mesh. When the die had to be laid flat, the
   * mesh eases into the new orientation instead of cutting to it — the fix is
   * rare, and it should look like the die tipping over rather than like a bug.
   *
   * `facing` is which way round the die is being held: a turn of the cube onto
   * itself, so it moves the printing and leaves the solid exactly where the
   * physics put it.
   */
  sync(body: CANNON.Body, facing: Quat, easing: boolean): void;
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
      // Only ever anything but 1 while the die is leaving, but declared here:
      // turning transparency on partway through costs a shader compile, and a
      // stutter at exactly the moment of a throw is the one place it shows.
      transparent: true,
    });
  });

  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 6, CORNER_RADIUS),
    materials,
  );
  mesh.castShadow = true;
  mesh.position.set(0, DIE_HALF, 0);

  const target = new THREE.Quaternion();
  const held = new THREE.Quaternion();
  const resting = new THREE.Vector3();

  /** 1 while the die is on the table, 0 once it has gone. */
  let strength = 1;
  let going = false;

  /** Where the die is being drawn: on the felt, on its way up, or up. */
  let show: "table" | "rising" | "up" | "laying" = "table";
  let hold: Hold | null = null;
  const from = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  let travelled = 0;
  let flourishing = false;
  const spin = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  function draw() {
    for (const material of materials) material.opacity = strength;
    mesh.scale.setScalar(GONE_SCALE + (1 - GONE_SCALE) * strength);
    // A fading mesh still throws a solid shadow, so the shadow is dropped once
    // the die is faint enough for its going to read as the die going. sync()
    // has the last word on this every frame; see there.
    mesh.castShadow = strength > 0.5;
    mesh.visible = strength > 0;
  }

  return {
    mesh,

    appear() {
      going = false;
      strength = 1;
      show = "table";
      hold = null;
      draw();
    },

    dismiss(now = false) {
      if (now) {
        going = false;
        strength = 0;
        draw();
        return;
      }
      if (strength > 0) going = true;
    },

    advance(dt) {
      if (show === "rising" || show === "laying") {
        travelled = Math.min(1, travelled + dt / (show === "rising" ? RISE_SECONDS : LAY_SECONDS));
        if (travelled >= 1) show = show === "rising" ? "up" : "table";
      }
      if (!going || strength === 0) return;
      strength = Math.max(0, strength - dt / FADE_SECONDS);
      if (strength === 0) going = false;
      draw();
    },

    present(next, flourish) {
      hold = next;
      from.position.copy(mesh.position);
      from.quaternion.copy(mesh.quaternion);
      travelled = flourish ? 0 : 1;
      flourishing = flourish;
      show = flourish ? "rising" : "up";
    },

    lay() {
      if (show === "table" || show === "laying") return;
      from.position.copy(mesh.position);
      from.quaternion.copy(mesh.quaternion);
      travelled = 0;
      flourishing = false;
      show = "laying";
    },

    release() {
      show = "table";
      hold = null;
    },

    get arrived() {
      return show === "up";
    },

    get held() {
      return show !== "table";
    },

    get leaving() {
      return going;
    },

    sync(body, facing, easing) {
      // A die held up at the camera casts its shadow from halfway across the
      // room, over the whole felt. It is not on the table; it should not be
      // lighting it either.
      mesh.castShadow = strength > 0.5 && show === "table";

      if (show === "up" && hold) {
        mesh.position.copy(hold.position);
        mesh.quaternion.copy(hold.quaternion);
        return;
      }

      // Where the body says the die is, which is where it landed and where it
      // goes back to.
      resting.set(body.position.x, body.position.y, body.position.z);
      target.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
      held.set(facing.x, facing.y, facing.z, facing.w);
      target.multiply(held);

      if (show === "rising" && hold) {
        const k = easeOut(travelled);
        mesh.position.lerpVectors(from.position, hold.position, k);
        mesh.quaternion.copy(from.quaternion).slerp(hold.quaternion, k);
        if (flourishing) {
          spin.setFromAxisAngle(UP, (1 - k) * FLOURISH_TURNS * Math.PI * 2);
          mesh.quaternion.premultiply(spin);
        }
        return;
      }

      if (show === "laying") {
        const k = easeOut(travelled);
        mesh.position.lerpVectors(from.position, resting, k);
        mesh.quaternion.copy(from.quaternion).slerp(target, k);
        return;
      }

      mesh.position.copy(resting);
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
