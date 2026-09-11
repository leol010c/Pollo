"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Physics, useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { StatsProbe } from "@/components/ui/Stats";
import { Coin } from "./Coin";
import { Die } from "./Die";
import { Props } from "./Props";
import { Tray } from "./Tray";
import { useDiceStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { setMuted, unlockAudio } from "@/lib/audio";
import {
  themeById,
  plain,
  spotAngle,
  type Backdrop,
  type Spot,
} from "@/lib/scene/backdrops";
import { defaultFaceSet, discreetFaceSet } from "@/lib/dice/faceSet";
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  cameraPoseFor,
  computeTrayBounds,
  type TrayBounds,
} from "@/lib/scene/bounds";
import { getGoboMap } from "@/lib/scene/gobo";
import { PHYSICS_STEP } from "@/lib/scene/physics";
import { easeOut } from "@/lib/scene/presentation";
import { MODE_FADE_MS } from "@/lib/modeSwitch";

/** Heavier than earth gravity — a real die is tiny, and matching its scale in
 *  world units would make the throw look like it's underwater. */
const GRAVITY: [number, number, number] = [0, -34, 0];

function useAspect(): number {
  const size = useThree((s) => s.size);
  return size.width / Math.max(1, size.height);
}

/**
 * The play area, recomputed whenever the viewport changes shape.
 *
 * The maths lives in lib/scene/bounds.ts so the verification script can import
 * exactly what runs here — a check that reimplements the thing it is checking
 * proves nothing.
 */
function useVisibleBounds(aspect: number): TrayBounds {
  return useMemo(() => computeTrayBounds(aspect), [aspect]);
}

/**
 * Applies the solved framing to the live camera.
 *
 * The framing can't be fixed at Canvas creation because it depends on the
 * viewport's shape: a phone held upright needs a steeper, wider, further-back
 * camera than a desktop window, or the die has no room to travel.
 */
function CameraRig({ aspect }: { aspect: number }) {
  // Read through the store rather than binding the camera as a hook value:
  // this reaches into three's mutable object graph, which is the one place a
  // React component legitimately mutates, and going via getState keeps that
  // outside React's own value tracking.
  const store = useStore();

  useEffect(() => {
    const camera = store.getState().camera as THREE.PerspectiveCamera;
    const pose = cameraPoseFor(aspect);

    camera.fov = pose.fov;
    camera.aspect = aspect;
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
  }, [store, aspect]);

  return null;
}

/** How far the camera leans in as the die comes to rest, as a share of its
 *  distance to the table. Small on purpose — this should register as attention,
 *  not as a zoom. */
const PUSH_IN = 0.075;
const PUSH_IN_SECONDS = 0.55;
const PUSH_OUT_SECONDS = 0.4;

/**
 * The camera leaning in on the result.
 *
 * It writes the pose every frame rather than only while moving, so it is always
 * the authority on where the camera is — two things easing the same object from
 * different states is how a camera ends up drifting. At rest that write is the
 * solved pose exactly, unchanged.
 *
 * The framing itself is never touched: this interpolates *along the view line*
 * toward the point the camera already looks at, and returns to the solved pose
 * whenever the die is not being presented. So the play area computed in
 * bounds.ts, and the seven viewport shapes verified against it, still hold.
 */
function SettlePush({ aspect }: { aspect: number }) {
  const phase = useDiceStore((s) => s.phase);
  // `phase` is "settled" for a turned-over card exactly as it is for a landed
  // die, and this push exists to lean in on a *die*. Without the mode test the
  // camera creeps forward behind a card nobody is looking past — and since the
  // loop freezes in card mode, it would then stop and stay there.
  const mode = useDiceStore((s) => s.mode);
  const reduced = useReducedMotion();
  const t = useRef(0);

  const { base, target } = useMemo(() => {
    const pose = cameraPoseFor(aspect);
    return {
      base: new THREE.Vector3(...pose.position),
      target: new THREE.Vector3(...pose.target),
    };
  }, [aspect]);

  useFrame((state, delta) => {
    const want = phase === "settled" && mode === "dice" && !reduced ? 1 : 0;
    const seconds = want > t.current ? PUSH_IN_SECONDS : PUSH_OUT_SECONDS;
    const step = delta / seconds;

    t.current =
      want > t.current
        ? Math.min(want, t.current + step)
        : Math.max(want, t.current - step);

    state.camera.position.lerpVectors(
      base,
      target,
      easeOut(t.current) * PUSH_IN,
    );
    state.camera.lookAt(target);
  });

  return null;
}

