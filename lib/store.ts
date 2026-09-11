"use client";

import { create } from "zustand";
import {
  DIE_SIDES,
  DIE_TYPES,
  largestDieFor,
  type DieType,
} from "./dice/types";
import {
  dealFaces,
  dealtTo,
  fixFace,
  type CardKind,
  type DeckEntry,
  type Measure,
} from "./dice/deck";
import { insertInto, removeFrom, shuffledPile } from "./cards/pile";
import {
  CARDS_PER_BET,
  calledRight,
  freshShoe,
  type Call,
  type PlayingCard,
} from "./cards/playing";
import { setBuiltinEntries, setOwnEntries } from "./dice/deck";
import {
  isOwn,
  newOwnId,
  serialiseOwn,
  toEntry,
  type OwnPosition,
} from "./dice/own";
import { resolvedSource } from "./dice/stencil";
import {
  writeDiscreet,
  writeDieType,
  writeHidden,
  writeLoved,
  writeOwn,
  writePool,
  writeTheme,
} from "./prefs";
import { defaultBackdrop } from "./scene/backdrops";

/**
 * Which object is in play.
 *
 * Not two apps: both modes read the same deck, produce the same DeckEntry, and
 * hand it to the same controls. What differs is how the entry is chosen — the die
 * re-deals every throw, the cards are drawn without replacement — and what you
 * watch while it is being chosen.
 */
export type GameMode = "dice" | "cards";

/**
 * Which half of the deck the die and the pile draw from.
 *
 * A filter on top of `disabled` rather than a replacement for it, because the
 * two say different things. Switching a position off is a verdict on that
 * position; this is a decision about the evening — tonight we are only using
 * the ones we wrote, or only the ones that came with it — and it has to be
 * reversible in one tap without having lost the verdicts underneath.
 *
 * Note that "own" takes the Joker out too. It is not a position somebody wrote,
 * and a deck labelled "only ours" that still deals a card from the app would be
 * lying about a thing the label is specifically for.
 */
export type PoolSource = "all" | "own" | "stock";

/**
 * A stored pool string, ruled on.
 *
 * prefs.ts hands back whatever was in storage without an opinion about it, the
 * same way it does for the room and the die. This is where the opinion lives.
 */
export function asPool(raw: string | null): PoolSource | null {
  return raw === "own" || raw === "stock" ? raw : null;
}

/**
 * The pool, read as two switches — one per half of the deck.
 *
 * The panel presents the pool as a switch on each section heading rather than
 * as a control of its own, because a heading that says "Yours" and a button
 * that says "only ours" are the same statement in two vocabularies, and having
 * both on screen made one choice look like two. This is the translation between
 * the two shapes, and it lives here rather than in the view so that the thing
 * being asserted is the thing being rendered.
 *
 * Both halves off is not a state: the die would have nothing to deal. The panel
 * locks the last one on, the way the position list locks the last position in
 * play, and setPool refuses it besides.
 */
export function poolSections(pool: PoolSource): {
  yours: boolean;
  stock: boolean;
} {
  return { yours: pool !== "stock", stock: pool !== "own" };
}

/** The pool that results from switching one half off. */
export function poolWithoutHalf(half: "yours" | "stock"): PoolSource {
  return half === "yours" ? "stock" : "own";
}

/**
 * The pool filter, as a plain function.
 *
 * Exported and pure because a component cannot ask the getter. Subscribing to
 * `s.inPlay` subscribes to a *function*, which never changes — the value would
 * be right on first render and then quietly stop updating. Components subscribe
 * to `deck`, `disabled` and `pool` atomically, the way this store is used
 * everywhere, and call this. The getter above is the same thing for callers
 * that already hold the state.
 */
export function inPlayOf(
  available: DeckEntry[],
  pool: PoolSource,
): DeckEntry[] {
  if (pool === "all") return available;
  return available.filter((entry) =>
    pool === "own" ? isOwn(entry.id) : !isOwn(entry.id),
  );
}

/**
 * Where a result is in its life.
 *
 * Shared by both modes deliberately, so every piece of UI that keys off it —
 * the controls, the announcer, the roll hint — works in either without knowing
 * which is running. "rolling" means the die is tumbling or the card is turning.
 */
type Phase = "idle" | "rolling" | "settled";

export interface HistoryEntry {
  /** Matches the rollId it came from, so it's stable as a list key. */
  id: number;
  /** Absent for a card draw, which has no solid. */
  type?: DieType;
  /** Absent for a card draw, which has no face number. */
  value?: number;
  /**
   * What was actually showing, captured at the moment it landed.
   *
   * Not looked up later from the face value: the deck re-deals on every throw,
   * so the same value means a different position next time and a history that
   * resolved lazily would silently rewrite itself.
   */
  image?: string;
  name?: string;
  /**
   * Whether this was a wild.
   *
   * Captured rather than looked up, for the same reason the image is: the deck
   * re-deals every throw, so resolving it later would describe a different
   * card. Without it the history chip has no image to show and falls back to
   * printing the face number, which is how a Joker ended up as a digit.
   */
  kind?: CardKind;
}

/** How many past results are kept. Enough to glance at, not a log. */
export const HISTORY_LIMIT = 5;

/**
 * What a lost double-or-nothing drops to, per measure.
 *
 * Not zero, in either unit. "Nothing" meaning the position ends immediately is
 * the literal reading, and it turns a playful gamble into a punishment — the
 * point is that taking it should be tempting. So a loss is the smallest thing
 * on the wheel rather than the end of the round.
 *
 * The two floors are the shortest entry of their own wheel. See STAKES.
 */
export const DOUBLE_OR_NOTHING_FLOOR: Record<Measure, number> = {
  time: 30,
  strokes: 20,
};

/**
 * What the wheel can land on, per measure.
 *
 * Both weighted toward the cheap end. A flat spread would make the longest as
 * likely as the shortest, and a gamble is only tempting when the long odds are
 * genuinely long — which is why 300 seconds and 200 strokes each appear once.
 *
 * The strokes wheel is not a conversion of the seconds one. It is built to the
 * same *shape* — a cheap floor, a fat middle, one number that reads as a dare —
 * because that shape is what makes the spin worth watching, not the units.
 */
export const STAKES: Record<Measure, number[]> = {
  time: [30, 45, 60, 60, 90, 120, 180, 300],
  strokes: [20, 30, 40, 50, 50, 75, 100, 200],
};

/**
 * How a bet went.
 *
 * Named from the bettor's side, because they are the one who took it: "won"
 * buys another result, "lost" hands the other person a joker. Shared by the
 * coin and by the card mode's call, which stake and pay exactly the same thing.
 */
export type CoinOutcome = "won" | "lost";

/** Which gamble is on the table. Only ever one of them at a time. */
export type BetKind = "coin" | "highlow";

/**
 * The coin, from the moment it is tossed until its result has been seen.
 *
 * The outcome is decided when the coin is *tossed*, not when it lands — the
 * animation is a reading of a number already in state, never the thing that
 * produces it. A coin that decided its own result would have to be trusted to
 * land flat, and no physical simulation can be trusted to do that on every
 * viewport, at every frame rate, on every phone.
 */
export interface CoinFlip {
  outcome: CoinOutcome;
  /** Bumped per toss, so the scene replays even on the same outcome twice. */
  flipId: number;
  /**
   * Whether it has come down.
   *
   * The outcome is known from the moment of the toss, so without this the app
   * would know it had lost while the coin was still in the air — and the notice
   * saying so would open over the top of it. Nothing may act on a result the
   * screen has not caught up with.
   */
  landed: boolean;
}

/**
 * The two cards on the felt, from the deal until the result has been seen.
 *
 * The card mode's twin of CoinFlip, and it follows the same rule for the same
 * reason: `next` is decided when the pair is *dealt*, before anything has been
 * called. A card chosen after the call is a card that could have been chosen to
 * beat it, and no amount of good intent makes that provable to somebody who
 * suspects otherwise. Dealt first, the deck cannot cheat and verify:highlow can
 * demonstrate it — the distribution of `next` is identical whichever way the
 * run always calls.
 *
 * What it does *not* share with the coin is where the answer comes from. A coin
 * has to invent its outcome; this one already has both cards, so the outcome is
 * a comparison rather than a number. See calledRight.
 */
export interface HighLow {
  /** Face-up from the moment it is dealt. The card you call against. */
  lying: PlayingCard;
  /** Face-down beside it. Known to the store, not to the screen. */
  next: PlayingCard;
  /** What was called. Null until somebody calls it. */
  call: Call | null;
  /** Bumped per bet, so the same pair twice still replays. */
  betId: number;
  /**
   * Whether `next` has finished turning over.
   *
   * Exactly CoinFlip.landed, and load-bearing for exactly the same reason: the
   * result exists from the deal, so without this the app would know it had lost
   * while the card was still face-down, and the notice saying so would open
   * over the top of it.
   */
  turned: boolean;
}

