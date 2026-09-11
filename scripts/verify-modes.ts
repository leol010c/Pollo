/**
 * The two modes share one result pipeline. Run with `npm run verify:modes`.
 *
 * verify-pile.ts checks the pile arithmetic in isolation; this drives the real
 * store the way the app does — play(), settleCard(), layDown(), notTonight() —
 * because the pile being correct is not the same as the app drawing from it
 * correctly, and every bug worth worrying about here lives in the seam.
 *
 * The seam in question: one action bar, one announcer and one history serve both
 * a die and a deck of cards, on the strength of currentEntry() returning the
 * right thing and a handful of shared actions branching on mode. Those branches
 * are cheap to get subtly wrong — a play() that bumps the die's roll counter in
 * card mode would leave the die throwing itself invisibly behind the cards, and
 * nothing on screen would say so.
 */
import { useDiceStore } from "../lib/store";
import { currentDeal, type DeckEntry } from "../lib/dice/deck";
import { DIE_SIDES } from "../lib/dice/types";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

function fakeDeck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

const store = useDiceStore;

/** Back to a known state: a fresh deck, in card mode, nothing drawn. */
function reset(size = 12) {
  store.setState({
    mode: "dice",
    phase: "idle",
    value: null,
    drawn: null,
    pile: [],
    disabled: [],
    favourites: [],
    history: [],
    stake: null,
    lastPositionId: null,
    rollId: 0,
    rollRequest: 0,
    layRequest: 0,
    // Cleared here too, now that picking is a toggle rather than an assignment.
    // Three sections below arm the fix on the same id, and without this the
    // second one silently unpicked what the first had picked.
    rigChoice: [],
    rigOn: false,
  });
  store.getState().setDeck(fakeDeck(size));
}

/** One complete draw: what a tap on the stack plus CardTable's flip amount to. */
function draw() {
  store.getState().play();
  store.getState().settleCard();
  return store.getState().drawn;
}

// --- A pass through the deck, driven through the store --------------------

{
  reset(12);
  store.getState().setMode("cards");

  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = draw();
    check(
      store.getState().phase === "settled",
      "a settled card did not reach the settled phase",
    );
    check(id !== null, "a draw produced no card");
    if (id) seen.push(id);
    store.getState().layDown();
  }

  check(seen.length === 12, `a 12-card pass produced ${seen.length} cards`);
  check(
    new Set(seen).size === 12,
    "a single pass through the deck repeated a card",
  );
  check(
    store.getState().pile.length === 0,
    "the pile was not spent after a full pass",
  );

  // The thirteenth draw is the reshuffle, and must not hand back the twelfth.
  const last = seen[11];
  const next = draw();
  check(
    store.getState().justShuffled,
    "the draw after a spent pile did not report a reshuffle",
  );
  check(next !== last, "the reshuffle dealt the card that was just face-up");
  check(
    store.getState().pile.length === 11,
    "the reshuffled pile was not a full deck less the card drawn from it",
  );
}

/*
 * Only a deliberate shuffle bumps shuffleId.
 *
 * The stack watches that counter to play its riffle, and a draw that had to
 * reshuffle plays its own inside the flip timeline instead. If drawCard() ever
 * bumps the counter too, both fire at once on the same elements and the stack
 * snaps to rest halfway through the cut. Nothing throws; it just looks broken,
 * which is exactly the sort of thing that gets "tidied" back in later.
 */
{
  reset(12);
  store.getState().setMode("cards");

  const atStart = store.getState().shuffleId;
  for (let i = 0; i < 12; i++) {
    draw();
    store.getState().layDown();
  }
  check(
    store.getState().shuffleId === atStart,
    "drawing through the deck bumped shuffleId",
  );

  // The thirteenth draw reshuffles — still silently, via justShuffled.
  draw();
  check(
    store.getState().justShuffled,
    "the reshuffling draw did not set justShuffled",
  );
  check(
    store.getState().shuffleId === atStart,
    "a reshuffle inside a draw bumped shuffleId, racing the flip animation",
  );

  // An outright shuffle does bump it, and does not claim to be a draw's.
  store.getState().shufflePile();
  check(
    store.getState().shuffleId === atStart + 1,
    "shufflePile() did not bump shuffleId",
  );
  check(
    !store.getState().justShuffled,
    "shufflePile() left justShuffled set, so the next draw would riffle twice",
  );
}

// --- play() dispatches to the right object --------------------------------

{
  reset(12);

  // Dice mode: bumps the counter the die watches, and touches no card state.
  const rollsBefore = store.getState().rollRequest;
  store.getState().play();
  check(
    store.getState().rollRequest === rollsBefore + 1,
    "play() in dice mode did not ask the die to throw",
  );
  check(
    store.getState().drawn === null,
    "play() in dice mode turned over a card",
  );

  // Card mode: draws, and leaves the die's counter alone. A bump here would
  // have the die throwing itself behind the cards, unseen.
  store.getState().setMode("cards");
  const rolls = store.getState().rollRequest;
  draw();
  check(
    store.getState().rollRequest === rolls,
    "play() in card mode also asked the die to throw",
  );
  check(store.getState().drawn !== null, "play() in card mode drew nothing");
}

