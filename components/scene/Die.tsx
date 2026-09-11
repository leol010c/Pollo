"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  ConvexHullCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { getDieGeometry } from "@/lib/dice/geometry";
import { asideSpot, easeOut, presentationPose } from "@/lib/scene/presentation";
import { getDieTextures, repaintDieTextures } from "@/lib/dice/atlas";
import { readFace } from "@/lib/dice/faceDetection";
import { forecastFace, FORECAST_RETRIES } from "@/lib/dice/forecast";
import {
  isStill,
  SETTLE_TIMEOUT,
  STILL_FRAMES,
} from "@/lib/dice/settle";
import { DIE_INRADIUS, DIE_RADIUS, type DieType } from "@/lib/dice/types";
import { defaultFaceSet, type FaceSet } from "@/lib/dice/faceSet";
import { dealtTo } from "@/lib/dice/deck";
import {
  randomThrow,
  restingAt,
  spin,
  tumbleFor,
  type Velocity,
} from "@/lib/dice/throw";
import {
  DIE_ANGULAR_DAMPING,
  DIE_DENSITY,
  DIE_LINEAR_DAMPING,
  DIE_SURFACE,
} from "@/lib/scene/physics";
import { playImpact } from "@/lib/audio";
import { riggedIds, useDiceStore } from "@/lib/store";
import { hapticThrow } from "@/lib/haptics";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { TrayBounds } from "@/lib/scene/bounds";

/** Attempts to unstick a cocked die before its reading is accepted as-is. */
const MAX_NUDGES = 4;
/** How long the die takes to rise and turn its face to the camera. */
const PRESENT_DURATION = 0.62;

interface DieProps {
  type?: DieType;
  faceSet?: FaceSet;
  /** The visible floor area. The throw is scaled to fit inside it. */
  bounds: TrayBounds;
}

const scratchQuat = new THREE.Quaternion();
/** The die's drawn position, read once a frame by the contact shadow. */
const scratchContact = new THREE.Vector3();

/**
 * The texture behind the contact darkening: dense at the centre, gone by the
 * rim.
 *
 * A flat disc was the problem. It ended at a hard circle, and nothing in the
 * world casts a hard circle — so it read as a painted spot rather than as the
 * die touching the cloth. Real contact darkening is dense where the two meet
 * and dissolves within about the object's own width.
 *
 * The falloff is squared rather than linear because a linear ramp still
 * resolves into a visible perimeter; the eye finds the point where the
 * gradient stops.
 */
let contactTexture: THREE.CanvasTexture | undefined;
function getContactTexture() {
  if (contactTexture) return contactTexture;

  const SIZE = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(SIZE, SIZE);
  const half = SIZE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d = Math.min(1, Math.hypot(dx, dy));
      const t = 1 - d;
      const i = (y * SIZE + x) * 4;
      /*
       * A warm near-black, not the cool one this was.
       *
       * The blob is alpha-blended over the cloth, so its hue mixes into the
       * surface rather than merely darkening it — and a blue-black laid over
       * burgundy pulls it toward grey, which reads as a smudge on the felt
       * instead of as shadow. Real occlusion is the surface's own colour with
       * the light taken away, so it stays red.
       */
      image.data[i] = 18;
      image.data[i + 1] = 3;
      image.data[i + 2] = 9;
      image.data[i + 3] = Math.round(t * t * (0.5 + 0.5 * t) * 255);
    }
  }

  ctx.putImageData(image, 0, 0);
  contactTexture = new THREE.CanvasTexture(canvas);
  return contactTexture;
}

/**
 * Ambient occlusion where the die meets the cloth — and nothing more than that.
 *
 * The light already casts a real shadow through the shadow map, offset to one
 * side. This is the other half of the effect: the darkening in the crevice at
 * the contact point, which a shadow map at this resolution cannot resolve and
 * which is what actually sells the die as resting on something.
 *
 * Two properties keep it honest. It stays directly beneath the die rather than
 * offsetting toward the light, because occlusion happens at the contact point
 * while the cast shadow happens away from it — offsetting would draw a second
 * cast shadow competing with the real one. And it fades out within roughly a
 * die's width of lift, because contact occlusion is a contact phenomenon; a
 * blob that follows the die into the air is just a decal.
 *
 * ## Why this follows the die's *drawn* position rather than the body's
 *
 * Rapier steps at a fixed rate and the screen does not, so what is drawn is
 * never the solver's state: `@react-three/rapier` interpolates each body
 * between the last two steps by however far through the current one the frame
 * happens to be. The die you see is at that interpolated pose. `translation()`
 * is not — it is the step the solver has actually reached.
 *
 * This used to read `translation()` from a `useFrame`, which is wrong twice
 * over. The value is a different position from the one the die is drawn at, and
 * because React fires child effects before parent ones, this component's
 * `useFrame` subscribes before `<Physics>`'s and therefore runs *before* the
 * step it is reading the result of. At rest none of that shows, which is why it
 * survived: everything agrees when nothing is moving. Mid-throw the die covers
 * about a quarter of its own width per step, so the blob slid out from under it
 * and back on a cycle set by the accumulator — a wobble under the die at
 * exactly the moment the throw is being watched.
 *
 * `onBeforeRender` is the one hook that is guaranteed to be late enough.
 * Three's `renderObject` calls it before computing `modelViewMatrix`, so a
 * transform written here lands in the frame being drawn, and by then `Physics`
 * has long since written the interpolated pose this reads. It also avoids
 * `useFrame`'s priority argument, which cannot be used to order this: any
 * priority above zero switches r3f out of rendering the scene for you.
 */