/**
 * With reduced motion on, the roll is still fully simulated — it just isn't
 * watched. One rigid body for a few hundred steps costs a couple of
 * milliseconds, so this resolves before the next paint and the result is a real
 * physics outcome rather than a drawn number.
 */
function InstantResolve({ enabled }: { enabled: boolean }) {
  const { world } = useRapier();
  const phase = useDiceStore((s) => s.phase);
  const wasRolling = useRef(false);

  useEffect(() => {
    const rolling = phase === "rolling";
    if (enabled && rolling && !wasRolling.current) {
      for (let i = 0; i < 300; i++) world.step();
    }
    wasRolling.current = rolling;
  }, [enabled, phase, world]);

  return null;
}

/**
 * How long the renderer keeps going after the scene has been put to sleep.
 *
 * Whatever is on screen when the loop stops is what stays on screen, so this
 * has to outlast the last thing still changing. That is the die's unmount,
 * which happens on the same beat sleep does and needs a frame drawn after it or
 * the die stays in the frozen image forever. The camera is already parked by
 * then — SettlePush's push-out is PUSH_OUT_SECONDS from the mode flip, and
 * sleep comes a full MODE_FADE_MS after that flip.
 *
 * A couple of frames is all it takes; the rest is margin.
 */
const FREEZE_DELAY_MS = 200;

/**
 * Stops the renderer while the scene is asleep.
 *
 * There is no `frameloop` prop on the Canvas, so this scene ran at "always"
 * from the day it was written: a full render at up to dpr 2 with MSAA, a
 * variance shadow pass, a Rapier step and four useFrame callbacks, sixty times
 * a second — *including* while you were looking at a playing card with the die
 * unmounted and nothing in the room moving. That is a whole frame budget spent
 * on an image that does not change, and GSAP's flip was competing with it for
 * the same 16ms. It is most of why the reveal stuttered on a phone.
 *
 * Nothing is lost by stopping. The die is gone, the camera is parked, and the
 * candle flicker this gives up is sitting behind a 14px blur where a few
 * percent of intensity wander was never visible anyway.
 *
 * The freeze is also what makes that blur cheap: a canvas that never repaints
 * is a compositor layer the browser blurs once and caches, rather than one it
 * re-blurs every frame. That matters most while the blur *radius* is animating,
 * which is why sleep covers the transitions and not just the still parts either
 * side of them — see `asleep` in SceneContents.
 *
 * Note this is `setFrameloop` off the store rather than a reactive prop on the
 * Canvas. Same effect, but it does not re-render the Canvas element — and
 * DiceApp goes to some lengths to mount that exactly once.
 */
function Freezer({ asleep }: { asleep: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);

  useEffect(() => {
    if (!asleep) {
      setFrameloop("always");
      return;
    }
    const id = setTimeout(() => setFrameloop("never"), FREEZE_DELAY_MS);
    return () => clearTimeout(id);
  }, [asleep, setFrameloop]);

  return null;
}

/**
 * Compiles the room's shaders before anything needs them.
 *
 * Three compiles a material's program the first time it is *drawn*, so a mesh
 * that is hidden until halfway through a round pays for its programs on the
 * frame it appears. The coin is exactly that: three `meshPhysicalMaterial`s
 * with clearcoat and a map each, first drawn on the frame a bet is settled.
 *
 * `compile` gathers materials with `traverse` rather than `traverseVisible`
 * (lights are the part it takes only from what is visible), so this reaches the
 * hidden coin without it having to be shown first — nothing flashes, and the
 * scene is handed as its own target so the light count it compiles for is the
 * one the room actually has.
 *
 * Waits for the environment map, because whether a material has one is part of
 * what its program is compiled for: warming before the Studio is baked would
 * compile a set nothing goes on to use. Keyed on the room, so a backdrop swap
 * warms again.
 */
