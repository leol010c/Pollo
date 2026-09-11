import * as THREE from "three";
import { atlasGrid, DIE_SIDES, type DieType } from "./types";
import { defaultFaceSet, type FaceSet } from "./faceSet";

/**
 * Face marks are baked into canvas atlases — one cell per value, plus a blank
 * cell that the chamfer geometry samples.
 *
 * Two atlases are produced from the same silhouette:
 *
 *  - colour, which is what you see
 *  - a packed roughness/metalness map, because three reads roughness from the
 *    green channel and metalness from the blue channel of a texture
 *
 * That second map is what makes brass numerals behave like metal while the body
 * stays a dielectric — one material, two genuinely different surfaces.
 */

/** Per-face cell size. The die fills a good part of the frame, so a face can
 *  span a few hundred screen pixels — 256 left the numerals visibly soft. */
const CELL = 512;

interface DieTextures {
  color: THREE.CanvasTexture;
  /** G = roughness, B = metalness. */
  material: THREE.CanvasTexture;
}

interface Entry extends DieTextures {
  /** What was last painted. See `hand`. */
  painted: string;
}

const cache = new Map<string, Entry>();

/**
 * What the faces currently say, as one comparable string.
 *
 * Exported so verify can assert on it directly, the same way `bettingNow` is —
 * this is a cache key whose failure mode is silence. Getting it wrong does not
 * throw or draw anything odd; it draws the *previous* face, which looks like a
 * die that simply came up the same way twice.
 *
 * A repaint is not cheap — two canvases up to 2560² for a d20, redrawn and then
 * re-uploaded to the GPU with mipmaps — and the deal is re-run on paths that
 * frequently produce the same hand twice: a throw that changes nothing about
 * the deck, a position toggled and toggled back, a mode returned to. Painting
 * those again costs exactly as much as painting a real change.
 *
 * Everything a face's mark depends on is in here. The token is built from the
 * artwork that actually resolved rather than the candidate list, so this also
 * changes the moment a slow file lands — which is precisely when a repaint *is*
 * wanted.
 */
export function hand(type: DieType, faceSet: FaceSet): string {
  const sides = DIE_SIDES[type];
  let key = faceSet.id;

  for (let value = 1; value <= sides; value++) {
    // A face set that can put two different code-drawn marks on two faces has
    // to say which is which itself — see tokenFor. Everything else is described
    // well enough by its artwork, with one exception: a wild is drawn in code
    // and has no file, so it needs a token or it would be indistinguishable
    // from a face whose artwork is merely missing.
    const token =
      faceSet.tokenFor?.(value) ??
      faceSet.sourceFor?.(value) ??
      (faceSet.isWild?.(value) ? "*" : "#");
    key += `|${token}`;
  }

  return key;
}

type Channel = "color" | "material";

function surfaceFill(
  faceSet: FaceSet,
  which: "body" | "mark",
  channel: Channel,
): string {
  const surface = faceSet[which];
  if (channel === "color") return surface.color;
  const g = Math.round(surface.roughness * 255);
  const b = Math.round(surface.metalness * 255);
  return `rgb(0, ${g}, ${b})`;
}

function paint(
  texture: THREE.CanvasTexture,
  type: DieType,
  faceSet: FaceSet,
  channel: Channel,
): void {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const sides = DIE_SIDES[type];
  const { cols } = atlasGrid(sides);

  // The body fills the whole atlas first, so a UV that lands slightly off-cell
  // still samples body pixels rather than a seam.
  ctx.fillStyle = surfaceFill(faceSet, "body", channel);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = surfaceFill(faceSet, "mark", channel);
  for (let value = 1; value <= sides; value++) {
    const cell = value - 1;
    ctx.save();
    ctx.translate((cell % cols) * CELL, Math.floor(cell / cols) * CELL);
    faceSet.draw(ctx, value, CELL, channel);
    ctx.restore();
  }

  texture.needsUpdate = true;
}

function makeTexture(type: DieType, channel: Channel): THREE.CanvasTexture {
  const { cols, rows } = atlasGrid(DIE_SIDES[type]);
  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;

  const texture = new THREE.CanvasTexture(canvas);
  // Only the colour map is authored in sRGB; roughness and metalness are raw
  // linear data and would be wrong if colour-managed.
  texture.colorSpace =
    channel === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Paints both channels and records what was painted.
 *
 * `force` is for the case the hand cannot describe: an asset resolving under a
 * hand that has not otherwise changed. A web font landing repaints the numerals
 * at their real metrics, and artwork landing replaces a numeral fallback with
 * the drawing — neither moves the signature, and both must still be drawn.
 */
function paintBoth(
  entry: Entry,
  type: DieType,
  faceSet: FaceSet,
  force = false,
): void {
  const next = hand(type, faceSet);
  if (!force && next === entry.painted) return;

  paint(entry.color, type, faceSet, "color");
  paint(entry.material, type, faceSet, "material");
  entry.painted = next;
}

/**
 * Repaints an already-built atlas in place.
 *
 * The deck deals different positions onto the faces on every throw, so the
 * textures have to change without being rebuilt — allocating a new pair per
 * roll would leak canvases for the length of a session.
 *
 * Callers time this for the tumble, not for the launch: `needsUpdate` on a
 * canvas this size is a full re-upload with mipmap generation, and it used to
 * land on the one frame the die leaps — the frame most worth protecting. It is
 * also a no-op whenever the faces would come out identical; see `hand`.
 */
export function repaintDieTextures(
  type: DieType,
  faceSet: FaceSet = defaultFaceSet,
): void {
  const entry = cache.get(`${type}:${faceSet.id}`);
  if (!entry) return;
  paintBoth(entry, type, faceSet);
}

export function getDieTextures(
  type: DieType,
  faceSet: FaceSet = defaultFaceSet,
): DieTextures {
  const key = `${type}:${faceSet.id}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const entry: Entry = {
    color: makeTexture(type, "color"),
    material: makeTexture(type, "material"),
    painted: "",
  };

  // Kick off artwork loading before the first paint. It won't have finished —
  // nothing async can — but starting here means the repaint below is the only
  // one needed rather than one per asset.
  const artwork = faceSet.prepare?.(CELL);

  // Forced, because nothing has been painted yet and the empty signature is
  // not a claim about the canvas.
  paintBoth(entry, type, faceSet, true);
  cache.set(key, entry);

  // Anything the marks depend on that isn't available synchronously repaints
  // the atlases in place. Blocking the scene on it instead is what previously
  // forced the canvas to mount conditionally, and cost a WebGL context on
  // every reload.
  const later: Promise<unknown>[] = [];
  if (typeof document !== "undefined" && document.fonts) {
    later.push(document.fonts.ready);
  }
  if (artwork) later.push(artwork);

  if (later.length) {
    // Forced: see paintBoth. What changed here is how the marks rasterise, not
    // which marks they are.
    Promise.allSettled(later).then(() => paintBoth(entry, type, faceSet, true));
  }

  return entry;
}
