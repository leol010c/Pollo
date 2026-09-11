/**
 * Positions somebody wrote themselves survive being stored, read back, and
 * dealt. Run with `npm run verify:own`.
 *
 * This is the first user-authored data the app has ever held, and it is held in
 * exactly one place — a string in localStorage on the device that typed it.
 * There is no server copy and no second chance, which changes what is worth
 * checking. A bug in the deal shows up as a strange evening; a bug in the codec
 * shows up as somebody's writing gone.
 *
 * So the emphasis here is hostile input rather than happy paths. Everything in
 * `HOSTILE` is something a real device can hand back: a write truncated by a
 * full disk, a blob from a future version, a hand-edit in devtools, a record
 * whose id would shadow a built-in.
 *
 * Two of these check things that fail *silently* rather than loudly, which is
 * why they are here instead of being left to the browser:
 *
 *  - the atlas cache key. Getting it wrong does not throw and does not draw
 *    anything odd — it draws the face that was there before, which looks like a
 *    die that simply came up the same way twice;
 *  - the monogram glyph. A colour emoji ignores the fill the atlas set and
 *    paints its own colours, and the second atlas is not a picture at all: it
 *    packs roughness into green and metalness into blue. A peach in a position
 *    name would make that face of the die physically metallic in a rainbow.
 */
import {
  initialOf,
  isOwn,
  newOwnId,
  parseOwn,
  serialiseOwn,
  toEntry,
  NAME_MAX,
  DESCRIPTION_MAX,
  type OwnPosition,
} from "../lib/dice/own";
import { hand } from "../lib/dice/atlas";
import type { FaceSet } from "../lib/dice/faceSet";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

const own = (over: Partial<OwnPosition> = {}): OwnPosition => ({
  id: newOwnId(),
  name: "Against the wall",
  description: "They decide when you are allowed to turn around.",
  intensity: 2,
  measure: "strokes",
  order: 0,
  ...over,
});

console.log("Own positions — the codec, the ids, the glyph, the cache key\n");

// --- Round trip -------------------------------------------------------------
{
  const list = [own({ order: 0 }), own({ order: 1, measure: "time", intensity: 3 })];
  const back = parseOwn(JSON.parse(serialiseOwn(list)!));
  check(back.length === 2, "a valid pair did not survive the round trip");
  check(
    JSON.stringify(back) === JSON.stringify(list),
    "the round trip changed something",
  );
  console.log(`  round trip: ${back.length} back, unchanged`);
}

// --- Absence is the default -------------------------------------------------
{
  check(
    serialiseOwn([]) === null,
    "an empty deck serialises to a string — it must store nothing at all",
  );
  console.log("  empty deck stores nothing (the key is removed, not written)");
}

// --- Hostile input ----------------------------------------------------------
const HOSTILE: [string, unknown][] = [
  ["null", null],
  ["a bare string", "nope"],
  ["an array", []],
  ["no positions key", { v: 1 }],
  ["positions not an array", { v: 1, positions: "nope" }],
  ["a null entry", { v: 1, positions: [null] }],
  ["an entry with no id", { v: 1, positions: [{ name: "x" }] }],
  ["an entry with no name", { v: 1, positions: [{ id: newOwnId() }] }],
  ["a blank name", { v: 1, positions: [{ id: newOwnId(), name: "   " }] }],
  ["a built-in's id", { v: 1, positions: [{ id: "image-3", name: "Shadow" }] }],
  ["the joker's id", { v: 1, positions: [{ id: "wild-choice", name: "Shadow" }] }],
  ["a forfeit id", { v: 1, positions: [{ id: "x-custom", name: "Shadow" }] }],
  ["nonsense intensity", { v: 1, positions: [{ id: newOwnId(), name: "A", intensity: 7 }] }],
  ["nonsense measure", { v: 1, positions: [{ id: newOwnId(), name: "A", measure: "vibes" }] }],
];

for (const [label, raw] of HOSTILE) {
  let threw = false;
  let out: OwnPosition[] = [];
  try {
    out = parseOwn(raw);
  } catch {
    threw = true;
  }
  check(!threw, `parseOwn threw on ${label}`);
  for (const entry of out) {
    check(isOwn(entry.id), `${label} produced an entry with a foreign id`);
    check(entry.name.trim().length > 0, `${label} produced a nameless entry`);
    check(
      entry.intensity === 1 || entry.intensity === 2 || entry.intensity === 3,
      `${label} produced an out-of-range intensity`,
    );
    check(
      entry.measure === "strokes" || entry.measure === "time",
      `${label} produced an unknown measure`,
    );
  }
}
console.log(`  ${HOSTILE.length} hostile payloads: none threw, none got through`);

// --- One bad entry must not cost the good ones ------------------------------
{
  const good = own();
  const back = parseOwn({
    v: 1,
    positions: [null, { id: "image-1", name: "Shadow" }, good, { id: "own-x" }],
  });
  check(back.length === 1, "one malformed entry took the valid ones with it");
  check(back[0]?.id === good.id, "the surviving entry was the wrong one");
  console.log("  one bad entry among four: the good one survived alone");
}

