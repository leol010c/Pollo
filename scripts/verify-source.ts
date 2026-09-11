/**
 * The pool can never be emptied, and a deleted position leaves nothing behind.
 * Run with `npm run verify:source`.
 *
 * Two seams meet here, and both of them fail quietly.
 *
 * The first is arithmetic. For as long as exclusions were the only filter,
 * "how many positions are in play" was `deck.length - disabled.length`, and
 * three separate places counted it that way. The pool is a second filter, and
 * the subtraction does not know about it: set the pool to your own three and
 * that expression still answers fourteen, so a d12 stays out and prints nine of
 * them twice — which is the exact dishonesty largestDieFor exists to prevent,
 * arrived at from the other direction. Nothing throws. The die just lies.
 *
 * The second is deletion. A position is not only a row in a list: it can be
 * favourited, excluded, sitting in a part-drawn pile, fixed by the rig,
 * remembered as the last thing thrown, chosen as a forfeit, or face-up on the
 * table at the moment somebody deletes it. An id left in any of those is a
 * reference the deck can no longer resolve — and an unresolvable id renders as
 * a Joker, which looks deliberate.
 *
 * So this drives the real store the way the app drives it, and asserts the
 * invariants after every move rather than at the end of a happy path.
 */
import {
  poolSections,
  poolWithoutHalf,
  useDiceStore,
  type PoolSource,
} from "../lib/store";
import { DIE_SIDES } from "../lib/dice/types";
import { currentDeal, type DeckEntry } from "../lib/dice/deck";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

const store = useDiceStore;
const POOLS: PoolSource[] = ["all", "own", "stock"];

/** A built-in deck of `n` positions plus the joker, as loadDeck would hand it over. */
function builtins(n: number): DeckEntry[] {
  const slots: DeckEntry[] = Array.from({ length: n }, (_, i) => ({
    id: `image-${i + 1}`,
    kind: "position" as const,
    name: `Position ${i + 1}`,
    source: [`/dice/image-${i + 1}.png`],
  }));
  return [...slots, { id: "wild-choice", kind: "wild", name: "Joker", source: [] }];
}

const draft = (name: string) => ({
  name,
  description: `${name}, and they decide when it stops.`,
  intensity: 2 as const,
  measure: "strokes" as const,
});

function reset(n = 13) {
  store.setState({
    own: [],
    pool: "all",
    disabled: [],
    favourites: [],
    pile: [],
    drawn: null,
    rigChoice: [],
    rigOn: false,
    lastPositionId: null,
    chosenEntry: null,
    mode: "dice",
    phase: "idle",
    dieType: "d6",
  });
  store.getState().setDeck(builtins(n));
}

/** The invariants that must hold after every single move. */
function holds(where: string) {
  const s = store.getState();
  const inPlay = s.inPlay();
  const available = s.available();

  check(
    s.deck.length === 0 || inPlay.length > 0,
    `${where}: the pool was emptied — the die has nothing to deal`,
  );
  check(
    inPlay.every((entry) => available.some((a) => a.id === entry.id)),
    `${where}: something in play was not available`,
  );
  // The d4 is a documented floor, not a violation: largestDieFor would rather
  // offer a die that repeats than offer no die at all below four positions.
  check(
    DIE_SIDES[s.dieType] <= inPlay.length || s.dieType === "d4",
    `${where}: a ${s.dieType} over ${inPlay.length} positions — faces must repeat`,
  );
}

console.log("Roll source — the pool holds, the fix picks, and deletion lets go\n");

// --- The pool can never be emptied -----------------------------------------
{
  reset(13);
  for (const pool of POOLS) {
    store.getState().setPool(pool);
    holds(`pool=${pool}`);
  }

  // "Only ours" with nothing of ours must be refused, not obeyed.
  reset(13);
  store.getState().setPool("own");
  check(
    store.getState().pool === "all",
    "the pool switched to ours with nothing of ours in the deck",
  );
  holds("refused empty pool");
  console.log("  an empty pool is refused rather than entered");
}

// --- Switching off cannot empty it -----------------------------------------
{
  reset(13);
  store.getState().addOwn(draft("Against the wall"));
  store.getState().addOwn(draft("On the stairs"));
  store.getState().setPool("own");
  holds("two of ours");

  // Thirteen built-ins are sitting right there, but they are not what the die
  // is dealing from tonight — so the second of ours must not switch off.
  for (const entry of store.getState().deck) {
    store.getState().togglePosition(entry.id);
    holds(`toggled ${entry.id}`);
  }
  check(
    store.getState().inPlay().length >= 1,
    "toggling everything off emptied the pool",
  );
  console.log("  the last one in the pool cannot be switched off");
}

