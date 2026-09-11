"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useDiceStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { playFlip } from "@/lib/audio";
import { hapticSettle } from "@/lib/haptics";
import type { TrayBounds } from "@/lib/scene/bounds";
import { easeOut, presentationPose } from "@/lib/scene/presentation";
import {
  COIN_THICKNESS,
  HOLD_SECONDS,
  PRESENT_SECONDS,
  REST_SECONDS,
  TOSS_SECONDS,
  coinFaceNormal,
  coinFaceUp,
  coinPresentDistance,
  floorClearance,
  getCoinFaces,
  getCoinGeometry,
  launchAngle,
  restQuaternion,
  spinRemaining,
  tossApex,
  tossAt,
  wobbleAt,
} from "@/lib/scene/coin";

/**
 * The coin, tossed.
 *
 * Deliberately outside the physics world — a sibling of the props rather than
 * of the die, for the reason the props give: a thing with no rigid body cannot
 * be knocked, cannot tunnel through the tray, and cannot come to rest disagreeing
 * with the result the store already holds. It is drawn, not simulated, and the
 * outcome it shows was decided before it moved. See lib/scene/coin.ts.
 *
 * Mounted always and shown only while there is a coin to show — see the frame
 * loop. It used to unmount, which cost nothing and looked wrong: a coin filling
 * half the frame stopped existing on the frame the round was settled. The
 * geometry and both faces are cached at module level besides.
 *
 * ## Why the group is never hidden, and the mesh is hidden instead
 *
 * Three skips an invisible group whole — `projectObject` returns on
 * `visible === false` before it has looked at anything inside. That is exactly
 * what you want for the mesh and exactly what you must not do to the light,
 * because a light that is skipped is a light that is *not in the scene*, and
 * the number of lights in the scene is part of the key three caches compiled
 * shader programs under.
 *
 * So hiding this group took the room from two point lights to three and back on
 * every flip, and each crossing invalidated every program in the frame: the
 * felt, the die, the petals, the wax, the sprite — all recompiled on the one
 * frame the coin appeared, along with this coin's own three materials being
 * compiled for the first time. On a phone that is the whole stall, and it
 * showed up worst on the first flip of a session because the programs for the
 * other light count are cached afterwards.
 *
 * The group therefore stays visible for its whole life. What used to be
 * `group.visible` is now the mesh's, so nothing is drawn that was drawn before;
 * the light stands in the list permanently and is turned down to zero instead
 * of being taken out of the room. Three point lights are evaluated where two
 * were — a few dozen instructions a pixel, against a recompile.
 */

const scratchForward = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchAxis = new THREE.Vector3();
const scratchSpin = new THREE.Quaternion();
const scratchWobble = new THREE.Quaternion();
const scratchRest = new THREE.Quaternion();
const scratchPresent = new THREE.Quaternion();

/**
 * The points in the flight where the coin hits the felt.
 *
 * Kept here rather than exported from the toss: this is the only thing that
 * cares *when* contact happens rather than where the coin is, and it is what
 * the haptics fire on. First touch and the two bounces, in order.
 */
const CONTACTS = [0.7, 0.88, 0.96] as const;

/** The travelling light's intensity while the coin is out. Zero otherwise —
 *  it stays in the room either way, which is the point. */
const COIN_LIGHT = 2.4;

/** How long the coin takes to be flicked out of the frame once it is spent. */
const EXIT_SECONDS = 0.42;
/** How far it rises on the way out, in world units. */
const EXIT_LIFT = 0.55;
/** Turns it puts in while going. Enough to read as a flick, not as a drill. */
const EXIT_TURNS = 1.1;

