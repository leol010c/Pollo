/**
 * The disguise holds. Run with `npm run verify:discreet`.
 *
 * Discreet mode is the one feature in this app whose failure is not cosmetic. If
 * the die comes back wearing artwork, or the announcer reads a position's name
 * out loud, or the room is still candlelit and strewn with petals, the app has
 * quietly told someone something about its owner that they took a deliberate
 * step to keep to themselves. That is worse than a bug; it is a betrayal of the
 * only promise the mode makes.
 *
 * It is also a feature that is nearly impossible to check by looking. The whole
 * point of it is that the screen is *unremarkable*, and an unremarkable screen is
 * exactly what a tired eye signs off on — one stray label in a popover, one
 * `aria-label` on a chip, one petal in the corner, and it still looks fine. So
 * the properties are asserted here instead, in the same terms the app renders in.
 *
 * What this cannot check is the pixels: whether the numerals are legible on the
 * baize, whether the die reads as a die. That is what the screenshot pass is for.
 * What it can check is that nothing nameable is reachable — and that is the half
 * that matters, because it is the half that leaks.
 */
import { useDiceStore } from "../lib/store";
import type { DeckEntry } from "../lib/dice/deck";
import { defaultFaceSet, discreetFaceSet } from "../lib/dice/faceSet";
import { DIE_SIDES, DIE_TYPES } from "../lib/dice/types";
import { defaultBackdrop, plain, THEMES } from "../lib/scene/backdrops";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

function fakeDeck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    intensity: 2 as const,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

const store = useDiceStore;

function reset(size = 12) {
  store.setState({
    mode: "dice",
    dieType: "d6",
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
    discreet: false,
  });
  store.getState().setDeck(fakeDeck(size));
}

/*
 * Nothing on a disguised face has a name or a picture.
 *
 * This is the check the whole file exists for. The die is painted from a FaceSet
 * and the reveal, the announcer and the history chips all read their text from
 * the same one, so a face set that answers `undefined` to every question about a
 * face is the single point where all of them are made safe at once.
 *
 * Asserted against the real `symbols` set as a control, because a check that
 * only proves the plain set is plain would also pass if someone wired the plain
 * set in permanently and deleted the feature.
 */
{
  for (const type of DIE_TYPES) {
    for (let value = 1; value <= DIE_SIDES[type]; value++) {
      check(
        discreetFaceSet.sourceFor?.(value) === undefined,
        `the discreet face set has artwork on face ${value}`,
      );
      check(
        discreetFaceSet.labelFor?.(value) === undefined,
        `the discreet face set names face ${value}`,
      );
      check(
        discreetFaceSet.intensityFor?.(value) === undefined,
        `the discreet face set rates face ${value}`,
      );
      // The token is what the atlas compares to decide whether to repaint, and
      // for the positions set it is built from the entry's *name*. A disguised
      // set must not be answering that question at all.
      check(
        discreetFaceSet.tokenFor?.(value) === undefined,
        `the discreet face set has a token on face ${value}`,
      );
      check(
        discreetFaceSet.hintFor?.(value) === undefined,
        `the discreet face set carries a hint on face ${value}`,
      );
      check(
        discreetFaceSet.isWild?.(value) !== true,
        `the discreet face set has a wild on face ${value}`,
      );
    }
  }

  check(
    discreetFaceSet.id !== defaultFaceSet.id,
    "the discreet face set and the ordinary one are the same set — " +
      "either the disguise does nothing or the app is permanently disguised",
  );
  check(
    typeof discreetFaceSet.draw === "function",
    "the discreet face set draws nothing, so every face would come up blank",
  );
}

