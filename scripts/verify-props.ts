/**
 * Confirms the scenery never gets in the die's way.
 *
 * This project removed its props three times, each time because something in
 * frame ended up competing with the die. They are back, and the thing that has
 * changed is not taste — it is that their positions are now *solved* from the
 * play area and the visible floor rather than authored, so "out of the way" is
 * a property that can be measured instead of eyeballed on whichever window
 * happened to be open.
 *
 * Two failures are possible and they are quite different:
 *
 *   1. A prop stands where the die can reach it. The die has no collider for
 *      any of this, so it would roll straight through a candle.
 *   2. A prop stands *between the camera and the die*. It can be nowhere near
 *      the play area in world space and still cross in front of it on screen,
 *      because the camera looks down at a steep angle. This is the one that is
 *      genuinely hard to see coming, and it is why the check projects.
 *
 * It imports the same placeProps() the scene calls and the same sceneCamera()
 * the scene is framed with, so it cannot drift away from what ships.
 *
 * Run with `npm run verify:props`.
 */
import * as THREE from "three";
import {
  computeTrayBounds,
  sceneCamera,
  visibleFloor,
  SPAWN_HEIGHT,
} from "../lib/scene/bounds";
import { DIE_INRADIUS, DIE_RADIUS } from "../lib/dice/types";
import {
  clearsPlayArea,
  placeProps,
  PETAL_LENGTH,
  type SceneProps,
} from "../lib/scene/props";
import { FLAME_HEIGHT } from "../lib/scene/candle";
import { foldAt, FOLD_AMPLITUDE, FOLD_RAMP } from "../lib/scene/folds";

const shapes: [string, number, number][] = [
  ["ultrawide 2560×1080", 2560, 1080],
  ["desktop 1920×1080", 1920, 1080],
  ["laptop 1440×716", 1440, 716],
  ["square 900×900", 900, 900],
  ["tablet portrait 768×1024", 768, 1024],
  ["phone 390×844", 390, 844],
  ["phone small 320×568", 320, 568],
];

/** Below this the sampler is quietly failing rather than adapting. */
const MIN_PETALS = 18;

/**
 * How much of the frame's width the middle is.
 *
 * Nothing standing up may project into it. Deliberately generous — the die
 * occupies far less than this, but the space around it is what makes it read as
 * the subject, and a candle just outside its silhouette still crowds it.
 */
const CENTRE_BAND = 0.55;

/** A flame this close to the edge of the frame is being cropped. */
const FLAME_EDGE = 0.97;

interface Failure {
  shape: string;
  note: string;
}

const failures: Failure[] = [];

/**
 * The volume the die is framed in.
 *
 * The same box `verify:bounds` builds: the die's centre is confined to the play
 * area inset by its inradius, and the solid reaches a circumradius beyond that.
 * The top of the throw is excluded on purpose — bounds.ts explicitly does not
 * frame the die at the peak of its arc, so including SPAWN_HEIGHT here would
 * inflate the box until it swallowed the whole screen and every prop would
 * "occlude" it.
 */
function dieVolume(bounds: ReturnType<typeof computeTrayBounds>): THREE.Box3 {
  const reachX = Math.max(0, bounds.halfX - DIE_INRADIUS) + DIE_RADIUS;
  const zLow = bounds.zMin + DIE_INRADIUS - DIE_RADIUS;
  const zHigh = bounds.zMax - DIE_INRADIUS + DIE_RADIUS;

  return new THREE.Box3(
    new THREE.Vector3(-reachX, 0, Math.min(zLow, zHigh)),
    new THREE.Vector3(reachX, DIE_RADIUS * 2, Math.max(zLow, zHigh)),
  );
}

/**
 * Whether any part of the die's volume sits behind this point from the camera.
 *
 * The direction matters and is easy to get backwards: a prop *in front of* the
 * die on screen is the failure. A prop the die passes in front of is fine and
 * happens constantly — most of the far-band petals are in exactly that
 * position.
 */
function occludes(
  point: THREE.Vector3,
  camera: THREE.Camera,
  volume: THREE.Box3,
): boolean {
  const eye = camera.position;
  const direction = point.clone().sub(eye);
  const distance = direction.length();
  direction.normalize();

  const hit = new THREE.Ray(eye, direction).intersectBox(
    volume,
    new THREE.Vector3(),
  );
  if (!hit) return false;

  // The ray reaches the die's box before it reaches the prop: the die is in
  // front, which is what should happen.
  return hit.distanceTo(eye) > distance;
}

