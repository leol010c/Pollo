"use client";

import * as THREE from "three";
import {
  cameraPoseFor,
  computeTrayBounds,
  type TrayBounds,
} from "./bounds";
import { holdDistance } from "./presentation";

/**
 * The coin you bet a re-roll on.
 *
 * Struck brass, a heart on one side and a crown on the other: win and you throw
 * again, lose and the other person is the one who chooses. It is a real object
 * in the room rather than a graphic over it, for the same reason the die's
 * result is the die itself — the thing you are watching should be the thing
 * that answers you.
 *
 * What it is *not* is a physical simulation. The outcome is decided in the
 * store before the coin has moved (see flipCoin), and everything here is a
 * reading of that number. A coin that landed on whichever face the solver
 * happened to leave up would have to land flat every time, on every phone, at
 * every frame rate, with a result nobody could correct if it came up wrong —
 * and there is no version of that which is worth the honesty it appears to buy,
 * because the toss is random either way.
 *
 * Built like the gobo and the velvet: no assets, canvas-drawn, cached at module
 * level so it is made once per load.
 */

/** Half the coin's width, in world units. Also its on-screen half-extent. */
export const COIN_RADIUS = 0.3;

/** Thick enough to read as struck metal edge-on mid-flip, no thicker. */
export const COIN_THICKNESS = 0.055;

/**
 * Whole turns from launch to lying still.
 *
 * A whole number, and that is not decoration: the coin comes to rest in
 * restQuaternion() plus this much turning, and a whole turn is the identity —
 * so anything fractional here would leave the coin resting at an angle, which
 * on a disc means resting on its edge.
 *
 * Seven rather than four. At four you can count them, and a coin you can count
 * the turns of is a coin being placed rather than thrown.
 */
export const SPIN_TURNS = 7;

/** How long the presented face is held before the notice opens over it. */
export const HOLD_SECONDS = 0.6;

/* --- The toss ------------------------------------------------------------ */

/**
 * How long the coin is in the air, launch to lying still on the felt.
 *
 * Longer than the old flight, because there is more to watch: this one leaves
 * the table, turns over against the room, and comes back down to it.
 */
export const TOSS_SECONDS = 1.35;

/** The beat it lies on the felt before it is picked up to be read. */
export const REST_SECONDS = 0.35;

/** How long it takes to come up off the table and turn its face to you. */
export const PRESENT_SECONDS = 0.55;

/**
 * How high the arc is allowed to reach on screen, and how high it would ever
 * want to go in the room.
 *
 * The ceiling is in normalised device coordinates — a share of the frame — and
 * the cap is in world units, because past a certain height the coin is a speck
 * at the top of the picture and the throw stops reading as a throw.
 */
const APEX_CEILING = 0.82;
const APEX_MAX = 2.4;

/** Kept off the ceiling it was solved against, so a wobble cannot clip it. */
const APEX_SAFETY = 0.9;

const apexes = new Map<number, number>();

/**
 * The height of the arc, in world units above the felt, for a given viewport.
 *
 * Solved per shape rather than fixed, and that is the difference between the
 * phone getting a throw and getting a nudge. The two ends of the range are not
 * close: a 16:9 window is framed shallow and close over the table and runs out
 * of headroom at about 1.7, while a phone — which gets a wider lens and a
 * steeper angle to buy floor — has room for three times that. One number for
 * both means either a coin that leaves the top of a desktop frame or a coin
 * that barely clears the felt on the thing this app is actually used on.
 *
 * Solved the way bounds.ts solves its framing: numerically, against the real
 * camera, rather than by picking a constant and hoping. Memoised because the
 * answer only changes when the window does, and the flight asks every frame.
 */