/*
 * The room has nothing suggestive left standing in it.
 *
 * Candles and petals are scenery rather than content, which is precisely why
 * they are easy to forget: nothing about them is named, so nothing about them
 * shows up in a search for names.
 */
{
  check(plain.flame === undefined, "the discreet room still has candles lit");
  check(plain.petals === false, "the discreet room still has petals scattered");
  check(
    plain.spot?.gobo !== true,
    "the discreet room still dapples its light — that reads as atmosphere",
  );
  check(
    plain.spot?.flicker === undefined,
    "the discreet room's lamp still flickers, which reads as candlelight",
  );
  /*
   * Against every room that can be showing, not only the default one.
   *
   * The user picks their room now, so "the ordinary room" is any of four. The
   * disguise has to be distinguishable from all of them: if a room were ever
   * authored close enough to the baize that the two were hard to tell apart, the
   * toggle would appear to do nothing, and someone would leave it off believing
   * it was on. That is the one failure of this mode that costs something real.
   */
  for (const room of THEMES) {
    check(
      plain.id !== room.id,
      `the discreet room is also offered as a choice (${room.id})`,
    );
    check(
      plain.background !== room.background,
      `the discreet room shares ${room.id}'s browser theme colour — ` +
        "the address bar would stay that colour over a green table",
    );
    check(
      plain.floor.color !== room.floor.color,
      `the discreet room's cloth is the same colour as ${room.id}'s`,
    );
  }

  // The petals still have to exist for the ordinary room. A flag that silently
  // turned them off everywhere would pass every check above. Checked on the
  // default rather than on all of them: `bare` has no petals on purpose, and
  // that is a taste rather than a disguise.
  check(
    defaultBackdrop.petals !== false && defaultBackdrop.flame !== undefined,
    "the ordinary room lost its candles or its petals",
  );
}

/*
 * Turning it on clears the screen and drops card mode.
 *
 * The clearing matters more than it looks: this is the tap someone makes when
 * another person walks in, and whatever was on screen a moment earlier must not
 * still be there a moment later.
 */
{
  reset(12);
  store.getState().setMode("cards");
  store.getState().play();
  store.getState().settleCard();
  check(store.getState().phase === "settled", "the card never turned over");

  store.getState().setDiscreet(true);

  check(store.getState().discreet, "setDiscreet(true) did not take");
  check(
    store.getState().mode === "dice",
    "discreet mode left the cards on the table",
  );
  check(
    store.getState().phase === "idle",
    "discreet mode left a result standing",
  );
  check(
    store.getState().history.length === 0,
    "discreet mode kept a row of position artwork in the history",
  );
  check(store.getState().stake === null, "discreet mode left a stake running");
}

/*
 * Nothing is thrown away.
 *
 * The mode is a disguise, not a reset. Someone who puts the app away mid-evening
 * and takes it out again half an hour later has to find it exactly as they left
 * it — the same positions ruled out, the same ones favoured — or the cost of
 * hiding is losing your place, and nobody pays that twice.
 */
{
  reset(12);
  store.getState().togglePosition("entry-3");
  store.getState().togglePosition("entry-7");
  store.getState().toggleFavourite("entry-5");

  const disabled = [...store.getState().disabled].sort();
  const favourites = [...store.getState().favourites].sort();
  const deck = store.getState().deck.map((entry) => entry.id);

  store.getState().setDiscreet(true);
  store.getState().setDiscreet(false);

  check(
    [...store.getState().disabled].sort().join() === disabled.join(),
    "a round trip through discreet mode changed which positions are in play",
  );
  check(
    [...store.getState().favourites].sort().join() === favourites.join(),
    "a round trip through discreet mode lost the favourites",
  );
  check(
    store
      .getState()
      .deck.map((entry) => entry.id)
      .join() === deck.join(),
    "a round trip through discreet mode changed the deck",
  );
  check(!store.getState().discreet, "setDiscreet(false) did not take");
}