for (const [label, w, h] of shapes) {
  const aspect = w / h;
  const bounds = computeTrayBounds(aspect);
  const floor = visibleFloor(aspect);
  const camera = sceneCamera(aspect);
  const props: SceneProps = placeProps(bounds, floor, camera);
  const volume = dieVolume(bounds);

  const note = (text: string) => failures.push({ shape: label, note: text });

  // --- 0. The cloth the die rolls on is flat --------------------------------
  //
  // The floor is folded now, and folds are geometry the die has no collider
  // for — it would sink into a crest and float over a trough. What makes that
  // safe is that the amplitude ramps to exactly zero across the play area, and
  // "exactly" is the kind of claim worth measuring rather than trusting: the
  // ramp is a smoothstep, and a smoothstep is zero at zero but *near* zero for
  // a good way after it. Sampled densely, including hard against the walls.
  let worstFold = 0;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = -bounds.halfX + (2 * bounds.halfX * i) / N;
      const z = bounds.zMin + ((bounds.zMax - bounds.zMin) * j) / N;
      worstFold = Math.max(Math.abs(foldAt(x, z, bounds)), worstFold);
    }
  }
  if (worstFold > 1e-9) {
    note(`floor is not flat where the die rolls (${worstFold.toFixed(4)})`);
  }

  // And it does have to actually fold somewhere, or the whole exercise is a
  // plane with extra vertices.
  const away = foldAt(bounds.halfX + FOLD_RAMP * 2, bounds.zMax, bounds);
  if (Math.abs(away) < FOLD_AMPLITUDE * 0.05) {
    note("cloth never rumples outside the play area");
  }

  // --- 1. Nothing stands where the die can reach ----------------------------

  const petalReach = (PETAL_LENGTH / 2) * 1.3;
  const petalIntrusions = props.petals.filter(
    (petal) =>
      !clearsPlayArea(petal.position[0], petal.position[2], bounds, petalReach),
  ).length;
  if (petalIntrusions > 0) {
    note(`${petalIntrusions} petal(s) inside the die's reach`);
  }

  const candleIntrusions = props.candles.filter(
    (candle) =>
      !clearsPlayArea(candle.position[0], candle.position[2], bounds, candle.radius),
  ).length;
  if (candleIntrusions > 0) {
    note(`${candleIntrusions} candle(s) inside the die's reach`);
  }

  // --- 2. Nothing crosses in front of the die ------------------------------

  let occluders = 0;
  for (const petal of props.petals) {
    if (occludes(new THREE.Vector3(...petal.position), camera, volume)) {
      occluders++;
    }
  }
  for (const candle of props.candles) {
    const [x, , z] = candle.position;
    // The top of the flame is the highest point and therefore the one most
    // likely to hang over the play area on screen.
    const top = candle.wick + candle.radius * FLAME_HEIGHT;
    for (const y of [0, candle.height, top]) {
      if (occludes(new THREE.Vector3(x, y, z), camera, volume)) occluders++;
    }
  }
  if (occluders > 0) note(`${occluders} prop point(s) in front of the die`);

  // --- 3. The candles are at the edges, and their flames are in shot -------

  const project = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).project(camera);

  let worstBand = 0;
  let worstEdge = 0;
  for (const candle of props.candles) {
    const [x, , z] = candle.position;
    const flame = project(x, candle.wick + candle.radius * FLAME_HEIGHT * 0.5, z);

    worstBand = Math.max(worstBand, 1 - Math.abs(flame.x));
    worstEdge = Math.max(worstEdge, Math.abs(flame.x), Math.abs(flame.y));

    if (Math.abs(flame.x) < CENTRE_BAND) {
      note(`a candle sits in the middle of the frame (ndc x ${flame.x.toFixed(2)})`);
    }
    if (Math.abs(flame.x) > FLAME_EDGE || Math.abs(flame.y) > FLAME_EDGE) {
      note(
        `a flame is cropped by the frame ` +
          `(ndc ${flame.x.toFixed(2)}, ${flame.y.toFixed(2)})`,
      );
    }
  }

  // --- 4. Nothing pokes above the die's world ------------------------------

  const tallest = Math.max(
    ...props.candles.map((c) => c.wick + c.radius * FLAME_HEIGHT),
  );
  if (tallest > SPAWN_HEIGHT) {
    note(`a candle stands ${tallest.toFixed(2)} high, above the throw`);
  }

  // --- 5. The sampler filled the frame -------------------------------------

  if (props.petals.length < MIN_PETALS) {
    note(`only ${props.petals.length} petals placed`);
  }

  // --- 6. The arrangement is the same every time ---------------------------

  const again = placeProps(bounds, floor, sceneCamera(aspect));
  const stable =
    JSON.stringify(again.petals) === JSON.stringify(props.petals) &&
    JSON.stringify(again.candles) === JSON.stringify(props.candles);
  if (!stable) note("placement is not deterministic");

  const mine = failures.filter((f) => f.shape === label);
  const ok = mine.length === 0;

  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(24)} ` +
      `petals ${String(props.petals.length).padStart(2)}  ` +
      `flame edge ${worstEdge.toFixed(2)}  ` +
      `clear of centre by ${worstBand.toFixed(2)}` +
      (ok ? "" : `\n      — ${mine.map((f) => f.note).join("\n      — ")}`),
  );
}

console.log(
  `\nProps must clear the die's reach, stay behind it on screen, keep their ` +
    `flames\ninside the frame and outside its middle ${CENTRE_BAND} band.`,
);
console.log(
  failures.length === 0
    ? "The scenery is out of the way on every viewport.\n"
    : `${failures.length} problem(s) across ${
        new Set(failures.map((f) => f.shape)).size
      } viewport shape(s).\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