function ContactShadow({
  die,
  radius,
}: {
  /** The die's own mesh, carrying the pose it is actually drawn at. */
  die: React.RefObject<THREE.Object3D | null>;
  radius: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;

    m.onBeforeRender = () => {
      const target = die.current;
      const mat = material.current;
      if (!target || !mat) return;

      target.getWorldPosition(scratchContact);

      m.position.set(scratchContact.x, 0.006, scratchContact.z);

      const lift = Math.max(0, scratchContact.y - radius * 0.6);
      // Gone within a die's width. Occlusion is contact, not proximity.
      const fade = Math.max(0, 1 - lift / (radius * 1.6));
      // Spreads a little as it leaves — the gap widens before it disappears.
      m.scale.setScalar(1 + lift * 0.7);
      mat.opacity = 0.62 * fade * fade;

      // By hand, because the scene's matrices were computed before this ran.
      // Without it the write above would not be seen until the next frame,
      // which is the lag this whole arrangement exists to remove.
      m.updateMatrixWorld();
    };

    return () => {
      // Three's own no-op, restored rather than left pointing at a dead ref.
      m.onBeforeRender = () => {};
    };
  }, [die, radius]);

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      {/* Wider than the die, because most of the texture is falloff rather
          than shadow — the dense part covers roughly the footprint. */}
      <planeGeometry args={[radius * 3.4, radius * 3.4]} />
      <meshBasicMaterial
        ref={material}
        map={getContactTexture()}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * How much extra mass the load adds, as a fraction of the die's own.
 *
 * Together with LOAD_REACH this sets how strongly a favourite is favoured. The
 * pair is tuned against scripts/verify-loaded.ts rather than guessed: the
 * relationship between an offset centre of mass and a landed face runs through
 * the whole tumble, so it is not something you can reason your way to.
 */
const LOAD_MASS = 0.45;
/**
 * How far the added mass sits from the centre, in die radii.
 *
 * These two land a favourite at about 31% against a fair 17% — roughly double.
 * The response is steeply non-linear: 0.75/0.85 gave 65%, which is a die that
 * obeys rather than one that leans.
 */
const LOAD_REACH = 0.65;

const ZERO = { x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/*
 * Picking the die up and throwing it.
 *
 * The gesture is the point: the die is held at a fixed height and follows the
 * finger, and letting go hands the physics engine the velocity the hand was
 * actually moving at. Nothing about the outcome is decided here — this only
 * sets initial conditions, exactly as the random throw does.
 */

/** Height the die is held at while dragged. */
const DRAG_HEIGHT = DIE_RADIUS * 2.1;

/**
 * Movement below this, in CSS pixels, is a tap rather than a drag.
 *
 * Measured in screen space on purpose. A world-space threshold would mean
 * something different on every viewport, because the camera pulls back on a
 * narrow screen — and a thumb's idea of "I didn't move" is a property of the
 * thumb, not of the scene.
 */
const TAP_SLOP_PX = 10;

/** How much recent movement the release velocity is taken from. */
const FLICK_WINDOW_MS = 120;

/**
 * A hand moves faster than a throw wants.
 *
 * A quick flick crosses the play area in about a sixth of a second, which is
 * several times the speed the random throw uses; handing that straight to the
 * solver fires the die into a wall. Scaled and capped, so a hard flick is
 * decisively harder than a gentle one without ever being unplayable.
 */
const THROW_SPEED_SCALE = 0.55;
const MAX_THROW_SPEED = 5.5;

/** Below this the die is being *placed*, not thrown, so it just drops. */
const TOSS_THRESHOLD = 0.6;

/**
 * How much the die rolls in the hand as it is carried.
 *
 * Rotation is taken from the *distance* dragged rather than the speed, which is
 * what rolling without slipping means — so it turns the same amount over the
 * same path however fast you move, and dragging quickly simply gets through
 * that rotation quickly. At 1 it turns as though pinned to the cloth.
 */
const DRAG_ROLL = 0.55;

/**
 * A rattle at speed.
 *
 * Nobody carries a die perfectly still, and a shape that tracks the finger
 * exactly reads as welded to it. This grows from nothing at walking pace, so a
 * careful placement stays steady and a fast drag visibly shakes.
 */
const DRAG_RATTLE = 0.05;
const RATTLE_ONSET = 1.5;
const RATTLE_FULL = 7;

const scratchRay = new THREE.Raycaster();
const scratchNdc = new THREE.Vector2();
const scratchHit = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchSpin = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Extra revolutions the die makes as it rises to present its face. */
const FLOURISH_TURNS = 1;

/** The horizontal plane the finger is tracked against, at the carry height. */
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_HEIGHT);

