/**
 * Confirms the felt still runs off every side of the frame.
 *
 * The surface has no edge — that is the whole premise of the room — and it used
 * to hold that by being sixty world units across on every viewport, which is
 * true and costs 80,000 triangles to say. It is now built to what the camera
 * can actually see, which is between one and two orders of magnitude smaller
 * and is only correct if the arithmetic is right. So the arithmetic is checked
 * here, on every shape a browser window can be, rather than trusted.
 *
 * Two claims:
 *
 *  1. The cloth covers the whole visible floor, at every viewport shape. If it
 *     does not, its edge is in shot, and a table with a visible edge is the one
 *     thing this scene must never show.
 *  2. The tessellation is never coarser than the folds need. The mesh got much
 *     smaller; the density it is built at must not have moved with it, or the
 *     creases start to facet.
 *
 * It imports lib/scene/felt.ts — the same module the mesh is built from — for
 * the reason every other check in this directory does: a check that
 * reimplements the thing it is checking proves nothing.
 *
 * Run with `npm run verify:floor`.
 */
import { computeTrayBounds, visibleFloor } from "../lib/scene/bounds";
import { FOLD_RESOLUTION, MAX_SEGMENTS, feltExtent } from "../lib/scene/felt";

const shapes: [string, number, number][] = [
  ["ultrawide 2560×1080", 2560, 1080],
  ["desktop 1920×1080", 1920, 1080],
  ["laptop 1440×716", 1440, 716],
  ["square 900×900", 900, 900],
  ["tablet portrait 768×1024", 768, 1024],
  ["phone 390×844", 390, 844],
  ["phone small 320×568", 320, 568],
  // Beyond anything a phone or a monitor is, because a browser window is not
  // obliged to be either.
  ["extreme wide 3840×720", 3840, 720],
  ["extreme tall 400×1600", 400, 1600],
];

/** What the floor used to cost, for the comparison the change exists to make. */
const WAS_TRIANGLES = 200 * 200 * 2;

let failures = 0;
let worstCoverX = Infinity;
let worstCoverZ = Infinity;
let heaviest = 0;

for (const [label, w, h] of shapes) {
  const aspect = w / h;
  const bounds = computeTrayBounds(aspect);
  const midZ = (bounds.zMax + bounds.zMin) / 2;

  const { halfX, halfZ, segX, segZ } = feltExtent(midZ, aspect);
  const quad = visibleFloor(aspect);

  // What the camera can see of the floor, measured from the mesh's own centre —
  // the same frame the extent above is in.
  const seenX = Math.max(quad.halfXNear, quad.halfXFar);
  const seenZ = Math.max(Math.abs(quad.zNear - midZ), Math.abs(quad.zFar - midZ));

  // How far past the last visible pixel the cloth reaches. Above 1 is covered.
  const coverX = halfX / seenX;
  const coverZ = halfZ / seenZ;
  worstCoverX = Math.min(worstCoverX, coverX);
  worstCoverZ = Math.min(worstCoverZ, coverZ);

  const covers = coverX >= 1 && coverZ >= 1;

  // The density that carries a fold, in world units per quad. Ceil() on the
  // segment count can only ever make a quad smaller than asked for, so this is
  // a floor rather than an equality — except where MAX_SEGMENTS binds, which is
  // the one case where the cloth is deliberately allowed to go coarse.
  const quadX = (halfX * 2) / segX;
  const quadZ = (halfZ * 2) / segZ;
  const capped = segX >= MAX_SEGMENTS || segZ >= MAX_SEGMENTS;
  const dense = capped || (quadX <= FOLD_RESOLUTION && quadZ <= FOLD_RESOLUTION);

  const triangles = segX * segZ * 2;
  heaviest = Math.max(heaviest, triangles);

  const ok = covers && dense;
  if (!ok) failures++;

  const notes = [
    covers ? "" : "cloth edge in shot",
    dense ? "" : "tessellation coarser than the folds need",
    capped ? "segment cap reached" : "",
  ]
    .filter(Boolean)
    .join(", ");

  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(24)} ` +
      `half ${halfX.toFixed(2)}×${halfZ.toFixed(2)}  ` +
      `seg ${String(segX).padStart(3)}×${String(segZ).padStart(3)}  ` +
      `tris ${String(triangles).padStart(6)}  ` +
      `cover ${coverX.toFixed(2)}/${coverZ.toFixed(2)}  ` +
      `quad ${Math.max(quadX, quadZ).toFixed(3)}${notes ? "  — " + notes : ""}`,
  );
}

// The shapes above are landmarks, not a proof. The felt is solved from a
// continuous quantity, so it is swept continuously.
let sweepFailures = 0;
let sweepWorst = Infinity;
let sweepWorstAspect = 0;

for (let aspect = 0.2; aspect <= 6; aspect += 0.002) {
  const bounds = computeTrayBounds(aspect);
  const midZ = (bounds.zMax + bounds.zMin) / 2;
  const { halfX, halfZ } = feltExtent(midZ, aspect);
  const quad = visibleFloor(aspect);

  const cover = Math.min(
    halfX / Math.max(quad.halfXNear, quad.halfXFar),
    halfZ / Math.max(Math.abs(quad.zNear - midZ), Math.abs(quad.zFar - midZ)),
  );

  if (cover < sweepWorst) {
    sweepWorst = cover;
    sweepWorstAspect = aspect;
  }
  if (cover < 1) sweepFailures++;
}

if (sweepFailures > 0) failures++;

console.log(
  `\n${sweepFailures === 0 ? "ok  " : "FAIL"}  aspect sweep 0.20..6.00 — ` +
    `thinnest cover ${sweepWorst.toFixed(2)}× at aspect ${sweepWorstAspect.toFixed(2)}` +
    (sweepFailures ? `, ${sweepFailures} shapes uncovered` : ""),
);

console.log(
  `\nheaviest floor ${heaviest.toLocaleString()} triangles, ` +
    `against ${WAS_TRIANGLES.toLocaleString()} before ` +
    `(${(WAS_TRIANGLES / heaviest).toFixed(1)}× lighter at the worst viewport).`,
);

console.log(
  failures === 0
    ? "\nThe felt runs off the frame at every viewport shape.\n"
    : `\n${failures} check(s) failed — the cloth's edge can be seen.\n`,
);
process.exit(failures === 0 ? 0 : 1);
