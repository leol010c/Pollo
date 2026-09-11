"use client";

import type { DeckEntry, Intensity, Measure } from "./deck";

/**
 * Positions somebody wrote themselves.
 *
 * The built-in deck is discovered from files in `public/dice/`, which makes
 * adding to it a developer's job — you need a drawing, a filename and a line in
 * POSITIONS. These are the other half: entries that carry no artwork and exist
 * only because someone typed them, stored on the device that typed them.
 *
 * They are ordinary deck entries in every way that matters. The one difference
 * is `source: []`, which the deck already understands — the Joker has carried an
 * empty source since the beginning, so dealing, drawing, announcing and the
 * forfeit picker all have an artwork-less path already worn in. What an empty
 * source did *not* have until now is a way to look like anything, which is what
 * the monogram is for. See drawMonogram in ./faceSet and OwnMark in the UI.
 */

/**
 * The id prefix, and the only test for "this one is ours".
 *
 * Deliberately unlike the three id shapes already in use — `image-N` for the
 * files, `x-` for the forfeit extras that never enter the deck, and the bare
 * `wild-choice`. Nothing has to be coordinated to keep them apart; the prefixes
 * do it.
 */
const OWN_PREFIX = "own-";

/**
 * How long a name and a line may be.
 *
 * Not arbitrary, and not really a storage limit. A description is meant to be
 * read across a room in one glance — that is the rule the built-in lines are
 * written to, and it is why they are all one short sentence. It is also what the
 * reveal is built for: FullPicture keeps to a fixed three-row stack and a
 * paragraph would push the name off it. Somebody typing on a phone will happily
 * write four sentences if nothing stops them, so this stops them here rather
 * than letting the layout do it later and worse.
 */
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 140;

/**
 * A ceiling on the whole payload.
 *
 * localStorage quotas are small and shared across everything the origin stores;
 * a write that exceeds one throws. This keeps the deck well underneath so the
 * failure never happens, and makes a runaway loop that appends forever fail at
 * a boundary we chose instead of one the browser chose.
 */
const PAYLOAD_MAX = 64 * 1024;

/** The version stamped into stored JSON. Bump when the record shape changes. */
const VERSION = 1;

export interface OwnPosition {
  id: string;
  name: string;
  description: string;
  intensity: Intensity;
  measure: Measure;
  /** Where it sits in the list. Display only — every deal is shuffled. */
  order: number;
}

export function isOwn(id: string): boolean {
  return id.startsWith(OWN_PREFIX);
}

/**
 * A fresh id.
 *
 * Time first so ids sort roughly in the order they were written, with a random
 * tail because two positions added in the same millisecond is not impossible —
 * a double-tapped save would do it, and two entries sharing an id would make
 * `disabled`, `favourites` and the draw pile all point at the wrong one.
 */
export function newOwnId(): string {
  return `${OWN_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The deck's view of one. */
export function toEntry(own: OwnPosition): DeckEntry {
  return {
    id: own.id,
    kind: "position",
    name: own.name,
    description: own.description,
    intensity: own.intensity,
    measure: own.measure,
    // The whole reason this works without touching the deal, the pile or the
    // announcer: an empty source is a shape the deck has always handled.
    source: [],
  };
}

/**
 * The letter a monogram is drawn from.
 *
 * The first *letter or digit*, which is a narrower thing than the first
 * character and deliberately so. A face set's `draw` is called once per atlas
 * channel and never sets its own fill, because the atlas has already set one —
 * and the second channel is not a picture at all: it packs roughness into green
 * and metalness into blue. A colour emoji ignores `fillStyle` and paints its
 * own colours, so a peach in a position name would not merely look odd, it
 * would write nonsense into the material map and make that face of the die
 * physically metallic in a rainbow pattern. Letters and digits cannot do that.
 *
 * Combining marks are folded away first, so "Émile" gives "E" rather than an E
 * wearing an accent that the ring then clips.
 *
 * Returns an empty string when a name holds nothing that qualifies — emoji-only
 * and punctuation-only names are both real — and the callers draw the ring
 * alone, which is still a mark.
 */
export function initialOf(name: string): string {
  // NFD splits a precomposed letter into base plus mark so the mark can go.
  const folded = name.normalize("NFD").replace(/\p{M}/gu, "");

  // Letters and numbers of any script: Cyrillic, Greek and CJK all paint as
  // ordinary monochrome glyphs and are welcome. It is only the pictographs
  // that carry their own colour, and no pictograph is \p{L} or \p{N}.
  const match = folded.match(/[\p{L}\p{N}]/u);
  if (!match) return "";

  // Locale-less on purpose. This is one glyph on a die, not prose, and the
  // Turkish dotless-i rule turning "iki" into "I" would be a surprise nobody
  // asked the die for.
  return match[0].toUpperCase();
}

function clamp(value: string, max: number): string {
  // Spread again rather than slice, so a name cut at the limit is never cut
  // through the middle of a character.
  const glyphs = [...value.trim()];
  return glyphs.length <= max ? glyphs.join("") : glyphs.slice(0, max).join("");
}

function intensityOf(value: unknown): Intensity {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

function measureOf(value: unknown): Measure {
  // Time is the safe default the deck already documents: anything can be
  // counted in seconds, while a stroke count needs something rhythmic to count.
  return value === "strokes" ? "strokes" : "time";
}

/**
 * Turns whatever was in storage into positions, discarding whatever wasn't one.
 *
 * Per-record rather than all-or-nothing, and silent rather than throwing. This
 * runs on somebody's own writing: one entry that got truncated by a full disk
 * or mangled by a hand-edit in devtools must not be able to take the other nine
 * with it, and there is no useful thing to say to a couple about a malformed
 * record at the moment they open the app.
 *
 * Validation lives here rather than in prefs.ts, which stores strings and holds
 * no opinion about what they mean — the same split `themeById` and `fitDie`
 * already use for the room and the die.
 */
export function parseOwn(raw: unknown): OwnPosition[] {
  if (!raw || typeof raw !== "object") return [];

  const list = (raw as { positions?: unknown }).positions;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const out: OwnPosition[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const id = typeof record.id === "string" ? record.id : "";
    // An id that isn't ours would let a stored record shadow a built-in
    // position — same id, different content, and the panel would offer to
    // delete a file it cannot delete.
    if (!isOwn(id) || seen.has(id)) continue;

    const name = clamp(typeof record.name === "string" ? record.name : "", NAME_MAX);
    if (!name) continue;

    seen.add(id);
    out.push({
      id,
      name,
      description: clamp(
        typeof record.description === "string" ? record.description : "",
        DESCRIPTION_MAX,
      ),
      intensity: intensityOf(record.intensity),
      measure: measureOf(record.measure),
      order: typeof record.order === "number" && Number.isFinite(record.order)
        ? record.order
        : out.length,
    });
  }

  return out.sort((a, b) => a.order - b.order);
}

/**
 * The string to store, or null to store nothing at all.
 *
 * Null for an empty deck because prefs.ts stores a default as *absence* — an
 * app that has never had a custom position should leave no key behind for
 * somebody idly reading devtools, the same way "not discreet" is stored by
 * removing the key rather than writing "0".
 *
 * Null again if it somehow got too big, which drops the write rather than
 * letting it throw. Losing the last edit is a smaller failure than an
 * unhandled exception on the path that saves your work.
 */
export function serialiseOwn(list: OwnPosition[]): string | null {
  if (list.length === 0) return null;

  const json = JSON.stringify({
    v: VERSION,
    positions: list.map((own, index) => ({ ...own, order: index })),
  });

  return json.length > PAYLOAD_MAX ? null : json;
}