interface DiceState {
  /** Die or cards. See GameMode. */
  mode: GameMode;
  /** Which solid is in play. Changing it swaps the die for a new one. */
  dieType: DieType;
  phase: Phase;
  /** Face value of the die at rest; null while it's moving. */
  value: number | null;
  /** Incremented on each throw — the reveal animation keys off this so that
   *  rolling the same number twice still replays. */
  rollId: number;
  /**
   * Incremented to ask the die to throw itself.
   *
   * The die lives inside the Canvas and the UI outside it, so a button can't
   * call into it directly. Watching a counter keeps that one-way: the store
   * never reaches into the scene, the scene just notices the number changed.
   */
  rollRequest: number;
  /**
   * Incremented to ask the die to return to the table.
   *
   * Same one-way channel as rollRequest: the UI can't reach into the scene, so
   * it changes a number the die is watching.
   */
  layRequest: number;
  /**
   * The deck, once discovered.
   *
   * Held in state rather than read from the module so the panel re-renders when
   * the artwork finishes loading — otherwise it renders once against an empty
   * deck and stays empty.
   */
  deck: DeckEntry[];
  /**
   * Positions ruled out, by deck id.
   *
   * Stored as the exclusions rather than the inclusions so that adding a new
   * picture to the folder is in play by default — the opposite would silently
   * ignore every file added after the first run.
   */
  disabled: string[];
  /** Bumped whenever the faces are re-dealt, so the atlas knows to repaint. */
  dealId: number;
  /**
   * Cards not yet drawn, in the order they will be, by deck id.
   *
   * The whole of what makes card mode a different game: it shrinks as you draw,
   * and nothing comes up twice until it is empty and reshuffles. Drawn cards are
   * simply not in here — there is no separate discard pile to keep in step.
   */
  pile: string[];
  /** The card currently face-up, by deck id. Null while the stack is face-down. */
  drawn: string | null;
  /**
   * Bumped every time the pile is deliberately shuffled.
   *
   * A counter the stack watches, the same one-way channel rollRequest uses for
   * the die: the store never reaches into a component to play an animation, the
   * component notices a number changed.
   *
   * Deliberately *not* bumped by the reshuffle inside drawCard(). That one is
   * followed immediately by a card turning over, and two animations racing for
   * the same elements would fight — the draw folds the shuffle into its own
   * timeline instead, reading `justShuffled`.
   */
  shuffleId: number;
  /**
   * Whether the card on the table came off a freshly shuffled pile.
   *
   * Worth saying out loud once: a deck that silently starts over looks like a
   * deck that was repeating itself all along.
   */
  justShuffled: boolean;
  /**
   * The position that last came up.
   *
   * Kept so the next deal can leave it out — landing on the same thing twice
   * running is the single most deflating outcome, and it is trivial to prevent.
   */
  lastPositionId: string | null;
  /**
   * The gambled stake, once taken.
   *
   * Was `timer`, and the rename is the feature: this now holds a count of
   * strokes as readily as a duration, and which one it is comes from the
   * position on the table rather than from a setting. See Measure in
   * lib/dice/deck.ts.
   *
   * `amount` is in whatever `measure` says — seconds, or strokes.
   */
  stake: {
    measure: Measure;
    amount: number;
    /**
     * When the clock runs out. Time only; absent for strokes.
     *
     * A wall-clock timestamp rather than a running count, so the countdown
     * stays correct if the tab is backgrounded — one built on an interval
     * silently loses time whenever the phone locks.
     *
     * Strokes need no equivalent, and that is most of the point of them: there
     * is nothing to keep in step with, because the counting is happening in the
     * room rather than on the screen.
     */
    endsAt?: number;
    /** The double-or-nothing is offered once per stake, not per second. */
    gambled?: boolean;
    /** How that second gamble went, so the UI can say so. */
    won?: boolean;
  } | null;
  /**
   * The coin in the air, or landed and not yet acknowledged. Null the rest of
   * the time.
   *
   * Doubles as the app's one busy flag. While it is non-null the result is
   * already decided and nothing else may ask for another: play(), layDown() and
   * notTonight() all stand down, so a tap on the felt, a shake, an Escape or a
   * second press of the flip button cannot start a throw underneath a coin
   * that is still deciding something.
   */
  coin: CoinFlip | null;
  /** Bumped per toss. See CoinFlip. */
  flipId: number;
  /**
   * A counter the die watches, meaning "step out of the way".
   *
   * Its own signal rather than reusing layRequest, because the two mean
   * different things now: laying down puts the die back on the felt and hands
   * it to the physics engine, while this parks it in the corner of the frame,
   * still held, still showing the face being bet against. The coin needs the
   * middle of the table to land on and the round needs the die to stay visible
   * while it is gambled — see asidePose.
   */
  asideRequest: number;
  /**
   * Whether no bet is available — either it has been taken, or no round has
   * started yet.
   *
   * One token for both modes, because there is one thing being spent: the
   * round's right to argue with its result. The die spends it on a coin, the
   * cards spend it on a call, and neither can spend it twice.
   *
   * Starts true, which is the "no round yet" half: the die's opening drop
   * settles a value without anybody having thrown it (see settle), and a coin
   * offered against a result nobody asked for is a coin spent before the game
   * begins.
   *
   * Cleared in exactly two places, one per mode, and both are the *only* thing
   * every result of that mode passes through: beginRoll() for the die and
   * drawCard() for the cards. play() looks like the better home for it and was
   * the first choice, and it was wrong: the die can be thrown by hand — tapped,
   * or picked up and flung — and those gestures go from the scene straight to
   * throwWith() without play() ever hearing about it. A round that began that
   * way never got its coin back, which stranded the offer after the first flip
   * of a session.
   *
   * The one result that must *not* count as a new round is the one a won bet
   * buys. See betPrize.
   */
  betUsed: boolean;
  /**
   * The result a won bet has already paid for.
   *
   * Set only by settleCoin or settleHighLow, on a bet that has been seen to
   * win, and read and cleared by the very next beginRoll or drawCard — so it
   * exempts exactly one result from being a new round, and there is no second
   * one it could exempt. That is the whole of the loop prevention: a bet can
   * buy a result, and a result the bet bought cannot buy another bet.
   *
   * It relies on the round boundary running once per result, which throwWith()
   * in Die.tsx guarantees for the die — it is called once per gesture, and the
   * rollRequest effect that drives it is counter-guarded — and which drawCard()
   * guarantees for the cards by being called once, from play(). Failing the
   * other way is safe: a boundary that never arrives leaves the bet spent,
   * which shows no offer rather than showing one that shouldn't exist.
   */
  betPrize: boolean;
  /**
   * The card mode's bet: two cards on the felt, higher or lower.
   *
   * The sibling of `coin` above, and the second half of the app's busy flag —
   * see bettingNow(). While either is non-null the next result is already
   * spoken for and nothing else may ask for one.
   */
  bet: HighLow | null;
  /** Bumped per bet. See HighLow. */
  betId: number;
  /**
   * The playing deck the bet is dealt from.
   *
   * Drawn without replacement and reshuffled when it runs short, the same way
   * the position pile is — a shoe that dealt with replacement would be a
   * random number generator wearing a deck's clothes, and the whole point of
   * using real cards is that they behave like real cards.
   *
   * Built lazily on the first bet rather than at construction: this module is
   * imported by the server render, and fifty-two shuffled cards nobody is going
   * to look at is work done in the wrong place.
   */
  shoe: PlayingCard[];
  /**
   * The other person's pick, won off a lost flip and held until it is used.
   *
   * A lost bet being paid, on screen, now.
   *
   * Replaces the joker, which was an IOU: losing set a flag, a chip claimed a
   * debt for as long as it took somebody to tap an X, and what was actually owed
   * happened off-screen where the app could not see it. Three problems fell out
   * of that one decision — state that had to persist, a chip that had to hold a
   * band of the screen to display it, and no way to end it except by hand,
   * because the app could not observe the thing being spent.
   *
   * Paying it immediately dissolves all three. There is nothing to remember, so
   * nothing to draw, so nothing to dismiss.
   *
   * Two stages, because losing hands over two decisions: which position, and
   * then how much of it. The entry they picked is carried into the second.
   */
  forfeit: { stage: "pick" | "amount"; entry: DeckEntry } | null;
  /**
   * A position chosen by hand rather than landed on.
   *
   * The one thing that lets a forfeit produce a result in either mode without
   * either mode knowing about it. A die's result is a face value and a card's is
   * a drawn id; this is neither, so it goes through currentEntry() — the seam
   * that already exists precisely so the controls never ask how a position got
   * onto the table.
   *
   * The whole entry rather than its id, because half of what can be chosen is
   * not in the deck to be looked up: see EXTRAS and FREE_CHOICE. An id would
   * have forced those into the deck, where they would then be dealt onto die
   * faces and drawn out of the pile — which is exactly what they must not be.
   */
  chosenEntry: DeckEntry | null;
  /**
   * The fix: what it is, and whether it is in.
   *
   * A joke rather than a feature, and implemented as one. It does not touch the
   * physics, the solver, or a random number anywhere. On the die the throw is
   * entirely real and is left alone — what happens instead is that the roll is
   * played out on a copy of the world the instant it leaves the hand, and the
   * chosen position is dealt onto the face that copy says will be up when it
   * stops (see forecastFace and fixFace). The die then rolls to a halt showing
   * it, on its own, with all six of its own pictures still on it. On the cards
   * it draws the chosen one instead of the top of the pile, which needs no
   * disguise at all because every card back is identical.
   *
   * Two fields rather than one, because arming and choosing are different
   * gestures. All three are quick runs of taps on things that otherwise do
   * nothing (see useTapRun): five on the title of the deck panel reveal the list
   * that sets the choice, three on the dice segment of ModeSwitch put the fix in,
   * and four on the speaker in DiceApp take it out. The choice outlives the
   * arming, so it can go back in without opening anything at all — with nobody
   * any the wiser either way.
   *
   * Session only. Deliberately forgotten on reload, unlike the disguise: a fix
   * somebody set last week and forgot stops being funny and starts being a bug.
   *
   * A set rather than one id, because "only this one" and "one of these" are the
   * same gesture at different sizes. Picking one position is the narrow case of
   * picking several, and a list that made you choose exactly one could not
   * express the interesting version — a short list of things you would both be
   * happy with, still arrived at by throwing something. Which of them comes up
   * is drawn fresh per throw; see pickRigged.
   */
  rigChoice: string[];
  rigOn: boolean;
  /**
   * Positions the die is weighted toward, by deck id.
   *
   * Not a probability table: these are fed to the die as a centre-of-mass
   * offset, so a favourite comes up more often because the die is genuinely
   * heavier on the far side. See loadFor() in components/scene/Die.tsx.
   */
  favourites: string[];

