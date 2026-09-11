/**
 * Static checks on face artwork. Run with `npm run verify:faces`.
 *
 * Canvas isn't available in Node, so the stencil itself can't be rasterised
 * here. What can be checked cheaply are the failure modes that otherwise stay
 * invisible until something renders wrong on a die face — a path that doesn't
 * resolve, art authored as strokes with no fill (which produces almost no ink
 * and so an almost empty face), or a solid silhouette that will read as a blob.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIE_SIDES } from "../lib/dice/types";
import { DECK_SLOTS, POSITIONS } from "../lib/dice/deck";
import {
  defaultFaceSet,
  FACE_EXTENSIONS,
  symbols,
  type FaceSet,
} from "../lib/dice/faceSet";

const PUBLIC_DIR = join(process.cwd(), "public");
/** The atlas cell size marks are rasterised into, and the fraction of it kept
 *  clear on each side — together these give the pixels a mark actually gets. */
const CELL = 512;
const PADDING = 0.14;

let failures = 0;
let warnings = 0;

function fail(msg: string) {
  failures++;
  console.log(`  FAIL  ${msg}`);
}
function warn(msg: string) {
  warnings++;
  console.log(`  warn  ${msg}`);
}
function ok(msg: string) {
  console.log(`  ok    ${msg}`);
}

