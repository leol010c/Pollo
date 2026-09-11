"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { Flame } from "@/lib/scene/backdrops";
import { sceneCamera, visibleFloor, type TrayBounds } from "@/lib/scene/bounds";
import {
  FLAME_HEIGHT,
  FLAME_WIDTH,
  getFlameMaterial,
  getWaxGeometry,
  getWaxMaterial,
} from "@/lib/scene/candle";
import {
  getPetalGeometry,
  getPetalMaterial,
  PETAL_TINT,
  type PetalTint,
} from "@/lib/scene/petals";
import {
  placeProps,
  type CandlePlacement,
  type Petal,
} from "@/lib/scene/props";
import { useReducedMotion } from "@/lib/useReducedMotion";

/**
 * The scenery: a pair of candles and a scatter of rose petals.
 *
 * Everything here lives outside `<Physics>`. Nothing has a body, nothing is
 * collided with, and the die cannot reach any of it — props.ts solves their
 * places into the margin between the play area and the edge of the picture, and
 * `verify:props` holds it to that on every viewport.
 *
 * They also cast nothing. The die's shadow stays the only shadow in the frame,
 * which is what makes it read as deliberate rather than as a rendering.
 */

/**
 * Instance capacity for the petals.
 *
 * Fixed and a little over what the sampler asks for, so a viewport that can only
 * fit fewer changes `count` rather than rebuilding the mesh.
 */
const PETAL_CAPACITY = 56;

function Petals({ petals, tint }: { petals: Petal[]; tint: PetalTint }) {
  const geometry = useMemo(() => getPetalGeometry(), []);
  /*
   * Keyed on the tint, and it has to be. The room can change under a mounted
   * scene, and a material memoised on `[]` would keep the previous room's roses
   * — the one failure mode of a runtime theme swap that shows up as a colour
   * being *right* everywhere except in forty-four small places.
   */
  const material = useMemo(() => getPetalMaterial(tint), [tint]);
  const mesh = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    petals.forEach((petal, i) => {
      // Yaw first, then the small tilts, so a petal turned to face any
      // direction lifts off the floor by the same amount rather than by an
      // amount that depends on which way it happens to be pointing.
      euler.set(petal.tilt[0], petal.yaw, petal.tilt[1], "YXZ");
      quaternion.setFromEuler(euler);
      position.set(...petal.position);
      scale.setScalar(petal.scale);
      instanced.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    });

    instanced.count = petals.length;
    instanced.instanceMatrix.needsUpdate = true;
    // The sampler can place these anywhere in the margin, which is well outside
    // whatever three last computed for a mesh at the origin.
    instanced.computeBoundingSphere();
  }, [petals]);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, PETAL_CAPACITY]}
      /*
       * Neither casts nor receives.
       *
       * Casting would put twenty-odd extra shadows in a frame whose whole
       * premise is one. Receiving is the subtler of the two: the shadow camera
       * is sized to the play area, and these sit outside it by construction, so
       * a lookup would land off the edge of the map.
       */
      castShadow={false}
      receiveShadow={false}
      frustumCulled={false}
    />
  );
}

/** How hard the flame's own light and body breathe together. */
const FLICKER_SCALE = 0.14;

/**
 * A pair of candles, and the two lights that are the whole reason for them.
 *
 * Mounted in every room, including the one with no candles in it. That looks
 * like waste and is the opposite: three keys its compiled shader programs on
 * how many lights are in the scene, so a room that drops from two point lights
 * to none recompiles every material in the frame on the one frame the disguise
 * goes on — the felt, the die, the petals, the coin. `plain` has no `flame`
 * (see backdrops.ts), so that is exactly what switching to it used to do.
 *
 * Without a flame the wax and the sprite are hidden and the lights sit at zero,
 * which is indistinguishable from not being there and costs a light-count that
 * never moves. The same reasoning, and the same fix, as the coin's travelling
 * light — see the note at the top of components/scene/Coin.tsx.
 */
