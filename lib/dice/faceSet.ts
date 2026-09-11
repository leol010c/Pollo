/**
 * What gets drawn on each face, and what that surface is physically made of.
 *
 * This is the seam for custom symbols. A face set draws a mark silhouette into
 * a square cell; the atlas bakes that silhouette into both a colour map and a
 * packed roughness/metalness map, so a mark is a genuinely different material
 * from the die body rather than a decal painted on it.
 *
 * Swapping numerals for artwork means writing one new FaceSet. Nothing in the
 * geometry, physics, or value detection changes, because a face's *value* stays
 * a number regardless of what's printed on it.
 *
 * Note: `draw` must not set its own fillStyle — the atlas sets it before each
 * call so the same silhouette can be rendered into different channels.
 */
export { FACE_EXTENSIONS } from "./stencil";

import {
  artworkFor,
  drawArtwork,
  drawStencil,
  preloadStencils,
  resolvedSource,
  type FaceSource,
  type StencilMode,
} from "./stencil";
import { dealtTo, loadDeck } from "./deck";
import { initialOf, isOwn } from "./own";

/** Fraction of each cell kept clear around a position's artwork. */
export const DECK_PADDING = 0.14;

/** Which of the two atlas maps is being painted. */
export type AtlasChannel = "color" | "material";

export interface Surface {
  color: string;
  /** 0 = mirror, 1 = fully diffuse. */
  roughness: number;
  /** 0 = dielectric (resin, stone, plastic), 1 = metal. */
  metalness: number;
}

export interface FaceSet {
  /** Stable id — used as the texture cache key. */
  id: string;
  /** The die body. */
  body: Surface;
  /** The mark printed on each face. */
  mark: Surface;
  /**
   * Draws the mark for `value`, centred in a `size`×`size` cell.
   *
   * Called once per atlas channel. Most marks ignore `channel` and simply use
   * the fill the atlas has set, which lands them correctly in both. A mark that
   * prints its own colours needs to know the difference: those colours belong
   * on the colour map, while the material map still needs a plain fill over the
   * same footprint.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    value: number,
    size: number,
    channel: AtlasChannel,
  ): void;

  /**
   * True when marks carry their own colours rather than being tinted. The UI
   * reads this to decide whether to show the artwork directly or as a mask.
   */
  rendersColor?: boolean;

  /**
   * Loads any external artwork at the atlas's cell size.
   *
   * The atlas calls this before painting and repaints when it resolves, so a
   * slow asset never blocks the scene — a face just briefly shows its numeral
   * fallback. Passing the cell size in explicitly means artwork is rasterised
   * once, at exactly the size it will be drawn.
   */
  prepare?(cellSize: number): Promise<void>;

  /**
   * Artwork URL for a face, so the UI can show the same mark the die does.
   * Undefined for faces drawn in code.
   */
  sourceFor?(value: number): string | undefined;

  /** Human-readable name for a face, for the accessible announcement. */
  labelFor?(value: number): string | undefined;

  /** How intense the face's position is, 1–3. See Intensity in ./deck.ts. */
  intensityFor?(value: number): 1 | 2 | 3 | undefined;

  /** A wild face changes the rules instead of naming a position. */
  isWild?(value: number): boolean;

  /** One line saying what a wild face means. */
  hintFor?(value: number): string | undefined;

  /**
   * What is on this face, as one comparable string.
   *
   * The atlas decides whether to repaint by comparing what the faces say, and
   * for most face sets the artwork URL answers that on its own. It stops being
   * enough once two different faces can both have no artwork: a hand-written
   * position and another hand-written position are not the same mark, but they
   * are the same *absence* of a file, and a die that compared only the files
   * would keep showing the first one's monogram after the deal swapped it for
   * the second. A face set that can do that supplies this instead. See hand().
   */
  tokenFor?(value: number): string;
}

/** 6 and 9 are indistinguishable on a die that can land in any orientation. */
function needsUnderline(value: number) {
  return value === 6 || value === 9;
}

