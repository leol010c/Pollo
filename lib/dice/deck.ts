"use client";

import { DIE_SIDES, DIE_TYPES } from "./types";
import {
  FACE_EXTENSIONS,
  preloadStencils,
  resolvedSource,
  type FaceSource,
} from "./stencil";

/**
 * The deck of positions, which is deliberately larger than the die.
 *
 * A die can only ever show as many things as it has faces, but there is no
 * reason the app has to own only that many. The deck holds up to DECK_SLOTS;
 * each throw deals one entry onto every face. Same object, more variety, and no
 * second die.
 *
 * The die is never larger than the deck, though — a die with more faces than
 * there are positions would have to print one twice, and then it is lying about
 * how many outcomes it has. See largestDieFor() in ./types.
 *
 * Deck membership is discovered from the files themselves rather than declared,
 * so adding a position is still just dropping `image-13.png` into public/dice.
 */

/** Hard ceiling on the deck. */
export const DECK_SLOTS = 16;

/** The most faces any die has, and so the most a deal ever needs to fill. */
const MAX_FACES = Math.max(...DIE_TYPES.map((type) => DIE_SIDES[type]));

/**
 * How intense a position is: 1 gentle, 2 steady, 3 intense.
 *
 * Not how *hard* it is. This used to mean exertion — easy, moderate, athletic —
 * which sounds like the same scale and is very nearly its opposite: the
 * positions that take the most effort to hold are usually the ones you can stay
 * in longest, because the effort is going somewhere other than the sensation.
 *
 * What it means now is how quickly it ends. A 3 is the one nobody lasts in; a 1
 * is the one you can stay in for as long as you like. That is the question
 * anybody is actually asking when they look at a position and then decide what
 * to stake on it, which is the only reason the number is worth printing.
 *
 * The ordering is what is commonly reported rather than anything measured —
 * there is no study of this to import. Treat it as a starting opinion and edit
 * it; nothing downstream depends on any particular position's number.
 */
export type Intensity = 1 | 2 | 3;

/**
 * How a position's stake is counted.
 *
 * The gamble used to be a duration for everything, and a duration has one flaw
 * the rest of this app doesn't: it can only be *watched*. A clock on the screen
 * keeps the phone in the room at the exact moment the phone should be face-down
 * on the nightstand. A count doesn't — once you know the number, the phone is
 * done until the next throw.
 *
 * So most positions are counted in strokes. Not all of them can be: a count
 * needs something rhythmic to count, and the ones that are slow, mutual or
 * simply not shaped that way keep the clock. That is the whole reason this is a
 * property of the position rather than a setting — the right unit is a fact
 * about what you are doing, not a preference.
 */
export type Measure = "strokes" | "time";

/**
 * What each picture is called, what it is, how intense it is, and how it is
 * counted.
 *
 * Add an entry when you add a file. A picture with no entry here still works —
 * it just gets announced by number, says nothing about itself, shows no
 * intensity, and is counted in time, which is the safe default because it
 * applies to anything.
 *
 * The line of description is written to be read across a room in one glance,
 * which is why every one of them is a single short sentence or two: it appears
 * under the name on the reveal, at the exact moment somebody is looking at a
 * picture and deciding what it is asking for. Anything longer is a paragraph
 * nobody reads while undressed.
 *
 * Three rules hold them together.
 *
 * Each one says what to *do* rather than describing the drawing, which the
 * drawing is already doing. Each one names something belonging to that position
 * alone — the wall, the wrists, the ankles, the lap — so a line could never be
 * moved to another card without somebody noticing.
 *
 * And each one asks for something: a rule, a dare, something withheld. That is
 * the half that took three passes to find. A description that only describes is
 * a caption, and a caption is read once and never again; a line that says who is
 * allowed to move makes the reveal part of the game rather than a label on it —
 * which the wilds had been quietly proving all along, being the one kind of card
 * anybody was pleased to turn over.
 */
export const POSITIONS: Record<
  string,
  {
    name: string;
    description: string;
    intensity?: Intensity;
    measure?: Measure;
  }