/** Reads an SVG's viewBox, which is what determines its aspect ratio. */
function svgAspect(source: string): number | null {
  const viewBox = source.match(/viewBox\s*=\s*["']([^"']+)["']/);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return parts[2] / parts[3];
    }
  }
  const w = source.match(/\bwidth\s*=\s*["']([\d.]+)/);
  const h = source.match(/\bheight\s*=\s*["']([\d.]+)/);
  if (w && h && Number(h[1]) > 0) return Number(w[1]) / Number(h[1]);
  return null;
}

/** PNG dimensions and colour type, straight out of the IHDR chunk. */
function pngHeader(buf: Buffer): { w: number; h: number; hasAlpha: boolean } | null {
  if (buf.length < 26 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colourType = buf[25];
  // 4 = grey+alpha, 6 = truecolour+alpha.
  return { w, h, hasAlpha: colourType === 4 || colourType === 6 };
}

function checkSvg(rel: string, source: string) {
  if (!/<svg[\s>]/i.test(source)) {
    fail(`${rel} — not an SVG`);
    return;
  }

  const aspect = svgAspect(source);
  if (aspect === null) {
    warn(`${rel} — no viewBox or intrinsic size; aspect ratio is a guess`);
  } else if (aspect > 4 || aspect < 0.25) {
    // Artwork is letterboxed into a square cell, so an extreme aspect leaves
    // the mark tiny along its short axis.
    warn(`${rel} — aspect ${aspect.toFixed(2)}:1 is very elongated for a square face`);
  }

  // A stroked outline with fill:none has essentially no ink, so the stencil
  // comes out empty and the face renders blank.
  const hasFill = /fill\s*[:=]\s*["']?(?!none)[^;"'\s>]+/i.test(source);
  const strokeOnly = /stroke\s*[:=]/i.test(source) && !hasFill;
  if (strokeOnly) {
    fail(`${rel} — stroked but unfilled; convert strokes to paths or it renders blank`);
    return;
  }

  // Explicit white fills sit inside enclosed areas of traced line art. The
  // "ink" stencil drops them, which is usually right, but flag it so a
  // deliberately white mark isn't silently lost.
  if (/fill\s*[:=]\s*["']?(#fff(fff)?\b|white)/i.test(source)) {
    warn(`${rel} — contains white fills; "ink" stencil will drop them (use stencil: "alpha" to keep)`);
  }

  ok(`${rel} — svg${aspect ? `, aspect ${aspect.toFixed(2)}:1` : ""}`);
}

function checkRaster(rel: string, buf: Buffer) {
  const header = pngHeader(buf);
  if (!header) {
    warn(`${rel} — not a PNG; can't inspect dimensions or alpha`);
    return;
  }

  if (!header.hasAlpha) {
    fail(`${rel} — no alpha channel; the face will show an opaque box`);
    return;
  }

  // Artwork is letterboxed into the cell with padding, so the pixels it
  // actually gets are smaller than the cell itself.
  const drawn = Math.round(CELL * (1 - PADDING * 2));
  const smallest = Math.min(header.w, header.h);
  const upscale = drawn / smallest;

  if (upscale > 2.5) {
    warn(
      `${rel} — ${header.w}×${header.h} upscales ${upscale.toFixed(1)}× to fill ${drawn}px and will look soft; ${drawn}px+ or SVG is sharper`,
    );
  } else if (upscale > 1.05) {
    // A stencil upscales more gracefully than colour art — all the detail is in
    // one alpha edge — so mild enlargement is worth noting, not warning about.
    ok(
      `${rel} — png ${header.w}×${header.h}, alpha (upscales ${upscale.toFixed(1)}× to ${drawn}px)`,
    );
    return;
  }

  ok(`${rel} — png ${header.w}×${header.h}, alpha`);
}

function checkFaceSet(name: string, faceSet: FaceSet) {
  console.log(`\n${name} (${faceSet.id})`);

  if (!faceSet.sourceFor) {
    ok("draws every face in code — no assets to check");
    return;
  }

  const sides = DIE_SIDES.d6;
  let withArt = 0;

  // At runtime a face probes its candidate extensions and takes the first that
  // exists. This mirrors that here rather than calling sourceFor, which only
  // knows the answer after the browser has resolved it.
  for (let value = 1; value <= sides; value++) {
    const found = FACE_EXTENSIONS.map((ext) => `/dice/image-${value}.${ext}`)
      .filter((url) => existsSync(join(PUBLIC_DIR, url)));

    if (found.length === 0) continue;
    withArt++;

    if (found.length > 1) {
      warn(
        `face ${value} — ${found.length} files match (${found.join(", ")}); ${found[0]} wins, the rest are ignored`,
      );
    }

    const src = found[0];
    const buf = readFileSync(join(PUBLIC_DIR, src));

    if (src.toLowerCase().endsWith(".svg")) {
      checkSvg(`face ${value}: ${src}`, buf.toString("utf8"));
    } else {
      checkRaster(`face ${value}: ${src}`, buf);
    }
  }

  if (withArt === 0) {
    warn("no faces have artwork — every face falls back to its numeral");
  } else if (withArt < sides) {
    ok(`${withArt}/${sides} faces have artwork; the rest fall back to numerals`);
  } else {
    ok(`all ${sides} faces have artwork`);
  }
}

/*
 * Every picture in the deck is named, and says what it is.
 *
 * An unnamed picture still works — it deals, it lands, it fills a face — and the
 * only sign of the omission is a reveal with a blank space where the title goes.
 * Nothing throws, nothing logs, and the picture looks entirely correct. So it
 * has to be checked here or it is found by seeing it.
 *
 * The description is the same failure one line lower: the reveal simply renders
 * nothing under the name, which looks exactly like a position that was never
 * meant to have a line. Both are the cost of the deck being discovered from the
 * files rather than declared — a picture can join it without anybody having
 * written anything about it.
 */
function checkDeckNames() {
  console.log("\ndeck names");

  const present: string[] = [];
  for (let slot = 1; slot <= DECK_SLOTS; slot++) {
    const id = `image-${slot}`;
    const found = FACE_EXTENSIONS.some((ext) =>
      existsSync(join(PUBLIC_DIR, "dice", `${id}.${ext}`)),
    );
    if (found) present.push(id);
  }

  if (present.length === 0) {
    warn("no deck artwork found in public/dice");
    return;
  }

  const unnamed = present.filter((id) => !POSITIONS[id]?.name);
  if (unnamed.length > 0) {
    fail(
      `artwork with no name in POSITIONS (lib/dice/deck.ts): ${unnamed.join(", ")}`,
    );
  } else {
    ok(`all ${present.length} pictures are named`);
  }

  const undescribed = present.filter((id) => !POSITIONS[id]?.description);
  if (undescribed.length > 0) {
    fail(
      `artwork with no description in POSITIONS (lib/dice/deck.ts): ${undescribed.join(", ")}`,
    );
  } else {
    ok(`all ${present.length} pictures say what they are`);
  }

  const noIntensity = present.filter((id) => !POSITIONS[id]?.intensity);
  if (noIntensity.length > 0) {
    warn(`no intensity set: ${noIntensity.join(", ")}`);
  }

  // A name declared for a file that isn't there is the other direction of the
  // same mistake, and it means the deck is smaller than it looks.
  const orphaned = Object.keys(POSITIONS).filter((id) => !present.includes(id));
  if (orphaned.length > 0) {
    warn(`named in POSITIONS but no file found: ${orphaned.join(", ")}`);
  }
}

checkDeckNames();

checkFaceSet("symbols", symbols);
if (defaultFaceSet.id !== symbols.id) {
  checkFaceSet("defaultFaceSet", defaultFaceSet);
} else {
  console.log(`\ndefaultFaceSet is "${symbols.id}" — checked above.`);
}

console.log(
  failures === 0
    ? `\nFace artwork is usable${warnings ? ` (${warnings} warning${warnings > 1 ? "s" : ""})` : ""}.\n`
    : `\n${failures} problem(s) with face artwork.\n`,
);
process.exit(failures === 0 ? 0 : 1);