export function tossApex(aspect: number): number {
  const cached = apexes.get(aspect);
  if (cached !== undefined) return cached;

  const pose = cameraPoseFor(aspect);
  const bounds = computeTrayBounds(aspect);
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, 0.1, 100);
  camera.position.set(...pose.position);
  camera.lookAt(new THREE.Vector3(...pose.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  /*
   * The apex happens halfway through the travel — but over a different patch of
   * table depending on which way the coin was thrown, and those patches are not
   * equally close to the camera. A throw from the near edge peaks lower in the
   * frame than one from the side, so the height has to clear the worst of them
   * rather than whichever one happened to be sampled.
   */
  const probe = new THREE.Vector3();
  let apex = APEX_MAX;

  for (let i = 0; i <= 8; i++) {
    const over = horizontalAt(0.5, bounds, (i / 8) * 2 * LAUNCH_ARC - LAUNCH_ARC);

    let low = 0;
    let high = APEX_MAX / APEX_SAFETY;
    for (let step = 0; step < 40; step++) {
      const mid = (low + high) / 2;
      probe.set(over.x, mid, over.z).project(camera);
      if (probe.y < APEX_CEILING) low = mid;
      else high = mid;
    }

    apex = Math.min(apex, low * APEX_SAFETY);
  }
  apexes.set(aspect, apex);
  return apex;
}

/**
 * Share of the frame the coin fills once it is up and being read.
 *
 * Larger than the die's 0.46 rather than smaller, and deliberately: the die's
 * reveal has a picture and a name opening over it, so the solid itself only has
 * to be legible. The coin *is* the whole message, it is a flat disc with one
 * mark on it, and this is the moment somebody finds out whether they lost their
 * position.
 */
const PRESENT_FILL = 0.52;

/** How far in front of the camera the coin holds to be read. */
export function coinPresentDistance(fov: number): number {
  return holdDistance(fov, COIN_RADIUS, PRESENT_FILL);
}

/**
 * Which way the outcome's face points, in the coin's own frame.
 *
 * The geometry puts the winning cap on +Z and the losing one on −Z; see
 * getCoinGeometry and getCoinFaces. Everything that has to show a result asks
 * this rather than knowing it, so the pairing is stated once.
 */
export function coinFaceNormal(outcome: "won" | "lost"): THREE.Vector3 {
  return new THREE.Vector3(0, 0, outcome === "won" ? 1 : -1);
}

/** The coin's own up axis, for squaring the mark on screen when it presents. */
export function coinFaceUp(): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0);
}

/**
 * How the coin lies once it has come down: flat on the felt, outcome upward.
 *
 * This, and nothing else, is what decides which face the round shows. The spin
 * below is a whole number of turns about a horizontal axis, and a whole turn is
 * the identity — so no amount of spinning, at any frame rate, on any device,
 * can change what this returns. It is the same guarantee the old flight had,
 * moved to where the coin now actually comes to rest.
 *
 * A quarter turn about X takes the coin's +Z to world +Y, which lays the
 * winning face upward; the other way lays the losing one there.
 */
export function restQuaternion(outcome: "won" | "lost"): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    outcome === "won" ? -Math.PI / 2 : Math.PI / 2,
  );
}

/**
 * Where in the flight the coin first touches down.
 *
 * The rest of it is the coin bouncing and rattling flat, which is most of what
 * makes a landing read as a landing. Before this existed the coin arrived at
 * the felt and simply stopped, on the exact frame its arc reached the table —
 * the single most obviously animated thing about it.
 */
const LAND_AT = 0.7;

/**
 * The bounces after the first touch: where each one ends, and how high it goes
 * in world units.
 *
 * Two, decaying hard. Three is a dropped coin rather than a thrown one, and one
 * reads as the coin sticking to the felt where it hit.
 *
 * Absolute rather than a share of the throw's apex, which is what they were.
 * How high a coin bounces is a fact about the coin and the cloth, not about how
 * hard it was thrown — and tying them to the apex meant the bounce shrank on
 * exactly the screens where the throw was already shortest, which is where the
 * coin then had the least room to be turning in when it hit.
 */
const BOUNCES: readonly (readonly [number, number])[] = [
  [0.88, 0.34],
  [0.96, 0.09],
];

/** How many times it comes off the felt again. See BOUNCES. */
export const BOUNCE_COUNT = BOUNCES.length;

/**
 * How high the coin starts, in world units above the felt.
 *
 * Off a hand rather than off the table. Zero here made the toss begin at the
 * cloth and end at it, which is a coin flipping itself.
 */
const LAUNCH_HEIGHT = 0.3;