export function Coin({ bounds }: { bounds: TrayBounds }) {
  const coin = useDiceStore((s) => s.coin);
  const landCoin = useDiceStore((s) => s.landCoin);
  const reduced = useReducedMotion();

  const group = useRef<THREE.Group>(null);
  /*
   * Hidden and revealed separately from the group that carries them, and never
   * together with it. See the note at the top of this file: hiding the group
   * would take its light out of the scene, and the light count is what three
   * keys compiled shaders on.
   */
  const mesh = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  /** Flight progress, 0 to 1: launch to lying still on the felt. */
  const t = useRef(0);
  /** Seconds spent lying on the felt before being picked up to be read. */
  const rested = useRef(0);
  /** Progress of the rise off the table, 0 to 1. */
  const shown = useRef(0);
  /** Seconds the presented face has been held before the notice opens. */
  const held = useRef(0);
  /** Guards landCoin to exactly one call per toss. */
  const reported = useRef(false);

  /** Running out the exit, after the store has let go of the coin. */
  const leaving = useRef(false);
  const exit = useRef(0);
  const exitFrom = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });

  const flipId = coin?.flipId;
  const outcome = coin?.outcome;

  /*
   * A fresh toss, per flipId rather than per mount.
   *
   * The same outcome twice running is an ordinary thing for a fair coin to do,
   * and keying the reset on the outcome would make the second one not happen.
   * The same reason rollId exists.
   */
  useEffect(() => {
    if (flipId === undefined) return;

    // With reduced motion the coin is already up and facing you. The toss and
    // the rise are the parts that are motion; the result is information, and it
    // still gets its moment on screen through the hold below.
    t.current = reduced ? 1 : 0;
    rested.current = reduced ? REST_SECONDS : 0;
    shown.current = reduced ? 1 : 0;
    held.current = 0;
    exit.current = 0;
    group.current?.scale.setScalar(1);
    // False even when the motion is skipped: being readable is what tells the
    // store the face can be spoken about, and the frame below is what says so.
    // Pre-setting it here would leave a reduced-motion coin sitting there
    // having never been reported, with nothing able to move past it.
    reported.current = false;

    if (!reduced) playFlip();
  }, [flipId, reduced]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;

    /*
     * The coin's presence, applied to the two things that own a piece of it.
     *
     * The mesh is what used to be hidden by hiding the group; the light is what
     * must never be, because taking it out of the scene recompiles every shader
     * in the room. Zero intensity is the light's version of invisible and costs
     * three instructions instead.
     */
    const show = (on: boolean) => {
      if (mesh.current) mesh.current.visible = on;
      if (light.current) light.current.intensity = on ? COIN_LIGHT : 0;
    };

    /*
     * Nothing to show, or something to show going.
     *
     * The round has been settled and the coin has no further part in it, but it
     * was up at the camera filling half the frame a moment ago, and simply
     * ceasing to exist there is the most abrupt thing the scene can do — on a
     * win it happened at the same instant the die was thrown, so two things
     * changed on one frame and neither was watchable.
     *
     * It is flicked away rather than faded: kept turning, lifted, and shrunk to
     * nothing. Scale rather than opacity because the coin is opaque struck
     * metal carrying three materials, and fading one of those buys a
     * transparency-sorting problem in exchange for a worse-looking exit.
     *
     * Started here rather than from an effect on purpose. This is animation
     * state, it is read once per frame, and routing it through React would mean
     * a render in the middle of a flight for something no component reads.
     */
    if (!outcome) {
      if (reported.current) {
        // Only a coin that was actually read gets a send-off. One cleared
        // before then — the disguise going on, a mode switch, the die changing
        // underneath it — was never seen, and those all mean the screen is
        // being cleared rather than a round being finished.
        reported.current = false;
        exit.current = 0;
        leaving.current = !reduced;
      }

      if (!leaving.current) {
        show(false);
        return;
      }

      exit.current = Math.min(1, exit.current + delta / EXIT_SECONDS);
      const e = exit.current;

      show(true);
      g.position.copy(exitFrom.current.position);
      g.position.y += EXIT_LIFT * e;
      g.quaternion.copy(exitFrom.current.quaternion);
      g.rotateX(EXIT_TURNS * Math.PI * 2 * e);
      // Squared, so it holds its size for the first part and goes quickly at
      // the end: the coin is tossed aside rather than deflating in place.
      g.scale.setScalar(1 - e * e);

      if (e >= 1) leaving.current = false;
      return;
    }

    show(true);
    if (reported.current) return;

    /*
     * Solved against the live camera every frame rather than once at launch.
     *
     * SettlePush eases the camera in and out along its view line, so a pose
     * captured at the toss would be a pose the camera has since left — the coin
     * would drift across the frame while apparently holding still. The die
     * solves its own presentation the same way and for the same reason.
     */
    const camera = state.camera as THREE.PerspectiveCamera;
    camera.updateMatrixWorld();
    camera.getWorldDirection(scratchForward);
    scratchUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    // The screen's horizontal, laid flat in the world. Turning about this is
    // what makes the toss read as end-over-end from where you are sitting
    // rather than rolling about some axis the framing doesn't share.
    scratchRight.crossVectors(scratchForward, scratchUp).setY(0).normalize();

    // How high this window can throw. Memoised per aspect inside, so asking
    // every frame costs a map lookup — and asking here rather than at launch
    // means a window resized mid-flight rescales the arc rather than sending
    // the coin through the top of the new frame.
    const apex = tossApex(camera.aspect);
    // Which way this toss comes from. Off the flip's own id, so it is the same
    // throw on every frame of it — see launchAngle.
    const angle = launchAngle(flipId ?? 0);

    // Where it lies when it is down: the middle of the play area, which is not
    // the world origin — the camera looks down at an angle. Same reasoning as
    // the die's home.
    scratchRest.copy(restQuaternion(outcome));

    if (t.current < 1) {
      const before = t.current;
      t.current = Math.min(1, t.current + delta / TOSS_SECONDS);

      const at = tossAt(t.current, bounds, apex, angle);
      g.position.set(at.x, at.y, at.z);

      /*
       * The turning, counted down onto the landing pose.
       *
       * Premultiplied, so the spin happens about the world axes rather than in
       * the coin's own frame — and it unwinds to exactly zero, which leaves the
       * coin lying in restQuaternion() by construction. That is the whole of
       * why the face cannot come up wrong: the total turning is a whole number
       * of turns and a whole turn is the identity, so nothing here can reach a
       * different face than the one restQuaternion chose.
       *
       * The lean goes on first, about the direction of travel, so the coin
       * tumbles slightly off its axis the way a thrown one does. It decays to
       * nothing over the flight for the same reason the spin does.
       */
      scratchSpin.setFromAxisAngle(scratchRight, spinRemaining(t.current));
      scratchWobble.setFromAxisAngle(scratchForward, wobbleAt(t.current));
      g.quaternion
        .copy(scratchSpin)
        .multiply(scratchWobble)
        .multiply(scratchRest);

      /*
       * And it cannot go through the table.
       *
       * Applied after the turn rather than folded into the arc, because how far
       * the coin reaches below its own centre depends entirely on how it is
       * lying at that instant — flat it is half a thickness, on edge it is a
       * whole radius. Near the felt it is still turning, so this is the stretch
       * either side of each bounce where it was sinking into the cloth.
       */
      scratchAxis.set(0, 0, 1).applyQuaternion(g.quaternion);
      g.position.y = Math.max(g.position.y, floorClearance(scratchAxis.y));

      // Once per contact, not once per landing: the bounces are hits too, and
      // a coin that only buzzed when it finally stopped would be missing the
      // two that make the landing read as one.
      for (const contact of CONTACTS) {
        if (before < contact && t.current >= contact) {
          hapticSettle(contact === CONTACTS[0] ? 1 : 0.4);
        }
      }
      return;
    }

    const down = tossAt(1, bounds, apex, angle);
    // Lying flat, so this is half a thickness and the hair of clearance that
    // keeps the underside off the floor plane rather than in it. Through the
    // same function the flight uses, so the coin does not step down onto the
    // cloth the instant it stops turning.
    down.y = floorClearance(1);

    // Lying still on the felt for a beat, so it is seen to have landed rather
    // than appearing to bounce straight back up at the camera.
    if (rested.current < REST_SECONDS) {
      rested.current += delta;
      g.position.set(down.x, down.y, down.z);
      g.quaternion.copy(scratchRest);
      return;
    }

    /*
     * Up off the table to be read, exactly as the die does it.
     *
     * The same solve, through the same function — the coin is a thing in the
     * room that has come to rest showing a face, which is the die's situation
     * to the letter. Its own distance because it is a different size, and its
     * own share of the frame because it is a flat disc with one mark on it.
     */
    const pose = presentationPose(
      camera,
      coinFaceNormal(outcome),
      coinFaceUp(),
      coinPresentDistance(camera.fov),
    );

    shown.current = Math.min(1, shown.current + delta / PRESENT_SECONDS);
    const k = easeOut(shown.current);

    scratchPosition.set(down.x, down.y, down.z);
    g.position.lerpVectors(scratchPosition, pose.position, k);

    scratchPresent.copy(pose.quaternion);
    g.quaternion.slerpQuaternions(scratchRest, scratchPresent, k);

    if (shown.current < 1) return;

    /*
     * A beat on the presented face before anything follows from it.
     *
     * The notice that says what happened opens over this, so without the beat
     * the coin would be covered on the frame it finished arriving — and the
     * thing you took the bet for would never be seen at all.
     */
    held.current += delta;
    if (held.current < HOLD_SECONDS) return;

    // Where it was standing when the round was settled, so the exit above can
    // pick up from exactly there rather than snapping somewhere first.
    exitFrom.current.position.copy(g.position);
    exitFrom.current.quaternion.copy(g.quaternion);

    // Readable. Said as soon as it is true, so the notices and the live region
    // are describing the face that is actually on screen.
    reported.current = true;
    landCoin();
  });

  const faces = getCoinFaces();

  return (
    // Always mounted, and shown or hidden by the frame loop above rather than
    // by returning null here. Unmounting was what made the coin vanish the
    // instant the round was settled.
    //
    // The group itself carries no visibility. That is load-bearing rather than
    // tidy — see the note at the top of this file — and the two things inside
    // it stand down in their own ways instead.
    <group ref={group}>
      <mesh ref={mesh} visible={false} geometry={getCoinGeometry()}>
        {/*
          Three materials, in the order a cylinder's groups come in: rim, then
          the cap that faces the camera at rest, then the far one. The pairing
          of cap to outcome is the whole contract between this file and
          finalSpin — see the note on getCoinFaces.
        */}
        <meshPhysicalMaterial attach="material-0" color="#a97c33" metalness={1} roughness={0.42} />
        <meshPhysicalMaterial
          attach="material-1"
          map={faces.won}
          metalness={1}
          roughness={0.34}
          clearcoat={0.6}
          clearcoatRoughness={0.2}
          // Metal in a candlelit room has almost nothing to reflect but the
          // studio panels, and the coin holds well above the pool the spot
          // makes. Lifted so it reads as brass rather than as a dark disc.
          envMapIntensity={1.6}
          emissive="#e8b04b"
          emissiveIntensity={0.1}
        />
        <meshPhysicalMaterial
          attach="material-2"
          map={faces.lost}
          metalness={1}
          roughness={0.34}
          clearcoat={0.6}
          clearcoatRoughness={0.2}
          envMapIntensity={1.6}
          emissive="#e8b04b"
          emissiveIntensity={0.1}
        />
      </mesh>

      {/*
        A soft light of its own, riding with it.

        The room is lit for a die lying on a table — one cone aimed down at the
        felt — and the coin holds in the air well outside it, where a metal disc
        would be a silhouette. This travels with the coin rather than being
        added to the room, so nothing about the table's lighting changes when a
        bet is taken.

        It is in the room at all times even so, at zero intensity between
        flips. A light that comes and goes changes how many lights three is
        compiling for, and that is not a thing to do on the frame a coin is
        thrown. Its *contribution* still comes and goes, which is all that was
        ever wanted here.
      */}
      <pointLight
        ref={light}
        position={[0.35, 0.45, COIN_THICKNESS + 0.6]}
        intensity={0}
        distance={3}
        color="#ffd8a0"
      />
    </group>
  );
}
