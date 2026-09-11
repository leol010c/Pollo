"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import type { Floor } from "@/lib/scene/backdrops";
import { FELT_SURFACE, RIM_SURFACE, RIM_TAG } from "@/lib/scene/physics";
import type { TrayBounds } from "@/lib/scene/bounds";
import { feltExtent } from "@/lib/scene/felt";
import { foldAt } from "@/lib/scene/folds";
import {
  VELVET_TILE,
  getVelvetNormalMap,
  getVelvetRoughnessMap,
} from "@/lib/scene/velvet";

/**
 * The surface the die is thrown on, and the edges of the screen it bounces off.
 *
 * There is no table here any more — no felt with an edge, no rim standing round
 * it, no shape at all. The surface simply runs off every side of the frame, and
 * the die rebounds off the boundary of what the camera can see, so the whole
 * screen is in play.
 *
 * That boundary is not a guess: bounds.ts already solves for the largest patch
 * of floor on which the die stays completely in shot, and these walls stand on
 * exactly that line. So "the edge of the screen" and "as far as the die may go"
 * are the same thing by construction.
 *
 * The surface carries no painted gradient. Whatever falloff appears across it
 * comes from the lights in DiceScene, computed per pixel — a baked one stretched
 * over this many world units either bands or needs dithering that reads as
 * visible grain.
 */

/**
 * How far the *collider* reaches.
 *
 * Far past anywhere the die can be — it is confined by the walls below to the
 * play area — and deliberately still a single large constant. A floor plane is
 * one static cuboid whether it is six units across or sixty, so there is
 * nothing to save here and a great deal to leave alone: scripts/verify-fix.ts
 * builds its shadow table with this same number, and every distribution check
 * in the suite is a statement about a die rolling on this surface.
 *
 * What the die rolls on and what the camera sees are no longer the same rectangle.
 */
const FLOOR_EXTENT = 60;

/** Height and thickness of the invisible walls at the screen's edge. */
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 0.5;
const CEILING = 8;

/**
 * The floor: a plane, displaced into folds, with its UVs rewritten to world
 * units.
 *
 * It used to be a `ShapeGeometry`, chosen because ShapeGeometry emits UVs in
 * world units while PlaneGeometry emits 0–1 across the whole surface — which
 * would stretch one tile of pile over the whole floor and lose the velvet. That
 * reasoning still holds, and is why the UVs are rewritten by hand below rather
 * than the plane simply being dropped in. What ShapeGeometry cannot do is have
 * any vertices in the middle to displace, and the folds need them.
 *
 * Built per `bounds` because the flat region is the play area, and per `aspect`
 * because its own size is now what the camera can see rather than a constant.
 * Both are solved from the viewport, so this is one rebuild, not two.
 *
 * It is a rectangle rather than a square, and that is most of the saving on a
 * phone: an upright viewport sees a long, narrow strip of floor, and squaring
 * that off to its longer side would build four times the cloth to show the same
 * picture.
 */