> = {
  // Oral, and the shortest odds in the deck.
  "image-1": {
    name: "Blowjob",
    description: "On your knees, hands behind your back. They decide when you stop.",
    intensity: 3,
    measure: "strokes",
  },
  // The one that comes up in every survey as the quickest to end. Depth, the
  // angle, and no eye contact to slow anybody down.
  "image-2": {
    name: "Doggy",
    description: "Face down, hips up. A fistful of hair, and they take what's given.",
    intensity: 3,
    measure: "strokes",
  },
  // The middle of the scale by definition — everything else is more or less
  // than this.
  "image-3": {
    name: "Missionary",
    description: "Wrists pinned above their head. No touching you until they beg.",
    intensity: 2,
    measure: "strokes",
  },
  // Hard work, and gentle on the clock: staying upright takes attention that
  // is then not going anywhere else, and the angle is shallow.
  "image-4": {
    name: "Standing",
    description: "Up against the wall. Their feet touch the floor, you start again.",
    intensity: 1,
    measure: "strokes",
  },
  // Seated and close rather than driving — there is no stroke to count.
  "image-5": {
    name: "Eating Her Out",
    description: "Her on her back, legs open and pulled up. He kneels between them, face buried, not coming up until she makes him.",
    intensity: 1,
    measure: "time",
  },
  "image-6": {
    name: "Reverse Cowgirl",
    description: "They ride facing away. Hands off — make them do all the work.",
    intensity: 2,
    measure: "strokes",
  },
  // Doggy's angle, but standing costs the depth and most of the rhythm.
  "image-7": {
    name: "Standing Doggy",
    description: "Bent over the nearest thing. Say out loud exactly what you're doing.",
    intensity: 2,
    measure: "strokes",
  },
  // Mutual, so a single count would belong to only one of you. Intense, but
  // both of you are doing something, and divided attention lasts longer.
  "image-8": {
    name: "Sixty-Nine",
    description: "Head to toe, mouths full. First one to make a sound loses.",
    intensity: 2,
    measure: "time",
  },
  // The most work in the deck, which is exactly why it is not a 3: whoever is
  // carrying is thinking about carrying.
  "image-9": {
    name: "Stand and Carry",
    description: "Off their feet, legs round your waist. They don't get put down.",
    intensity: 2,
    measure: "strokes",
  },
  // Lying flat along each other rather than riding: close and slow, and there
  // is no stroke in it to count.
  "image-10": {
    name: "Lazy Cowgirl",
    description: "Flat on top, grinding slow. No thrusting, and keep your hands off.",
    intensity: 1,
    measure: "time",
  },
  // Flat, tight and full contact — doggy's angle with none of the room to back
  // off. Reported over and over as the fastest of the lot.
  "image-11": {
    name: "Lazy Doggy",
    description: "Face down, pinned, nowhere to go. They stay where you put them.",
    intensity: 3,
    measure: "strokes",
  },
  // The deepest angle there is.
  "image-12": {
    name: "Legs Up",
    description: "Ankles on your shoulders, folded in half. No looking away.",
    intensity: 3,
    measure: "strokes",
  },
  "image-13": {
    name: "Cowgirl",
    description: "Astride you, setting the pace. Touch them and they start over.",
    intensity: 2,
    measure: "strokes",
  },
};

/**
 * What kind of card a deck entry is.
 *
 * `wild` entries have no artwork file and no intensity — they change the rules
 * instead of naming a position. They live in the deck rather than beside it so
 * they inherit everything the deck already does: dealing, the not-tonight
 * filter, the panel, the reveal. A parallel system for "special faces" would
 * have had to reimplement all of it.
 */
export type CardKind = "position" | "wild";

