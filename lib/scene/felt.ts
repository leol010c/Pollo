import { visibleFloor } from "./bounds";

/**
 * How much cloth to build, and how finely.
 *
 * Separated from the mesh that uses it for the reason bounds.ts and folds.ts
 * are: scripts/verify-floor.ts imports exactly this, so the check cannot drift
 * away from the thing it checks.
 *
 * The surface still runs off every side of the frame — it must never end in
 * shot, and an edge is exactly what it does not have. What changed is that it
 * now reaches *just* past the frame rather than sixty world units in every
 * direction regardless of where the frame is.
 */

/**
 * World units per quad.
 *
 * Folds have wavelengths measured in world units, so this only has to be fine
 * enough to carry a metre-scale curve — 0.3 puts about seven quads across the
 * narrowest crease, which is plenty. It is not trying to represent the pile;
 * that is the normal map's job, and it works at 0.3 units too.
 *
 * This is a *density*, and that is the change. It used to be a segment count —
 * 200 — spread across a fixed 60-unit square: 80,000 triangles and 40,000
 * vertices, rebuilt in JS with `foldAt` per vertex and `computeVertexNormals`
 * every time the viewport changed shape. The density was right; the extent was
 * not. On a phone the camera sees about 3.7 by 7.9 world units of floor, so
 * better than 99% of that mesh was tessellated at full detail and then thrown
 * away by the clip stage, on every frame.
 */
export const FOLD_RESOLUTION = 0.3;

/**
 * How much floor is built beyond what the camera can see.
 *
 * `visibleFloor` is exact for the solved pose, and the only thing that ever
 * moves the camera off it is SettlePush — which eases *along the view line
 * toward* the point it already looks at, so it can only ever narrow the view.
 * The margin is therefore not covering camera motion; it is covering the folds
 * themselves, which displace the cloth by up to FOLD_AMPLITUDE and so can show
 * a little further round a crest at a grazing angle than a flat plane would.
 *
 * 60% in every direction is far more than that needs, and still leaves the mesh
 * one to two orders of magnitude smaller than it was.
 */
export const FLOOR_MARGIN = 1.6;

/**
 * A ceiling on the tessellation.
 *
 * Not expected to bind at any viewport a browser can be — it is there so that
 * an absurd aspect ratio degrades into a coarse floor rather than into a
 * hundred thousand triangles built during a resize.
 */
export const MAX_SEGMENTS = 192;

export interface FeltExtent {
  /** Half-width and half-depth, measured from the mesh's own centre. */
  halfX: number;
  halfZ: number;
  segX: number;
  segZ: number;
}

/**
 * The felt's size and tessellation for a viewport.
 *
 * A rectangle rather than a square, and that is most of the saving on a phone:
 * an upright viewport sees a long, narrow strip of floor, and squaring that off
 * to its longer side would build four times the cloth to show the same picture.
 *
 * `midZ` is the mesh's own centre, which is not the world origin — the camera
 * looks down at an angle, so the patch of floor it frames sits well behind it.
 */
export function feltExtent(midZ: number, aspect: number): FeltExtent {
  const quad = visibleFloor(aspect);

  const halfX = Math.max(quad.halfXNear, quad.halfXFar) * FLOOR_MARGIN;
  const halfZ =
    Math.max(Math.abs(quad.zNear - midZ), Math.abs(quad.zFar - midZ)) *
    FLOOR_MARGIN;

  return {
    halfX,
    halfZ,
    segX: Math.min(MAX_SEGMENTS, Math.ceil((halfX * 2) / FOLD_RESOLUTION)),
    segZ: Math.min(MAX_SEGMENTS, Math.ceil((halfZ * 2) / FOLD_RESOLUTION)),
  };
}