/**
 * How far from the landing point it is thrown, as shares of the play area:
 * sideways, and toward the near edge.
 *
 * This is the difference between a throw and a drop, and it is the thing that
 * was missing. A coin going straight up and straight back down has no direction
 * and nothing to follow; one that crosses the table is thrown by somebody.
 */
const LAUNCH_ACROSS = 0.62;
const LAUNCH_TOWARD = 0.82;

/**
 * How far round from straight-on the throw can come, in radians.
 *
 * The near half of the table only. Behind the landing point is where the die is
 * parked and where the frame runs out soonest — a coin thrown from back there
 * would start its arc off the top of the screen on the shallow desktop framing,
 * which is the one direction that cannot be made to work.
 */
const LAUNCH_ARC = (72 * Math.PI) / 180;

/**
 * Which direction this particular toss comes from.
 *
 * Off the flip's own id rather than a random number, so it is the same throw
 * every time that flip is drawn — a re-render mid-flight would otherwise move
 * the launch point and bend the arc. Stepped by the golden ratio, which is the
 * cheapest way to make a sequence that never settles into a pattern: successive
 * tosses land far apart in the range, so it does not come from the same side
 * twice running, and it does not march predictably around the table either.
 */
export function launchAngle(flipId: number): number {
  const spread = (flipId * 0.6180339887498949) % 1;
  return (spread * 2 - 1) * LAUNCH_ARC;
}

/**
 * Turns still to go once it first touches down.
 *
 * Half of one. The coin keeps turning through the bounces — that is what a coin
 * does, and stopping the rotation dead on contact is what made the old landing
 * read as an animation ending rather than an object arriving — but only just
 * enough to flip over one more time before it rattles flat.
 */
const TURNS_AFTER_LANDING = 0.5;

/**
 * How far the tumble leans off its axis, in radians, and how many times it
 * swings through that lean over the flight.
 *
 * A real coin does not turn about one clean axis; it precesses, and the wobble
 * is most of why a tossed coin looks alive. Decayed to nothing by the end so it
 * cannot disturb the face that comes up — see spinRemaining.
 */
const WOBBLE = 0.26;
const WOBBLE_CYCLES = 2.5;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * How far through its turning the coin still has to go, at flight progress `t`.
 *
 * Counted down to zero rather than up, so the landing orientation is reached
 * exactly rather than approached: at t = 1 this is 0, and the coin is lying in
 * restQuaternion() by construction. Whole turns in total — see SPIN_TURNS —
 * however they are distributed across the flight, which is why the split below
 * is free to be chosen for how it looks.
 */
export function spinRemaining(t: number): number {
  const k = clamp01(t);
  const inAir = SPIN_TURNS - TURNS_AFTER_LANDING;

  const done =
    k <= LAND_AT
      ? (k / LAND_AT) * inAir
      : inAir + ((k - LAND_AT) / (1 - LAND_AT)) * TURNS_AFTER_LANDING;

  return (SPIN_TURNS - done) * Math.PI * 2;
}

/**
 * How far the tumble is leaning off its axis at `t`, in radians.
 *
 * Zero at both ends: the coin leaves flat to its spin axis and arrives flat to
 * it, and everything in between is the lean that makes the turn read as thrown
 * rather than machined. Reaching exactly zero is what keeps this decorative —
 * it cannot move the face that ends up upward.
 */
export function wobbleAt(t: number): number {
  const k = clamp01(t);
  return WOBBLE * (1 - k) * Math.sin(k * Math.PI * WOBBLE_CYCLES);
}

/**
 * Height of the coin's centre above the felt, at flight progress `t`.
 *
 * The arc, then the bounces. A parabola for each, which is what a thrown thing
 * does between contacts — the coin is drawn rather than simulated for the
 * reason at the top of this file, and an arc somebody can read is worth more
 * here than a solver whose result would have to be corrected anyway.
 */