export interface DeckEntry {
  /** File stem, e.g. "image-3", or the wild's id. Stable across sessions. */
  id: string;
  kind: CardKind;
  name?: string;
  /**
   * One line saying what to do. Only wilds have one — a rule has to be stated.
   *
   * Kept separate from `description` rather than merged with it, though both
   * land in the same place on the reveal. A hint is an *instruction*, and two
   * other screens treat it as one: the forfeit notice prints it in place of the
   * "and how many?" prompt precisely because a wild replaces that question. A
   * description arriving through the same field would have quietly taken that
   * prompt away from every position picked as a forfeit.
   */
  hint?: string;
  /**
   * One line saying what this position asks for.
   *
   * A picture explains itself, which was the argument against having this at
   * all — and it holds right up until somebody looks at two pink and blue
   * figures at an unusual angle and has to guess which one of them is meant to
   * move. The line is not there to describe the picture; it is there to say what
   * the position is asking for.
   *
   * Printed on the card face, and spoken by ResultAnnouncer. Deliberately *not*
   * on the die's reveal, which is a fixed stack of unshrinkable rows in a
   * centred box — a fourth row there does not make the others smaller, it pushes
   * the last one off the end. See FullPicture.
   */
  description?: string;
  intensity?: Intensity;
  /**
   * How this one's stake is counted. Absent means time — see Measure.
   *
   * Wilds leave it absent deliberately, and that is the right answer rather
   * than an omission: a wild does not name an activity, so there is nothing
   * whose strokes could be counted. Whatever you choose, you choose for a
   * while.
   */
  measure?: Measure;
  /** Candidate URLs, one per supported extension. Empty for wilds. */
  source: FaceSource;
}

/**
 * A drawer in the forfeit picker.
 *
 * The list outgrew a flat column the moment it stopped being twelve pictures.
 * Thirty things in one scroll is a menu somebody reads top to bottom while the
 * other person waits; four closed drawers is a decision about *kind* first,
 * which is how anybody actually chooses.
 *
 * `fromDeck` is the one category not listed here. Positions come from whatever
 * is in play at that moment, so writing them out would mean a drawer offering
 * something the deck panel had switched off.
 */
export interface ForfeitCategory {
  id: string;
  name: string;
  /** Filled from the live deck rather than from `entries`. */
  fromDeck?: boolean;
  entries: DeckEntry[];
}

/**
 * Everything a won forfeit may choose beyond the pictures.
 *
 * The deck is thirteen pictures, and thirteen pictures is not "whatever they
 * like" — which is what a lost bet is supposed to hand over. None of these have
 * artwork and none need it: they are read, not looked at, so adding one costs a
 * line here rather than a file in public/dice.
 *
 * Deliberately not part of the deck. Nothing here is ever dealt onto a die face
 * or drawn out of the pile — a die face has to be *seen* from across a table and
 * a sentence is not, which is the whole reason the deck is pictures. These exist
 * for the one moment somebody is holding the phone and choosing deliberately.
 *
 * **Edit these lists.** They are a starting point, not a fixed menu.
 */
export const FORFEIT_CATEGORIES: ForfeitCategory[] = [
  {
    id: "foreplay",
    name: "Foreplay",
    entries: [
      { id: "x-massage", kind: "position", name: "Massage", measure: "time", source: [] },
      { id: "x-kiss", kind: "position", name: "Kiss wherever they say", measure: "time", source: [] },
      { id: "x-blindfold", kind: "position", name: "Blindfold them", measure: "time", source: [] },
      { id: "x-tease", kind: "position", name: "Tease — no touching", measure: "time", source: [] },
      { id: "x-strip", kind: "position", name: "Take something off", measure: "time", source: [] },
    ],
  },
  {
    id: "hands",
    name: "Hands & mouth",
    entries: [
      { id: "x-handjob", kind: "position", name: "Handjob", measure: "strokes", source: [] },
      { id: "x-fingering", kind: "position", name: "Fingering", measure: "strokes", source: [] },
      { id: "x-mouth", kind: "position", name: "Use your mouth", measure: "strokes", source: [] },
      { id: "x-godown", kind: "position", name: "Go down on them", measure: "time", source: [] },
    ],
  },
  {
    id: "positions",
    name: "Positions",
    fromDeck: true,
    entries: [],
  },
  {
    id: "toys",
    name: "Toys & extras",
    entries: [
      { id: "x-toy", kind: "position", name: "Their choice of toy", measure: "time", source: [] },
      { id: "x-vibrator", kind: "position", name: "Vibrator", measure: "time", source: [] },
      { id: "x-holdstill", kind: "position", name: "Hold still, hands off", measure: "time", source: [] },
    ],
  },
];