// --- currentEntry() is the seam -------------------------------------------

{
  reset(12);
  store.getState().setMode("cards");
  const id = draw();
  const entry = store.getState().currentEntry();
  check(entry?.id === id, "currentEntry() did not return the drawn card");

  // Gated on phase, not on drawn: layDown keeps the card so its face stays
  // painted while it turns back over, which is only safe if every reader is
  // looking at the phase.
  store.getState().layDown();
  check(
    store.getState().drawn === id,
    "layDown() dropped the card mid-turn, blanking its face",
  );
  check(
    store.getState().phase === "idle",
    "layDown() did not put the card back down",
  );
}

// --- Ruling one out while in card mode ------------------------------------

{
  reset(12);
  store.getState().setMode("cards");
  const rejected = draw();
  store.getState().notTonight();

  check(
    store.getState().disabled.includes(rejected!),
    "notTonight() did not rule the card out",
  );
  check(
    !store.getState().pile.includes(rejected!),
    "a card ruled out was left in the pile",
  );
  check(
    store.getState().drawn !== rejected,
    "notTonight() did not draw a replacement",
  );

  // And it stays out for the rest of the deck, including across a reshuffle.
  store.getState().settleCard();
  for (let i = 0; i < 30; i++) {
    if (draw() === rejected) {
      check(false, "a card ruled out came back around");
      break;
    }
    store.getState().layDown();
  }
}

// --- Editing the deck mid-pile --------------------------------------------

{
  reset(12);
  store.getState().setMode("cards");
  draw();
  store.getState().layDown();
  draw();
  store.getState().layDown();

  const pile = store.getState().pile;
  const target = pile[2];

  store.getState().togglePosition(target);
  check(
    !store.getState().pile.includes(target),
    "switching a position off left it in the pile",
  );
  check(
    store.getState().pile.length === pile.length - 1,
    "switching a position off changed the pile by more than one card",
  );

  store.getState().togglePosition(target);
  check(
    store.getState().pile.filter((id) => id === target).length === 1,
    "switching a position back on did not return it exactly once",
  );
  check(
    store.getState().pile.length === pile.length,
    "switching a position back on left the pile the wrong size",
  );
}

// --- History records a card as a card --------------------------------------

{
  reset(12);
  store.getState().setMode("cards");
  const id = draw();

  const [newest] = store.getState().history;
  check(Boolean(newest), "a card draw recorded no history");
  check(
    newest?.name === store.getState().entry(id!)?.name,
    "the history chip did not record the card's name",
  );
  check(
    newest?.type === undefined && newest?.value === undefined,
    "a card draw recorded a die type or a face number",
  );

  // Capped the same as the die's.
  for (let i = 0; i < 20; i++) {
    draw();
    store.getState().layDown();
  }
  check(
    store.getState().history.length === 5,
    `history grew to ${store.getState().history.length}, past its limit`,
  );

  // Every id distinct, so React's keys hold across a run of draws.
  const ids = store.getState().history.map((h) => h.id);
  check(new Set(ids).size === ids.length, "history entries shared a key");
}

// --- Switching modes leaves nothing stale ----------------------------------

{
  reset(12);
  store.getState().setMode("cards");
  draw();
  store.getState().startStake("time", 60);

  store.getState().setMode("dice");
  check(store.getState().phase === "idle", "a card was still up in dice mode");
  check(store.getState().stake === null, "a card's stake survived into dice mode");
  check(
    store.getState().currentEntry() === undefined,
    "a result survived the mode switch",
  );

  // Back again: a fresh full pile, nothing on the table.
  store.getState().setMode("cards");
  check(
    store.getState().pile.length === 12,
    `returning to cards gave a pile of ${store.getState().pile.length}`,
  );
  check(store.getState().drawn === null, "returning to cards left a card up");
}

/*
 * The die's own path still works.
 *
 * The shared actions grew mode branches, and the one that would hurt most is a
 * die roll that quietly stopped recording itself.
 */
{
  reset(12);
  store.getState().beginRoll();
  check(store.getState().phase === "rolling", "beginRoll did not start a roll");
  store.getState().settle(3);
  check(store.getState().phase === "settled", "the die did not settle");
  check(
    store.getState().history.length === 1,
    "a die roll recorded no history",
  );
  check(
    store.getState().history[0].type === "d6",
    "a die roll did not record its solid",
  );
  check(
    store.getState().history[0].value === 3,
    "a die roll did not record its face",
  );
}

/*
 * A one-position deck.
 *
 * The smallest deck is where every no-repeat rule has to give way, and giving
 * way gracefully is the requirement — a pile that refused to deal its only card
 * would be a mode that cannot be played at all.
 */
{
  reset(1);
  store.getState().setMode("cards");
  for (let i = 0; i < 5; i++) {
    check(draw() === "entry-1", "a one-card deck failed to deal its card");
    store.getState().layDown();
  }
}