/*
 * A disguised roll still records a face number.
 *
 * RollHistory prints `entry.value` while disguised, through the same branch a
 * missing artwork file uses. A chip with no number in it renders as an empty
 * square, which is a small bug with an outsized tell: a row of blank boxes is
 * conspicuous in a way a row of numbers is not.
 */
{
  reset(12);
  store.getState().setDiscreet(true);
  store.getState().beginRoll();
  store.getState().settle(4);

  const [latest] = store.getState().history;
  check(latest !== undefined, "a disguised roll recorded no history at all");
  check(
    latest?.value === 4,
    "a disguised roll recorded no face number, so its chip would be blank",
  );
}

/*
 * A tap on the felt throws rather than putting the die down.
 *
 * DiceScene reads `discreet` out of the store in its pointer handler, so this
 * asserts the state that handler branches on rather than the handler itself:
 * settling must leave the phase somewhere the tap can act on.
 */
{
  reset(12);
  store.getState().setDiscreet(true);
  store.getState().beginRoll();
  store.getState().settle(2);
  check(
    store.getState().phase === "settled",
    "a disguised roll did not settle, so a tap would do nothing",
  );

  const before = store.getState().rollRequest;
  store.getState().play();
  check(
    store.getState().rollRequest === before + 1,
    "playing from a settled disguised die did not ask for a throw",
  );
}

console.log("Discreet — nothing nameable is reachable while disguised");

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

/*
 * A position somebody wrote themselves leaks nothing either.
 *
 * The disguise was built when every position was a drawing shipped in the app,
 * and a drawing is not very incriminating on its own. Hand-written ones are a
 * different proposition: they are in somebody's own words, and one of them is
 * drawn on the die as *the first letter of its name*. That is a new way for a
 * name to reach the screen, and it arrived after this file was written.
 *
 * The structural answer is that discreet mode swaps the whole face set, so the
 * monogram is never reached — but "never reached" is an argument, and this is
 * the file that turns arguments about the disguise into assertions.
 */
{
  reset(12);
  store.getState().restoreOwn(
    [
      {
        id: "own-testtesttest",
        name: "Against the wall",
        description: "They decide when you are allowed to turn around.",
        intensity: 3,
        measure: "strokes",
        order: 0,
      },
    ],
    "all",
  );
  store.getState().setDiscreet(true);

  const written = "Against the wall";
  const initial = "A";

  for (const type of DIE_TYPES) {
    for (let value = 1; value <= DIE_SIDES[type]; value++) {
      const said = [
        discreetFaceSet.labelFor?.(value),
        discreetFaceSet.hintFor?.(value),
        discreetFaceSet.sourceFor?.(value),
        discreetFaceSet.tokenFor?.(value),
      ];
      check(
        said.every((answer) => answer === undefined),
        `a disguised face answered a question about face ${value}`,
      );
      check(
        !said.some((answer) => typeof answer === "string" && answer.includes(written)),
        `a hand-written name reached face ${value} while disguised`,
      );
      check(
        !said.some((answer) => answer === initial),
        `a hand-written initial reached face ${value} while disguised`,
      );
    }
  }

  // And it is still there when the disguise comes off — the deck is untouched.
  store.getState().setDiscreet(false);
  check(
    store.getState().deck.some((entry) => entry.name === written),
    "the disguise ate a hand-written position",
  );
  check(
    store.getState().own.length === 1,
    "the disguise ate the record behind a hand-written position",
  );
  console.log("  no hand-written name or initial reaches a disguised face");
}

/*
 * The disguise tears down a half-written position.
 *
 * This is the tap somebody makes when another person walks into the room, and a
 * form full of their own words is the single worst thing that could survive it —
 * worse than the grid of positions the forfeit picker had to learn to drop, and
 * for the same reason.
 */
{
  reset(12);
  store.getState().setEditing("new");
  store.getState().setDiscreet(true);
  check(
    store.getState().editing === null,
    "a half-written position survived the disguise going on",
  );
  console.log("  a half-written position goes with the screen it was on");
}

console.log("  OK  plain faces, a plain room, and the deck kept intact");