/**
 * The escape hatch, and the only honest end to a list claiming "whatever".
 *
 * No list is ever complete, and one that pretends to be turns the prize into a
 * menu. This names nothing: they say it out loud, and the app carries the stake
 * without ever knowing what it is attached to — which is fine, because the app
 * was never the thing keeping score.
 *
 * Above the categories rather than inside one, and drawn as the joker it is.
 * Putting it at the bottom would make it the last resort of somebody who found
 * nothing they liked; at the top it is the first offer, which is what "anything
 * they like" is supposed to mean.
 */
export const FREE_CHOICE: DeckEntry = {
  id: "x-custom",
  kind: "wild",
  name: "Custom",
  hint: "Off the list. They say it; the app just holds the number.",
  measure: "time",
  source: [],
};

/**
 * Cards that aren't positions.
 *
 * Kept deliberately short. One wild in a six-face deal comes up often enough to
 * feel like a live possibility; several would dilute the deck into a game of
 * instructions rather than pictures.
 */
export const WILDS: DeckEntry[] = [
  {
    // The id stays "wild-choice" even though it is called the Joker: it is
    // what favourites and the not-tonight list key off, so renaming it would
    // orphan those.
    id: "wild-choice",
    kind: "wild",
    name: "Joker",
    hint: "Whoever threw the die picks anything they like.",
    source: [],
  },
];

/** Every slot the deck could hold, whether or not a file exists for it. */
const SLOTS: DeckEntry[] = Array.from({ length: DECK_SLOTS }, (_, i) => {
  const id = `image-${i + 1}`;
  return {
    id,
    kind: "position" as const,
    name: POSITIONS[id]?.name,
    description: POSITIONS[id]?.description,
    intensity: POSITIONS[id]?.intensity,
    measure: POSITIONS[id]?.measure,
    source: FACE_EXTENSIONS.map((ext) => `/dice/${id}.${ext}`),
  };
});

let discovered: DeckEntry[] = [];

/**
 * The deck's two halves, held separately so either can be replaced alone.
 *
 * `builtins` is whatever artwork resolved; `own` is what somebody wrote. They
 * arrive on schedules that have nothing to do with each other — one is a
 * network probe, the other a read from localStorage — and the second one can
 * change at any point afterwards, since every add, edit and delete lands there.
 * Keeping them apart is what makes the arrival order not matter. See rebuild().
 */
let builtins: DeckEntry[] = [];
let own: DeckEntry[] = [];
/**
 * The rule cards, held as a slot rather than read from WILDS at compose time.
 *
 * Because "which wilds are in this deck" is a property of the deck that landed,
 * not a constant. Composing straight from WILDS meant every deck grew a Joker
 * whether or not one had been handed over, which is right for the app and wrong
 * for anything driving the store with a deck of its own.
 */
let wilds: DeckEntry[] = [];

/**
 * Recomputes the deck from its two halves.
 *
 * The order is the deal's only opinion about presentation: pictures first, then
 * whatever was written by hand, then the rule cards. Wilds stay last for the
 * reason they always have — they read as an addition to the deck rather than
 * part of the run of positions.
 */
function rebuild(): DeckEntry[] {
  discovered = [...builtins, ...own, ...wilds];
  return discovered;
}

/**
 * Replaces one half of the deck and returns the whole thing.
 *
 * The store calls these and puts the result into state. They deliberately do
 * not go back through whenDeckReady(), which resolves once and means one
 * specific thing — the artwork finished probing — and would be a strange
 * promise to make again every time somebody edits a line of their own.
 *
 * Either is safe to call before the other. The two halves are independent, so
 * whichever arrives second produces the same deck, and nothing has to know
 * which one that was.
 *
 * `builtins` is a parameter rather than being read from SLOTS here, even though
 * loadDeck is the only caller that matters. It was SLOTS once, and that quietly
 * made this module and the store two separate authorities on what the built-in
 * half contains — a disagreement no check could see, because the app happens to
 * feed the store the same array this function produces. A test deck went in and
 * was thrown away on the next edit.
 */
export function setBuiltinEntries(
  entries: DeckEntry[],
  rules: DeckEntry[],
): DeckEntry[] {
  builtins = entries;
  wilds = rules;
  return rebuild();
}

export function setOwnEntries(entries: DeckEntry[]): DeckEntry[] {
  own = entries;
  return rebuild();
}

