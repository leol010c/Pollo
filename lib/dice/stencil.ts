"use client";

/**
 * Turns artwork into a recolourable stencil.
 *
 * A face mark has to be drawn into two different atlas channels — colour, and
 * packed roughness/metalness — from a single silhouette. So artwork can't be
 * blitted directly; it has to become a pure alpha mask that the atlas can then
 * fill with whatever the face set specifies, exactly like the numerals.
 */

export type StencilMode = "alpha" | "ink";

/**
 * How much ink covers each pixel.
 *
 * The obvious choice is the alpha channel, and for correctly authored artwork —
 * black shapes, transparent everywhere else — that is exactly what `ink`
 * computes, because darkness is 1 wherever alpha is 1.
 *
 * It differs on line art whose enclosed areas are filled opaque white rather
 * than left transparent, which is common in exported raster drawings. There the
 * alpha channel covers the whole figure, so an alpha mask collapses it into a
 * solid blob with every interior line lost. Weighting by darkness drops those
 * white fills and keeps the strokes.
 *
 * `alpha` remains available for the case this gets wrong: artwork authored in
 * light colours on transparent, which has no ink by this measure.
 */
function coverage(
  r: number,
  g: number,
  b: number,
  a: number,
  mode: StencilMode,
): number {
  if (mode === "alpha") return a;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return a * (1 - luminance);
}

const cache = new Map<string, Promise<Artwork>>();