function drawNumeral(
  ctx: CanvasRenderingContext2D,
  value: number,
  size: number,
) {
  const label = String(value);
  const fontSize = size * (label.length > 1 ? 0.46 : 0.58);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.font = `600 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);

  if (needsUnderline(value)) {
    const w = fontSize * 0.44;
    const y = fontSize * 0.44;
    ctx.fillRect(-w / 2, y, w, Math.max(3, fontSize * 0.05));
  }

  ctx.restore();
}

/**
 * The wild mark: a four-pointed sparkle.
 *
 * Drawn in code rather than loaded, because a wild has no artwork file and
 * never will — it isn't a position. Four points with pulled-in waists read as
 * "special" at the size a die face gives you, where a question mark reads as an
 * error and a star reads as a rating.
 *
 * It uses whatever fill the atlas has set, like every other mark, so it lands
 * correctly in the colour and the material channel without knowing which is
 * which.
 */
function drawWild(ctx: CanvasRenderingContext2D, size: number) {
  const sparkle = (cx: number, cy: number, reach: number) => {
    const waist = reach * 0.24;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = (i * Math.PI) / 2;
      const x = cx + Math.cos(a) * reach;
      const y = cy + Math.sin(a) * reach;
      if (i === 0) {
        ctx.moveTo(x, y);
        continue;
      }
      // Control point between the two points but close to the centre, which is
      // what gives each arm its concave sweep.
      const mid = a - Math.PI / 4;
      ctx.quadraticCurveTo(
        cx + Math.cos(mid) * waist,
        cy + Math.sin(mid) * waist,
        x,
        y,
      );
    }
    ctx.closePath();
    ctx.fill();
  };

  // A large mark with a small companion — one sparkle alone sits dead centre
  // and reads as a symbol, two read as a flourish.
  sparkle(size * 0.46, size * 0.53, size * 0.3);
  sparkle(size * 0.71, size * 0.29, size * 0.12);
}

/**
 * The mark for a position somebody wrote themselves: its initial, in a ring.
 *
 * A hand-written position has no artwork and is never going to get any, so the
 * face has to say something in code — the same problem the wild solves, with a
 * different answer because the answer has to differ *per entry*. The letter is
 * what distinguishes one from another at a glance, and the ring is what keeps a
 * bare letter from reading as a numeral on a die covered in drawings.
 *
 * Falls back to the ring alone when the name yields nothing printable, which is
 * still a mark and still unmistakably one of yours.
 */
function drawMonogram(
  ctx: CanvasRenderingContext2D,
  name: string,
  size: number,
) {
  const letter = initialOf(name);

  ctx.save();
  ctx.translate(size / 2, size / 2);

  // Stroked with the caller's fill rather than strokeStyle: the face-set
  // contract is that draw() never picks its own colour, and the atlas has set
  // exactly one of them.
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(3, size * 0.028);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  if (letter) {
    // The display face, matching the name printed under the reveal. Falls back
    // through a serif stack rather than to sans, so a face that has not loaded
    // yet still looks like the same decision.
    ctx.font = `italic 600 ${size * 0.34}px var(--font-display), Cormorant Garamond, ui-serif, Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Optical centring: a cap sits high in its em box, and "middle" baselines
    // it rather than the glyph, which leaves it visibly above the ring's centre.
    ctx.fillText(letter, 0, size * 0.02);
  }

  ctx.restore();
}

/** Polished resin body with metallic marks — the house style. */
function resin(id: string, bodyColor: string, markColor: string): FaceSet {
  return {
    id,
    body: { color: bodyColor, roughness: 0.28, metalness: 0 },
    // Metal marks flare as the die tumbles through the light instead of
    // sitting flat, which is most of what separates this from a printed decal.
    mark: { color: markColor, roughness: 0.34, metalness: 1 },
    draw: drawNumeral,
  };
}

const BRASS = "#f0bd5e";
const CREAM = "#f6efe0";

// Bright, saturated bodies. Against a near-black floor these carry the frame,
// where a dark body leaves the die reading as a silhouette.
export const jade = resin("jade", "#2fa383", BRASS);
export const sapphire = resin("sapphire", "#3f78d0", CREAM);
export const crimson = resin("crimson", "#c8404f", CREAM);
export const amethyst = resin("amethyst", "#8a5cc4", CREAM);
export const pearl = resin("pearl", "#e2e6ee", BRASS);

/**
 * Warm bone with charcoal marks — the classic casino die.
 *
 * Deliberately off-white rather than pure white: a true #fff body has no
 * headroom left for a specular highlight, so it flattens out under the studio
 * panels and stops reading as a solid object.
 */
export const ivory: FaceSet = {
  id: "ivory",
  body: { color: "#f2ece0", roughness: 0.3, metalness: 0 },
  mark: { color: "#17140f", roughness: 0.5, metalness: 0 },
  draw: drawNumeral,
};