/**
 * Resolves once the deck has been discovered.
 *
 * Loading happens deep inside the scene, but the deck panel is ordinary React
 * outside it — and a module-level array changing is invisible to React. This is
 * how that boundary gets crossed: something above can await the deck and put it
 * into state, where a component can actually react to it.
 */
let announceReady: (entries: DeckEntry[]) => void;
const ready = new Promise<DeckEntry[]>((resolve) => {
  announceReady = resolve;
});

export function whenDeckReady(): Promise<DeckEntry[]> {
  return ready;
}

export function deckEntry(id: string): DeckEntry | undefined {
  return discovered.find((entry) => entry.id === id);
}

/**
 * Loads every slot's artwork and keeps the ones that resolved.
 *
 * All of them are preloaded rather than just the six currently dealt, because
 * the atlas paints synchronously — a deal that had to wait for a file would
 * flash numerals on the faces it hadn't fetched yet.
 */
export async function loadDeck(cellSize: number, padding: number) {
  await preloadStencils(
    SLOTS.map((slot) => slot.source),
    cellSize,
    padding,
    "alpha",
  );

  announceReady(
    setBuiltinEntries(
      SLOTS.filter((slot) => resolvedSource(slot.source)),
      WILDS,
    ),
  );
}

// --- Dealing ---------------------------------------------------------------

let deal: DeckEntry[] = [];

/**
 * Which entry is currently on a given face.
 *
 * Deals from everything discovered if nothing has been dealt yet, so the very
 * first paint — which happens the moment the deck finishes loading, before any
 * throw — shows artwork rather than numerals.
 *
 * That opening deal fills the largest die there is, because this module has no
 * idea which one is in play and dealing too few would leave real faces blank.
 * The store re-deals to the actual die a moment later, so the surplus never
 * reaches the screen.
 */
export function dealtTo(value: number): DeckEntry | undefined {
  if (deal.length === 0 && discovered.length > 0) {
    dealFaces(discovered, MAX_FACES);
  }
  return deal[value - 1];
}

export function currentDeal(): DeckEntry[] {
  return deal;
}

/**
 * Puts `entry` on a given face, exchanging it with whatever was there.
 *
 * Used once, by the deal, to put the fixed position on the face the throw now in
 * the air is going to stop on — see `rigChoice` in the store, and forecastFace
 * for where that face comes from. Nothing else about the deal changes.
 *
 * A **swap** rather than an overwrite, which is the whole reason it is written
 * this way. An overwrite would leave the displaced position missing and the
 * incoming one printed twice, and a die showing the same picture on two faces is
 * the first thing anybody would notice about it. Exchanging the two leaves the
 * solid carrying the same set it started with, in a different order — and a die
 * whose face order you have never memorised looks exactly like itself.
 *
 * It does not decide anything about the throw. Which face ends up upward is
 * still the solver's business — this only decides what is printed on it.
 */
export function fixFace(entry: DeckEntry, value: number) {
  const index = value - 1;
  if (index < 0 || index >= deal.length) return;
  if (deal[index]?.id === entry.id) return;

  const already = deal.findIndex((e) => e.id === entry.id);
  // Whatever was showing goes where the fixed one came from, so the set of
  // faces is unchanged. If it was not dealt at all, it simply replaces one.
  if (already >= 0) deal[already] = deal[index];
  deal[index] = entry;
}

/**
 * Deals one entry onto every face of the die.
 *
 * `faces` is the die's actual side count, not a constant. It used to be
 * hardcoded to six, which quietly broke every die that isn't a d6: a d12 got
 * six entries and its remaining six faces, finding nothing dealt to them, fell
 * back to drawing numerals. Half the die showed numbers.
 *
 * Draws without replacement where it can, so a single throw does not show the
 * same position twice. With fewer entries than faces the deck necessarily
 * repeats — that is the honest consequence, and better than refusing to roll.
 */
export function dealFaces(available: DeckEntry[], faces: number): DeckEntry[] {
  if (available.length === 0) {
    deal = [];
    return deal;
  }

  const pool = [...available];
  // Fisher–Yates, so every ordering is equally likely. Sorting by a random key
  // is the common shortcut and is measurably biased.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  deal = Array.from({ length: faces }, (_, i) => pool[i % pool.length]);
  return deal;
}