  /**
   * Positions somebody wrote themselves.
   *
   * Kept as the authored records rather than only as deck entries, because an
   * edit needs the thing that was typed — a DeckEntry has already been through
   * toEntry() and has defaults baked into it that the editor must not present
   * back as though they had been chosen.
   */
  own: OwnPosition[];

  /** Which half of the deck is in play tonight. See PoolSource. */
  pool: PoolSource;

  /**
   * The position being written or edited: an own-id, "new", or nothing.
   *
   * In the store rather than in the panel's own useState, and the reason is the
   * disguise. Discreet mode is the tap somebody makes when another person walks
   * into the room, and it has to be able to tear down a half-written page of
   * their own words. A component-local flag cannot be reached from there.
   */
  editing: string | null;
  /** Most recent results, newest first. */
  history: HistoryEntry[];
  muted: boolean;
  /**
   * Whether the app is wearing its disguise.
   *
   * Not a filter and not a censor: the deck, the exclusions and the favourites
   * are all left exactly as they are, and nothing is removed from play. What
   * changes is only what is *shown* — plain numerals on the die, a green baize
   * table with no candles or petals, and no name anywhere. Turning it off gives
   * back the app you left, mid-session, unchanged.
   *
   * One of the two pieces of state that survive a reload. See lib/prefs.ts.
   */
  discreet: boolean;
  /**
   * Which room the scene is in, by `Backdrop.id`.
   *
   * An id rather than the `Backdrop` itself, and that is on purpose: this is the
   * one piece of app state that is written to storage and read back, so it has
   * to be something a string can be. `themeById` in lib/scene/backdrops.ts turns
   * it into a room and decides what an unrecognised id means.
   *
   * Has no authority over discreet mode. The disguise picks its own room and
   * outranks this — see the selection in DiceScene.
   */
  theme: string;

  setMode: (mode: GameMode) => void;
  setDieType: (type: DieType) => void;
  setDeck: (entries: DeckEntry[]) => void;
  notTonight: () => void;
  /** Commits a stake. The measure comes from the position it is staked on. */
  startStake: (measure: Measure, amount: number) => void;
  clearStake: () => void;
  doubleOrNothing: () => void;
  /** Stakes the round on a coin. Decides the outcome and clears the screen. */
  flipCoin: () => void;
  /** The coin has come down. Called by the scene. */
  landCoin: () => void;
  /** The landed face has been shown for long enough to act on. */
  settleCoin: () => void;
  /** Stakes the round on two cards. Deals the pair and clears the screen. */
  openHighLow: () => void;
  /** Calls it. Once per bet. */
  guessHighLow: (call: Call) => void;
  /** The second card has finished turning. Called by HighLowTable. */
  turnHighLow: () => void;
  /** The turned pair has been shown for long enough to act on. */
  settleHighLow: () => void;
  /**
   * The won bet has been read; collect it.
   *
   * The one entry point the notices use, so neither of them has to know which
   * gamble it is standing over. A no-op unless a win is actually pending, in
   * both directions.
   */
  settleBet: () => void;
  /**
   * Their pick, taken. Ends the lost round and puts that position on the table.
   *
   * Where "Fine." used to be. The acknowledgement and the payment are the same
   * tap now, which is the whole point — there is no moment between losing and
   * paying for a token to exist in.
   */
  forfeitPick: (entry: DeckEntry) => void;
  /** And their number. Sets the stake and closes the forfeit. */
  forfeitAmount: (amount: number) => void;
  /**
   * Abandons a forfeit that is still open.
   *
   * For the routes that clear the whole screen — a mode switch, the disguise
   * going on. The old joker was deliberately paid on the way out of those,
   * because it was a debt that outlived the screen. This one *is* the screen, so
   * clearing it cancels rather than settles: there is nothing left owing once
   * the round it belonged to is gone.
   */
  cancelForfeit: () => void;
  /** Adds or removes one position from the fix, and arms it. See `rigChoice`. */
  toggleRigChoice: (id: string) => void;
  /** Empties the fix and takes it out. */
  clearRigChoice: () => void;
  /** Arms or disarms whatever was last chosen, without touching the choice. */
  setRigOn: (on: boolean) => void;
  toggleFavourite: (id: string) => void;
  togglePosition: (id: string) => void;
  fitDie: () => void;

  /** Puts back what was switched off and what was favourited. Hydration only. */
  restoreCuration: (hidden: string[], loved: string[]) => void;
  /** Replaces the authored half wholesale. Hydration only — see DiceApp. */
  restoreOwn: (list: OwnPosition[], pool: PoolSource | null) => void;
  /** Writes a new position and returns its id. */
  addOwn: (draft: Omit<OwnPosition, "id" | "order">) => string;
  /** Rewrites one, keeping its id so nothing pointing at it comes loose. */
  updateOwn: (id: string, draft: Omit<OwnPosition, "id" | "order">) => void;
  removeOwn: (id: string) => void;
  /** Reorders the authored half. Display only — every deal is shuffled. */
  reorderOwn: (ids: string[]) => void;
  setPool: (pool: PoolSource) => void;
  setEditing: (id: string | null) => void;

  /**
   * Rebuilds `deck` from its two halves and settles the die on it.
   *
   * Internal plumbing in the same way `deal` and `fitDie` are: every authoring
   * action ends here rather than each one composing the deck for itself.
   */
  recompose: () => void;
  /**
   * Deals a fresh hand onto the die.
   *
   * `landing` is the face the throw now in the air is going to come to rest on,
   * and only the throw can supply it — see forecastFace. It exists for the fix:
   * with it, the fixed position is dealt onto the face that is about to be up.
   */
  deal: (landing?: number) => void;
  /** What the current mode does with the entries still in play. */
  inPlay: () => DeckEntry[];
  available: () => DeckEntry[];
  /** Looks a deck entry up by id. */
  entry: (id: string) => DeckEntry | undefined;
  /** The position on the table right now, whichever object produced it. */
  currentEntry: () => DeckEntry | undefined;
  /** Ask for a result. The mode decides whether that's a throw or a draw. */
  play: () => void;
  requestRoll: () => void;
  drawCard: () => void;
  settleCard: () => void;
  shufflePile: () => void;
  layDown: () => void;
  beginRoll: () => void;
  settle: (value: number) => void;
  toggleMuted: () => void;
  /**
   * Puts the disguise on or takes it off.
   *
   * Takes the value rather than flipping, because the one caller that isn't a
   * toggle is the restore on startup and it needs to be able to set `false`
   * without that meaning "flip".
   */
  setDiscreet: (on: boolean) => void;
  toggleDiscreet: () => void;
  /** Takes a `Backdrop.id`. Unknown ids fall back at the point of use. */
  setTheme: (id: string) => void;
  /**
   * Puts back the solid the user last chose, at startup and only at startup.
   *
   * Deliberately not `setDieType`. See the implementation.
   */
  restoreDieType: (type: string) => void;
}