function buildFloor(
  bounds: TrayBounds,
  midZ: number,
  aspect: number,
): THREE.BufferGeometry {
  // Solved in lib/scene/felt.ts, so scripts/verify-floor.ts can measure exactly
  // what ships rather than a second copy of the same arithmetic.
  const { halfX, halfZ, segX, segZ } = feltExtent(midZ, aspect);

  const geometry = new THREE.PlaneGeometry(halfX * 2, halfZ * 2, segX, segZ);

  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    // Still in the plane's own space: x across, y up the plane, z out of it.
    // The mesh is rotated flat afterwards, so y here becomes world -z and the
    // out-of-plane axis becomes world height.
    const x = pos.getX(i);
    const y = pos.getY(i);
    // The mesh sits at z = midZ once placed, so the fold field has to be
    // sampled where the vertex will actually end up or the flat patch lands
    // somewhere other than under the die.
    pos.setZ(i, foldAt(x, midZ - y, bounds));
    // World units, so one tile of pile stays one tile however big the floor
    // is — the property ShapeGeometry gave for free.
    uv.setXY(i, x, y);
  }

  // The displacement is the whole point, so the normals have to follow it.
  // Without this the cloth is folded and lit as though it were flat.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function FloorSurface({ floor }: { floor: Floor }) {
  const nap = getVelvetNormalMap();
  const sheen = getVelvetRoughnessMap();
  // One tile per VELVET_TILE world units is simply its reciprocal, because the
  // UVs are already in world units — scaling by the surface's size here would
  // repeat the pile hundreds of times over and turn it to noise.
  const repeat = 1 / VELVET_TILE;

  return (
    /*
     * Physical rather than standard, for one feature: `sheen`.
     *
     * Velvet's whole character is that it lights up where it turns away from
     * you — the pile catches at grazing angles. Reaching for that by lowering
     * roughness is what produced the sweep across the surface that got called a
     * gradient three times, because that is a mirror lobe and a mirror lobe on
     * a big plane under a raking light is a band.
     *
     * Sheen is a different lobe. It brightens with the viewing angle instead of
     * reflecting the light's position, so the glow follows the cloth rather
     * than sliding across it, and roughness stays where it is. It is still the
     * riskiest thing in this file given the history, which is why it is one
     * optional number a backdrop can set to zero.
     */
    <meshPhysicalMaterial
      color={floor.color}
      roughness={floor.roughness}
      metalness={floor.metalness}
      envMapIntensity={floor.envMapIntensity}
      sheen={floor.sheen ?? 0}
      sheenColor={floor.sheenColor ?? "#ffffff"}
      sheenRoughness={floor.sheenRoughness ?? 1}
      /*
       * The same height field that drives the nap, so the sheen varies along
       * the pile instead of sitting evenly over it — that variation is most of
       * what separates velvet from any other matte cloth.
       *
       * Literally the same texture object as the roughness map above, so its
       * repeat is already set and must not be set again here: with sheen off
       * this is null, and `sheenRoughnessMap-repeat-x` on a null map throws
       * before the scene can mount.
       */
      sheenRoughnessMap={floor.sheen ? sheen : null}
      normalMap={nap}
      // Subtle on purpose. The pile should register as texture when the light
      // rakes across it, not as visible bumps.
      normalScale={new THREE.Vector2(0.26, 0.26)}
      normalMap-repeat-x={repeat}
      normalMap-repeat-y={repeat}
      // The sheen: roughness varying along the nap is what separates velvet
      // from any other matte cloth.
      roughnessMap={sheen}
      roughnessMap-repeat-x={repeat}
      roughnessMap-repeat-y={repeat}
    />
  );
}

export function Tray({
  floor,
  bounds,
  aspect,
}: {
  floor: Floor;
  bounds: TrayBounds;
  /** The floor is built to what the camera can see, and that is a function of
   *  the viewport's shape. See buildFloor. */
  aspect: number;
}) {
  const { halfX, zMin, zMax } = bounds;
  const halfZ = (zMax - zMin) / 2;
  const midZ = (zMax + zMin) / 2;
  const spanX = halfX + WALL_THICKNESS * 2;
  const spanZ = halfZ + WALL_THICKNESS * 2;

  const geometry = useMemo(
    () => buildFloor(bounds, midZ, aspect),
    [bounds, midZ, aspect],
  );

  return (
    <group>
      <RigidBody
        type="fixed"
        friction={FELT_SURFACE.friction}
        restitution={FELT_SURFACE.restitution}
      >
        <mesh
          receiveShadow
          geometry={geometry}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, midZ]}
        >
          <FloorSurface floor={floor} />
        </mesh>
        <CuboidCollider
          args={[FLOOR_EXTENT / 2, 0.25, FLOOR_EXTENT / 2]}
          position={[0, -0.25, midZ]}
        />
      </RigidBody>

      {/*
        The screen's edges, as four walls the die rebounds off.

        Invisible on purpose — there is nothing drawn for them to be the
        collision shape of. They stand on the play boundary, which is the line
        past which the die would no longer be fully in shot, so the die appears
        to bounce off the sides of the picture itself.

        Tagged as rim so an impact still sounds like a wall rather than cloth.
      */}
      <RigidBody
        type="fixed"
        userData={RIM_TAG}
        friction={RIM_SURFACE.friction}
        restitution={RIM_SURFACE.restitution}
      >
        <CuboidCollider
          args={[WALL_THICKNESS, WALL_HEIGHT, spanZ]}
          position={[halfX + WALL_THICKNESS, WALL_HEIGHT, midZ]}
        />
        <CuboidCollider
          args={[WALL_THICKNESS, WALL_HEIGHT, spanZ]}
          position={[-halfX - WALL_THICKNESS, WALL_HEIGHT, midZ]}
        />
        <CuboidCollider
          args={[spanX, WALL_HEIGHT, WALL_THICKNESS]}
          position={[0, WALL_HEIGHT, zMax + WALL_THICKNESS]}
        />
        <CuboidCollider
          args={[spanX, WALL_HEIGHT, WALL_THICKNESS]}
          position={[0, WALL_HEIGHT, zMin - WALL_THICKNESS]}
        />
        {/* A lid, so a hard throw cannot leave over the top. */}
        <CuboidCollider
          args={[spanX, WALL_THICKNESS, spanZ]}
          position={[0, CEILING, midZ]}
        />
      </RigidBody>
    </group>
  );
}