// --- The die follows the pool, not the deck --------------------------------
{
  reset(13);
  store.getState().setDieType("d12");
  check(store.getState().dieType === "d12", "a d12 over 13 positions was refused");

  store.getState().addOwn(draft("Against the wall"));
  store.getState().addOwn(draft("On the stairs"));
  store.getState().setPool("own");

  check(
    store.getState().dieType === "d4",
    `the die stayed a ${store.getState().dieType} over two of ours`,
  );
  holds("d12 clamped by the pool");
  console.log(`  a d12 over two of ours clamps to a ${store.getState().dieType}`);
}

// --- Deletion lets go of everything ----------------------------------------
{
  reset(13);
  const id = store.getState().addOwn(draft("Against the wall"));

  store.getState().toggleFavourite(id);
  store.getState().togglePosition(id);
  store.getState().toggleRigChoice(id);
  store.getState().shufflePile();
  store.setState({ lastPositionId: id, drawn: id });
  const entry = store.getState().entry(id);
  if (entry) store.setState({ chosenEntry: entry });

  store.getState().removeOwn(id);
  const s = store.getState();

  check(!s.own.some((o) => o.id === id), "the record survived its own deletion");
  check(!s.deck.some((e) => e.id === id), "the deck still holds a deleted position");
  check(!s.disabled.includes(id), "a deleted position is still excluded");
  check(!s.favourites.includes(id), "a deleted position is still favourited");
  check(!s.pile.includes(id), "a deleted position is still in the pile");
  check(!s.rigChoice.includes(id), "the rig still points at a deleted position");
  check(s.rigOn === false, "the rig is still on with nothing to fix to");
  check(s.lastPositionId !== id, "the last thrown is still a deleted position");
  check(s.chosenEntry?.id !== id, "a forfeit still holds a deleted position");
  check(s.drawn !== id, "a deleted position is still face-up on the table");
  holds("after deletion");
  console.log("  deletion leaves no dangling id in any of eight places");
}

// --- A rename keeps everything pointing at it ------------------------------
{
  reset(13);
  const id = store.getState().addOwn(draft("Against the wall"));
  store.getState().toggleFavourite(id);
  store.getState().shufflePile();
  const wasInPile = store.getState().pile.includes(id);

  store.getState().updateOwn(id, draft("On the stairs"));
  const s = store.getState();

  check(s.favourites.includes(id), "a rename lost the favourite");
  check(s.pile.includes(id) === wasInPile, "a rename disturbed the pile");
  check(
    s.entry(id)?.name === "On the stairs",
    "the rename did not reach the deck",
  );
  check(s.own.length === 1, "the rename added a second record");
  console.log("  a rename keeps its id, and everything pointing at it");
}

// --- Adding does not cost you your place in the pile -----------------------
{
  reset(13);
  store.getState().setMode("cards");
  store.getState().shufflePile();
  const before = store.getState().pile.slice(0, 4);

  const id = store.getState().addOwn(draft("Against the wall"));
  const after = store.getState().pile;

  check(after.includes(id), "a new position never reached the pile");
  check(
    before.every((card) => after.includes(card)),
    "adding a position reshuffled the pile",
  );
  console.log("  adding splices into the pile rather than reshuffling it");
}

// --- Every pool, every exclusion --------------------------------------------
{
  reset(6);
  store.getState().addOwn(draft("Against the wall"));
  store.getState().addOwn(draft("On the stairs"));
  store.getState().addOwn(draft("In the doorway"));

  let moves = 0;
  for (const pool of POOLS) {
    store.getState().setPool(pool);
    for (const entry of [...store.getState().deck]) {
      store.getState().togglePosition(entry.id);
      holds(`pool=${pool} after ${entry.id}`);
      moves++;
    }
    store.setState({ disabled: [] });
  }
  console.log(`  ${moves} pool/exclusion combinations: the invariants held throughout`);
}

/*
 * The pool reaches the faces.
 *
 * inPlay() being right is not the same as the die being right, and this is the
 * gap the two used to fall through: `deal` had the exclusion filter written out
 * inline rather than going through the getter, which was the same answer for as
 * long as exclusions were the only filter. Adding a second one did not break
 * anything loudly — the panel said "only ours" and the die went on dealing
 * built-ins onto its faces, which nothing was looking at.
 */
{
  reset(8);
  store.getState().addOwn(draft("Against the wall"));
  store.getState().addOwn(draft("On the stairs"));

  for (const pool of POOLS) {
    store.getState().setPool(pool);
    store.getState().deal();

    const allowed = new Set(store.getState().inPlay().map((entry) => entry.id));
    const dealt = currentDeal();

    check(dealt.length > 0, `pool=${pool}: nothing was dealt onto the die`);
    check(
      dealt.every((entry) => allowed.has(entry.id)),
      `pool=${pool}: the die was dealt something the pool rules out`,
    );
  }
  console.log("  every face dealt comes from the pool, in all three settings");
}