export const useDiceStore = create<DiceState>((set, get) => ({
  mode: "dice",
  dieType: "d6",
  phase: "idle",
  value: null,
  rollId: 0,
  rollRequest: 0,
  layRequest: 0,
  deck: [],
  disabled: [],
  dealId: 0,
  pile: [],
  drawn: null,
  shuffleId: 0,
  justShuffled: false,
  lastPositionId: null,
  stake: null,
  coin: null,
  flipId: 0,
  asideRequest: 0,
  // True, not false: there is no round until somebody throws or draws. See
  // betUsed.
  betUsed: true,
  betPrize: false,
  bet: null,
  betId: 0,
  shoe: [],
  forfeit: null,
  chosenEntry: null,
  rigChoice: [],
  rigOn: false,
  favourites: [],
  own: [],
  pool: "all",
  editing: null,
  history: [],
  muted: false,
  // Always starts false and is restored on mount rather than read here: this
  // runs during the server render too, where there is no localStorage to read
  // and where reading one would mean the markup disagreed with the client's.
  discreet: false,
  // Same reasoning as `discreet` above: a literal here, restored from storage on
  // mount, so the server render and the first client render agree.
  theme: defaultBackdrop.id,

  /**
   * Everything that has not been ruled out.
   *
   * Not the same question as what the die deals from, which is why this is a
   * second getter rather than the only one. An exclusion is a standing verdict
   * on a position; the pool is a decision about tonight. The forfeit picker
   * wants this one — "whatever they like" narrowed to the three things you
   * happened to write yourself is not what anybody means by a forfeit.
   */
  available: () => {
    const { deck, disabled } = get();
    return deck.filter((entry) => !disabled.includes(entry.id));
  },

  /** Everything still eligible to come up, in either mode. */
  inPlay: () => inPlayOf(get().available(), get().pool),

  /**
   * Looks a deck entry up by id.
   *
   * Reads the store's own mirror of the deck rather than deckEntry(), which
   * searches a module-level array only loadDeck() fills. That array is the right
   * source for anything inside the scene — it is what the atlas paints from —
   * but out here it is invisible to React, which is why the deck is mirrored
   * into state at all, and it is unreachable to anything without a canvas.
   */
  entry: (id) => get().deck.find((entry) => entry.id === id),

  /**
   * The result currently on the table.
   *
   * The seam that lets one set of controls serve both modes. The die's result is
   * a face number that has to be looked up in the deal; a card's result is the
   * card. Everything downstream — the action bar, the announcer, the favourite
   * heart — wants the entry, not the route it arrived by.
   */
  currentEntry: () => {
    const { mode, value, drawn, chosenEntry } = get();
    // A forfeit outranks both, and only ever exists having just been set — the
    // next throw or draw clears it on its way past. See `chosenEntry`.
    if (chosenEntry) return chosenEntry;
    if (mode === "cards") return drawn ? get().entry(drawn) : undefined;
    return typeof value === "number" ? dealtTo(value) : undefined;
  },

  /**
   * Swaps the object in play.
   *
   * Modelled on setDieType: whatever was on the table no longer stands, so the
   * phase drops and the result clears. The history is deliberately *kept*, unlike
   * a die change — those chips are positions, and a position is the same thing
   * whether a die or a card produced it.
   */
  setMode: (mode) => {
    if (mode === get().mode) return;

    // A forfeit still open belongs to the round being put away. See
    // cancelForfeit — clearing the screen cancels it rather than settling it.
    get().cancelForfeit();

    set({
      mode,
      phase: "idle",
      value: null,
      drawn: null,
      stake: null,
      // A coin still in the air, or a pair still face-down, belongs to a game
      // that is being put away, and its outcome was never seen. Nothing is owed
      // either way.
      coin: null,
      bet: null,
      betPrize: false,
      chosenEntry: null,
      // No round is in progress on the other side of the switch — the next
      // throw or draw starts one and hands the bet back with it.
      betUsed: true,
    });

    // A fresh pile per visit rather than one that persists across the switch:
    // going back to the die and returning is a break, and picking up a
    // half-drawn pile from before it would be a memory the app doesn't otherwise
    // claim to have.
    //
    // Nothing to do in the other direction. The die is unmounted while cards are
    // out and mounts fresh on the way back, so it has no standing presentation
    // to be told to put down — and Die.tsx seeds its layRequest guard from the
    // current value, so a bump here would be read as already handled anyway.
    if (mode === "cards") get().shufflePile();
  },

  setDieType: (type) => {
    if (type === get().dieType) return;

    // The picker sits in the bottom bar, which stays reachable through the
    // coin's whole flight, so a forfeit can still be open when this lands.
    // Exactly as setMode does it.
    get().cancelForfeit();

    // The old die is replaced rather than reshaped, so its result no longer
    // stands — and the history is of a different solid, so it's cleared too
    // rather than mixing d6 and d20 results in one row.
    set({
      dieType: type,
      phase: "idle",
      value: null,
      history: [],
      // The result the coin was staked against is gone, so the bet goes with
      // it rather than landing on a round that no longer exists.
      coin: null,
      bet: null,
      betPrize: false,
      chosenEntry: null,
      betUsed: true,
    });
    // A different solid has a different number of faces to fill, so the
    // standing deal no longer covers the die.
    get().deal();

    /*
     * Remembered, and only from here.
     *
     * `fitDie` below changes `dieType` too, but it is the app shrinking the die
     * to fit a deck the user just emptied — not a choice about which solid they
     * want. Saving from there would quietly overwrite a deliberate d12 with the
     * d6 it was forced down to, and since exclusions are *not* remembered, the
     * next load would have a full deck and no reason left to be a d6.
     */
    writeDieType(type);
  },

  /**
   * Rules a position in or out.
   *
   * The last enabled position cannot be turned off — a deck with nothing in it
   * has no faces to deal, and a die that cannot be rolled is worse than one
   * that occasionally shows something you would rather skip.
   */
  togglePosition: (id) => {
    const { disabled } = get();
    const isDisabled = disabled.includes(id);

    // The last one standing *within the current pool* — see fitDie. With the
    // pool set to your own and two of them, the second cannot be switched off
    // even though thirteen built-ins are sitting there, because those thirteen
    // are not what the die is dealing from tonight.
    if (!isDisabled && get().inPlay().length <= 1) return;

    const next = isDisabled
      ? disabled.filter((entry) => entry !== id)
      : [...disabled, id];
    writeHidden(next);

    set({
      disabled: isDisabled
        ? disabled.filter((entry) => entry !== id)
        : [...disabled, id],
      // Kept in step rather than rebuilt, so editing the deck mid-pile doesn't
      // cost you your place in it. A position switched back on is spliced in at
      // an unknown index; one switched off simply leaves.
      pile: isDisabled
        ? insertInto(get().pile, id)
        : removeFrom(get().pile, id),
    });
    get().fitDie();
    get().deal();
  },

  /** Deals a fresh entry onto every face from whatever is still in play. */
  deal: (landing) => {
    const { dieType, lastPositionId } = get();
    // Through inPlay(), not a filter written out again here. This was the
    // exclusions rewritten inline, which was the same answer for as long as
    // exclusions were the only filter — and then quietly stopped being, so the
    // die went on dealing built-ins onto its faces while the panel said it was
    // only using the ones you wrote.
    const inPlay = get().inPlay();

    // Leave out whatever just came up — but only while something else remains
    // to deal. With one position left, repeating it is the only honest answer.
    const withoutLast = inPlay.filter((entry) => entry.id !== lastPositionId);
    const available = withoutLast.length > 0 ? withoutLast : inPlay;

    // The die's own face count, not a constant — a d12 needs twelve.
    dealFaces(available, DIE_SIDES[dieType]);

    /*
     * The fix, dealt onto the face the throw is about to stop on.
     *
     * `landing` comes from the forecast — the die is already in the air, and a
     * copy of the world has been run to the end of the roll to find out where
     * it ends up. Putting the fixed position there is the entire trick: the die
     * is never touched, and it comes to rest showing it because that is the face
     * it was always going to land on.
     *
     * Nothing else about the deal changes. Six different positions, dealt the
     * same way, and fixFace *exchanges* rather than overwrites, so the die
     * carries the same set it would have carried anyway.
     *
     * Without a forecast — every deal that isn't a throw, plus the occasional
     * roll the forecast will not call (a cocked landing, a die that never
     * settles) — the fixed position still gets a face, just a random one. That
     * is not a fix, and it is not meant to be: it only guarantees the position
     * is *on* the die, which is what stops the trick failing every second throw
     * for a reason nobody would guess at. The deal leaves out whatever came up
     * last, and after a fixed throw that is the fixed position itself.
     */
    const fixed = pickRigged(get(), inPlay);
    if (fixed) {
      fixFace(
        fixed,
        landing ?? 1 + Math.floor(Math.random() * DIE_SIDES[dieType]),
      );
    }

    set({ dealId: get().dealId + 1 });
  },

  /**
   * Rules the current position out and throws again.
   *
   * The same effect as switching it off in the deck panel, reachable in one tap
   * at the moment you actually form the opinion. Turning something off is a
   * settings decision; not wanting it right now is a reflex.
   */
  notTonight: () => {
    // Nothing may leave a result while a bet is deciding what happens to it.
    // See bettingNow().
    if (bettingNow(get())) return;

    const { disabled, deck, pile } = get();
    const landed = get().currentEntry();
    if (!landed) return;

    // Never rule out the last one standing — and never rule out something that
    // was never in the deck. A forfeit can put an off-deck pick on the table
    // (see EXTRAS), and "not tonight" on one of those would file an exclusion
    // against an id nothing will ever deal.
    const inDeck = deck.some((e) => e.id === landed.id);
    if (inDeck && get().inPlay().length > 1) {
      const next = [...disabled, landed.id];
      writeHidden(next);
      set({
        disabled: next,
        pile: removeFrom(pile, landed.id),
      });
    }

    // `drawn` is left alone: the next draw overwrites it, and blanking it here
    // would empty the card's face while it is still on screen turning over.
    set({ phase: "idle", stake: null, layRequest: get().layRequest + 1 });
    get().play();
  },

  startStake: (measure, amount) =>
    set({
      stake: {
        measure,
        amount,
        // Only time has a deadline. Strokes are counted in the room.
        endsAt: measure === "time" ? Date.now() + amount * 1000 : undefined,
      },
    }),

  clearStake: () => set({ stake: null }),

  /**
   * Stakes what was won on a coin flip: twice as much, or the smallest slot.
   *
   * Works in either unit without knowing which — it doubles `amount` and falls
   * back to that measure's floor. Doubling is the reason this reads better on
   * strokes than it ever did on time: "40 → 80" lands instantly, where
   * "90 seconds → 3 minutes" needs a moment's arithmetic.
   *
   * A clock restarts either way, so the stake is the whole duration and not
   * whatever happens to be left on it. A count has nothing to restart.
   */
  doubleOrNothing: () => {
    const { stake } = get();
    if (!stake || stake.gambled) return;

    const won = Math.random() < 0.5;
    const amount = won
      ? stake.amount * 2
      : DOUBLE_OR_NOTHING_FLOOR[stake.measure];

    set({
      stake: {
        measure: stake.measure,
        amount,
        endsAt:
          stake.measure === "time" ? Date.now() + amount * 1000 : undefined,
        gambled: true,
        won,
      },
    });
  },

  /**
   * Stakes the round on a coin: another throw, or the other person picks.
   *
   * The sibling of doubleOrNothing above, and deliberately the same shape — a
   * fair 50/50 taken at most once, resolved the moment it is taken. What it
   * stakes is different: that one gambles how long a position lasts, this one
   * gambles the position itself.
   *
   * Dice only, and never while disguised. A 3D coin needs a scene to be flipped
   * in, and in card mode the renderer is deliberately asleep behind a blur;
   * discreet mode has no reveal to flip away from and no way to say what was
   * won without saying what the app is. Both are refused here rather than only
   * hidden in the UI, so the rule holds wherever the call comes from.
   */
  flipCoin: () => {
    const { mode, discreet, betUsed, phase, value } = get();
    if (mode !== "dice" || discreet) return;
    // One per round, and never two at once — this is also what makes a second
    // press of the button while the first coin is still in the air harmless.
    if (bettingNow(get()) || betUsed) return;
    // There has to be a result to be unhappy with. Mid-throw there is nothing
    // to reject yet, and with no value the die has never landed at all.
    if (phase === "rolling" || value === null) return;

    const flipId = get().flipId + 1;
    const outcome: CoinOutcome = Math.random() < 0.5 ? "won" : "lost";

    set({
      coin: { outcome, flipId, landed: false },
      flipId,
      betUsed: true,
      /*
       * The reveal comes down and the die steps into the corner, so the coin
       * has the middle of the table to be thrown on rather than flipping
       * behind the picture it is a bet against.
       *
       * Aside rather than down: the die keeps showing the face being gambled,
       * which is the thing the bet is about, and the felt it would otherwise
       * be lying on is where the coin has to land. Inline rather than through
       * layDown(), which refuses unless the phase is already "settled" — the
       * flip is offered on the main screen too, where the die has already been
       * put back and the phase is idle.
       */
      phase: "idle",
      stake: null,
      asideRequest: get().asideRequest + 1,
    });
  },

  /**
   * The coin has come down.
   *
   * Separate from acting on it, and the gap between the two is deliberate: this
   * is the moment the face becomes true on screen, and everything that speaks
   * about the result — the notice, the live region — waits for it. What happens
   * *because* of the result waits a beat longer. See settleCoin.
   */
  landCoin: () => {
    const coin = get().coin;
    if (!coin || coin.landed) return;
    set({ coin: { ...coin, landed: true } });
  },

  /**
   * The landed face has been shown for long enough to act on.
   *
   * A win throws again from here — that is the thing that was bet for, and
   * making somebody tap once more to collect it would be an anticlimax. A loss
   * does nothing at all: its notice is already up, and it stays up until it has
   * been acknowledged, because a joker somebody just won should not expire on a
   * timer while nobody was looking.
   */
  settleCoin: () => {
    const coin = get().coin;
    if (!coin || !coin.landed) return;
    if (coin.outcome !== "won") return;

    /*
     * The throw is marked as bought before it is asked for.
     *
     * beginRoll is where a round gets its coin back, and this throw is not a
     * new round — it is the prize from the last one, so it is flagged out of
     * being counted as one. Marking it here rather than routing it around
     * beginRoll is what makes the rule hold for every throw: there is no path
     * to the die that skips beginRoll, and there is no path that skips this.
     *
     * Reaching for the die directly is safe because the coin only exists in
     * dice mode at all — flipCoin refuses anywhere else, so there is no card
     * branch to miss here.
     */
    set({ coin: null, betPrize: true });
    get().requestRoll();
  },

  /**
   * Stakes the round on two cards: another draw, or the other person picks.
   *
   * The card mode's twin of flipCoin, and deliberately the same shape down to
   * the order of its guards. What differs is where the answer comes from: the
   * coin invents a number, and this deals a pair off a real deck and lets a
   * comparison decide. That is the whole reason it is a different game and not
   * a coin with cards painted on it — you can see the card you are calling
   * against, so the bet is a judgement rather than a wish.
   *
   * Cards only, and never while disguised. The pair is dealt onto the felt over
   * the position deck, which only exists in card mode; and discreet mode has no
   * reveal to bet away from and no way to say what was won without saying what
   * the app is. Both are refused here rather than only hidden in the UI, so the
   * rule holds wherever the call comes from.
   */
  openHighLow: () => {
    const { mode, discreet, betUsed, phase, drawn } = get();
    if (mode !== "cards" || discreet) return;
    // One per round, and never two at once — as with the coin, this is also
    // what makes a second press while the pair is already out harmless.
    if (bettingNow(get()) || betUsed) return;
    // There has to be a result to be unhappy with. Mid-draw there is nothing to
    // reject yet, and with no card drawn the deck has never been touched.
    if (phase === "rolling" || drawn === null) return;

    /*
     * Both cards come off one shoe, dealt now.
     *
     * `next` exists before anything is called, which is the property the whole
     * bet rests on. See HighLow.
     */
    let shoe = get().shoe;
    if (shoe.length < CARDS_PER_BET) shoe = freshShoe();
    const [lying, next, ...rest] = shoe;

    const betId = get().betId + 1;

    set({
      bet: { lying, next, call: null, betId, turned: false },
      betId,
      shoe: rest,
      betUsed: true,
      /*
       * The card goes back down and the felt is cleared, so the pair has the
       * middle of the screen to be dealt onto rather than sitting over the
       * position it is a bet against.
       *
       * Inline rather than through layDown(), which refuses unless the phase is
       * already "settled" — and which now also refuses while a bet is out, so
       * calling it from here would be refused by the state this very set() is
       * creating.
       */
      phase: "idle",
      stake: null,
    });
  },

  /**
   * Calls it.
   *
   * Recorded rather than resolved: the outcome is already determined by the two
   * cards, and what happens next is the second one turning over. Nothing about
   * the result may be acted on until it has — see `turned`.
   */
  guessHighLow: (call) => {
    const bet = get().bet;
    // Once per bet. A second press while the card is already turning is the
    // same call arriving twice, not a change of mind.
    if (!bet || bet.call !== null) return;
    set({ bet: { ...bet, call } });
  },

  /**
   * The second card has finished turning.
   *
   * The exact counterpart of landCoin, and separate from acting on the result
   * for the same reason: this is the moment the card becomes true on screen,
   * and everything that speaks about it waits for it. What happens *because* of
   * it waits a beat longer. See settleHighLow.
   */
  turnHighLow: () => {
    const bet = get().bet;
    if (!bet || bet.call === null || bet.turned) return;
    set({ bet: { ...bet, turned: true } });
  },

  /**
   * The turned pair has been shown for long enough to act on.
   *
   * settleCoin, with a draw where the throw is. A win draws again from here —
   * that is the thing that was bet for — and a loss does nothing at all,
   * because its notice is already up and stays up until it is acknowledged.
   */
  settleHighLow: () => {
    const bet = get().bet;
    if (!bet || !bet.turned || bet.call === null) return;
    if (!calledRight(bet.call, bet.lying, bet.next)) return;

    /*
     * The draw is marked as bought before it is asked for, exactly as
     * settleCoin does it — and for the same reason. drawCard is where a card
     * round gets its bet back, and this draw is not a new round; it is the
     * prize from the last one. Marking it here rather than routing around
     * drawCard is what makes the rule hold for every draw: there is no path to
     * a card that skips drawCard, and there is no path here that skips this.
     */
    set({ bet: null, betPrize: true });
    get().drawCard();
  },

  settleBet: () => {
    if (get().coin) get().settleCoin();
    else if (get().bet) get().settleHighLow();
  },

  forfeitPick: (landed) => {
    /*
     * Only from a loss that has actually been *seen*, or from a forfeit already
     * open at this stage.
     *
     * A coin still in the air and a card still face-down have both decided
     * already, and neither has been shown to anybody — so neither may be paid
     * yet. The second half of the condition is what keeps this callable once
     * the bet below has been cleared, which happens on this very tap.
     */
    const open = settledBet(get())?.outcome === "lost";
    if (!open && get().forfeit?.stage !== "pick") return;

    set({
      // The bet is done the moment it is paid. Nothing is held.
      coin: null,
      bet: null,
      forfeit: { stage: "amount", entry: landed },
      /*
       * Their position, on the table, as a real result.
       *
       * `chosenEntry` rather than writing `value` or `drawn`, because those are
       * how a *die* and a *deck* say what happened and this was neither. Every
       * reader goes through currentEntry(), which is exactly the seam that lets
       * one action bar serve both objects — so a position that arrived by being
       * pointed at needs no reader to know that is how it arrived.
       */
      chosenEntry: landed,
      phase: "settled",
      lastPositionId: landed.id,
      /*
       * And the die comes back down out of the corner.
       *
       * A win does not need this — the throw it buys puts the die back on the
       * table on its way to being thrown — but a loss ends the round with
       * nothing thrown, and a die left parked in the corner of an otherwise
       * empty screen is a reveal that never finished.
       */
      layRequest: get().layRequest + 1,
      /*
       * The face the die is showing no longer means anything, so it is dropped
       * rather than left to contradict the position now on the table. `chosen`
       * takes precedence in currentEntry() either way; clearing it keeps the
       * two from disagreeing anywhere else.
       */
      value: null,
      /*
       * A result of its own, so it counts as one.
       *
       * Every other result bumps this on its way in — beginRoll and drawCard do
       * it before settle() and settleCard() read it back for the history id. A
       * forfeit has no such boundary in front of it, so it has to bump its own,
       * and skipping that was a real bug rather than an untidiness: the history
       * chip took its key from `rollId`, so a forfeit reused the key of the very
       * throw it replaced and React was handed two children with the same one.
       *
       * It earns the bump twice over. The reveal replays on `rollId` changing —
       * see FullPicture — so without this their pick arrived with no animation
       * at all, silently reusing the frame of the roll before it.
       */
      rollId: get().rollId + 1,
      history: [
        {
          id: get().rollId + 1,
          image: resolvedSource(landed.source),
          name: landed.name,
          kind: landed.kind,
        },
        ...get().history,
      ].slice(0, HISTORY_LIMIT),
    });
  },

  forfeitAmount: (amount) => {
    const forfeit = get().forfeit;
    if (forfeit?.stage !== "amount") return;

    // The unit is the position's, exactly as it is when the wheel decides it —
    // they are choosing the number, not what the number counts.
    const measure = forfeit.entry.measure ?? "time";
    get().startStake(measure, amount);
    set({ forfeit: null });
  },

  cancelForfeit: () => {
    if (!get().forfeit) return;
    set({ forfeit: null });
  },

  /**
   * Weights the die toward a position, or stops.
   *
   * Deliberately the mirror of ruling one out: both are opinions about the deck
   * formed while playing, and neither should require going somewhere to set it.
   */
  toggleRigChoice: (id) => {
    const { rigChoice } = get();
    const next = rigChoice.includes(id)
      ? rigChoice.filter((entry) => entry !== id)
      : [...rigChoice, id];
    // Emptying the list by unpicking the last one takes the fix out, which is
    // the same thing "Off" does — a fix armed over nothing is not armed.
    set({ rigChoice: next, rigOn: next.length > 0 });
  },

  clearRigChoice: () => set({ rigChoice: [], rigOn: false }),

  setRigOn: (on) => set({ rigOn: on }),

  recompose: () => {
    // setOwnEntries composes the deck from both halves and hands the whole
    // thing back, so the two arrival orders at boot converge on the same array
    // — see the note there. Deliberately not setDeck(), which reshuffles the
    // pile: editing the deck mid-pile must not cost you your place in it, and
    // each caller below splices instead.
    const deck = setOwnEntries(get().own.map(toEntry));
    set({ deck });
    get().fitDie();
    get().deal();
  },

  restoreCuration: (hidden, loved) => {
    // Set, not merged, and not pruned against the deck — which may not have
    // arrived yet. An id naming a position that no longer exists simply never
    // matches, which is the same thing prefs.ts says about storing them.
    if (hidden.length > 0) set({ disabled: hidden });
    if (loved.length > 0) set({ favourites: loved });
  },

  restoreOwn: (list, pool) => {
    set({
      own: list,
      // A saved pool that no longer has anything in it is dropped rather than
      // honoured. Somebody who deleted their last own position while set to
      // "only ours" must not come back to a deck the die cannot deal from.
      pool: pool === "own" && list.length === 0 ? "all" : (pool ?? "all"),
    });
    get().recompose();
    get().shufflePile();
  },

  addOwn: (draft) => {
    const id = newOwnId();
    const own = [...get().own, { ...draft, id, order: get().own.length }];

    set({ own });
    writeOwn(serialiseOwn(own));
    get().recompose();

    // Spliced in rather than reshuffled, the same way togglePosition does it.
    // A pile you are part way through is a place in the evening, and rebuilding
    // it because somebody wrote a new position would quietly cost you that.
    if (get().inPlay().some((entry) => entry.id === id)) {
      set({ pile: insertInto(get().pile, id) });
    }

    return id;
  },

  updateOwn: (id, draft) => {
    const own = get().own.map((entry) =>
      entry.id === id ? { ...entry, ...draft, id, order: entry.order } : entry,
    );

    set({ own });
    writeOwn(serialiseOwn(own));
    // The id is deliberately untouched, so favourites, exclusions, the rig and
    // a part-drawn pile all still point at it after a rename.
    get().recompose();
  },

  removeOwn: (id) => {
    const state = get();
    const own = state.own.filter((entry) => entry.id !== id);

    writeOwn(serialiseOwn(own));

    const disabled = state.disabled.filter((entry) => entry !== id);
    const favourites = state.favourites.filter((entry) => entry !== id);
    if (disabled.length !== state.disabled.length) writeHidden(disabled);
    if (favourites.length !== state.favourites.length) writeLoved(favourites);

    /*
     * Everything that could still be pointing at it, let go of at once.
     *
     * A deleted position leaves more behind than a row in a list. It can be
     * favourited, excluded, sitting in a part-drawn pile, fixed by the rig,
     * remembered as the last thing thrown, chosen as a forfeit, or face-up on
     * the table right now. An id left in any of those is a reference to
     * something the deck can no longer resolve — and entry(id) returning
     * undefined is exactly what draws a Joker.
     */
    set({
      own,
      disabled,
      favourites,
      pile: removeFrom(state.pile, id),
      rigChoice: state.rigChoice.filter((entry) => entry !== id),
      // Only disarmed if that was the last one it was holding.
      rigOn: state.rigChoice.some((entry) => entry !== id) && state.rigOn,
      lastPositionId: state.lastPositionId === id ? null : state.lastPositionId,
      chosenEntry: state.chosenEntry?.id === id ? null : state.chosenEntry,
    });

    // A card showing it is cleared off the table rather than left to render as
    // a position that no longer exists.
    if (state.drawn === id) {
      set({
        drawn: null,
        phase: "idle",
        stake: null,
        layRequest: get().layRequest + 1,
      });
    }

    get().recompose();
  },

  reorderOwn: (ids) => {
    const by = new Map(get().own.map((entry) => [entry.id, entry]));
    const own = ids
      .map((id) => by.get(id))
      .filter((entry): entry is OwnPosition => entry !== undefined)
      .map((entry, order) => ({ ...entry, order }));

    // Anything the caller failed to mention keeps its place at the end rather
    // than disappearing — a reorder is not a delete.
    for (const entry of get().own) {
      if (!ids.includes(entry.id)) own.push({ ...entry, order: own.length });
    }

    set({ own });
    writeOwn(serialiseOwn(own));
    get().recompose();
  },

  setPool: (pool) => {
    if (pool === get().pool) return;

    // Refused rather than allowed to empty the deck. The control is meant to be
    // disabled before it gets this far — see DeckPanel — but the store does not
    // take the UI's word for what is legal.
    const { deck, disabled } = get();
    const would = deck
      .filter((entry) => !disabled.includes(entry.id))
      .filter((entry) =>
        pool === "all" ? true : pool === "own" ? isOwn(entry.id) : !isOwn(entry.id),
      );
    if (would.length === 0) return;

    set({ pool });
    writePool(pool === "all" ? null : pool);

    get().fitDie();
    get().deal();
    // Reshuffled here, unlike a single toggle: changing which half of the deck
    // is in play invalidates a pile wholesale rather than by one card.
    get().shufflePile();
  },

  setEditing: (id) => set({ editing: id }),

  toggleFavourite: (id) => {
    const { favourites, deck } = get();
    // Deck only. Favourites are fed to the die as a centre-of-mass offset
    // toward a *face*, and something that never reaches a face cannot be
    // leaned toward — see EXTRAS, which a forfeit can put on the table.
    if (!deck.some((e) => e.id === id)) return;

    const next = favourites.includes(id)
      ? favourites.filter((entry) => entry !== id)
      : [...favourites, id];

    writeLoved(next);
    set({ favourites: next });
  },

  setDeck: (entries) => {
    // The built-in half is registered with the deck module rather than only
    // stored here, so that a later edit to a hand-written position recomposes
    // over the same built-ins instead of over whatever the module last probed.
    // Idempotent in the app, where `entries` is already what the module built.
    const deck = setBuiltinEntries(
      entries.filter((entry) => entry.kind !== "wild" && !isOwn(entry.id)),
      entries.filter((entry) => entry.kind === "wild"),
    );
    set({ deck });
    get().fitDie();
    get().deal();
    // The deck arrives asynchronously, well after the first render, so the pile
    // cannot be built at construction — this is the first moment there is
    // anything to shuffle.
    get().shufflePile();
  },

  /**
   * Shrinks the die if the deck can no longer fill it.
   *
   * Ruling positions out is the common way to end up with a die bigger than the
   * deck — pick a d12, then switch six positions off, and six faces have
   * nothing left to show but a repeat. Stepping the die down keeps the object
   * honest without making that a thing the user has to notice and fix.
   *
   * It only ever shrinks. Growing the die because a position was switched back
   * on would silently undo a deliberate choice of solid.
   */
  fitDie: () => {
    const { dieType } = get();
    // Counted through inPlay() rather than as deck minus disabled. Those were
    // the same number for as long as exclusions were the only filter; the pool
    // is a second one, and the subtraction would happily leave a d12 out over
    // three positions and print nine of them twice.
    const inPlay = get().inPlay().length;
    if (DIE_SIDES[dieType] <= inPlay) return;

    const fitted = largestDieFor(inPlay);
    if (fitted === dieType) return;

    // Only disturbs what's on screen when the die is actually the thing on
    // screen. In card mode this is housekeeping for a solid that isn't out,
    // and clearing the history row over it would be inexplicable.
    if (get().mode === "cards") {
      set({ dieType: fitted });
      return;
    }

    // Same reasoning as setDieType, which this is the automatic half of: the
    // deck panel is reachable while a coin is in the air, and turning enough
    // positions off in it lands here.
    get().cancelForfeit();
    set({
      dieType: fitted,
      phase: "idle",
      value: null,
      history: [],
      coin: null,
      bet: null,
      betPrize: false,
      chosenEntry: null,
      betUsed: true,
    });
  },

  /**
   * The one thing every "give me a result" control calls.
   *
   * Tapping the felt, shaking the phone, "Draw again", and the retry inside
   * notTonight all mean the same thing and none of them should have to know
   * which object is on the table. requestRoll stays what it always was — a
   * counter the die watches — rather than growing a mode branch, because the
   * scene has no business being told about cards.
   */
  play: () => {
    // While a bet is out the next result is already spoken for, and once it has
    // come down on a loss the round is over — either way a throw started here
    // would be one nobody asked for.
    if (bettingNow(get())) return;

    /*
     * Note what is *not* here: anything about the round's bet.
     *
     * This used to be where a round got its coin back, on the reasoning that
     * every control meaning "give me a result" comes through here. Most do —
     * every tap on the felt, every shake, "Roll again", "Draw again" and "Not
     * tonight" — but the die itself does not. Tapping it or flinging it goes
     * from the scene into throwWith() directly, and a round begun that way
     * never reached this line. See betUsed, and beginRoll and drawCard, which
     * every result does reach.
     */
    if (get().mode === "cards") get().drawCard();
    else get().requestRoll();
  },

  requestRoll: () => set({ rollRequest: get().rollRequest + 1 }),

  /** A fresh pile from whatever is in play, minus the card already face-up. */
  shufflePile: () =>
    set({
      pile: shuffledPile(get().inPlay(), get().drawn),
      justShuffled: false,
      shuffleId: get().shuffleId + 1,
    }),

  /**
   * Turns over the next card.
   *
   * The card is chosen here rather than by the component that animates it, which
   * is the one place cards differ structurally from the die: a die's value comes
   * out of the physics, so Die.tsx reports it back with settle(), whereas a card
   * has to be picked before the flip can paint its face. The reporting half is
   * the same — CardTable runs the turn and calls settleCard() when it lands.
   *
   * It is also the card mode's round boundary, and the only one — the exact
   * counterpart of beginRoll for the die. Every card that ever turns over comes
   * through here: the tap on the stack, the shake, "Draw again", "Not tonight",
   * and the one a won call bought. The first four are new rounds and get a bet;
   * the last is the prize from a round already played and does not. See betUsed
   * and betPrize.
   */
  drawCard: () => {
    const inPlay = get().inPlay();
    if (inPlay.length === 0) return;

    /*
     * The fix, on the card side. See `rigChoice`.
     *
     * The pile is left exactly where it was rather than drawn from, and that is
     * the important half: a fixed deck that also burned through the pile would
     * run it dry within a few draws and start announcing a reshuffle every time,
     * which is the one thing on this screen that would say out loud that
     * something was up.
     */
    const fixed = pickRigged(get(), inPlay)?.id ?? null;

    // The pile emptying is the end of a pass through the deck, not an error
    // state — it reshuffles and keeps going, and says so once.
    let pile = get().pile;
    let justShuffled = false;
    if (!fixed && pile.length === 0) {
      pile = shuffledPile(inPlay, get().drawn);
      justShuffled = true;
    }

    const next = fixed ?? pile[0];
    const rest = fixed ? pile : pile.slice(1);

    /*
     * The same two lines beginRoll uses, and they say the same thing.
     *
     * A draw that starts while one is already turning is the same draw arriving
     * twice, not a new round — which cannot happen through play(), but is free
     * to guard against and is the shape of failure that would hand a spent bet
     * back. The prize token is consumed either way, so it can exempt one draw
     * and never a second.
     */
    const { betPrize, phase, betUsed } = get();
    const newRound = !betPrize && phase !== "rolling";

    set({
      drawn: next,
      pile: rest,
      justShuffled,
      phase: "rolling",
      value: null,
      stake: null,
      rollId: get().rollId + 1,
      betPrize: false,
      betUsed: newRound ? false : betUsed,
      // A drawn card replaces whatever was pointed at. See `chosenEntry`.
      chosenEntry: null,
    });
  },

  /** The card has finished turning. Mirrors settle() for the die. */
  settleCard: () => {
    const state = get();
    if (state.phase !== "rolling" || !state.drawn) return;

    const landed = get().entry(state.drawn);

    set({
      phase: "settled",
      lastPositionId: landed?.id ?? null,
      history: [
        {
          id: state.rollId,
          // Snapshotted, not resolved later — see the HistoryEntry doc comment.
          // A card is drawn out of the pile and the pile keeps changing, so a
          // chip that looked its position up afterwards would drift too.
          image: landed ? resolvedSource(landed.source) : undefined,
          name: landed?.name,
          kind: landed?.kind,
        },
        ...state.history,
      ].slice(0, HISTORY_LIMIT),
    });
  },

  /**
   * Dismisses the presented result.
   *
   * The phase drops to idle immediately so the overlay clears while the die is
   * still travelling, rather than hanging over it on the way down. The value is
   * kept — it's still the face showing, it just isn't being presented.
   *
   * `drawn` is kept for exactly the same reason, and it earns its keep twice
   * over: the card is still turning back over when this returns, and a face that
   * blanked mid-turn would show an empty card for the second half of it. So
   * `drawn` means "the card most recently turned over" and `phase` says whether
   * it is face-up — every reader of currentEntry() is already gated on phase.
   *
   * The card is *not* put back into the pile. It has been seen, and the point of
   * a pile is that a seen card doesn't come round again until the deck does.
   */
  layDown: () => {
    // The bet already put the result down on its way out (see flipCoin and
    // openHighLow), so this would be a second dismissal of something no longer
    // on screen — and the Escape key routes here, which is the one that would
    // otherwise reach past the joker notice. See bettingNow().
    if (bettingNow(get())) return;
    if (get().phase !== "settled") return;
    set({ phase: "idle", stake: null, layRequest: get().layRequest + 1 });
  },

  /*
   * The round boundary, and the only one.
   *
   * Every throw arrives here and nothing else does: the buttons and gestures
   * that go through play(), the die thrown by hand, and the one a won flip
   * bought. The first two are new rounds and get a coin; the third is the
   * prize from a round already played and does not. `betPrize` is what tells
   * them apart, and it is consumed either way, so it can exempt one throw and
   * never a second. See `betUsed` and `betPrize` in the state above.
   *
   * drawCard is the same boundary for the cards, written the same way.
   */
  beginRoll: () => {
    const { betPrize, phase, betUsed } = get();

    /*
     * A throw that starts while one is already in the air is the same throw
     * arriving twice, not a new round.
     *
     * This is the one thing the old placement of this rule got right to be
     * afraid of: beginRoll is called by the scene, so a component that answers
     * twice would hand a spent flip back. Rather than move the rule somewhere
     * the scene cannot reach — which is what put the boundary in play(), where
     * a die thrown by hand never passed — the repeat is made harmless. A second
     * call leaves the coin exactly as the first left it, in both directions.
     *
     * It fails safe on the other side too: grabbing a die that is still rolling
     * and flinging it again reads as the same throw and keeps the coin spent,
     * which shows no offer rather than a free one.
     */
    const sameThrow = phase === "rolling";
    const newRound = !betPrize && !sameThrow;

    set({
      phase: "rolling",
      value: null,
      stake: null,
      rollId: get().rollId + 1,
      betPrize: false,
      betUsed: newRound ? false : betUsed,
      // A thrown die replaces whatever was pointed at. See `chosenEntry`.
      chosenEntry: null,
    });
  },

  settle: (value) => {
    const state = get();
    // The die's first drop settles too, but that isn't a roll the user made,
    // so it fills in the value without promoting the phase or recording it.
    if (state.phase !== "rolling") {
      set({ value, phase: "idle" });
      return;
    }

    const landed = dealtTo(value);

    set({
      value,
      phase: "settled",
      lastPositionId: landed?.id ?? null,
      history: [
        {
          id: state.rollId,
          type: state.dieType,
          value,
          image: landed ? resolvedSource(landed.source) : undefined,
          name: landed?.name,
          kind: landed?.kind,
        },
        ...state.history,
      ].slice(0, HISTORY_LIMIT),
    });
  },

  toggleMuted: () => set({ muted: !get().muted }),

  /**
   * Puts the disguise on or takes it off.
   *
   * Three things happen either way, and all three are about the screen rather
   * than about the deck:
   *
   * Card mode is dropped, and only ever in the "on" direction. A card carries
   * its position's artwork and name printed on its face — that is the whole of
   * what a card is here — so there is no plain version of one. A dice simulator
   * has dice and nothing else, which is also the simplest true thing to show.
   *
   * Whatever is on the table is put down, inline rather than through layDown(),
   * which refuses unless the phase is already "settled". Here it has to work
   * from any phase: the point is that the screen is clear a frame after the tap.
   *
   * And the history is cleared in *both* directions, because those chips are
   * snapshots from the other game — positions on the way in, bare numbers on the
   * way out — and either way a row of them left over is a row that no longer
   * means anything. It also guarantees every chip in discreet mode has a face
   * number to fall back to, which is what RollHistory shows instead of artwork.
   */
  setDiscreet: (on) => {
    if (on === get().discreet) return;

    if (on) get().setMode("dice");

    /*
     * A forfeit still open goes with the screen it was on.
     *
     * This is the tap someone makes when another person walks into the room, so
     * it has to clear everything — and unlike the joker it replaced, there is
     * nothing here that outlives the round. The old flag was a debt worth
     * carrying across the disguise; a grid of positions waiting to be pointed at
     * is the opposite, and leaving it up is precisely what must not happen.
     */
    get().cancelForfeit();

    set({
      discreet: on,
      // A half-written position goes with the screen it was on, for the same
      // reason the forfeit grid above does — more so, since this one is full of
      // words somebody typed themselves and the disguise is the tap they make
      // when another person walks in.
      editing: null,
      phase: "idle",
      stake: null,
      history: [],
      layRequest: get().layRequest + 1,
      // An undecided bet is dropped. There is no scene to land a coin in on the
      // way out, no cards to turn over, and nothing was owed on either yet.
      coin: null,
      bet: null,
      betPrize: false,
      chosenEntry: null,
      // The round went with the screen. The next throw starts a new one.
      betUsed: true,
    });

    writeDiscreet(on);
  },

  toggleDiscreet: () => get().setDiscreet(!get().discreet),

  /*
   * Changing the room changes nothing else, and that is the whole design.
   *
   * `setDiscreet` above has to clear the screen because the disguise is an
   * emergency. This is a taste: a throw in flight keeps flying, a stake stands,
   * an open forfeit is still owed. The room is the only thing that moves, and
   * the scene swaps it under a mounted canvas without a remount.
   */
  setTheme: (id) => {
    if (id === get().theme) return;
    set({ theme: id });
    writeTheme(id === defaultBackdrop.id ? null : id);
  },

  /*
   * The saved solid, put back before anything has been drawn.
   *
   * ## Why this is not `setDieType`
   *
   * `setDieType` is the user changing their mind mid-session, so it clears the
   * round: the result no longer stands, the history is of a different solid, an
   * open bet was staked on a roll that is gone. At startup there is nothing to
   * clear, and doing it anyway is not merely wasted — it deals a hand onto an
   * empty deck, and the real deal then happens again a moment later when the
   * deck arrives.
   *
   * ## Why it has to happen this early
   *
   * The scene mounts the die as `<Die key={dieType}>`, so changing the type
   * *replaces* the die: new geometry, new physics body, a fresh drop. This used
   * to run once the deck had loaded, which is well after the canvas is up — so a
   * saved d12 showed as a d6 falling onto the cloth, and then as a d12 falling
   * onto the cloth. Two drops, and the first one a lie about what you had
   * chosen. Restoring before the scene's chunk resolves means the die is only
   * ever built once, as the right solid.
   *
   * ## What replaces the validation that used to be here
   *
   * A die may not have more faces than the deck has positions, and the deck is
   * not known yet — that is the whole reason this was late. It does not need to
   * be checked here: `fitDie` already runs the moment the deck lands and shrinks
   * a die the deck cannot fill, which is the same clamp arriving from the
   * direction it was written for. The rare oversized case costs the remount that
   * every case used to pay.
   *
   * Refuses once the deck is in, which is what keeps "at startup" true rather
   * than merely intended.
   */
  restoreDieType: (type) => {
    if (get().deck.length > 0) return;
    if (!DIE_TYPES.includes(type as DieType)) return;
    if (type === get().dieType) return;
    set({ dieType: type as DieType });
  },
}));

