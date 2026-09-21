/**
 * The app comes up once, as the thing that was saved.
 *
 * This is the check that would have caught the bug it was written after, and
 * that bug is worth stating because it was invisible in every other check: the
 * die is mounted as `<Die key={dieType}>`, so changing the type does not adjust
 * the die — it destroys it and builds another one, with a new physics body and a
 * fresh drop. The saved solid was being restored once the deck had loaded, which
 * is long after the canvas is up, so a saved d12 fell onto the cloth as a d6 and
 * then fell onto it again as a d12. Two drops, and the first one showing a die
 * the user had not chosen.
 *
 * Nothing about that is visible in the store's final state. It settles on d12
 * either way, and every existing script that looks at the end of the sequence
 * agrees the end is right. What was wrong was the *path*, so that is what this
 * measures: it drives the store the way DiceApp drives it and watches the order
 * things happen in.
 *
 * The property that catches it is **the die is settled before the deck lands**.
 * That reads like an odd thing to care about until you line up the two clocks:
 * the deck arrives over the network, and the scene arrives as a `ssr:false`
 * dynamic chunk, which resolves first. So the deck landing is *after* the die
 * has been built, and anything that changes the type at or after that moment is
 * changing a die somebody is already looking at. The store cannot see the
 * canvas, but it can see this, and this is the same fact.
 *
 * The one legitimate exception is `fitDie`, which shrinks a die the deck turns
 * out to be too short for. That is a correction that could not have been made
 * any earlier, and it is checked separately below.
 *
 * A second, weaker property is also held: nothing is dealt before the deck
 * arrives. That would not have caught this bug — it is here because the obvious
 * repair for it, restoring through `setDieType` on mount, deals a hand onto an
 * empty deck on the way past, and that repair should not be able to land
 * quietly either.
 *
 * Run with `npm run verify:boot`.
 */
import { useDiceStore } from "../lib/store";
import { setBuiltinEntries, type DeckEntry } from "../lib/dice/deck";
import type { OwnPosition } from "../lib/dice/own";
import { toEntry } from "../lib/dice/own";
import { DIE_SIDES, DIE_TYPES, type DieType } from "../lib/dice/types";