/*
 * The fix, with more than one position picked.
 *
 * "Only this one" and "one of these" are the same gesture at different sizes,
 * and the second is the interesting one: a shortlist you would both be happy
 * with, still arrived at by throwing something. Which means the pick has to be
 * drawn *per throw* — held in state it would be a stuck die with extra steps,
 * and taken during a render it would be a different answer every repaint.
 */
{
  reset(8);
  const three = store.getState().deck.slice(0, 3).map((entry) => entry.id);
  for (const id of three) store.getState().toggleRigChoice(id);

  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    store.getState().deal();
    const landed = currentDeal();
    const fixedOnes = landed.filter((entry) => three.includes(entry.id));
    check(fixedOnes.length > 0, "a fixed position did not reach the die at all");
    for (const entry of fixedOnes) seen.add(entry.id);
  }
  check(
    three.every((id) => seen.has(id)),
    "over 400 throws the fix never reached one of the three picked",
  );
  console.log(`  three picked: all three come up across 400 throws`);

  // The narrow case still behaves exactly as it did.
  store.getState().clearRigChoice();
  const one = three[1];
  store.getState().toggleRigChoice(one);
  for (let i = 0; i < 50; i++) {
    store.getState().deal();
    check(
      currentDeal().some((entry) => entry.id === one),
      "one picked did not reach the die",
    );
  }
  console.log("  one picked: it is on the die every single throw");

  // Unpicking the last one is the same thing as switching the fix off.
  store.getState().toggleRigChoice(one);
  check(store.getState().rigOn === false, "unpicking the last one left the fix armed");
  check(store.getState().rigChoice.length === 0, "unpicking the last one left it behind");
  console.log("  unpicking the last one takes the fix out");
}

/*
 * A fix cannot reach past the pool.
 *
 * Picking something and then ruling it out is an ordinary sequence — the fix
 * list is read once and the pool is changed later — and the answer has to be
 * that the fix quietly does not fire, not that the die deals something the
 * panel says is out of play.
 */
{
  reset(8);
  store.getState().addOwn(draft("Against the wall"));
  const built = store.getState().deck.filter((e) => !e.id.startsWith("own-"));
  store.getState().toggleRigChoice(built[0].id);
  store.getState().setPool("own");
  store.getState().deal();

  const allowed = new Set(store.getState().inPlay().map((entry) => entry.id));
  check(
    currentDeal().every((entry) => allowed.has(entry.id)),
    "a fix reached past the pool and put a ruled-out position on the die",
  );
  console.log("  a fix on something the pool rules out simply does not fire");
}

/*
 * The pool, read as two switches, covers every state and reaches no dead end.
 *
 * The panel no longer has a "roll from" control; it has a switch on each of the
 * two section headings, and this is the translation between those two shapes.
 * The property that matters is that it is total in both directions — every pool
 * reads as at least one half in play, and flipping either half from any state
 * lands on a legal pool the store will actually accept.
 */
{
  for (const pool of POOLS) {
    const { yours, stock } = poolSections(pool);
    check(yours || stock, `pool=${pool}: both halves read as switched off`);

    // Exactly the two taps the headings offer, from this state.
    const afterYours = yours ? poolWithoutHalf("yours") : "all";
    const afterStock = stock ? poolWithoutHalf("stock") : "all";

    for (const [half, next] of [
      ["yours", afterYours],
      ["built-in", afterStock],
    ] as const) {
      const read = poolSections(next);
      check(
        read.yours || read.stock,
        `pool=${pool}: switching ${half} left both halves off`,
      );
      check(
        POOLS.includes(next),
        `pool=${pool}: switching ${half} produced a pool that does not exist`,
      );
    }
  }

  // And the locks: the heading that is the only half left must refuse.
  reset(8);
  store.getState().addOwn(draft("Against the wall"));
  for (const pool of POOLS) {
    store.getState().setPool(pool);
    const { yours, stock } = poolSections(store.getState().pool);
    const locked = (yours && !stock) || (stock && !yours);
    check(
      locked === (store.getState().pool !== "all"),
      `pool=${store.getState().pool}: the lock disagrees with the state`,
    );
  }
  console.log("  the two section switches cover all three pools, with no dead end");
}

if (problems.length > 0) {
  console.log("");
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("\n  OK  the pool always has something in it, and nothing outlives deletion");