/**
 * Whether a gamble is on the table.
 *
 * The app's busy flag, and the one condition every "give me a result" control
 * stands down on. It exists as a function rather than as two `||`s written out
 * in four places because that is precisely how the coin's version of it ended
 * up being checked in some paths and not others — and a path that misses it is
 * a throw happening underneath a bet that has not been settled.
 *
 * Exported so verify can assert on it directly.
 */
/**
 * A stable empty list, so a selector reading this never sees a fresh array.
 *
 * The same trap useSettledBet documents: a selector that builds a new object
 * every call makes useSyncExternalStore compare unequal forever and re-render
 * without end.
 */
const NO_RIG: string[] = [];

/**
 * The fix currently in — the one place `rigChoice` and `rigOn` are combined, so
 * nothing has to remember that a remembered choice is not the same as an armed
 * one. Empty means the throw is honest.
 */
export function riggedIds(s: DiceState): string[] {
  return s.rigOn ? s.rigChoice : NO_RIG;
}

/**
 * Which of the fixed positions this particular throw lands on.
 *
 * Drawn here rather than held in state, because the choice belongs to the throw
 * and not to the setting: with three positions fixed, the answer has to be
 * different from one throw to the next or the fix is just a stuck die with extra
 * steps. Called once per deal and once per draw, never during a render — a
 * random number in a render is a different result every repaint.
 *
 * Narrowed to what is actually in play first. Fixing to something the pool or
 * the exclusions have ruled out is a fix that silently never happens, and with
 * several picked it would quietly bias the rest — so those are dropped rather
 * than drawn and discarded.
 */