/** Cooler, greyer off-white — porcelain rather than bone. */
export const bone: FaceSet = {
  id: "bone",
  body: { color: "#eceef0", roughness: 0.26, metalness: 0 },
  mark: { color: "#191b1f", roughness: 0.45, metalness: 0 },
  draw: drawNumeral,
};

/** Cream body, brass numerals — warmest of the three, ties to the app accent. */
export const creamBrass: FaceSet = {
  id: "cream-brass",
  body: { color: "#f0e8d6", roughness: 0.3, metalness: 0 },
  mark: { color: "#8a6a22", roughness: 0.35, metalness: 1 },
  draw: drawNumeral,
};

/** Near-black dielectric with brass numerals. */
export const obsidian = resin("obsidian", "#0f1013", BRASS);

// ---------------------------------------------------------------------------
// Artwork faces
// ---------------------------------------------------------------------------

export interface ImageFaceSetConfig {
  id: string;
  body: Surface;
  mark: Surface;
  /**
   * Artwork URL per face, indexed by value: `sources[0]` is face 1.
   *
   * Gaps are allowed. Any face without a source draws its numeral instead, so
   * a set can be filled in one symbol at a time rather than needing every face
   * before anything can be seen.
   */
  sources: readonly (FaceSource | undefined)[];
  /** Optional face names, same indexing, used for screen-reader output. */
  labels?: readonly (string | undefined)[];
  /** Fraction of the cell kept clear on each side. */
  padding?: number;
  /** See StencilMode — `ink` suits black line art, including white-filled. */
  stencil?: StencilMode;
  /**
   * How the artwork is treated.
   *
   * `stencil` reduces it to a silhouette and fills it with `mark`, so one file
   * works on any die colour and the mark can be metal. Right for single-colour
   * symbols; wrong for a colour illustration, which collapses to a flat
   * silhouette — or, under the `ink` measure, to a washed-out luminance map.
   *
   * `image` prints the artwork's own colours. The mark's surface still applies
   * to the material map, so the artwork reads as printed onto the face rather
   * than floating over it.
   */
  colorMode?: "stencil" | "image";
}

/**
 * A face set backed by artwork files.
 *
 * The artwork is reduced to a stencil rather than blitted, so a mark stays a
 * material — brass, charcoal, engraved — instead of becoming a flat printed
 * decal, and one file works on any die colour.
 */
export function imageFaceSet(config: ImageFaceSetConfig): FaceSet {
  const {
    id,
    body,
    mark,
    sources,
    labels,
    padding = 0.14,
    colorMode = "stencil",
    // Printed artwork masks by its own outline; measuring ink would eat every
    // light-coloured region of the illustration.
    stencil = colorMode === "image" ? "alpha" : "ink",
  } = config;

  const candidatesFor = (value: number) => sources[value - 1];

  return {
    id,
    body,
    mark,

    // The UI wants the file that actually loaded, not the list of candidates.
    // Undefined until `prepare` has resolved, which is fine — the readout only
    // appears after a roll, long past that point.
    sourceFor: (value) => {
      const candidates = candidatesFor(value);
      return candidates ? resolvedSource(candidates) : undefined;
    },

    labelFor: (value) => labels?.[value - 1],
    rendersColor: colorMode === "image",

    prepare: (cellSize) => preloadStencils(sources, cellSize, padding, stencil),

    draw(ctx, value, size, channel) {
      const candidates = candidatesFor(value);
      const artwork = candidates
        ? artworkFor(candidates, size, padding, stencil)
        : undefined;

      // No artwork for this face, or it hasn't loaded yet — the numeral stands
      // in until `prepare` resolves and the atlas repaints, so a face is never
      // blank and a missing file degrades instead of breaking.
      if (!artwork) {
        drawNumeral(ctx, value, size);
        return;
      }

      // The colour map takes the illustration itself; the material map still
      // gets a flat fill over the same footprint, so the artwork behaves like
      // ink printed onto the face rather than a separate floating surface.
      if (colorMode === "image" && channel === "color") {
        drawArtwork(ctx, artwork.color, size);
        return;
      }

      drawStencil(ctx, artwork.mask, size);
    },
  };
}

/**
 * The positions face set, backed by the deck.
 *
 * Unlike a fixed set, what each face shows changes between throws: the deck
 * deals six of its entries onto the faces each time. So `draw` asks the deck
 * what is currently on this face rather than holding its own list.
 *
 * Names live in lib/dice/deck.ts — that is the file to edit to rename a
 * position or add a new one.
 */