function scratchFor(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export interface Artwork {
  /** The image letterboxed into the cell, colours untouched. */
  color: HTMLCanvasElement;
  /** The same shape as a white-on-transparent mask, for tinting. */
  mask: HTMLCanvasElement;
}

/**
 * Rasterises `src` into a `size`×`size` cell, twice over: once with its colours
 * intact, and once reduced to a mask.
 *
 * Both come out of a single decode because a face set needs one or the other
 * depending on whether the artwork is a stencil to be filled or an illustration
 * to be printed — and the atlas can't await anything at paint time.
 *
 * The artwork is letterboxed rather than stretched — a wide drawing on a square
 * face should keep its proportions, not be squashed to fit. `padding` is a
 * fraction of the cell kept clear on every side so a mark never runs into the
 * edge of its atlas cell and bleeds onto the neighbouring face.
 */
async function rasterise(
  src: string,
  size: number,
  padding: number,
  mode: StencilMode,
): Promise<Artwork> {
  const image = new Image();
  // Same-origin assets out of /public, but this keeps getImageData legal if a
  // mark is ever served from elsewhere.
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();

  const canvas = scratchFor(size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Raster marks are usually smaller than the cell and get scaled up. The
  // default resampling is noticeably blockier than the high setting, and this
  // runs once per asset rather than per frame, so the quality is free.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // An SVG with no intrinsic size reports 0; fall back to the cell itself.
  const iw = image.naturalWidth || size;
  const ih = image.naturalHeight || size;

  const inner = size * (1 - padding * 2);
  const scale = Math.min(inner / iw, inner / ih);
  const w = iw * scale;
  const h = ih * scale;

  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);

  // The letterboxed original is kept as-is, so a face set can print the
  // artwork's own colours instead of treating it as a stencil.
  const pixels = ctx.getImageData(0, 0, size, size);

  const maskCanvas = scratchFor(size);
  const maskCtx = maskCanvas.getContext("2d")!;
  const mask = maskCtx.createImageData(size, size);

  for (let i = 0; i < pixels.data.length; i += 4) {
    const alpha = coverage(
      pixels.data[i],
      pixels.data[i + 1],
      pixels.data[i + 2],
      pixels.data[i + 3],
      mode,
    );
    // White everywhere, with all the shape information in the alpha channel —
    // which is what lets a single source-in fill tint it any colour.
    mask.data[i] = 255;
    mask.data[i + 1] = 255;
    mask.data[i + 2] = 255;
    mask.data[i + 3] = alpha;
  }
  maskCtx.putImageData(mask, 0, 0);

  return { color: canvas, mask: maskCanvas };
}

export function loadStencil(
  src: string,
  size: number,
  padding: number,
  mode: StencilMode,
): Promise<Artwork> {
  const key = `${src}|${size}|${padding}|${mode}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = rasterise(src, size, padding, mode);
    cache.set(key, entry);
  }
  return entry;
}

/**
 * A face's artwork: either one URL, or several candidates tried in order.
 *
 * Candidates are what let a face accept more than one file type. Nothing can
 * list a directory from the browser, so the alternatives have to be named up
 * front and probed.
 */
export type FaceSource = string | readonly string[];

/**
 * File types a face will accept, tried in this order.
 *
 * Lives here rather than with the face sets so that both the deck and the face
 * sets can reach it without importing each other — that pair formed a cycle,
 * and a cycle in module initialisation fails at load with a name that is
 * merely "not defined yet".
 */
export const FACE_EXTENSIONS = ["svg", "png", "webp"] as const;

/** Which candidate actually exists, per face. */
const chosen = new Map<string, string>();

function candidateKey(source: FaceSource): string {
  return typeof source === "string" ? source : source.join("|");
}

/**
 * Picks the first candidate that exists.
 *
 * HEAD rather than attempting to load each one: a failed image load prints an
 * error to the console, and probing two extensions per face would fill it with
 * noise on every start. A 404 from fetch is an ordinary response.
 */
async function resolveSource(source: FaceSource): Promise<string | undefined> {
  if (typeof source === "string") return source;

  for (const url of source) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return url;
    } catch {
      // Network error — try the next candidate.
    }
  }
  return undefined;
}

/** Ready artwork, so the synchronous atlas paint can use it without awaiting. */
const resolved = new Map<string, Artwork>();

export function artworkFor(
  source: FaceSource,
  size: number,
  padding: number,
  mode: StencilMode,
): Artwork | undefined {
  const src = chosen.get(candidateKey(source));
  if (!src) return undefined;
  return resolved.get(`${src}|${size}|${padding}|${mode}`);
}

export async function preloadStencils(
  sources: readonly (FaceSource | undefined)[],
  size: number,
  padding: number,
  mode: StencilMode,
): Promise<void> {
  await Promise.all(
    sources
      .filter((s): s is FaceSource => !!s)
      .map(async (source) => {
        try {
          const src = await resolveSource(source);
          if (!src) return;

          const artwork = await loadStencil(src, size, padding, mode);
          chosen.set(candidateKey(source), src);
          resolved.set(`${src}|${size}|${padding}|${mode}`, artwork);
        } catch {
          // A missing or malformed asset falls back to the numeral rather than
          // taking the whole die down with it.
        }
      }),
  );
}

/** The file a face ended up using, once resolved — for the UI to show. */
export function resolvedSource(source: FaceSource): string | undefined {
  return chosen.get(candidateKey(source));
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Draws a mask into `ctx`, tinted with whatever fill the caller has set.
 *
 * The face-set contract is that `draw` never sets its own fillStyle, because
 * the atlas sets a different one per channel. `ctx.fillStyle` is readable, so
 * the tint is taken from the caller and applied to the mask through a scratch
 * canvas with `source-in` — the fill lands only where the mask has coverage.
 */
export function drawStencil(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  size: number,
): void {
  if (!scratch || scratch.width !== size) {
    scratch = scratchFor(size);
  }

  const sctx = scratch.getContext("2d")!;
  sctx.clearRect(0, 0, size, size);
  sctx.globalCompositeOperation = "source-over";
  sctx.drawImage(mask, 0, 0, size, size);

  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = ctx.fillStyle;
  sctx.fillRect(0, 0, size, size);
  sctx.globalCompositeOperation = "source-over";

  ctx.drawImage(scratch, 0, 0);
}

/**
 * Draws artwork with its own colours, unmodified.
 *
 * The counterpart to drawStencil: used where the artwork *is* the mark rather
 * than a shape to be filled, so a colour illustration prints as itself instead
 * of collapsing to a single-colour silhouette.
 */
export function drawArtwork(
  ctx: CanvasRenderingContext2D,
  color: HTMLCanvasElement,
  size: number,
): void {
  ctx.drawImage(color, 0, 0, size, size);
}