export function pickRigged(
  s: DiceState,
  pool: DeckEntry[],
): DeckEntry | undefined {
  const armed = riggedIds(s);
  if (armed.length === 0) return undefined;

  const eligible = pool.filter((entry) => armed.includes(entry.id));
  if (eligible.length === 0) return undefined;

  return eligible[Math.floor(Math.random() * eligible.length)];
}

export function bettingNow(s: DiceState): boolean {
  return s.coin !== null || s.bet !== null;
}

/**
 * The bet that is on the table and has been *seen*, and how it went.
 *
 * The single thing the two notices, the announcer and acceptJoker all read, so
 * none of them has to know which gamble is running. "Seen" is the whole point
 * of it: a coin still in the air and a card still face-down have both already
 * decided, and nothing may act on a result the screen has not caught up with.
 *
 * Null while nothing is out, and null while something is out but undecided —
 * which is what makes acceptJoker safe to call from anything that clears the
 * screen.
 */
export function settledBet(
  s: DiceState,
): { kind: BetKind; outcome: CoinOutcome; id: number } | null {
  if (s.coin?.landed) {
    return { kind: "coin", outcome: s.coin.outcome, id: s.coin.flipId };
  }
  if (s.bet?.turned && s.bet.call !== null) {
    return {
      kind: "highlow",
      outcome: calledRight(s.bet.call, s.bet.lying, s.bet.next)
        ? "won"
        : "lost",
      id: s.bet.betId,
    };
  }
  return null;
}