function Candles({
  candles,
  flame,
}: {
  candles: CandlePlacement[];
  /** Absent in a room with no candles. The lights stay; their light does not. */
  flame?: Flame;
}) {
  const wax = useMemo(() => getWaxGeometry(), []);
  const waxMaterial = useMemo(() => getWaxMaterial(), []);
  const flameMaterial = useMemo(() => getFlameMaterial(), []);
  const reduced = useReducedMotion();

  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const lights = useRef<(THREE.PointLight | null)[]>([]);

  useFrame((state) => {
    if (reduced || !flame) return;
    const t = state.clock.elapsedTime;

    candles.forEach((candle, i) => {
      /*
       * Two sine waves at unrelated speeds, offset per candle.
       *
       * One wave is a pulse you can count; two that never line up read as a
       * flame. The per-candle offset matters as much: two flames breathing in
       * unison look mechanical in a way one flame never does.
       */
      const phase = i * 2.4;
      const wander =
        Math.sin(t * 1.9 + phase) * 0.6 + Math.sin(t * 3.3 + phase * 1.7) * 0.4;

      const light = lights.current[i];
      if (light) {
        light.intensity =
          flame.intensity * candle.strength * (1 + wander * flame.flicker);
      }

      const sprite = sprites.current[i];
      if (sprite) {
        // The body swells with the light rather than only brightening — a
        // flame that changes intensity but not size reads as a dimmer.
        const size = 1 + wander * FLICKER_SCALE;
        sprite.scale.set(
          candle.radius * FLAME_WIDTH * size,
          candle.radius * FLAME_HEIGHT * size,
          1,
        );
      }
    });
  });

  return (
    <>
      {candles.map((candle, i) => {
        const height = candle.radius * FLAME_HEIGHT;

        return (
          <group key={candle.position.join()} position={candle.position}>
            {/* The body and the flame are the parts that may simply not be
                there. Hiding them is free; hiding the light is not. */}
            <mesh
              visible={!!flame}
              geometry={wax}
              material={waxMaterial}
              scale={[candle.radius, candle.height, candle.radius]}
              castShadow={false}
              receiveShadow={false}
            />

            <sprite
              ref={(node) => {
                sprites.current[i] = node;
              }}
              visible={!!flame}
              material={flameMaterial}
              position={[0, candle.wick + height / 2, 0]}
              scale={[candle.radius * FLAME_WIDTH, height, 1]}
            />

            {/*
              The light the whole treatment is built around.

              `decay: 2` is the point of it: this falls to a fraction of itself
              within a couple of units, so it lights its own wax, the petals
              near it and a small patch of felt — and contributes almost nothing
              to the play area. That is what lets it be as orange as a flame
              while the key stays near-white. A warm light that reached the
              whole floor is exactly what made the felt brown.

              Never casts. One shadow in the frame.

              Present in every room, at zero where there is no flame. See the
              note above this component for why it may not come and go.
            */}
            <pointLight
              ref={(node) => {
                lights.current[i] = node;
              }}
              position={[0, candle.wick + height * 0.3, 0]}
              intensity={flame ? flame.intensity * candle.strength : 0}
              color={flame?.color ?? "#ffffff"}
              decay={2}
              castShadow={false}
            />
          </group>
        );
      })}
    </>
  );
}

export function Props({
  bounds,
  aspect,
  flame,
  petals = true,
  petalTint = PETAL_TINT,
}: {
  bounds: TrayBounds;
  aspect: number;
  flame?: Flame;
  /** Off in discreet mode. A scatter of rose petals gives the game away. */
  petals?: boolean;
  /** What colour the room's roses are. See `Backdrop.petal`. */
  petalTint?: PetalTint;
}) {
  /*
   * Solved against a freshly built camera rather than the live one.
   *
   * The live camera is not the solved pose: SettlePush writes to it every frame
   * to lean in on a result. Placing props against it would drift them across the
   * floor as the camera moved, and would make the arrangement depend on when it
   * happened to be measured. `sceneCamera` is the same deterministic pose
   * `verify:props` uses, so what ships is what the check measured.
   */
  const placed = useMemo(
    () => placeProps(bounds, visibleFloor(aspect), sceneCamera(aspect)),
    [bounds, aspect],
  );

  return (
    <>
      {petals && <Petals petals={placed.petals} tint={petalTint} />}
      {/* Unconditional, and `flame` decides what is *lit* rather than what is
          mounted. A room that mounts a different number of lights than the one
          before it recompiles every shader in the frame on the way in. */}
      <Candles candles={placed.candles} flame={flame} />
    </>
  );
}