export function Die({
  type = "d6",
  faceSet = defaultFaceSet,
  bounds,
}: DieProps) {
  const body = useRef<RapierRigidBody>(null);
  /** The drawn die, which is not where the solver thinks it is — see ContactShadow. */
  const dieMesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  // The table itself, for the one thing that needs to run a throw twice — see
  // the forecast in throwWith.
  const { world, rapier } = useRapier();
  const { geometry, hull, faceNormals, faceUps, faceValues } = useMemo(
    () => getDieGeometry(type),
    [type],
  );
  const textures = useMemo(
    () => getDieTextures(type, faceSet),
    [type, faceSet],
  );

  const beginRoll = useDiceStore((s) => s.beginRoll);
  const settle = useDiceStore((s) => s.settle);
  const favourites = useDiceStore((s) => s.favourites);
  const dealId = useDiceStore((s) => s.dealId);
  const reduced = useReducedMotion();

  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gl = useThree((s) => s.gl);

  const dragRef = useRef<{
    pointerId: number;
    /** Where the die sat relative to the finger when it was grabbed. */
    offsetX: number;
    offsetZ: number;
    /** Last carried position, so the release starts from exactly there. */
    x: number;
    z: number;
    /** Carried orientation, turned as the die is dragged. */
    quat: THREE.Quaternion;
    lastT: number;
    movedPx: number;
    lastClientX: number;
    lastClientY: number;
    samples: { t: number; x: number; z: number }[];
  } | null>(null);

  /*
   * The loaded die.
   *
   * Favourites are not a thumb on the random number generator — there isn't
   * one. The die's centre of mass is shifted toward the face opposite whatever
   * you've starred, so it is genuinely bottom-heavy on that side and genuinely
   * more likely to settle with your face up. The physics stays the only thing
   * deciding the outcome, which is the whole premise of the app.
   *
   * With several favourites the offset runs along the *sum* of their normals,
   * so the die leans toward that whole region of itself. That falls out nicely
   * at both ends: one favourite loads straight at it, and favouriting
   * everything gives a sum near zero and a fair die again, which is exactly
   * what it should mean.
   *
   * A die with a fix in is never loaded, and that is not a compromise: the fix
   * has already decided the outcome, so a weight nudging it toward the same
   * answer changes nothing anybody could see. What it *would* change is the
   * physics, halfway through the throw — the load is applied from the new deal,
   * which is dealt after the die is already in the air, and a centre of mass
   * that moves mid-flight is a die the forecast has stopped describing.
   */
  const baseMass = useRef(0);
  /** Whether a load is currently applied, so an unloaded die is left alone. */
  const loaded = useRef(false);
  const rigged = useDiceStore((s) => riggedIds(s).length > 0);
  useEffect(() => {
    const rb = body.current;
    if (!rb) return;

    // Read once, before any load is applied — afterwards mass() reports the
    // loaded total and using it would compound the offset on every deal.
    if (baseMass.current <= 0) baseMass.current = rb.mass();
    if (baseMass.current <= 0) return;

    // Guarded rather than unconditional: this runs on every deal, and every deal
    // happens mid-throw. Rewriting mass properties that are already zero would
    // be a write into a die in flight for no reason at all.
    const unload = () => {
      if (!loaded.current) return;
      rb.setAdditionalMassProperties(0, ZERO, ZERO, NO_ROTATION, true);
      loaded.current = false;
    };

    if (rigged) {
      unload();
      return;
    }

    const bias = new THREE.Vector3();
    for (let i = 0; i < faceValues.length; i++) {
      const entry = dealtTo(faceValues[i]);
      if (entry && favourites.includes(entry.id)) bias.add(faceNormals[i]);
    }

    if (bias.lengthSq() < 1e-6) {
      unload();
      return;
    }

    // Toward the *opposite* side: mass low on the far side is what brings the
    // favoured face up.
    bias.normalize().multiplyScalar(-DIE_RADIUS * LOAD_REACH);

    rb.setAdditionalMassProperties(
      baseMass.current * LOAD_MASS,
      { x: bias.x, y: bias.y, z: bias.z },
      // A point mass. Rapier applies the parallel-axis shift itself, so giving
      // it no inertia of its own is both correct and the strongest bias for a
      // given offset.
      ZERO,
      NO_ROTATION,
      true,
    );
    loaded.current = true;
  }, [favourites, dealId, faceNormals, faceValues, rigged]);

  const settled = useRef(false);
  const stillFrames = useRef(0);
  const elapsed = useRef(0);
  const nudges = useRef(0);
  /** Set when the user throws, so the opening drop isn't presented. */
  const presentOnSettle = useRef(false);

  /**
   * The rise-and-present animation.
   *
   * While it runs the body is kinematic and driven directly — a dynamic body
   * would fight every frame of it, and gravity would pull the die back down
   * mid-flight. It returns to dynamic the moment it's thrown again.
   */
  const present = useRef<{
    from: THREE.Vector3;
    fromQuat: THREE.Quaternion;
    to: THREE.Vector3;
    toQuat: THREE.Quaternion;
    t: number;
    /** On arrival, "down" hands the die back to the physics engine. */
    settleOnArrival: boolean;
    /** A turn thrown in on the way up. Only the rise gets one. */
    flourish: boolean;
  } | null>(null);
  /** Where the die was resting before it rose, to put it back exactly there. */
  const restPose = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);

  const beginPresentation = useCallback(
    (value: number) => {
      const rb = body.current;
      if (!rb) return;

      const index = faceValues.indexOf(value);
      if (index === -1) return;

      const pose = presentationPose(camera, faceNormals[index], faceUps[index]);

      const p = rb.translation();
      const r = rb.rotation();

      restPose.current = {
        position: new THREE.Vector3(p.x, p.y, p.z),
        quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      };

      rb.setBodyType(2 /* KinematicPositionBased */, true);
      present.current = {
        from: new THREE.Vector3(p.x, p.y, p.z),
        fromQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
        to: pose.position,
        toQuat: pose.quaternion,
        settleOnArrival: false,
        flourish: !reduced,
        // Reduced motion still presents the result — it just arrives rather
        // than flying. Skipping the reveal entirely would hide the outcome.
        t: reduced ? 1 : 0,
      };
    },
    [camera, faceNormals, faceUps, faceValues, reduced],
  );

  /**
   * Steps the die into the corner of the frame while the coin decides.
   *
   * Reaches the same animation the reveal uses, from either of the two places a
   * flip can be taken from: up at the camera presenting a result, or lying on
   * the felt after it has been put back. The second is why the rest pose is
   * captured here rather than assumed — there may have been no presentation to
   * have saved one, and without it the die would have nowhere to come back to
   * when a lost flip is acknowledged.
   */
  const setAside = useCallback(() => {
    const rb = body.current;
    if (!rb) return;

    const p = rb.translation();
    const r = rb.rotation();

    if (!present.current) {
      restPose.current = {
        position: new THREE.Vector3(p.x, p.y, p.z),
        quaternion: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      };
      rb.setBodyType(2 /* KinematicPositionBased */, true);
    }

    const rest = restPose.current;
    if (!rest) return;

    const spot = asideSpot(bounds);

    present.current = {
      from: new THREE.Vector3(p.x, p.y, p.z),
      fromQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      /*
       * Its own resting height and its own resting orientation, moved sideways.
       *
       * That is what makes this reading as sitting down rather than as being
       * repositioned: the die ends up on the felt exactly as it was lying, the
       * same face up, just over by the candle. Solving a fresh orientation here
       * would turn it on the way, and a die that turns is a die being rolled.
       */
      to: new THREE.Vector3(spot.x, rest.position.y, spot.z),
      toQuat: rest.quaternion.clone(),
      settleOnArrival: false,
      // Stepping aside is a retreat, not a flourish. The coin is the thing
      // to watch from here.
      flourish: false,
      t: reduced ? 1 : 0,
    };
  }, [bounds, reduced]);

  const layDown = useCallback(() => {
    const rb = body.current;
    const rest = restPose.current;
    if (!rb || !rest || !present.current) return;

    const p = rb.translation();
    const r = rb.rotation();

    present.current = {
      from: new THREE.Vector3(p.x, p.y, p.z),
      fromQuat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      // Back to exactly where it was resting. Dropping it instead would let it
      // tumble onto a different face, contradicting the result just shown.
      to: rest.position.clone(),
      toQuat: rest.quaternion.clone(),
      t: reduced ? 1 : 0,
      settleOnArrival: true,
      // Putting it back is the quiet half of the gesture; a pirouette on the
      // way down would fight the reveal that just finished.
      flourish: false,
    };
  }, [reduced]);

  /**
   * Drops out of presentation and hands the die back to the physics engine.
   *
   * Onto the cloth, at a place it could actually have been lying — and that is
   * a correctness fix as much as a visual one.
   *
   * This used to put the die at `bounds.home`, which is not on the table: it is
   * the point 2.2 units *above* the middle that the die drops from on load. So
   * every throw from a reveal began by teleporting the die into the air and
   * launching it from there, while randomThrow() reads only x and z and hands
   * out an upward kick sized to lift a die off the felt under its own steam.
   * The launch profile that verify:distribution and verify:loaded prove fair is
   * built on `restingAt()` — "a die lying somewhere on screen, thrown from
   * exactly there" — so the app was throwing from a height nothing had ever
   * checked, and hanging the die a good two units higher in frame than the
   * framing was solved for.
   *
   * A die already resting on the felt is left exactly where it is, which is the
   * whole of what stops it jumping when a won flip throws it again: it has been
   * sitting out the round next to the candle, and it simply leaps from there.
   */
  const endPresentation = useCallback(() => {
    const rb = body.current;
    if (!rb || !present.current) return;

    present.current = null;
    rb.setBodyType(0 /* Dynamic */, true);

    const p = rb.translation();
    const onFelt =
      Math.abs(p.x) <= bounds.halfX &&
      p.z >= bounds.zMin &&
      p.z <= bounds.zMax &&
      p.y <= DIE_RADIUS * 1.5;

    if (!onFelt) {
      // Up at the camera, so it goes back to where it was lying before it rose
      // — a spot on the table this die actually came to rest at, at its own
      // resting height, rather than a point in the air over the middle.
      const back = restPose.current;
      if (back) {
        rb.setTranslation(back.position, true);
        rb.setRotation(back.quaternion, true);
      } else {
        rb.setTranslation(
          restingAt({ x: bounds.home[0], z: bounds.home[2] }),
          true,
        );
      }
    }

    rb.setLinvel(ZERO, true);
    rb.setAngvel(ZERO, true);
  }, [bounds]);

  const beginMotion = useCallback(() => {
    settled.current = false;
    stillFrames.current = 0;
    elapsed.current = 0;
    nudges.current = 0;
  }, []);

  /**
   * Hands the die to the solver with a given velocity, and does the bookkeeping
   * every throw needs whatever started it.
   *
   * Shared by the random throw and by letting go of a drag, so the two can
   * never drift apart on which of these steps they remember — dealing a fresh
   * hand, arming the reveal, and telling the store a roll is under way.
   */
  const throwWith = useCallback(
    (
      linvel: Velocity,
      angvel: Velocity,
      /**
       * Another throw of the same kind, for a throw the forecast cannot call.
       *
       * Only the throws the app invents can offer one. A fling somebody made
       * with their finger is theirs and is used exactly as given.
       */
      resample?: () => { linvel: Velocity; angvel: Velocity },
    ) => {
      const rb = body.current;
      if (!rb) return;

      const state = useDiceStore.getState();
      const fixing = riggedIds(state).length > 0;

      /*
       * Where this throw ends up, asked before it gets there.
       *
       * Only when a fix is in, and it changes nothing about the throw itself: a
       * copy of the world is run to the end of the roll and hands back the face
       * that will be up when the die stops, so the deal below can put the fixed
       * position there. See lib/dice/forecast.ts for why that is a snapshot
       * rather than a simulation, and for what it declines to answer.
       *
       * Looping is not the die being thrown repeatedly — nothing here has been
       * stepped, dealt, sounded or put on screen yet, and setting a velocity
       * twice is the same as setting it once. A throw the forecast will not call
       * is reconsidered before it ever becomes a throw.
       */
      let velocity = { linvel, angvel };
      let landing: number | null = null;

      for (let attempt = 0; ; attempt++) {
        rb.wakeUp();
        rb.setLinvel(velocity.linvel, true);
        rb.setAngvel(velocity.angvel, true);

        if (!fixing) break;
        landing = forecastFace(world, rapier.World, rb.handle, type);
        if (landing !== null || !resample || attempt >= FORECAST_RETRIES) break;
        velocity = resample();
      }

      // A fresh hand, dealt as the throw starts. The die is already leaping and
      // spinning by the time the textures change, so the swap is invisible —
      // dealing while it rested would visibly rewrite the face you were looking
      // at. The repaint follows from the deal.
      state.deal(landing ?? undefined);

      beginMotion();
      presentOnSettle.current = true;
      hapticThrow();
      beginRoll();
    },
    [beginMotion, beginRoll, rapier, type, world],
  );

  /**
   * A throw is a set of initial conditions, not a force applied over time —
   * exactly like a hand opening. The die is lifted clear of the floor first so
   * it tumbles instead of scraping, and nudged back toward the centre so it
   * doesn't wander off over repeated rolls.
   */
  const roll = useCallback(() => {
    const rb = body.current;
    if (!rb) return;

    // Down from the reveal first if it is up there, so the leap starts from the
    // table rather than from up beside the camera.
    endPresentation();
    rb.wakeUp();

    /*
     * One impulse, from exactly where it lies.
     *
     * Two earlier versions of this were worse in opposite directions. The first
     * teleported the die to the near rail and launched it from there, which is
     * a jump across the table you can plainly see. The second lifted it off the
     * cloth with a scripted animation and released it at the top — no teleport,
     * but a quarter-second of dead air before anything happened, and a seam
     * where the animation handed the die back to the solver.
     *
     * A hand doesn't raise a die and let go; it accelerates it and opens. So
     * the die is never moved, never scripted, and never handed over — it is
     * dynamic from the first frame, and the throw is the only thing that
     * touches it.
     */
    const p = rb.translation();
    const from = { x: p.x, z: p.z };
    // Every call is a fresh draw from the same throw: same spot on the cloth,
    // same aim, same range of pace. So it is also the resample the fix reaches
    // for when it cannot read the first one — a throw of exactly the same kind.
    const another = () => {
      const linvel = randomThrow(from, bounds);
      return { linvel, angvel: tumbleFor(linvel.x, linvel.z) };
    };

    const first = another();
    throwWith(first.linvel, first.angvel, another);
  }, [bounds, endPresentation, throwWith]);

  /**
   * Where the finger is, on the plane the die is carried along.
   *
   * Raycast rather than unprojected directly, because the camera's pitch and
   * distance both change with the viewport — there is no fixed mapping from
   * screen to table to shortcut this with.
   */
  const pointerToPlane = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      scratchNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      scratchRay.setFromCamera(scratchNdc, camera);
      return scratchRay.ray.intersectPlane(dragPlane, scratchHit);
    },
    [camera, gl],
  );

  const grab = useCallback(
    (event: { pointerId: number; clientX: number; clientY: number }) => {
      const rb = body.current;
      if (!rb) return;

      // Velocities are cleared while the body is still dynamic; a kinematic
      // body has none to clear, and leaving them set means whatever it was
      // doing resumes the instant it is let go.
      rb.setLinvel(ZERO, true);
      rb.setAngvel(ZERO, true);

      const p = rb.translation();
      const r = rb.rotation();
      rb.setBodyType(2 /* KinematicPositionBased */, true);
      rb.setTranslation({ x: p.x, y: DRAG_HEIGHT, z: p.z }, true);

      // The grab offset keeps the die where it was relative to the finger, so
      // it doesn't snap its centre under the touch the moment you press.
      const hit = pointerToPlane(event.clientX, event.clientY);

      dragRef.current = {
        pointerId: event.pointerId,
        offsetX: hit ? p.x - hit.x : 0,
        offsetZ: hit ? p.z - hit.z : 0,
        x: p.x,
        z: p.z,
        // Picked up mid-turn, so the roll continues from the attitude it had.
        quat: new THREE.Quaternion(r.x, r.y, r.z, r.w),
        lastT: performance.now(),
        movedPx: 0,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        samples: [],
      };
      setDragging(true);
    },
    [pointerToPlane],
  );

  /*
   * The drag runs on window listeners rather than on the mesh.
   *
   * A finger that leaves the die — which it does immediately, since the die is
   * smaller than a fingertip — would stop producing events on the object it
   * started on. Listening on the window means the gesture survives leaving the
   * die, leaving the canvas, and coming back.
   */
  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      const rb = body.current;
      if (!drag || !rb || event.pointerId !== drag.pointerId) return;

      drag.movedPx += Math.hypot(
        event.clientX - drag.lastClientX,
        event.clientY - drag.lastClientY,
      );
      drag.lastClientX = event.clientX;
      drag.lastClientY = event.clientY;

      const hit = pointerToPlane(event.clientX, event.clientY);
      if (!hit) return;

      // Clamped to the play area: a kinematic body is not stopped by the walls,
      // so without this the die can be carried straight out through the rim.
      const x = THREE.MathUtils.clamp(
        hit.x + drag.offsetX,
        -bounds.halfX,
        bounds.halfX,
      );
      const z = THREE.MathUtils.clamp(
        hit.z + drag.offsetZ,
        bounds.zMin,
        bounds.zMax,
      );

      const now = performance.now();
      const dx = x - drag.x;
      const dz = z - drag.z;
      const step = Math.hypot(dx, dz);

      drag.x = x;
      drag.z = z;
      rb.setNextKinematicTranslation({ x, y: DRAG_HEIGHT, z });

      /*
       * Rolling in the hand.
       *
       * The same axis the throw uses — up × movement — so the die turns the way
       * it is being carried and simply keeps turning once released. Applied as
       * a delta on the near side, since these are rotations in world space and
       * post-multiplying would compose them in the die's own frame instead.
       */
      if (step > 1e-5) {
        scratchAxis.set(dz, 0, -dx).divideScalar(step);
        scratchSpin.setFromAxisAngle(
          scratchAxis,
          (step / DIE_INRADIUS) * DRAG_ROLL,
        );
        drag.quat.premultiply(scratchSpin);

        const dt = (now - drag.lastT) / 1000;
        const speed = dt > 0 ? step / dt : 0;
        const rattle =
          THREE.MathUtils.clamp(
            (speed - RATTLE_ONSET) / (RATTLE_FULL - RATTLE_ONSET),
            0,
            1,
          ) * DRAG_RATTLE;

        if (rattle > 0) {
          // Driven by sines rather than randomness: a random axis every frame
          // is noise, which reads as the die glitching. Three unrelated periods
          // wander instead, which reads as a hand that isn't quite steady.
          scratchAxis
            .set(
              Math.sin(now * 0.031),
              Math.cos(now * 0.047),
              Math.sin(now * 0.023),
            )
            .normalize();
          scratchSpin.setFromAxisAngle(scratchAxis, rattle);
          drag.quat.premultiply(scratchSpin);
        }

        rb.setNextKinematicRotation(drag.quat);
      }
      drag.lastT = now;

      // Only the tail of the gesture decides the throw. Averaging the whole
      // drag would let a long slow carry cancel out the flick at the end of it.
      drag.samples.push({ t: now, x, z });
      while (
        drag.samples.length > 2 &&
        now - drag.samples[0].t > FLICK_WINDOW_MS
      ) {
        drag.samples.shift();
      }
    };

    const release = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      dragRef.current = null;
      setDragging(false);

      const rb = body.current;
      if (!rb) return;

      rb.setTranslation({ x: drag.x, y: DRAG_HEIGHT, z: drag.z }, true);
      rb.setRotation(drag.quat, true);
      rb.setBodyType(0 /* Dynamic */, true);

      // A coin that arrived mid-drag. The grab is already refused while one is
      // out, so this is only the sliver where the flip was taken with the die
      // in hand — it is put down rather than thrown, which is a body already
      // back under gravity and no store write at all, so there is nothing to
      // fall out of step with the throw the coin may be about to buy.
      if (useDiceStore.getState().coin) return;

      // Barely moved: this was a tap on the die, which has always meant throw
      // it for me. Falling through to the drag path instead would drop it
      // straight back down with no velocity and no roll.
      if (drag.movedPx < TAP_SLOP_PX) {
        roll();
        return;
      }

      let vx = 0;
      let vz = 0;
      const samples = drag.samples;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = (last.t - first.t) / 1000;
        // A denominator this small is a single stray event, not a measurement.
        if (dt > 0.008) {
          vx = ((last.x - first.x) / dt) * THROW_SPEED_SCALE;
          vz = ((last.z - first.z) / dt) * THROW_SPEED_SCALE;
        }
      }

      const raw = Math.hypot(vx, vz);
      if (raw > MAX_THROW_SPEED) {
        const k = MAX_THROW_SPEED / raw;
        vx *= k;
        vz *= k;
      }
      const speed = Math.min(raw, MAX_THROW_SPEED);

      // A gentle placement drops rather than arcs; anything with real pace in
      // it gets lifted, so the die tumbles instead of skidding along the cloth.
      const vy =
        speed < TOSS_THRESHOLD
          ? 0
          : THREE.MathUtils.clamp(2.4 + speed * 0.5, 2.4, 6.5);

      // Tumbling along the throw, so the die visibly rolls the way you flung
      // it rather than spinning about some unrelated axis.
      throwWith({ x: vx, y: vy, z: vz }, tumbleFor(vx, vz));
    };

    // Held, not merely hoverable. Set here rather than in the pointer handlers
    // because the cursor has to survive the finger leaving the die, which it
    // does at once.
    document.body.style.cursor = "grabbing";

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    // A cancelled pointer — the OS taking over for a system gesture — has to
    // put the die down too, or it is left kinematic and frozen in mid-air.
    window.addEventListener("pointercancel", release);

    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [dragging, bounds, pointerToPlane, roll, throwWith]);

  // A resize can shrink the tray around a die that has already come to rest,
  // leaving it stranded outside the new walls where nothing will ever push it
  // back. Fixed colliders don't resolve that on their own.
  useEffect(() => {
    const rb = body.current;
    if (!rb) return;

    const pos = rb.translation();
    const x = Math.min(bounds.halfX, Math.max(-bounds.halfX, pos.x));
    const z = Math.min(bounds.zMax, Math.max(bounds.zMin, pos.z));

    if (x !== pos.x || z !== pos.z) {
      rb.setTranslation({ x, y: pos.y, z }, true);
    }
  }, [bounds]);

  // Opening drop: a random attitude so the die's starting face isn't fixed.
  useEffect(() => {
    const rb = body.current;
    if (!rb) return;
    rb.setAngvel({ x: spin(), y: spin(), z: spin() }, true);
    beginMotion();
  }, [beginMotion]);

  // "Roll again" from the result dialog. The counter's initial value is skipped
  // so mounting doesn't count as a request.
  const rollRequest = useDiceStore((s) => s.rollRequest);
  const lastRequest = useRef(rollRequest);
  useEffect(() => {
    if (rollRequest === lastRequest.current) return;
    lastRequest.current = rollRequest;
    roll();
  }, [rollRequest, roll]);

  useFrame((_, delta) => {
    const rb = body.current;
    // A die being carried is motionless by definition, and its velocities are
    // zero because it is kinematic — so without this it reads as settled after
    // a few frames and announces a result mid-gesture.
    if (!rb || settled.current || dragRef.current) return;

    elapsed.current += delta;

    stillFrames.current =
      rb.isSleeping() || isStill(rb.linvel(), rb.angvel())
        ? stillFrames.current + 1
        : 0;

    const timedOut = elapsed.current > SETTLE_TIMEOUT;
    if (stillFrames.current < STILL_FRAMES && !timedOut) return;

    const r = rb.rotation();
    scratchQuat.set(r.x, r.y, r.z, r.w);
    const reading = readFace(type, scratchQuat);

    // A cocked die is leaning on an edge. Nudge it rather than report a value
    // that doesn't match what's visibly on top.
    if (!reading.clean && nudges.current < MAX_NUDGES && !timedOut) {
      nudges.current += 1;
      rb.wakeUp();
      rb.setLinvel(
        {
          x: (Math.random() - 0.5) * 1.1,
          y: 2.2,
          z: (Math.random() - 0.5) * 1.1,
        },
        true,
      );
      rb.setAngvel({ x: spin(), y: spin(), z: spin() }, true);
      stillFrames.current = 0;
      return;
    }

    /*
     * Whatever is on top, and nothing else — including when a fix is in.
     *
     * There used to be a substitution here: the reading was thrown away and the
     * face carrying the fixed position was reported in its place, on the theory
     * that the rise turns the die anyway so nobody would see it happen. They
     * would. The die was watched coming to rest on one position and then rising
     * with another, which is exactly the tell the fix exists to avoid, and it
     * happened on five throws out of six.
     *
     * The fix now happens before the die has landed rather than after — the deal
     * puts the fixed position on the face the throw is already heading for, so
     * by the time this runs there is nothing left to correct. See throwWith.
     */
    settled.current = true;
    settle(reading.value);

    // Only a throw the user made gets presented; the opening drop just sits.
    if (presentOnSettle.current) {
      presentOnSettle.current = false;
      beginPresentation(reading.value);
    }
  });

  // Drives the rise. Kinematic bodies are moved by setting their next pose, so
  // the interpolation happens here rather than through the solver.
  useFrame((_, delta) => {
    const rb = body.current;
    const anim = present.current;
    if (!rb || !anim) return;

    anim.t = Math.min(1, anim.t + delta / PRESENT_DURATION);
    const k = easeOut(anim.t);

    const p = anim.from.clone().lerp(anim.to, k);
    const q = anim.fromQuat.clone().slerp(anim.toQuat, k);

    /*
     * A turn thrown in on the way up.
     *
     * A slerp takes the shortest path between two orientations, which is
     * correct and completely undramatic — the die rotates the minimum it can
     * get away with. Winding an extra revolution about the vertical and
     * unwinding it across the rise makes the reveal a small performance.
     *
     * The angle runs from 2π down to 0, and a rotation of 2π is the identity,
     * so both ends of the animation are untouched: it starts exactly where the
     * die was and lands exactly on the face-to-camera pose. The easing does the
     * rest, decelerating the spin as it arrives.
     */
    if (anim.flourish) {
      scratchSpin.setFromAxisAngle(
        UP,
        (1 - k) * FLOURISH_TURNS * Math.PI * 2,
      );
      q.premultiply(scratchSpin);
    }

    rb.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });

    if (anim.t >= 1 && anim.settleOnArrival) {
      present.current = null;
      rb.setBodyType(0 /* Dynamic */, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  });

  /*
   * Repaint whenever the hand changes, whatever changed it.
   *
   * This used to live inside the throw, which meant a deal triggered any other
   * way — turning a position off in the deck panel — updated which faces were
   * dealt but left the die showing the old ones until the next roll. The filter
   * looked broken because the visible faces lagged the deck by one throw.
   *
   * A frame late, deliberately.
   *
   * `deal()` is called on the launch frame — see throwWith — and a repaint is
   * two canvases of up to 2560² redrawn and re-uploaded to the GPU with
   * mipmaps. That is a large, entirely predictable stall landing on the single
   * frame the die leaps out of the hand, which is the frame a phone can least
   * afford and the one the user is watching hardest.
   *
   * Nothing is lost by waiting. The die is tumbling by the next frame and its
   * faces are unreadable for the best part of a second; the only requirement is
   * that the atlas is right long before it comes to rest, and one frame is a
   * sixtieth of the budget available. Deals that are not throws — a position
   * toggled in the panel — are just as happy a frame later.
   */
  useEffect(() => {
    const id = requestAnimationFrame(() => repaintDieTextures(type, faceSet));
    return () => cancelAnimationFrame(id);
  }, [dealId, type, faceSet]);

  /*
   * "Step aside", from a flip being taken. Counter-guarded exactly as the two
   * below are.
   */
  const asideRequest = useDiceStore((s) => s.asideRequest);
  const lastAside = useRef(asideRequest);
  useEffect(() => {
    if (asideRequest === lastAside.current) return;
    lastAside.current = asideRequest;
    setAside();
  }, [asideRequest, setAside]);

  // "Lay down" from a button, a tap, or the die itself.
  const layRequest = useDiceStore((s) => s.layRequest);
  const lastLay = useRef(layRequest);
  useEffect(() => {
    if (layRequest === lastLay.current) return;
    lastLay.current = layRequest;
    layDown();
  }, [layRequest, layDown]);

  return (
    <>
      <ContactShadow die={dieMesh} radius={DIE_RADIUS} />
      <RigidBody
        ref={body}
        colliders={false}
        position={bounds.home}
        friction={DIE_SURFACE.friction}
        restitution={DIE_SURFACE.restitution}
        linearDamping={DIE_LINEAR_DAMPING}
        angularDamping={DIE_ANGULAR_DAMPING}
        ccd
        onCollisionEnter={({ other }) => {
          const rb = body.current;
          if (!rb) return;
          const lv = rb.linvel();
          // The rim rings; the cloth thuds. playImpact has carried a brighter,
          // tighter voice for hard surfaces since it was written and nothing
          // has ever asked for it — with one die there are no die-on-die hits,
          // so the wall is the only thing that was ever going to.
          const rim = other.rigidBodyObject?.userData?.rim === true;
          playImpact({ velocity: Math.hypot(lv.x, lv.y, lv.z), hard: rim });
        }}
      >
        <ConvexHullCollider args={[hull]} density={DIE_DENSITY} />

        {/*
          The grab target, invisible and larger than the die.

          On a phone the die is a few millimetres of glass and a fingertip
          covers far more than that, so hit-testing the geometry itself makes
          picking it up a game of its own. It cannot use `visible={false}` —
          three's raycaster skips those outright — so it is a fully transparent
          material instead, which costs one draw call and nothing else.
        */}
        <mesh
          onPointerDown={(e) => {
            e.stopPropagation();
            // Nothing while a coin is out. The felt already refuses taps for
            // this reason (see onPointerMissed in DiceScene) and the die is the
            // other half of it: the next result is already spoken for, and a
            // throw started by hand here would race the one a win is about to
            // ask for.
            if (useDiceStore.getState().coin) return;
            // While it's up at the camera the die is the result, so touching it
            // puts it back rather than starting a throw with it.
            if (present.current) {
              useDiceStore.getState().layDown();
              return;
            }
            grab(e.nativeEvent);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = "grab";
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = "";
          }}
        >
          <sphereGeometry args={[DIE_RADIUS * 1.45, 12, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Ref'd so the contact shadow can follow the pose the die is drawn
            at rather than the one the solver has reached. See ContactShadow. */}
        <mesh ref={dieMesh} geometry={geometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            map={textures.color}
            // Both channels come from one packed texture: three reads roughness
            // from green and metalness from blue, so the numerals are actual
            // metal while the resin body stays dielectric.
            roughnessMap={textures.material}
            metalnessMap={textures.material}
            roughness={1}
            metalness={1}
            // A lacquer layer over everything. This is what gives the die a wet,
            // polished edge highlight instead of a dry plastic one — and it only
            // reads at all because there's an environment to reflect.
            clearcoat={1}
            clearcoatRoughness={0.06}
            // Dialled back for a light body — a cream die has far less headroom
            // before the studio panels blow it out to flat white.
            envMapIntensity={0.85}
            // A faint warm lift on hover, so the die reads as the thing to click
            // without needing a label to say so.
            emissive="#e8b04b"
            // Brighter while actually held than merely pointed at, so picking
            // it up has a response of its own on a screen that has no hover.
            emissiveIntensity={dragging ? 0.16 : hovered ? 0.09 : 0}
          />
        </mesh>
      </RigidBody>
    </>
  );
}