// --- Duplicate ids ----------------------------------------------------------
{
  const id = newOwnId();
  const back = parseOwn({
    v: 1,
    positions: [
      { id, name: "First", order: 0 },
      { id, name: "Second", order: 1 },
    ],
  });
  check(back.length === 1, "a duplicate id was allowed through");
  check(back[0]?.name === "First", "the duplicate kept the wrong one");
  console.log("  duplicate ids collapse to the first");
}

// --- Oversize ---------------------------------------------------------------
{
  const back = parseOwn({
    v: 1,
    positions: [{ id: newOwnId(), name: "N".repeat(400), description: "D".repeat(4000) }],
  });
  check([...(back[0]?.name ?? "")].length <= NAME_MAX, "a name came back over the cap");
  check(
    [...(back[0]?.description ?? "")].length <= DESCRIPTION_MAX,
    "a description came back over the cap",
  );

  const huge = Array.from({ length: 4000 }, () => own({ description: "D".repeat(140) }));
  check(serialiseOwn(huge) === null, "an over-budget payload was offered for writing");
  console.log("  oversize: names and lines clamped, a runaway payload refused");
}

// --- Ids --------------------------------------------------------------------
{
  const ids = new Set<string>();
  let collisions = 0;
  for (let i = 0; i < 20000; i++) {
    const id = newOwnId();
    if (ids.has(id)) collisions++;
    ids.add(id);
    // The three id shapes already in use, none of which this may ever produce.
    check(!/^image-\d+$/.test(id), "a generated id looked like a built-in");
    check(!id.startsWith("x-"), "a generated id looked like a forfeit extra");
    check(id !== "wild-choice", "a generated id collided with the joker");
    check(isOwn(id), "a generated id was not recognised as ours");
  }
  check(collisions === 0, `${collisions} id collisions in 20000`);
  console.log(`  20000 ids: no collisions, none shaped like anything else`);
}

// --- The glyph --------------------------------------------------------------
{
  const NASTY: [string, string][] = [
    ["Against the wall", "A"],
    ["émile", "E"],
    ["Ölandet", "O"],
    ["  spaced", "S"],
    ["9 to 5", "9"],
    ["Ходьба", "Х"],
    ["椅子", "椅"],
    ["🍑", ""],
    ["🍑 peach", "P"],
    ["👩‍❤️‍👨", ""],
    ["", ""],
    ["   ", ""],
    ["!!!", ""],
    ["—", ""],
  ];

  for (const [name, want] of NASTY) {
    const got = initialOf(name);
    check(got === want, `initialOf(${JSON.stringify(name)}) gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
    // The rule that keeps a colour glyph out of the material atlas: whatever
    // comes back is a single letter or digit, or nothing at all.
    check(
      got === "" || /^[\p{L}\p{N}]$/u.test(got),
      `initialOf(${JSON.stringify(name)}) produced something that is not a letter or a digit`,
    );
  }
  console.log(`  ${NASTY.length} names: no pictograph ever reaches the die`);
}

// --- The atlas cache key ----------------------------------------------------
{
  // A stub deal, so the key can be driven without a scene or a canvas.
  let faces: (OwnPosition | undefined)[] = [];
  const stub: FaceSet = {
    id: "stub",
    body: { color: "#fff", roughness: 1, metalness: 0 },
    mark: { color: "#000", roughness: 1, metalness: 0 },
    draw: () => {},
    tokenFor: (value) => {
      const entry = faces[value - 1];
      if (!entry) return "#";
      return `${entry.id}:${initialOf(entry.name)}`;
    },
  };

  const anna = own({ name: "Anna" });
  const bea = own({ name: "Bea" });

  faces = [anna, bea, anna, bea, anna, bea];
  const before = hand("d6", stub);

  // Two hand-written positions swapping faces. Both are artwork-less, so a key
  // built from the artwork alone would call this the same hand and skip the
  // repaint — the die would keep showing the previous monogram.
  faces = [bea, anna, bea, anna, bea, anna];
  check(hand("d6", stub) !== before, "swapping two authored positions did not change the key");

  // And a rename, which changes the glyph while leaving every id where it was.
  faces = [own({ ...anna, name: "Zara" }), bea, anna, bea, anna, bea];
  check(hand("d6", stub) !== before, "renaming an authored position did not change the key");

  console.log("  atlas key: a swap and a rename both force a repaint");
}

// --- Into the deck ----------------------------------------------------------
{
  const entry = toEntry(own({ name: "Against the wall", measure: "time" }));
  check(entry.kind === "position", "an authored entry did not enter as a position");
  check(
    Array.isArray(entry.source) && entry.source.length === 0,
    "an authored entry carried artwork candidates",
  );
  check(entry.measure === "time", "toEntry lost the measure");
  check(entry.name === "Against the wall", "toEntry lost the name");
  console.log("  toEntry: a position with no artwork, which the deck already knows");
}

if (problems.length > 0) {
  console.log("");
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("\n  OK  what was written comes back, and nothing else does");