function Prewarm({ id }: { id: string }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const warmed = useRef<string | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFrame(() => {
    if (warmed.current === id || pending.current || !scene.environment) return;

    // Between frames rather than in the middle of one. `compile` walks the
    // graph and pushes a render state of its own, and there is no reason for
    // any of that to happen while the loop is part-way through assembling the
    // frame it is about to draw.
    pending.current = setTimeout(() => {
      pending.current = null;
      warmed.current = id;
      // Async where the driver supports it, which is what keeps the link step
      // off a frame entirely. Nothing depends on the result; it is a cache
      // being filled ahead of the thing that would otherwise fill it.
      void gl.compileAsync(scene, camera);
    }, 0);
  });

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  return null;
}

/**
 * Fewer pixels while the die is in the air.
 *
 * Off unless the URL says `?flight=1`, and that is deliberate: unlike
 * everything else in this file it is a real trade rather than a free win, and
 * the only way to settle it is to measure both on the device.
 *
 * ## The case for
 *
 * A cube has ninety-degree symmetry, so it starts to strobe once it turns more
 * than forty-five degrees between frames. A fast throw here spins at about
 * 21 rad/s — twenty degrees a frame at sixty, forty at thirty. So the throw is
 * *non-linearly* sensitive to frame rate in a way the rest of the app is not:
 * a settled die at 45fps looks fine, and a tumbling one looks broken. Those are
 * also the frames where nothing can be examined — the die is a blur and the
 * camera is busy — so they are the cheapest frames in the app to spend
 * resolution on.
 *
 * ## The case against, which is why this is a flag
 *
 * Changing dpr is not free. r3f's `setDpr` reaches `gl.setPixelRatio` and
 * `gl.setSize`, which resizes the canvas and makes the browser reallocate the
 * drawing buffer — and with `antialias: true` the multisample buffers too. That
 * is a stall, and there are two of them per throw.
 *
 * So the timing is the whole design. The drop is taken a frame *after* the
 * launch, for the same reason the atlas repaint is (see Die.tsx): the launch
 * frame is the one frame worth protecting, and by the next one the die is
 * moving fast enough to hide a hitch. The restore waits for the die to be not
 * merely settled but done being presented, when the room is static and a stall
 * has nothing to show against.
 */
const FLIGHT_DPR = 1.4;

function flightScaling(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("flight") === "1";
}

function FlightQuality() {
  const store = useStore();
  const phase = useDiceStore((s) => s.phase);
  const on = flightScaling();

  useEffect(() => {
    if (!on) return;

    const { setDpr, viewport } = store.getState();
    // What the Canvas resolved at mount, so the restore puts back exactly what
    // was there rather than a number written twice.
    const full = viewport.initialDpr;

    /*
     * Late in both directions, by different amounts, for different reasons.
     *
     * Going down: two frames, not a timeout. `beginRoll` runs from a pointer
     * handler, so this effect fires in that same task — before the rAF that
     * actually launches the die. A `setTimeout(0)` would therefore land *on*
     * the launch frame rather than after it, which is precisely the frame this
     * is arranged to protect. Two rAFs put it unambiguously past the first
     * drawn frame of the throw, by which point the die is moving fast enough
     * to cover a reallocation.
     *
     * Coming back: `phase` leaves "rolling" the moment the solver reports the
     * die still, which is also when SettlePush starts easing the camera in and
     * the reveal opens over the top. A resize against a moving camera is the
     * one thing this must not be, so the restore waits for that to finish.
     */
    if (phase === "rolling") {
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setDpr(FLIGHT_DPR));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }

    const id = setTimeout(() => setDpr(full), PRESENT_SETTLE_MS);
    return () => clearTimeout(id);
  }, [on, phase, store]);

  return null;
}

