/**
 * Confirms the felt is still the colour it was authored to be.
 *
 * This is the check that would have caught the bug it was written after, and it
 * is worth stating that bug plainly because it survived three attempts to fix
 * it: the velvet was authored as a garnet and rendered as brown, and every
 * attempt moved the garnet a few degrees or dimmed the lights, because everyone
 * assumed a surface's colour is its albedo.
 *
 * It isn't. A light multiplies the surface it lands on, so the lit colour is the
 * product of the two — and the key light had `decay: 0`, which means it reached
 * every square inch of the floor at full strength. It was `#ffbe86`, an amber
 * carrying about a quarter as much blue as red. The felt kept roughly a quarter
 * of the blue it had, and a dark red with no blue in it is brown. The albedo was
 * barely participating in what you saw.
 *
 * So the rule this enforces is about the *lights*, not the surface:
 *
 *   A light with `decay: 0` reaches the whole floor, so it must be near
 *   neutral. A light with `decay: 2` is local, so it may be as orange as a
 *   flame.
 *
 * Everything here is measured in linear space via THREE.Color, which is the
 * same conversion the renderer does rather than a reimplementation of it, and
 * everything is a chromaticity ratio — so it says nothing about exposure or
 * tone mapping and won't need rewriting if either is revisited.
 *
 * Run with `npm run verify:hue`.
 */
import * as THREE from "three";
import { BACKDROPS, type Backdrop } from "../lib/scene/backdrops";
// Shared with verify:themes, which measures the same rooms with the same
// arithmetic. See scripts/light.ts.
import { hueDegrees, hueGap, incidence, linear } from "./light";

/**
 * Minimum blue and green the *dominant* light may carry, relative to its red.
 *
 * Only the dominant one, and that restraint is deliberate. The obvious rule —
 * every light with no falloff must be near neutral — is too blunt, and applying
 * it here failed the rose rim, which is one of the better things in the frame.
 * A rim is dim and rakes across the floor at a grazing angle, so it contributes
 * a few percent of the light the floor receives; being saturated is its entire
 * job, since a warm lit side against a rose shadow side is what makes candlelit
 * photographs look candlelit.
 *
 * What cannot be saturated is whichever light is actually bathing the floor.
 * That one's hue effectively becomes the floor's hue, which is what happened.
 * The amber that caused all this scored 0.24 and 0.51, and it was the key.
 */
const MIN_BLUE_RATIO = 0.55;
const MIN_GREEN_RATIO = 0.7;

/** How far the lit felt's hue may drift from its albedo, in degrees. */
const MAX_HUE_DRIFT = 8;

/**
 * How much of the felt's own blue-to-red ratio must survive being lit.
 *
 * The single most diagnostic number here. The old scene scored 0.26: three
 * quarters of the surface's blue was being removed by its own key light, which
 * is what "brown" turned out to mean.
 */
const MIN_BLUE_RETENTION = 0.65;

let failures = 0;