export function tossHeight(t: number, apex: number): number {
  const k = clamp01(t);
  const rest = COIN_THICKNESS / 2;

  if (k <= LAND_AT) {
    const u = k / LAND_AT;
    // Falls from the launch height as it goes, so the arc is lopsided the way a
    // throw across a table is: up fast, over, and a longer way down.
    return rest + LAUNCH_HEIGHT * (1 - u) + 4 * apex * u * (1 - u);
  }

  let from = LAND_AT;
  for (const [end, height] of BOUNCES) {
    if (k <= end) {
      const u = (k - from) / (end - from);
      return rest + 4 * height * u * (1 - u);
    }
    from = end;
  }

  return rest;
}

/**
 * The lowest the coin's centre can be without any part of it inside the floor.
 *
 * A disc lying flat reaches half its thickness below its centre; the same disc
 * on its edge reaches a whole radius, which here is more than ten times as far.
 * The coin is drawn rather than simulated, so nothing was stopping it from
 * going through the cloth — and near the felt it is still turning, so for a
 * stretch either side of every bounce it was doing exactly that. Half a coin
 * disappearing into the table is what that looked like.
 *
 * `upness` is how square the coin's face is to the world's up axis: 1 lying
 * flat, 0 on its edge. Between the two the disc's reach is the radius and the
 * thickness mixed by exactly this much, which is the projection of a circle
 * onto the vertical.
 */
export function floorClearance(upness: number): number {
  const flat = Math.min(1, Math.abs(upness));
  const edge = Math.sqrt(Math.max(0, 1 - flat * flat));
  return COIN_RADIUS * edge + (COIN_THICKNESS / 2) * flat + FLOOR_GAP;
}

/**
 * How far clear of the cloth the coin is held, in world units.
 *
 * Small, and not zero. A coin resting with its underside exactly on the floor
 * plane is two coplanar surfaces, and which one a renderer draws at any given
 * pixel is a coin-flip of its own — the shimmer across the face that reads as
 * the coin glitching rather than lying there.
 */
const FLOOR_GAP = 0.004;

/**
 * Where the coin is over the table at travel fraction `u`, ignoring height.
 *
 * Its own function because the apex solve needs it before there is a flight to
 * ask — it has to know what the coin is over at the top of the arc in order to
 * work out how high the arc can be.
 */
function horizontalAt(
  u: number,
  bounds: TrayBounds,
  angle: number,
): { x: number; z: number } {
  const landX = bounds.home[0];
  const landZ = bounds.home[2];

  // Swung round the landing point: straight-on at zero, and out to the side as
  // the angle opens. Scaled by the play area in each direction rather than by a
  // single radius, because the table is not square and a circle of launch
  // points would run off the sides of the narrow one.
  const fromX = landX + Math.sin(angle) * bounds.halfX * LAUNCH_ACROSS;
  const fromZ =
    landZ + Math.cos(angle) * (bounds.zMax - landZ) * LAUNCH_TOWARD;

  return {
    x: fromX + (landX - fromX) * u,
    z: fromZ + (landZ - fromZ) * u,
  };
}

/**
 * Where the coin is at flight progress `t`, in world space.
 *
 * Horizontal travel is linear and finishes when the coin first touches down:
 * nothing accelerates a thrown thing sideways, and once it is on the felt it is
 * bouncing rather than travelling. The landing point is the middle of the play
 * area — not the world origin, because the camera looks down at an angle. Same
 * reasoning as the die's home.
 */
export function tossAt(
  t: number,
  bounds: TrayBounds,
  apex: number,
  angle: number,
): { x: number; y: number; z: number } {
  const k = clamp01(t);
  const { x, z } = horizontalAt(Math.min(1, k / LAND_AT), bounds, angle);
  return { x, y: tossHeight(k, apex), z };
}

let geometry: THREE.CylinderGeometry | null = null;

/**
 * The blank, lying face-on to the camera at rest.
 *
 * A cylinder's axis is +Y and its caps are its second and third material
 * groups. Rotated a quarter turn about X the axis becomes +Z, so the first cap
 * faces the camera when the coin's own frame is pointed at it — which is what
 * lets finalSpin be measured in plain half-turns about X rather than in some
 * composed orientation nobody could check by reading it.
 */