/** Long enough for the push-in and the reveal to be done moving. */
const PRESENT_SETTLE_MS = 700;

/**
 * A WebGL context can be taken away at any time — GPU driver resets, memory
 * pressure, a laptop switching graphics. Calling preventDefault is what makes a
 * restore possible at all; without it the canvas is dead for good.
 */
function ContextWatcher({
  onLost,
  onRestored,
}: {
  onLost: () => void;
  onRestored: () => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;

    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };

    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

/**
 * A studio built out of light panels, baked once into an environment map.
 *
 * Polished surfaces are defined almost entirely by what they reflect — a
 * clearcoat with nothing to mirror just looks like flat plastic. Rather than
 * fetch an HDR (which a strict CSP would block anyway, and which costs a
 * download), the surround is assembled from emissive rectangles: a broad
 * overhead softbox for the primary sheen, two narrow side strips that draw
 * bright specular lines down the bevels, and a warm panel that keeps the brass
 * from going grey.
 *
 * `frames={1}` bakes it a single time; it never needs to update.
 */
function Studio({ intensity, tint }: { intensity: number; tint?: string }) {
  return (
    <Environment resolution={256} frames={1}>
      {/* Near-black surround, so only the panels below register as highlights. */}
      <color attach="background" args={["#05060a"]} />

      {/* Overhead softbox — the main sheen across the top faces. */}
      <Lightformer
        color={tint}
        intensity={3.2 * intensity}
        rotation-x={Math.PI / 2}
        position={[0, 6, 0]}
        scale={[9, 9, 1]}
      />

      {/* Side strips. Narrow and bright: these are what make an edge read as a
          crisp bevel rather than a soft corner. */}
      <Lightformer
        color={tint}
        intensity={4.5 * intensity}
        rotation-y={-Math.PI / 2}
        position={[6, 1.5, 0]}
        scale={[6, 0.7, 1]}
      />
      <Lightformer
        color={tint}
        intensity={3 * intensity}
        rotation-y={Math.PI / 2}
        position={[-6, 1, 1]}
        scale={[6, 0.5, 1]}
      />

      {/* Warm panel at the front, so metallic marks keep their colour. */}
      <Lightformer
        form="ring"
        color="#ffd8a0"
        intensity={2.2 * intensity}
        position={[-1.5, 2, 4]}
        scale={[3, 3, 1]}
      />
    </Environment>
  );
}

/**
 * A candle wander on any light's intensity.
 *
 * Two overlapping sine waves at unrelated speeds, so the variation never
 * settles into an obvious pulse. Held to a few percent — a flicker you notice
 * is a bug, one you don't is atmosphere.
 */
function useFlicker<T extends THREE.Light>(intensity: number, flicker = 0) {
  // The ref is created here rather than passed in: the wander is a per-frame
  // write into three's mutable object graph, and keeping the ref local is what
  // makes that a mutation of our own object rather than of someone's argument.
  const light = useRef<T>(null);
  const reduced = useReducedMotion();

  useFrame((state) => {
    if (!light.current || !flicker || reduced) return;
    const t = state.clock.elapsedTime;
    const wander = Math.sin(t * 2.1) * 0.6 + Math.sin(t * 3.7 + 1.3) * 0.4;
    light.current.intensity = intensity * (1 + wander * flicker);
  });

  return light;
}

/**
 * The cone that makes the pool.
 *
 * Aimed at the middle of the play area rather than the world origin, which is
 * the whole difference between a pool that lights the die and one that lights
 * the floor in front of it. The camera looks down at an angle, so the patch of
 * table it frames sits well behind the origin — the same correction the camera
 * itself makes in bounds.ts.
 *
 * A spotlight's target is a bare Object3D that three never adds to the scene,
 * so nothing else will ever compute its world matrix; updating it by hand is
 * required rather than merely tidy.
 */
function PooledSpot({
  spot,
  bounds,
  aimZ,
}: {
  spot: Spot;
  bounds: TrayBounds;
  aimZ: number;
}) {
  const light = useFlicker<THREE.SpotLight>(spot.intensity, spot.flicker);

  useEffect(() => {
    if (!light.current) return;
    light.current.target.position.set(0, 0, aimZ);
    light.current.target.updateMatrixWorld();
  }, [aimZ, light]);

  /*
   * Solved from the play area rather than authored.
   *
   * A cone wide enough to look right on a desktop window covers a phone's
   * entire play area and then some, and a pool with no visible edge is just
   * flat light. Deriving it means the falloff lands just past where the die can
   * actually reach, on every viewport — the same reasoning that already sizes
   * the camera and the shadow box.
   */
  const angle = spotAngle(spot, bounds, aimZ);

  // Built lazily and cached in the module, so treatments without a gobo never
  // pay for the canvas.
  const gobo = useMemo(() => (spot.gobo ? getGoboMap() : null), [spot.gobo]);

  return (
    <spotLight
      ref={light}
      position={spot.position}
      angle={angle}
      penumbra={spot.penumbra}
      map={gobo ?? undefined}
      /*
       * Still distance-independent. With the light six units out and the play
       * area under three across, inverse-square would vary the brightness by a
       * few percent end to end — invisible, but it would multiply the intensity
       * by about forty and turn one readable number into a magic one. The cone
       * is what makes the pool; decay was never the missing piece.
       */
      decay={0}
      intensity={spot.intensity}
      color={spot.color}
      castShadow
      /*
       * Half the resolution the hard shadow used, and it looks better for it.
       * VSM blurs the map, so detail beyond the blur radius is thrown away
       * anyway — spending 2048² to then smear it is paying twice for nothing,
       * and this is a phone.
       */
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      /*
       * Tight. The spot sits ~5.6 up and the far corner of the play area is
       * under 9 away, so 1..24 was spending most of the depth buffer's
       * precision on empty space either side of the only object in the scene.
       * The near plane still clears the die at the top of its arc and while it
       * is up at the camera being presented.
       */
      shadow-camera-near={1.5}
      shadow-camera-far={14}
      // The softness itself. Blur samples are what stop the penumbra banding.
      shadow-radius={4}
      shadow-blurSamples={16}
      shadow-bias={-0.0004}
      // Lower than it was: normal bias pushes the shadow off along the surface
      // normal, and too much of it detaches the shadow from the die's contact
      // point — the die floats, which is its own kind of unreal.
      shadow-normalBias={0.012}
    />
  );
}

function Lighting({
  backdrop,
  bounds,
}: {
  backdrop: Backdrop;
  bounds: TrayBounds;
}) {
  const { ambient, ambientColor, spot, rim } = backdrop;

  return (
    <>
      {/* Fill. Kept low where the treatment wants the floor to fall away to
          black outside a pool, higher where it wants even illumination.

          Its colour is the colour of every shadow in the frame: nothing else
          reaches the surfaces the key and rim miss. */}
      <ambientLight intensity={ambient} color={ambientColor} />

      {/*
        A spotlight's cone plus penumbra gives a soft pool computed per pixel,
        rather than painted into the surface — which over this many world units
        bands, and needs dithering that reads as grain. Offset from vertical so
        the die throws its shadow across the pool rather than sitting on it.

        decay={0} makes intensity distance-independent, so brightness is a
        single number to reason about rather than a function of mount height.
      */}
      {spot && <PooledSpot spot={spot} bounds={bounds} aimZ={bounds.home[2]} />}

      {/* Separation from behind. Never casts — one shadow in the frame reads
          as deliberate, two read as a mistake. */}
      {rim && (
        <directionalLight
          position={rim.position}
          intensity={rim.intensity}
          color={rim.color}
        />
      )}

      {/*
        The flames are not here. They belong to the candles, and the candles
        solve their own places from the viewport — so their lights are mounted
        with their bodies in Props, where the wick's position is known once
        rather than derived twice.
      */}
    </>
  );
}

/**
 * Keeps tone-mapping exposure in step with the room.
 *
 * `onCreated` runs once, so a backdrop swapped after mount would be rendered at
 * the previous room's exposure. Both rooms ship at 1.02, which is exactly why
 * this is worth having: nothing would go visibly wrong until someone tuned one of
 * them, and then it would go wrong somewhere else entirely.
 */
function Exposure({ value }: { value: number }) {
  // Through the store rather than `useThree(s => s.gl)`: the renderer is state
  // owned by a hook, and writing to a hook's return value is exactly what the
  // compiler's immutability rule is there to stop. Reaching into the store
  // inside the effect keeps the write where it belongs — at the renderer, once,
  // when the number changes.
  const store = useStore();

  useEffect(() => {
    const { gl, invalidate } = store.getState();
    gl.toneMappingExposure = value;
    // The loop may be frozen (see Freezer), in which case nothing would redraw
    // to show it.
    invalidate();
  }, [store, value]);

  return null;
}

/** Lives inside the Canvas so it can measure the camera against the viewport. */
function SceneContents({
  backdrop,
  reduced,
}: {
  backdrop: Backdrop;
  reduced: boolean;
}) {
  const aspect = useAspect();
  const bounds = useVisibleBounds(aspect);
  const dieType = useDiceStore((s) => s.dieType);
  const mode = useDiceStore((s) => s.mode);
  const cards = mode === "cards";
  const discreet = useDiceStore((s) => s.discreet);

  /*
   * Whether the room is asleep — which lags the mode by a whole transition, in
   * *both* directions, and that symmetry is the point.
   *
   * Falling asleep late is what stops the die popping. It has no fade of its
   * own — it is a rigid body in a physics world, and it either exists or it
   * does not — so taken away on the frame the mode flips it vanishes from a
   * perfectly sharp room. Held for the length of the switch it goes while the
   * room is already soft, and the blur does the work a fade would.
   *
   * Waking up late is what stops the way back stuttering, and that was a real
   * bug rather than a refinement. Leaving card mode used to restart the
   * renderer on the same frame the blur began animating down, so for 450ms the
   * compositor was re-blurring — at a new radius every frame — a canvas that
   * was itself being redrawn at full retina with a shadow pass, while Rapier
   * rebuilt the die's body and React mounted its mesh. Four expensive things on
   * one frame budget. Staying asleep through the transition means the blur
   * animates over a still image, which is the case the compositor is good at,
   * and the scene comes back only once the room is sharp again.
   *
   * The die follows this exactly: it is on the table whenever the room is
   * awake. Nothing is lost by it arriving late — it drops in, which is an
   * entrance already, and now it lands on a room that is done moving.
   */
  const [asleep, setAsleep] = useState(cards);

  useEffect(() => {
    const id = setTimeout(() => setAsleep(cards), MODE_FADE_MS);
    return () => clearTimeout(id);
  }, [cards]);

  return (
    <>
      {/* Renders nothing and samples nothing unless the URL asks for it. */}
      <StatsProbe />
      <Freezer asleep={asleep} />
      <CameraRig aspect={aspect} />
      <SettlePush aspect={aspect} />
      <Lighting backdrop={backdrop} bounds={bounds} />
      {/*
        Outside the physics world, deliberately. Scenery the die could collide
        with is scenery that can be knocked over, and a candle lying on its side
        after a hard throw is a bug nobody wants to have to solve. Nothing here
        has a body; props.ts keeps it all out of the die's reach geometrically
        instead, and `verify:props` holds that on every viewport.
      */}
      <Props
        bounds={bounds}
        aspect={aspect}
        flame={backdrop.flame}
        petals={backdrop.petals !== false}
        petalTint={backdrop.petal}
      />
      {/*
        The coin, out here with the props rather than in the world below.

        It has no body and never touches anything — it is thrown up off the
        felt, lands back on it and comes up to be read, and its result was
        decided before it moved. Putting it in the simulation would be handing a
        settled question back to the solver. It takes the tray's bounds for the
        same reason the die does: the middle of the play area is where it lands,
        and that is not the world origin. See components/scene/Coin.tsx.
      */}
      <Coin bounds={bounds} />
      {/*
        Paused once the die has gone. There is no body in the world then, but
        the world still steps, still runs its broadphase and still costs a slice
        of every frame. Rapier resumes from exactly where it left off, and the
        die remounts and drops in fresh regardless.

        On `asleep` rather than on `cards`, so the simulation lasts exactly as
        long as the thing it is simulating. Switching modes mid-throw would
        otherwise freeze the die in mid-air for the length of the transition.
      */}
      <Physics gravity={GRAVITY} timeStep={PHYSICS_STEP} paused={asleep}>
        <InstantResolve enabled={reduced} />
        <Tray floor={backdrop.floor} bounds={bounds} aspect={aspect} />
        {/*
          Keyed by type: a different solid means a different mesh and a
          different collider, and Rapier can't reshape a body in place. Letting
          React replace it is both simpler and less error-prone than mutating a
          live rigid body.

          Off the table entirely in card mode. The lit room stays — that is the
          whole reason cards layer over this scene rather than replacing it —
          but a die lying there under a deck of cards would be a prop from the
          other game. Rapier removes the body cleanly, and switching back
          remounts it so it drops in the way it does on first load.
        */}
        {!asleep && (
          <Die
            key={dieType}
            type={dieType}
            bounds={bounds}
            /*
              A prop rather than a second `key`. The atlas is cached per
              `type:faceSet.id` and Die re-memoises its textures on this, so the
              swap is a texture change — the body stays where it is instead of
              being destroyed and dropped in again, which would announce the
              disguise going on with a die falling out of the sky.
            */
            faceSet={discreet ? discreetFaceSet : defaultFaceSet}
          />
        )}
      </Physics>
    </>
  );
}

export default function DiceScene({
  onContextLost,
  onContextRestored,
  backdrop: override,
}: {
  onContextLost: () => void;
  onContextRestored: () => void;
  /**
   * Forces a particular room. Left out, the scene picks its own from the mode —
   * which is what the app does; this stays as the escape hatch it always was.
   */
  backdrop?: Backdrop;
}) {
  const muted = useDiceStore((s) => s.muted);
  const discreet = useDiceStore((s) => s.discreet);
  const theme = useDiceStore((s) => s.theme);
  const reduced = useReducedMotion();

  /*
   * The disguise is a different room, not a filter over this one. See `plain` in
   * lib/scene/backdrops.ts for why it is a second backdrop rather than a set of
   * overrides on the first.
   *
   * And it outranks the chosen room, which is the one ordering here that
   * matters. Discreet is the tap someone makes when another person walks in; a
   * saved preference winning over it — even a preference for a room that happens
   * to look tame — would make the disguise a thing that mostly works.
   */
  const backdrop = override ?? (discreet ? plain : themeById(theme));

  useEffect(() => {
    setMuted(muted);
  }, [muted]);

  return (
    <Canvas
      /*
       * Variance shadow maps, for a shadow with a soft edge.
       *
       * `shadows` on its own asks for PCFSoftShadowMap, which three deprecated
       * — it silently falls back to plain PCF and prints a warning, and plain
       * PCF is a hard, aliased edge. That is what made the die look pasted onto
       * the felt rather than resting on it: nothing in a candlelit room casts a
       * crisp outline.
       *
       * VSM blurs in shadow space, so the map can be *smaller* than the hard
       * one it replaces and still look better — which is the right trade on a
       * phone. See the blur settings on the lights below.
       */
      shadows="variance"
      // Full retina density. This was capped at 1.5 while chasing context
      // loss, which cost real sharpness for nothing — the loss came from the
      // canvas remounting, not from the size of the drawing buffer.
      dpr={[1, 2]}
      /*
       * `alpha: false`, and it is worth more on a phone than it looks.
       *
       * The default is a canvas with an alpha channel, which tells the browser
       * the page shows through it — so Safari composites the WebGL layer as a
       * translucent surface over whatever is behind it, every frame, for the
       * whole screen. Nothing is ever behind this one: the first thing the
       * scene does is clear to an opaque `<color attach="background">`. So that
       * was a full-screen blend per frame in exchange for a channel nothing
       * reads.
       *
       * Safe under the card-mode blur in DiceApp, which reads the pixels the
       * renderer produced either way.
       */
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      // Framing is applied by CameraRig, which solves it from the viewport
      // shape; these are only sane starting values before the first layout.
      camera={{
        fov: 30,
        near: CAMERA_NEAR,
        far: CAMERA_FAR,
        position: [0, 4.4, 3.75],
      }}
      onCreated={({ gl }) => {
        /*
         * Neutral rather than ACES, and it is part of the fix for the brown.
         *
         * Some tone mapping is needed: a near-white die against a near-black
         * floor clips to a flat patch without it. But ACES's roll-off skews
         * saturated warm reds toward orange as they brighten, and a deep red
         * felt under a key light sits squarely in the range where it does that
         * — so the tone mapper was pulling the surface the same direction the
         * amber key already was.
         *
         * Khronos PBR Neutral holds albedo hue through the shadows and
         * midtones and only desaturates approaching white. The wine stays wine;
         * only the flames and the die's highlights roll off, which is exactly
         * where roll-off is wanted.
         */
        gl.toneMapping = THREE.NeutralToneMapping;
        gl.toneMappingExposure = backdrop.exposure ?? 1;
      }}
      onPointerDown={unlockAudio}
      // Fires only when a click hits no object, so tapping the felt rolls
      // without also double-firing when the die itself is tapped.
      onPointerMissed={() => {
        const { phase, discreet, coin, layDown, play } = useDiceStore.getState();
        // Nothing while a coin is out. Both store actions below already refuse,
        // but the felt is the one control that is the size of the screen and
        // sits directly under the coin — a tap meant for nothing in particular
        // should not even be read as a gesture while a bet is being settled.
        if (coin) return;
        // A tap means "put it back" while a result is up, and "go again" once
        // the table is clear. Same gesture, read from what's on screen — and
        // `play` rather than `requestRoll` so bare felt throws the die or turns
        // a card depending on which mode is out. The scene itself still knows
        // nothing about cards.
        //
        // Except while disguised, where a tap always throws. Putting the die
        // back is how you dismiss a *result* — a picture and a name laid over
        // the room — and in discreet mode there is no such thing: the die shows
        // a number and that is the end of it. Making the first tap a dismissal
        // would cost two taps a roll for nothing visible. roll() drops the die
        // out of its presentation on the way, so this is safe from any phase,
        // and it is what a shake has always done here.
        if (phase === "settled") {
          if (discreet) play();
          else layDown();
        } else if (phase !== "rolling") play();
      }}
      className="touch-none"
    >
      <color attach="background" args={[backdrop.background]} />
      {/* Depth, for nothing. See the note on Backdrop.fog. */}
      {backdrop.fog && (
        <fogExp2
          attach="fog"
          args={[backdrop.fog.color, backdrop.fog.density]}
        />
      )}
      <ContextWatcher onLost={onContextLost} onRestored={onContextRestored} />
      <Exposure value={backdrop.exposure ?? 1} />
      {/*
        Keyed by room. The studio is `frames={1}` — baked once on mount and never
        again, which is the whole reason it costs nothing — so changing a
        Lightformer's colour under it does nothing at all. Without the key the die
        would go on mirroring rose panels on a green table, and since the die is
        glossy that reflection is most of what you see of it.
      */}
      <Studio
        key={backdrop.id}
        intensity={backdrop.envIntensity}
        tint={backdrop.envTint}
      />
      <Prewarm id={backdrop.id} />
      {/* Off unless `?flight=1`. See the note on FlightQuality. */}
      <FlightQuality />
      <SceneContents backdrop={backdrop} reduced={reduced} />
    </Canvas>
  );
}
