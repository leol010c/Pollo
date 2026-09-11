/**
 * The rooms are real rooms, and each one is still the room it was authored as.
 *
 * `verify:hue` and `verify:pool` already iterate `BACKDROPS`, so a new room is
 * held to the lighting rules and the cone geometry the moment it is added. What
 * neither of them can see is the set itself: whether the picker is offering
 * something the app can actually resolve, whether a room was made by copying
 * another one and half-editing it, and whether the handful of rules that live in
 * prose at the top of backdrops.ts are still true of every entry.
 *
 * That gap is new. With one room and a disguise it did not exist — you could
 * hold both in your head. With four in a picker and a fifth behind a toggle, the
 * likely failure is no longer "this room looks wrong"; it is "this room is
 * subtly the previous room", and that is not something a screenshot catches
 * either, because each screenshot looks fine on its own.
 *
 * Run with `npm run verify:themes`.
 */
import {
  BACKDROPS,
  defaultBackdrop,
  plain,
  THEMES,
  themeById,
  type Backdrop,
} from "../lib/scene/backdrops";
import { PETAL_TINT } from "../lib/scene/petals";
import { hueDegrees, hueGap, incidence, lightness, linear } from "./light";

let failures = 0;

const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${line}`);
};

/**
 * The lamp every room shares.
 *
 * Not a constant of its own: it is read off the default room, because the thing
 * being asserted is that the others were not re-aimed away from it. Writing the
 * numbers out here would make this check agree with itself rather than with the
 * scene.
 */
const REFERENCE_SPOT = defaultBackdrop.spot;

if (!REFERENCE_SPOT) {
  console.log(
    "FAIL  the default room has no spot to measure the others against",
  );
  process.exit(1);
}

// --- The set the picker is offered ------------------------------------------

console.log("the set");

report(
  THEMES.length >= 2,
  `${THEMES.length} rooms offered — a picker with one option is not a picker`,
);

const ids = THEMES.map((room) => room.id);
report(
  new Set(ids).size === ids.length && ids.every(Boolean),
  `ids unique and non-empty — ${ids.join(", ")}`,
);

const labels = THEMES.map((room) => room.label);
report(
  new Set(labels).size === labels.length && labels.every(Boolean),
  `labels unique and non-empty — ${labels.join(", ")}`,
);

/*
 * The picker's lookup is the same lookup the scene uses, so a room that cannot
 * be found by its own id is a room that can be selected and never appears. It
 * would look exactly like the tap doing nothing.
 */
report(
  THEMES.every((room) => themeById(room.id) === room),
  "every room resolves from its own id",
);

// An id arrives from localStorage and may name a room that no longer ships.
report(
  themeById("a-room-that-was-deleted") === defaultBackdrop &&
    themeById(null) === defaultBackdrop,
  "an unknown or missing id falls back to the default room",
);

report(
  THEMES.includes(defaultBackdrop),
  `the default room (${defaultBackdrop.id}) is one of the offered ones`,
);

/*
 * The disguise is not a taste and must not be in the row.
 *
 * Offering it beside four aesthetics would advertise the one feature that works
 * by not being noticed — and it would let someone select it as a look, which
 * would then be silently overridden by the toggle that owns it.
 */
report(!THEMES.includes(plain), "the disguise is not offered as a choice");

report(
  BACKDROPS.length === THEMES.length + 1 &&
    THEMES.every((room) => BACKDROPS.includes(room)) &&
    BACKDROPS.includes(plain),
  "every room that ships is in BACKDROPS, so verify:hue and verify:pool see it",
);

// --- Each room is its own room ----------------------------------------------

const floors = BACKDROPS.map((room) => room.floor.color.toLowerCase());
report(
  new Set(floors).size === floors.length,
  `no two rooms share a floor colour — ${floors.join(", ")}`,
);

const backgrounds = BACKDROPS.map((room) => room.background.toLowerCase());
report(
  new Set(backgrounds).size === backgrounds.length,
  "no two rooms share a clear colour",
);

// --- Per room ----------------------------------------------------------------

function checkRoom(room: Backdrop) {
  console.log(`\n${room.id}`);

  const spot = room.spot;
  if (!spot) {
    report(false, "no spot — verify:pool has no cone to solve");
    return;
  }

  /*
   * The cone is solved from the play area, not authored. A room may recolour the
   * light; it may not move the lamp, because the solve and the shadow camera are
   * both written against this pose. `verify:pool` would catch a cone that stopped
   * covering the floor, but not one that was moved somewhere that still happens
   * to cover it — and "still happens to" is how the two rooms drifted apart the
   * first time.
   */
  report(spot.pooled === true, "the cone is solved from the play area");
  report(
    spot.position.every((n, i) => n === REFERENCE_SPOT!.position[i]),
    `the lamp is where every room's lamp is — [${spot.position.join(", ")}]`,
  );

  /*
   * Petals stay lighter than the floor.
   *
   * Darkening them so they sat *into* the cloth was tried on the original room
   * and rejected: the contrast against the floor is what makes them read as
   * roses rather than as marks on it. A recoloured room inherits that rule, and
   * this is the check that makes inheriting it mean something.
   */
  if (room.petals !== false) {
    const tint = room.petal ?? PETAL_TINT;
    const petal = lightness(linear(tint.color));
    const floor = lightness(linear(room.floor.color));
    report(
      petal > floor,
      `petals lighter than the floor — ${petal.toFixed(3)} over ${floor.toFixed(3)}`,
    );
  }

  /*
   * Fog toward a value *above* the clear colour.
   *
   * Fogging toward the background only re-darkens what is already dark; fogging
   * toward a lifted value reads as air catching the light, and keeps the far
   * field a colour rather than a void. Copying a room and forgetting the fog is
   * the single easiest way to lose that, and it is invisible on a phone where
   * very little far field is in frame.
   */
  if (room.fog) {
    const fog = lightness(linear(room.fog.color));
    const background = lightness(linear(room.background));
    report(
      fog > background,
      `fog sits above the clear colour — ${fog.toFixed(4)} over ${background.toFixed(4)}`,
    );
  }
}

