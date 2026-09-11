/**
 * Confirms the spotlight actually pools on the play area.
 *
 * This check exists because the failure it catches was invisible in both the
 * code and the picture. The `candlelit` backdrop is built entirely around one
 * warm pool falling away into dark, and it says so at length — but its cone was
 * authored as a fixed `angle: 0.66`, which lands about five world units across
 * while the play area reaches barely one and a half. Only the innermost quarter
 * of the cone was ever on screen: its brightest, flattest part. The felt was
 * lit dead flat, the corners were being darkened by an unrelated CSS overlay,
 * and nothing anywhere threw or logged.
 *
 * Two things have to hold at once, and they pull against each other:
 *
 *   1. The whole play area is inside the cone, so the die can never be thrown
 *      into a part of the table that isn't lit.
 *   2. The play area's corner is far enough out in the cone that the falloff is
 *      visible in frame rather than off-screen.
 *
 * With `penumbra: 1` three attenuates smoothly from the cone's centre to its
 * edge, so (2) is the one that matters for whether a pool reads as a pool. It
 * is expressed as the corner's distance from the aim point over the cone's
 * radius there: 1.0 is exactly on the cone's edge. The shipped scene measured
 * 0.44 to 0.67 depending on viewport — worst on a square window, and never
 * close to far enough out for the falloff to be in shot. Across the frame's
 * width alone it was nearer 0.27.
 *
 * ## What this actually measures, now that the spot is `pooled`
 *
 * Worth being honest about, because the number below looks like a measurement
 * and is not one. Once `pooled` is on, the angle is derived as
 * `atan(reach * POOL_SPREAD / distance)` and the ratio divides by
 * `distance * tan(angle)` — the same distance, and the same reach. They cancel,
 * and the ratio is identically `1 / POOL_SPREAD` on every viewport, from every
 * light position, forever.
 *
 * That does not make the check worthless, but it does change what it is for. It
 * guards three things: that `pooled` is still on (turning it off reintroduces
 * the hardcoded angle, and the ratio immediately stops being constant and
 * fails), that POOL_SPREAD stays in the band where the falloff lands on screen,
 * and that the light has not been moved somewhere that makes the cone
 * degenerate. It does not independently verify the geometry — `poolAngle` does
 * that by construction, which is the whole reason it exists.
 *
 * It imports the same poolAngle() the scene uses, so the check cannot drift
 * away from the behaviour it is checking.
 *
 * Run with `npm run verify:pool`.
 */
import {
  computeTrayBounds,
  poolCornerRatio,
  POOL_SPREAD,
} from "../lib/scene/bounds";
import { BACKDROPS, spotAngle, type Backdrop } from "../lib/scene/backdrops";

const shapes: [string, number, number][] = [
  ["ultrawide 2560×1080", 2560, 1080],
  ["desktop 1920×1080", 1920, 1080],
  ["laptop 1440×716", 1440, 716],
  ["square 900×900", 900, 900],
  ["tablet portrait 768×1024", 768, 1024],
  ["phone 390×844", 390, 844],
  ["phone small 320×568", 320, 568],
];

/**
 * How far out in the cone the play area's corner must sit.
 *
 * Below this the falloff is happening mostly outside the frame and the surface
 * reads flat, which is the bug. Comfortably under 1.0 so there is room for the
 * die's own radius without the corner spilling past the cone's edge.
 */
const MIN_CORNER_RATIO = 0.8;

let failures = 0;

/**
 * Every backdrop, not only the one the app opens in.
 *
 * The discreet room is the same room with the lights changed, and its spot is
 * authored by copying this one's geometry — which is exactly the arrangement
 * that drifts. If someone moves one lamp and not the other, this is where it
 * shows up rather than in a screenshot nobody took.
 */
function checkBackdrop(backdrop: Backdrop) {
  console.log(`\n${backdrop.id}`);

  const spot = backdrop.spot;

  if (!spot) {
    // Not a silent skip. A treatment with no cone has no pool, and this check
    // passing vacuously would be the same class of failure it was written for.
    failures++;
    console.log(
      `FAIL  ${backdrop.id} has no spot — there is no pool to verify.`,
    );
    return;
  }

  for (const [label, w, h] of shapes) {
    const aspect = w / h;
    const bounds = computeTrayBounds(aspect);
    const aimZ = bounds.home[2];

    // Whatever the scene will actually render with, including the `pooled`
    // decision — so turning that off, or reverting to a hardcoded angle, fails
    // here rather than only looking wrong.
    const angle = spotAngle(spot, bounds, aimZ);
    const ratio = poolCornerRatio(spot.position, bounds, aimZ, angle);

    // Every corner of the play area is lit. The ratio is built from the furthest
    // corner, so this is the single comparison that covers all four.
    const covered = ratio <= 1;
    // ...and the falloff is on screen rather than past the edge of it.
    const pooled = ratio >= MIN_CORNER_RATIO;
    // A cone approaching a hemisphere is no longer a cone; it would mean the
    // light has been placed so low that the pool can't be solved from it.
    const sane = angle > 0 && angle < 1.4;

    const ok = covered && pooled && sane;
    if (!ok) failures++;

    const notes = [
      covered ? "" : "play area spills outside the cone",
      pooled ? "" : "falloff is off-screen — the felt reads flat",
      sane ? "" : "cone angle is degenerate",
    ]
      .filter(Boolean)
      .join(", ");

    console.log(
      `${ok ? "ok  " : "FAIL"}  ${label.padEnd(24)} ` +
        `angle ${angle.toFixed(3)}rad  corner ${ratio.toFixed(2)}` +
        `${notes ? "  — " + notes : ""}`,
    );
  }
}

for (const backdrop of BACKDROPS) checkBackdrop(backdrop);

console.log(
  `\nPOOL_SPREAD ${POOL_SPREAD}, corner must land in ` +
    `${MIN_CORNER_RATIO}..1.00 of the cone radius.`,
);
console.log(
  failures === 0
    ? "The pool covers the play area and falls off inside the frame.\n"
    : `${failures} viewport shape(s) do not pool correctly.\n`,
);
process.exit(failures === 0 ? 0 : 1);
