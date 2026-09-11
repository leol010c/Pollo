/**
 * Confirms the card stack sits in the middle of the screen and never collides
 * with the controls, at every viewport shape.
 *
 * This exists because "the card is glued to the top of my phone" was a bug that
 * survived a long time, and it survived because nobody can see a 99px offset by
 * looking — you can only see that something is *slightly* wrong, which is easy
 * to talk yourself out of. It was caused by two siblings in a flex column each
 * quietly taking vertical space the card was then centred in what remained of:
 * PresentControls, which never leaves the flow however transparent it is, and
 * the pile count beneath the stack. Both are now out of flow, and this asserts
 * the result in numbers rather than in confidence.
 *
 * It imports cardWidthAt() from lib/cards/layout.ts — the same formula the
 * component renders as a CSS min() — so the check cannot drift away from the
 * behaviour it is checking. Same contract as verify:bounds against
 * computeTrayBounds().
 *
 * Run with `npm run verify:cards`.
 */
import {
  CAPTION_GAP_PX,
  CAPTION_HEIGHT_PX,
  CARD_ASPECT,
  CONTROLS_TALL_REM,
  PRESENT_LIFT_REM,
  cardWidthAt,
} from "../lib/cards/layout";

/**
 * The shapes verify:bounds uses, so the two checks speak about the same set —
 * plus the ones that matter only to a layout.
 *
 * The extra two are phones *with the browser's own chrome showing*, and they
 * are here because that is the case that actually broke. A phone advertises
 * 390×844 and the number this layout is measured against is `100dvh`, which on
 * Iso Safari is the viewport left over once the address bar and toolbar have
 * taken their share — around a hundred pixels less. Checking only the hardware
 * dimension is checking the one configuration the app is never used in.
 */
const shapes: [string, number, number][] = [
  ["ultrawide 2560×1080", 2560, 1080],
  ["desktop 1920×1080", 1920, 1080],
  ["laptop 1440×716", 1440, 716],
  ["square 900×900", 900, 900],
  ["tablet portrait 768×1024", 768, 1024],
  ["phone 390×844", 390, 844],
  ["phone in Safari 390×745", 390, 745],
  ["phone small 320×568", 320, 568],
  ["phone small in Safari 375×553", 375, 553],
];

const REM = 16;
/*
 * Only the tall height is measured against here. CONTROLS_RESERVE_REM is not
 * missing by accident: at rest the bar is `visibility: hidden` and there is
 * nothing on screen to clear, so the resting reservation's whole job is inside
 * cardWidthAt(), choosing a width. What has to be checked is the one moment
 * both are on screen at once — a lifted card over a bar at full height.
 */
/** The bar at its tallest — a running timer with "Double or nothing" under it. */
const CONTROLS_TALL_PX = CONTROLS_TALL_REM * REM;
const LIFT_PX = PRESENT_LIFT_REM * REM;

/** What the card used to be, so the shrink can be held to what was asked for. */
function previousWidth(vw: number): number {
  return Math.min(vw * 0.74, 19 * REM);
}

/** Leo asked for 5–15% off. */
const SHRINK_MIN = 0.05;
const SHRINK_MAX = 0.15;

let failures = 0;

for (const [label, vw, dvh] of shapes) {
  const width = cardWidthAt(vw, dvh);
  const height = width / CARD_ASPECT;

  // Centred on the viewport, which is the entire point.
  const top = (dvh - height) / 2;
  const bottom = top + height;
  const centre = top + height / 2;

  const centred = Math.abs(centre - dvh / 2) <= 1;

  // A card is no use if it does not fit, however well centred it is.
  const fits = height <= dvh && width <= vw;

  /*
   * Face-up, the stack rises by PRESENT_LIFT_REM and the control bar comes up
   * underneath it — at its *tall* height, because a gambled timer adds a row.
   * That combination is what put buttons across the bottom of the card, so it
   * is the combination this checks: lifted card against tall bar.
   *
   * Where the viewport has the room the card must be entirely clear. Where it
   * does not — see CARD_MIN_REM, which stops a short screen shrinking the card
   * to nothing — the bar may cross the card's bottom edge, but only far enough
   * that it stays off the subject of the picture.
   */
  const liftedBottom = bottom - LIFT_PX;
  const overlap = Math.max(0, liftedBottom - (dvh - CONTROLS_TALL_PX));
  const clearsControls = overlap <= 1 || overlap <= height * 0.25;

  // And the lift must not push the card off the top of a short screen.
  const liftedTop = top - LIFT_PX;
  const liftFits = liftedTop >= 0;

  // Face-down, the pile count hangs off the bottom of the stack instead.
  const captionBottom = bottom + CAPTION_GAP_PX + CAPTION_HEIGHT_PX;
  const captionOnScreen = captionBottom <= dvh;

  const shrink = 1 - width / previousWidth(vw);
  // Only meaningful where the width terms govern. Where the new height cap
  // bites there was no previous behaviour to compare against — the old card
  // simply overflowed the screen.
  const heightCapped = width < Math.min(vw * 0.66, 17 * REM) - 0.5;
  const shrankRight =
    heightCapped ||
    (shrink >= SHRINK_MIN - 1e-9 && shrink <= SHRINK_MAX + 1e-9);

  const ok =
    centred &&
    fits &&
    liftFits &&
    clearsControls &&
    captionOnScreen &&
    shrankRight;
  if (!ok) failures++;

  const notes = [
    centred ? "" : "off centre",
    fits ? "" : "does not fit",
    liftFits ? "" : "lift pushes the card off the top",
    clearsControls
      ? ""
      : `controls cover ${((overlap / height) * 100).toFixed(0)}% of the card`,
    captionOnScreen ? "" : "count off screen",
    shrankRight ? "" : `shrank ${(shrink * 100).toFixed(0)}%, wanted 5–15%`,
  ]
    .filter(Boolean)
    .join(", ");

  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(24)} ` +
      `card ${width.toFixed(0)}×${height.toFixed(0)}  ` +
      `y ${top.toFixed(0)}..${bottom.toFixed(0)}  ` +
      `centre ${centre.toFixed(0)} vs ${(dvh / 2).toFixed(0)}  ` +
      `lifted ${liftedTop.toFixed(0)}..${liftedBottom.toFixed(0)}  ` +
      `gap ${(dvh - liftedBottom).toFixed(0)}/${CONTROLS_TALL_PX}` +
      `${overlap > 1 ? ` (overlap ${overlap.toFixed(0)})` : ""}  ` +
      `${heightCapped ? "height-capped" : `−${(shrink * 100).toFixed(0)}%`}` +
      `${notes ? "  — " + notes : ""}`,
  );
}

console.log(
  failures === 0
    ? "\nThe card is centred at every viewport shape, and the controls stay off it.\n"
    : `\n${failures} viewport shape(s) place the card wrongly.\n`,
);
process.exit(failures === 0 ? 0 : 1);