for (const room of BACKDROPS) checkRoom(room);

// --- The two hues, reported rather than enforced ------------------------------

/**
 * Warm or cool, by how much blue a light carries relative to its red.
 *
 * The band in the middle is deliberately wide: the spot in every room is near
 * white by law, and calling a near-white light "warm" because it is a percent
 * off neutral would make every room pass on a technicality.
 */
function temperature(hex: string): "warm" | "cool" | "neutral" {
  const c = linear(hex);
  const ratio = c.b / c.r;
  if (ratio < 0.75) return "warm";
  if (ratio > 1.3) return "cool";
  return "neutral";
}

console.log(
  "\n\nthe two hues — reported, not enforced\n" +
    "\n" +
    "  A frame carrying one low-saturation hue family everywhere is the grammar\n" +
    "  of a sepia photograph, and this project shipped exactly that once. A warm\n" +
    "  lit side against a cool shadow side is what makes an image read as\n" +
    "  photographed rather than filtered.\n" +
    "\n" +
    "  This is printed rather than failed on because the default room does not\n" +
    "  currently satisfy it, and changing the default room is not a thing a check\n" +
    "  script gets to decide. Read the split below; a room with nothing in one\n" +
    "  column is a room worth looking at.\n",
);

for (const room of BACKDROPS) {
  const parts: [string, string][] = [];
  if (room.spot) parts.push(["spot", room.spot.color]);
  if (room.key) parts.push(["key", room.key.color]);
  if (room.rim) parts.push(["rim", room.rim.color]);
  if (room.ambientColor) parts.push(["ambient", room.ambientColor]);
  if (room.flame) parts.push(["flame", room.flame.color]);

  const warm = parts.filter(([, hex]) => temperature(hex) === "warm");
  const cool = parts.filter(([, hex]) => temperature(hex) === "cool");

  // Widest gap between any two of the room's lights, which is the span the eye
  // has to read a second hue out of.
  let span = 0;
  for (const [, a] of parts) {
    for (const [, b] of parts) {
      span = Math.max(
        span,
        hueGap(hueDegrees(linear(a)), hueDegrees(linear(b))),
      );
    }
  }

  const share =
    room.rim && room.spot
      ? (room.rim.intensity * incidence(room.rim.position)) /
        (room.rim.intensity * incidence(room.rim.position) +
          room.spot.intensity * incidence(room.spot.position))
      : 0;

  console.log(
    `  ${room.id.padEnd(9)} span ${String(Math.round(span)).padStart(3)}°  ` +
      `warm ${(warm.map(([n]) => n).join(",") || "—").padEnd(20)} ` +
      `cool ${(cool.map(([n]) => n).join(",") || "—").padEnd(14)} ` +
      `rim carries ${(share * 100).toFixed(0)}% of the two`,
  );
}

console.log(
  `\n${
    failures === 0
      ? "Every room is offered, resolvable, and still its own room.\n"
      : `${failures} check(s) failed — a room in the picker is not what it claims.\n`
  }`,
);
process.exit(failures === 0 ? 0 : 1);