/**
 * settledBet(), subscribed to.
 *
 * Three primitive selectors rather than one that returns the record, and that
 * is not a style choice. A selector returning a fresh object on every call
 * never compares equal to its last result, so the subscription fires on every
 * store change and React's useSyncExternalStore reports a snapshot that will
 * not settle. The same reasoning betOffer's doc comment gives for returning a
 * string. The object is assembled *after* the subscriptions, where nothing is
 * comparing it to anything.
 */
export function useSettledBet(): {
  kind: BetKind;
  outcome: CoinOutcome;
  id: number;
} | null {
  const kind = useDiceStore((s) => settledBet(s)?.kind ?? null);
  const outcome = useDiceStore((s) => settledBet(s)?.outcome ?? null);
  const id = useDiceStore((s) => settledBet(s)?.id ?? null);

  if (kind === null || outcome === null || id === null) return null;
  return { kind, outcome, id };
}

/**
 * Which bet is on offer, if any.
 *
 * A plain function of the state rather than a hook, because the reveal's action
 * bar is not the only thing that draws this conclusion and a second copy of
 * these conditions is exactly how two readers end up disagreeing. The conditions
 * are also worth checking headlessly: the one that was wrong here was wrong on
 * the very first frame of the app, which is not a state a test that starts by
 * throwing the die can reach.
 *
 * It used to have a third answer, "joker", for a chip that sat on the felt
 * claiming a debt. There is no debt any more — a lost bet is paid where it is
 * lost — so the chip is gone and the band of screen it held belongs to the roll
 * hint again. See `forfeit`.
 */