export const symbols: FaceSet = {
  id: "symbols",
  // Warm bone with a touch of rose, so the die belongs to the palette around it
  // rather than reading as a borrowed object.
  body: { color: "#f5ebe4", roughness: 0.32, metalness: 0 },
  // Printed artwork, so this only sets how the ink sits on the face — matte and
  // non-metallic, like something actually printed rather than inlaid.
  mark: { color: "#241a18", roughness: 0.55, metalness: 0 },
  rendersColor: true,

  prepare: (cellSize) => loadDeck(cellSize, DECK_PADDING),

  sourceFor: (value) => {
    const entry = dealtTo(value);
    return entry ? resolvedSource(entry.source) : undefined;
  },

  labelFor: (value) => dealtTo(value)?.name,
  intensityFor: (value) => dealtTo(value)?.intensity,
  isWild: (value) => dealtTo(value)?.kind === "wild",
  hintFor: (value) => dealtTo(value)?.hint,

  tokenFor: (value) => {
    const entry = dealtTo(value);
    if (!entry) return "#";

    // The id alone is not enough. What a monogram paints is derived from the
    // *name*, so renaming a position changes the face while leaving the id
    // exactly where it was — and the repaint would be skipped. The glyph goes
    // in the token because the glyph is what is drawn.
    if (isOwn(entry.id)) {
      return `${entry.id}:${initialOf(entry.name ?? "")}`;
    }

    // Everything else is described by its artwork, and by whether that artwork
    // has resolved yet — a slow file landing is precisely when a repaint is
    // wanted, so the resolved url is the right half to key on.
    return resolvedSource(entry.source) ?? (entry.kind === "wild" ? "*" : "#");
  },

  draw(ctx, value, size, channel) {
    const entry = dealtTo(value);

    // A wild has no file to draw, by definition.
    if (entry?.kind === "wild") {
      drawWild(ctx, size);
      return;
    }

    // Neither does a position somebody wrote themselves — but unlike a wild it
    // has a name, so it gets a mark of its own rather than a shared one.
    if (entry && isOwn(entry.id)) {
      drawMonogram(ctx, entry.name ?? "", size);
      return;
    }

    const artwork = entry
      ? artworkFor(entry.source, size, DECK_PADDING, "alpha")
      : undefined;

    // Nothing dealt to this face yet, or its file is missing — the numeral
    // stands in rather than leaving the face blank.
    if (!artwork) {
      drawNumeral(ctx, value, size);
      return;
    }

    if (channel === "color") {
      drawArtwork(ctx, artwork.color, size);
      return;
    }

    drawStencil(ctx, artwork.mask, size);
  },
};

/**
 * Pips rather than numerals — a working reference for the custom-symbol work.
 * Everything but `draw` is shared, which is the point: a new mark shape is the
 * only thing a new face set has to supply.
 */
export const ivoryPips: FaceSet = {
  ...ivory,
  id: "ivory-pips",

  draw(ctx, value, size) {
    // Pip positions on a 3×3 grid, in cell-relative coordinates.
    const g = [0.27, 0.5, 0.73];
    const layouts: Record<number, [number, number][]> = {
      1: [[1, 1]],
      2: [
        [0, 0],
        [2, 2],
      ],
      3: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      4: [
        [0, 0],
        [2, 0],
        [0, 2],
        [2, 2],
      ],
      5: [
        [0, 0],
        [2, 0],
        [1, 1],
        [0, 2],
        [2, 2],
      ],
      6: [
        [0, 0],
        [2, 0],
        [0, 1],
        [2, 1],
        [0, 2],
        [2, 2],
      ],
    };

    const radius = size * 0.072;
    for (const [cx, cy] of layouts[value] ?? []) {
      ctx.beginPath();
      ctx.arc(g[cx] * size, g[cy] * size, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/**
 * Change this one line to restyle the die.
 *
 * Artwork:    symbols
 * Off-white:  ivory | bone | creamBrass | pearl
 * Coloured:   jade | sapphire | crimson | amethyst | obsidian
 * Pips:       ivoryPips
 */
export const defaultFaceSet = symbols;

/**
 * What the die wears in discreet mode.
 *
 * `ivory` rather than `ivoryPips`: pips are the more convincing dice-shop object
 * but the layout table only covers 1–6, so a d10 would come up blank on four of
 * its faces. Numerals are correct on every solid, which is the only requirement
 * a disguise has — it has to be right everywhere, not charming somewhere.
 */
export const discreetFaceSet = ivory;