const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${line}`);
};

// --- What the floor is actually bathed in ------------------------------------

interface Contributor {
  name: string;
  hex: string;
  /** Light reaching the floor: intensity attenuated by the angle it arrives at. */
  weight: number;
}

/**
 * Every backdrop, not only the one the app opens in.
 *
 * `plain` — the discreet room — was added long after this check was written, and
 * it is a green cloth under a near-white lamp: the exact shape of mistake this
 * file exists to catch, with a different albedo. A second room that nothing
 * measures is a second room that quietly goes brown.
 */
function checkBackdrop(backdrop: Backdrop) {
  const { spot, key, rim, ambient, ambientColor } = backdrop;

  console.log(`\n${backdrop.id}`);

  const contributors: Contributor[] = [];

  if (spot) {
    contributors.push({
      name: "spot (key)",
      hex: spot.color,
      weight: spot.intensity * incidence(spot.position),
    });
  }
  if (key) {
    contributors.push({
      name: "key",
      hex: key.color,
      weight: key.intensity * incidence(key.position),
    });
  }
  if (rim) {
    contributors.push({
      name: "rim",
      hex: rim.color,
      weight: rim.intensity * incidence(rim.position),
    });
  }
  // Ambient arrives from everywhere, so there is no angle to attenuate it by.
  if (ambientColor) {
    contributors.push({ name: "ambient", hex: ambientColor, weight: ambient });
  }

  if (contributors.length === 0) {
    report(false, `${backdrop.id} has no lights at all`);
    return;
  }

  const total = contributors.reduce((sum, c) => sum + c.weight, 0);

  for (const c of contributors) {
    const linearColor = linear(c.hex);
    console.log(
      `      ${c.name.padEnd(12)} ${c.hex}  ` +
        `${((c.weight / total) * 100).toFixed(0)}% of the light on the floor  ` +
        `B/R ${(linearColor.b / linearColor.r).toFixed(2)}`,
    );
  }

  // --- The dominant light must be near neutral -------------------------------

  const dominant = contributors.reduce((a, b) => (b.weight > a.weight ? b : a));
  const dominantColor = linear(dominant.hex);
  const blue = dominantColor.b / dominantColor.r;
  const green = dominantColor.g / dominantColor.r;

  report(
    blue >= MIN_BLUE_RATIO && green >= MIN_GREEN_RATIO,
    `dominant      ${dominant.name} ${dominant.hex}  ` +
      `B/R ${blue.toFixed(2)} (min ${MIN_BLUE_RATIO})  ` +
      `G/R ${green.toFixed(2)} (min ${MIN_GREEN_RATIO})`,
  );

  // --- The felt survives being lit ------------------------------------------

  const albedo = linear(backdrop.floor.color);

  /**
   * The colour of the light the floor sits in, then the floor under it.
   *
   * Weighted by how much of each light actually arrives, then multiplied by the
   * albedo — which is what the shader does. Nothing here models where on the
   * floor any of it lands; the question is what colour the surface comes out,
   * and that is a property of the mixture rather than of the layout.
   */
  const bath = new THREE.Color(0, 0, 0);
  for (const c of contributors) {
    bath.add(linear(c.hex).multiplyScalar(c.weight));
  }

  const lit = new THREE.Color(
    albedo.r * bath.r,
    albedo.g * bath.g,
    albedo.b * bath.b,
  );

  const drift = hueGap(hueDegrees(albedo), hueDegrees(lit));
  report(
    drift <= MAX_HUE_DRIFT,
    `felt hue      ${backdrop.floor.color} ` +
      `${hueDegrees(albedo).toFixed(0)}° → ${hueDegrees(lit).toFixed(0)}° ` +
      `(drift ${drift.toFixed(1)}°, max ${MAX_HUE_DRIFT}°)`,
  );

  /*
   * Blue-to-red retention, except on a floor that is mostly green.
   *
   * The measure was written for a wine-red velvet, where blue is the channel a
   * warm light steals and the one whose loss reads as brown. On the baize the
   * scarce channel is red — its blue-to-red ratio is above 1 — so the same
   * arithmetic is measuring the wrong thing entirely, and the hue drift above
   * already covers what this was protecting.
   */
  if (albedo.b < albedo.r) {
    const retention = lit.b / lit.r / (albedo.b / albedo.r);
    report(
      retention >= MIN_BLUE_RETENTION,
      `felt blue     keeps ${(retention * 100).toFixed(0)}% of its blue-to-red ` +
        `(min ${(MIN_BLUE_RETENTION * 100).toFixed(0)}%)`,
    );
  }

  // --- The flames are allowed to be as warm as they like --------------------

  if (backdrop.flame) {
    const c = linear(backdrop.flame.color);
    console.log(
      `ok    flame        ${backdrop.flame.color}  ` +
        `B/R ${(c.b / c.r).toFixed(2)}  — exempt, decay 2`,
    );
  }
}

for (const backdrop of BACKDROPS) checkBackdrop(backdrop);

console.log(
  `\nLights with no falloff colour the entire floor, so they must stay near\n` +
    `neutral. The warmth belongs in the flames, which fall off.`,
);
console.log(
  failures === 0
    ? "The felt keeps its own colour under its own lights.\n"
    : `${failures} check(s) failed — the frame will drift toward the key's hue.\n`,
);
process.exit(failures === 0 ? 0 : 1);