export function getCoinGeometry(): THREE.CylinderGeometry {
  if (geometry) return geometry;

  // 64 segments: the rim catches a moving specular highlight through the flip
  // and a coarse cylinder reads as a polygon exactly when it is turning.
  geometry = new THREE.CylinderGeometry(
    COIN_RADIUS,
    COIN_RADIUS,
    COIN_THICKNESS,
    64,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Brass, and the darker tone the marks are struck in. */
const BRASS = "#c8974a";
const BRASS_LOW = "#8d6427";
const STRUCK = "#4a3110";

const FACE_SIZE = 512;

function blank(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = FACE_SIZE;
  const ctx = canvas.getContext("2d")!;

  const half = FACE_SIZE / 2;

  // Lit from the upper left, so the face has a direction before anything is
  // struck into it. A flat fill reads as a printed disc.
  const sheen = ctx.createLinearGradient(0, 0, FACE_SIZE, FACE_SIZE);
  sheen.addColorStop(0, BRASS);
  sheen.addColorStop(0.55, BRASS_LOW);
  sheen.addColorStop(1, BRASS);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

  // A milled border. Coins have one, and its absence is the sort of thing that
  // reads as "wrong" without being nameable.
  ctx.strokeStyle = STRUCK;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = FACE_SIZE * 0.018;
  ctx.beginPath();
  ctx.arc(half, half, half * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  return { canvas, ctx };
}

/**
 * A heart, drawn rather than fetched.
 *
 * Two lobes and a point, in the proportions the deck's own artwork uses — wide
 * and low rather than the tall valentine, which at this size collapses into a
 * blob.
 */
function heart(ctx: CanvasRenderingContext2D) {
  const s = FACE_SIZE;
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.72);
  ctx.bezierCurveTo(s * 0.16, s * 0.5, s * 0.22, s * 0.24, s * 0.5, s * 0.38);
  ctx.bezierCurveTo(s * 0.78, s * 0.24, s * 0.84, s * 0.5, s * 0.5, s * 0.72);
  ctx.closePath();
  ctx.fill();
}

/**
 * A crown, for the face that hands the choice to somebody else.
 *
 * Not a cross or a tail: this coin's two sides are not heads and tails, they
 * are two outcomes, and the losing one has a subject — the other person, who
 * now gets to pick. A crown says that in one shape and needs no caption.
 */
function crown(ctx: CanvasRenderingContext2D) {
  const s = FACE_SIZE;
  ctx.beginPath();
  ctx.moveTo(s * 0.22, s * 0.66);
  ctx.lineTo(s * 0.18, s * 0.34);
  ctx.lineTo(s * 0.34, s * 0.48);
  ctx.lineTo(s * 0.5, s * 0.28);
  ctx.lineTo(s * 0.66, s * 0.48);
  ctx.lineTo(s * 0.82, s * 0.34);
  ctx.lineTo(s * 0.78, s * 0.66);
  ctx.closePath();
  ctx.fill();

  // The band. Separated from the points by a hair of brass so the whole thing
  // doesn't read as one solid pentagon at coin size.
  ctx.fillRect(s * 0.22, s * 0.7, s * 0.56, s * 0.08);
}

let faces: { won: THREE.CanvasTexture; lost: THREE.CanvasTexture } | null = null;

/**
 * The two faces, cached.
 *
 * `won` is the cap that faces the camera at zero rotation; see getCoinGeometry
 * and finalSpin. Getting these two the wrong way round is the one mistake in
 * this file that would be invisible to every check that isn't looking at
 * pixels, which is why the pairing is stated in both places.
 *
 * Both marks are drawn left-right symmetric on purpose. A cylinder's two caps
 * are UV-mapped in opposite senses, so whatever goes on the far face is
 * mirrored — which is invisible for a heart or a crown and would be glaring for
 * a letter or a number.
 */
export function getCoinFaces(): {
  won: THREE.CanvasTexture;
  lost: THREE.CanvasTexture;
} {
  if (faces) return faces;

  const win = blank();
  win.ctx.fillStyle = STRUCK;
  heart(win.ctx);

  const loss = blank();
  loss.ctx.fillStyle = STRUCK;
  crown(loss.ctx);

  const won = new THREE.CanvasTexture(win.canvas);
  const lost = new THREE.CanvasTexture(loss.canvas);
  for (const texture of [won, lost]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
  }

  faces = { won, lost };
  return faces;
}