export function betOffer(s: DiceState): "flip" | "call" | null {
  /*
   * Nothing at all while disguised, and this is the half of the feature that
   * had to be got right rather than merely remembered.
   *
   * An offer to gamble on an otherwise plain dice roller is a sentence about
   * what this app is, sitting on the screen somebody put the disguise on to be
   * able to hand over.
   */
  if (s.discreet) return null;

  /*
   * The offer stands from the moment a result lands until the next one, which
   * is why it is gated on there being a result rather than on the reveal being
   * up: putting the position back does not withdraw the bet. `betUsed` is what
   * ends it, and beginRoll and drawCard are the only things that give it back.
   *
   * The two modes differ only in which field carries "there is a result": the
   * die's face value, and the card most recently turned over. Both survive
   * their result being put back down, which is the property that matters here.
   */
  if (!s.betUsed && !bettingNow(s) && s.phase !== "rolling") {
    if (s.mode === "dice" && s.value !== null) return "flip";
    if (s.mode === "cards" && s.drawn !== null) return "call";
  }

  return null;
}

/**
 * betOffer(), subscribed to.
 *
 * Lived in CoinChip.tsx while there was a chip on the felt to draw. That chip
 * only ever drew the joker, and there is no joker now — so the file went, and
 * the hook belongs next to the function it subscribes to. A string is a safe
 * thing to select on: no new object per render, so the subscription does not
 * fire on every unrelated change.
 */
export function useBetOffer(): "flip" | "call" | null {
  return useDiceStore(betOffer);
}