/*
 * The fix, in both modes — and nowhere near the physics.
 *
 * It is a joke, but one with several ways of quietly stopping working, and none
 * of them show up by playing for a minute.
 *
 * The die is the delicate half, and both of the ways it has been got wrong were
 * ways of being *seen*. Dealing the chosen position onto every face works and is
 * instantly obvious to anybody who glances at the die — six identical pictures
 * is a prop, not a solid. Reporting a different face than the one it landed on
 * works too, and is obvious to anybody watching the die instead of the screen.
 *
 * So the deal stays honest and the fixed position is dealt onto the face the
 * throw is already going to stop on, which is what the checks below are holding
 * in place: the fixed face is the one asked for, the die still carries its own
 * six positions around it, and the face that lands is the position announced.
 * Whether the throw really does stop there is physics, and is measured in
 * scripts/verify-fix.ts.
 *
 * And a fixed card that still drew from the pile would empty it within a few
 * draws and start announcing a reshuffle, which is the one thing on screen that
 * would give the game away.
 */
{
  reset(12);
  const fixedId = "entry-3";
  const faces = () => DIE_SIDES[store.getState().dieType];

  store.getState().toggleRigChoice(fixedId);

  /*
   * --- The die --------------------------------------------------------------
   *
   * Twenty rounds rather than one pass, because the way this failed was
   * *intermittent*: the deal leaves out whatever came up last, so after a fixed
   * throw the fixed position is the one thing excluded from the next deal — and
   * the trick worked, then did not, then did.
   */
  for (let round = 0; round < 20; round++) {
    // The face the forecast has just picked out of the throw in the air. Every
    // face in turn, because the fix must not care which one it is handed.
    const landing = (round % faces()) + 1;
    store.getState().deal(landing);
    const dealt = currentDeal().slice(0, faces());

    // The die is still a die: six different positions, no repeats.
    check(
      new Set(dealt.map((e) => e.id)).size === dealt.length,
      `round ${round}: the fix stacked the deal — the die repeats a position`,
    );

    // And the fixed one is among them, exactly once, so there is a face to land
    // on and no second copy of it anywhere else on the solid.
    check(
      dealt.filter((e) => e.id === fixedId).length === 1,
      `round ${round}: the fixed position is not on the die exactly once`,
    );

    // On the face the throw is heading for, which is the whole of the trick.
    check(
      dealt[landing - 1]?.id === fixedId,
      `round ${round}: the fix was not dealt onto the face the die lands on`,
    );

    // And that face is what the round reports, with no substitution anywhere in
    // between — the picture on the die and the position announced are one thing.
    store.getState().beginRoll();
    store.getState().settle(landing);
    check(
      store.getState().currentEntry()?.id === fixedId,
      `round ${round}: the fixed face did not resolve to the fixed position`,
    );
    store.getState().layDown();
  }

  // --- Disarming leaves the choice behind, so it can be put back ---
  store.getState().setRigOn(false);
  check(
    store.getState().rigChoice.join() === fixedId,
    "taking the fix out forgot which position it was",
  );
  {
    // Landing faces handed over exactly as a rigged throw would hand them over.
    // With the fix out they must mean nothing: the deal is not to reach for the
    // chosen position just because it has been told where the die will stop.
    const landed = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const landing = (i % faces()) + 1;
      store.getState().deal(landing);
      store.getState().beginRoll();
      store.getState().settle(landing);
      landed.add(store.getState().currentEntry()?.id ?? "");
      store.getState().layDown();
    }
    check(landed.size > 1, "the die stayed fixed after the fix was taken out");
  }
  store.getState().setRigOn(true);

  // --- The cards: the same card, and the pile untouched beneath it ---
  reset(12);
  store.getState().setMode("cards");
  store.getState().toggleRigChoice(fixedId);
  const pileBefore = store.getState().pile.length;
  for (let i = 0; i < 20; i++) {
    check(draw() === fixedId, `a fixed draw came up honest on draw ${i}`);
    check(
      !store.getState().justShuffled,
      `a fixed draw announced a reshuffle on draw ${i}`,
    );
    store.getState().layDown();
  }
  check(
    store.getState().pile.length === pileBefore,
    "a fixed draw ate the pile underneath it",
  );

  // --- Taking it out puts the game back ---
  store.getState().setRigOn(false);
  const after = new Set<string>();
  for (let i = 0; i < 20; i++) {
    after.add(draw() ?? "");
    store.getState().layDown();
  }
  check(after.size > 1, "the deck stayed fixed after the fix was taken out");

  // --- And a fix on something out of play is no fix at all ---
  reset(12);
  store.getState().setMode("cards");
  store.getState().toggleRigChoice(fixedId);
  store.getState().togglePosition(fixedId);
  const honest = new Set<string>();
  for (let i = 0; i < 20; i++) {
    honest.add(draw() ?? "");
    store.getState().layDown();
  }
  check(
    !honest.has(fixedId),
    "a position switched off still came up because it was fixed",
  );
  check(honest.size > 1, "ruling the fixed position out left the deck stuck");
}

console.log("Modes — card draws and die rolls through the real store");

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("  OK  one pipeline, two objects, nothing leaking between them");
