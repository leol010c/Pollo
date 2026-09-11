/**
 * Confirms the tray walls always sit inside the camera's view.
 *
 * The die escaping the frame is a geometry problem, not something you can spot
 * reliably by rolling a few times — it depends on the window's aspect ratio and
 * on which corner the die happens to reach. This projects the resulting play
 * area back through the real projection matrix and asserts the die lands inside
 * the viewport, across the whole range of shapes a browser window can be.
 *
 * It imports the same computeTrayBounds() the scene uses, so the check cannot
 * drift away from the behaviour it is checking.
 *
 * Run with `npm run verify:bounds`.
 */
import * as THREE from "three";
import { computeTrayBounds, sceneCamera } from "../lib/scene/bounds";
import { DIE_RADIUS } from "../lib/dice/types";

const shapes: [string, number, number][] = [
  ["ultrawide 2560×1080", 2560, 1080],
  ["desktop 1920×1080", 1920, 1080],
  ["laptop 1440×716", 1440, 716],
  ["square 900×900", 900, 900],
  ["tablet portrait 768×1024", 768, 1024],
  ["phone 390×844", 390, 844],
  ["phone small 320×568", 320, 568],
];

let failures = 0;

for (const [label, w, h] of shapes) {
  const aspect = w / h;
  const { halfX, zMin, zMax } = computeTrayBounds(aspect);
  const camera = sceneCamera(aspect);

  // Worst case: the die pressed into a corner of the play area. Its centre can
  // only reach an inradius short of each wall — the wall stops its face — and
  // from there the solid extends a circumradius in any direction.
  const inradius = DIE_RADIUS / Math.sqrt(3);
  const centreX = Math.max(0, halfX - inradius);
  const centreZNear = zMax - inradius;
  const centreZFar = zMin + inradius;

  let worstX = 0;
  let worstY = 0;

  for (const cx of [-centreX, centreX]) {
    for (const cz of [centreZFar, centreZNear]) {
      for (const cy of [DIE_RADIUS * 0.6, DIE_RADIUS * 0.6 + 0.28]) {
        // Sample the bounding sphere's extremes, not just the centre.
        for (const [ox, oy, oz] of [
          [-DIE_RADIUS, 0, 0],
          [DIE_RADIUS, 0, 0],
          [0, -DIE_RADIUS, 0],
          [0, DIE_RADIUS, 0],
          [0, 0, -DIE_RADIUS],
          [0, 0, DIE_RADIUS],
        ]) {
          const ndc = new THREE.Vector3(cx + ox, cy + oy, cz + oz).project(
            camera,
          );
          worstX = Math.max(worstX, Math.abs(ndc.x));
          worstY = Math.max(worstY, Math.abs(ndc.y));
        }
      }
    }
  }

  const onScreen = worstX <= 1.001 && worstY <= 1.001;

  // The die's resting place has to be inside its own play area, or it spawns
  // outside the walls and gets shoved somewhere arbitrary on the first frame.
  const { home } = computeTrayBounds(aspect);
  const homeInside =
    Math.abs(home[0]) <= halfX + 1e-6 &&
    home[2] >= zMin - 1e-6 &&
    home[2] <= zMax + 1e-6;

  // A play area narrower than the die itself means it cannot move at all.
  const usable = halfX >= DIE_RADIUS * 0.5 && zMax - zMin >= DIE_RADIUS;

  const ok = onScreen && homeInside && usable;
  if (!ok) failures++;

  const notes = [
    onScreen ? "" : "off-screen",
    homeInside ? "" : "home outside play area",
    usable ? "" : "play area too small to roll",
  ]
    .filter(Boolean)
    .join(", ");

  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(24)} ` +
      `halfX ${halfX.toFixed(2)}  z ${zMin.toFixed(2)}..${zMax.toFixed(2)}  ` +
      `home z ${home[2].toFixed(2)}  ` +
      `ndc ${worstX.toFixed(2)}/${worstY.toFixed(2)}${notes ? "  — " + notes : ""}`,
  );
}

console.log(
  failures === 0
    ? "\nThe die stays on screen at every viewport shape.\n"
    : `\n${failures} viewport shape(s) let the die leave the frame.\n`,
);
process.exit(failures === 0 ? 0 : 1);