let failures = 0;
const report = (ok: boolean, line: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${line}`);
};

function deck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    intensity: 2 as const,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

/**
 * One page load, in the order DiceApp actually does it.
 *
 * The store is a module singleton, so each run starts by putting it back to the
 * state `create()` left it in. Only the fields this sequence touches are reset —
 * resetting everything would mean restating the initial state here, and a copy
 * of it would go stale.
 */
function boot(saved: string | null, entries: DeckEntry[], written: OwnPosition[] = []) {
  const store = useDiceStore;

  /*
   * The deck module is a singleton too, and it is the half of a cold start the
   * store cannot reset.
   *
   * It keeps the built-in entries so that a later edit to a hand-written
   * position recomposes over the same pictures. That is right in the app and
   * wrong here: left alone, the pictures from the *previous* boot in this
   * process are still registered, so restoreOwn composes a full deck and the
   * half-built one that a real first load goes through never happens. Every
   * check below it would then be passing on a state the app never reaches.
   */
  setBuiltinEntries([], []);

  store.setState({
    dieType: "d6",
    deck: [],
    deckIn: false,
    own: [],
    pool: "all",
    disabled: [],
    dealId: 0,
    history: [],
    phase: "idle",
    value: null,
  });

  const seen: DieType[] = [store.getState().dieType];
  const dealsBeforeDeck: number[] = [];

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.dieType !== previous.dieType) seen.push(state.dieType);
    if (state.dealId !== previous.dealId && state.deck.length === 0) {
      dealsBeforeDeck.push(state.dealId);
    }
  });

  // 1. The mount effects, which run at hydration — before the scene's chunk has
  //    resolved and therefore before any die exists.
  if (saved) store.getState().restoreDieType(saved);

  /*
   * 2. And the rest of those effects, in the order DiceApp declares them.
   *
   * This used to be left out, and leaving it out is what let the bug below
   * through: restoreOwn composes a deck from the hand-written half alone —
   * nothing, for most people — and everything downstream of it was then
   * measuring the die against a deck of nothing. A boot without it is not a
   * boot, it is the half of one that happened to work.
   */
  store.getState().restoreCuration([], []);
  store.getState().restoreOwn(written, "all");

  // The die the scene will build, captured at the last moment before the deck
  // can influence it. This is the value the user actually watches fall.
  const onMount = store.getState().dieType;

  // 3. The deck, which arrives over the network some time later. `setDeck` fits
  //    the die to it and deals.
  store.getState().setDeck(entries);

  unsubscribe();
  return { seen, dealsBeforeDeck, onMount, final: store.getState().dieType };
}

// --- A saved die that fits ---------------------------------------------------

{
  const { seen, dealsBeforeDeck, onMount, final } = boot("d12", deck(13));

  report(
    final === "d12",
    `a saved d12 with 13 positions comes up as a ${final}`,
  );

  /*
   * The one that matters, and the one the old arrangement failed.
   *
   * Restoring after the deck had loaded left this at d6 while the final answer
   * was d12 — which is precisely a die built as one solid and replaced by
   * another with the canvas already up.
   */
  report(
    onMount === final,
    `the die is settled before the deck lands — built as ${onMount}, ends as ${final}`,
  );

  /*
   * And it is built once. `seen` starts with the store's initial d6, so a clean
   * boot is [d6, d12]: the value before anything is mounted, then the value
   * everything is mounted as.
   */
  report(
    seen.length === 2,
    `it passes through no third solid — ${seen.join(" → ")}`,
  );
  report(
    dealsBeforeDeck.length === 0,
    `nothing is dealt before the deck arrives — ${dealsBeforeDeck.length} deal(s)`,
  );
}

// --- A saved die the deck can no longer fill ---------------------------------

/*
 * The case the restore used to guard against by running late. It does not need
 * to any more: `fitDie` shrinks a die the deck cannot fill the moment the deck
 * lands, which is the same clamp arriving from the direction it was written for.
 *
 * This one *does* pass through a second solid, and that is correct — the die was
 * legitimately built as what the user chose and then corrected by a deck that
 * turned out to be short. It is the rare case paying the cost that every case
 * used to pay.
 */
{
  const { final } = boot("d12", deck(6));
  report(
    final === "d6",
    `a saved d12 with only 6 positions is clamped to a ${final}`,
  );
}

// --- Nothing saved, and nonsense saved ---------------------------------------

{
  const { seen, final } = boot(null, deck(13));
  report(
    final === "d6" && seen.length === 1,
    `no saved die leaves the default alone — ${seen.join(" → ")}`,
  );
}

{
  const { final } = boot("d20", deck(13));
  report(
    final === "d6",
    `a saved die that does not exist is ignored, not applied — ${final}`,
  );
}

// --- The restore is startup-only ---------------------------------------------

/*
 * The guard that makes "at startup" a property rather than an intention. Called
 * with a deck already in, this must do nothing — otherwise it is a second way to
 * change the die that skips everything `setDieType` does to the round.
 */
{
  const store = useDiceStore;
  store.setState({ dieType: "d6", deck: deck(13), deckIn: true, disabled: [] });
  store.getState().restoreDieType("d12");
  report(
    store.getState().dieType === "d6",
    "the restore refuses once the deck is in",
  );
}

/*
 * The two halves of the deck arrive in either order, and converge.
 *
 * The built-in half comes from probing files in public/dice; the hand-written
 * half comes from localStorage. Nothing sequences them — they are read by
 * different effects for different reasons and finish whenever they finish. So
 * "which one landed first" is a coin flip on every cold start, and a deck that
 * depended on the answer would be a deck that was occasionally short by
 * however many positions somebody had written.
 *
 * There is no promise to wait on and deliberately so: whenDeckReady() resolves
 * once and means one specific thing. The composition is what makes the order
 * not matter, and this is what proves it.
 */
{
  const written = [
    {
      id: "own-aaaaaaaaaa",
      name: "Against the wall",
      description: "They decide when you are allowed to turn around.",
      intensity: 3 as const,
      measure: "strokes" as const,
      order: 0,
    },
    {
      id: "own-bbbbbbbbbb",
      name: "On the stairs",
      description: "Halfway up, and neither of you is allowed to speak.",
      intensity: 2 as const,
      measure: "time" as const,
      order: 1,
    },
  ];

  const store = useDiceStore;

  const ids = () =>
    store
      .getState()
      .deck.map((entry) => entry.id)
      .join();

  // Storage first, then the artwork.
  store.setState({ deck: [], deckIn: false, own: [], pool: "all", disabled: [], dieType: "d6" });
  store.getState().restoreOwn(written, "all");
  store.getState().setDeck([...deck(13), ...written.map(toEntry)]);
  const storageFirst = ids();

  // Artwork first, then storage.
  store.setState({ deck: [], deckIn: false, own: [], pool: "all", disabled: [], dieType: "d6" });
  store.getState().setDeck(deck(13));
  store.getState().restoreOwn(written, "all");
  const artworkFirst = ids();

  report(
    storageFirst === artworkFirst,
    `both arrival orders give the same deck — ${store.getState().deck.length} entries`,
  );
  report(
    store.getState().own.length === 2,
    "both hand-written positions survived the boot",
  );
  report(
    store.getState().deck.filter((entry) => entry.id.startsWith("own-")).length === 2,
    "both hand-written positions reached the deck",
  );
}

// --- A saved die survives the half-deck the mount effects compose ------------

/*
 * The bug this section was added for, and the one the app actually shipped with.
 *
 * The hand-written half is read from localStorage in a mount effect, and
 * restoreOwn composes a deck out of it immediately — long before the artwork
 * probe finishes. For anybody who has never written a position that deck is
 * empty, and `largestDieFor(0)` is a d4. fitDie ran against it, shrank the die
 * to fit a deck of nothing, and because it only ever shrinks, the real deck
 * arriving a moment later could not put it back. Every load came up as a d4,
 * whatever had been chosen — which read as the saved solid not being saved at
 * all.
 *
 * Both halves are checked, because the empty-deck case and the short-deck case
 * fail for the same reason and a guard that only covers the first one leaves
 * anybody with two hand-written positions in exactly the same hole.
 */
{
  const { onMount, final } = boot("d12", deck(13));
  report(
    onMount === "d12" && final === "d12",
    `a saved d12 survives a boot with nothing hand-written — built ${onMount}, ends ${final}`,
  );
}

{
  const written: OwnPosition[] = [
    {
      id: "own-cccccccccc",
      name: "Against the door",
      description: "Neither of you reaches for the handle.",
      intensity: 3 as const,
      measure: "strokes" as const,
      order: 0,
    },
  ];
  const { onMount, final } = boot("d12", [...deck(13), ...written.map(toEntry)], written);
  report(
    onMount === "d12" && final === "d12",
    `a saved d12 survives a boot with one hand-written position — built ${onMount}, ends ${final}`,
  );
}

// --- The saved value is one the picker could have produced -------------------

report(
  DIE_TYPES.every((type) => DIE_SIDES[type] > 0),
  `every die type has a face count — ${DIE_TYPES.join(", ")}`,
);

console.log(
  `\n${
    failures === 0
      ? "The app comes up once, as the die that was saved.\n"
      : `${failures} check(s) failed — the die is built more than once on load.\n`
  }`,
);
process.exit(failures === 0 ? 0 : 1);
