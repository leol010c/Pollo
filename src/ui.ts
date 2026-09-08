/**
 * Everything outside the canvas.
 *
 * The placard is the point of the page: the dice decide, and this is where the
 * decision is posted. It takes a whole round at once — what, and where, if
 * where has been thrown yet — because there is no state here to keep. What is
 * on the plate is what was passed to it.
 *
 * It is posted in two steps rather than one, because the die is holding the
 * answer up while it is being written. prepare() lays the plate out and hands
 * back the patch of screen the die should fly to; reveal() opens it, once the
 * die has arrived there, and the card grows out of the face it finds. Anything
 * with no die to wait for calls post(), which does both at once.
 *
 * The strip along its top is the same six pip clusters printed on the faces of
 * the position die, dimmed except the one that landed, so the plate says both
 * what you got and what you did not.
 *
 * The switch under the wordmark is here too. It is the only place the number of
 * dice is drawn; whether that setting is remembered is settings.ts's business
 * and whether it means anything is main.ts's.
 */

import { POSITIONS, positionFor } from "./positions";
import { locationFor } from "./locations";
import { pipCells } from "./pips";
import type { Slot } from "./present";

/**

/**
 * How the word faces are set, repeated from paintWord() in die.ts. Change one,
 * change both — the card is meant to be the face at a different size, and a
 * word that is bigger on one than on the other is the one thing that would give
 * that away. Widths are shares of the face.
 */
const WORD_WIDTH = 0.78;
const WORD_CAP = 0.3;

/**
 * How much of the card the die's face covers when it arrives.
 *
 * The die holds at this fraction of the card it is about to become, and the
 * card grows from here to its full size — which is what makes it read as the
 * face opening out rather than a picture landing on top of one. The same number
 * goes to the rise and to the CSS, from here, so there is one of it.
 */
const OPEN_FROM = 0.72;

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

/** Nine cells, some of them lit — one three-by-three pip cluster. */
export function fillCluster(item: HTMLElement, value: number) {
  const lit = new Set(pipCells(value));
  item.replaceChildren(
    ...Array.from({ length: 9 }, (_, cell) => {
      const pip = document.createElement("i");
      if (lit.has(cell)) pip.dataset.pip = "true";
      return pip;
    }),
  );
}

function cluster(value: number): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "cluster";
  item.dataset.value = String(value);
  item.dataset.landed = "false";
  fillCluster(item, value);
  return item;
}

export interface Round {
  position: number;
  /** Null until the second die has been thrown. */
  location: number | null;
  /** False when the location die is switched off: this round is already over. */
  wants: boolean;
}

export interface Chrome {
  /**
   * Lays the plate out for this round and leaves it shut, handing back where on
   * screen the die should hold so its face lands inside the card that is about
   * to open. Null when there is no card for it — nothing has landed yet.
   */
  prepare(round: Round): Slot | null;
  /** Opens what prepare() laid out. */
  reveal(): void;
  /** Both at once, for a result that no die is holding up. */
  post(round: Round): void;
  close(): void;
  /** Whether a die is being held up, which is the only time it can be put down. */
  setUp(up: boolean): void;
  setRolling(rolling: boolean): void;
  /** The position die: a new round. */
  onThrow(handler: () => void): void;
  /** The location die: the second half of this one. */
  onWhere(handler: () => void): void;
  /** The switch under the wordmark: two dice, or only the first. */
  onPair(handler: (two: boolean) => void): void;
  /** Putting the die back on the felt. */
  onLay(handler: () => void): void;
  /** Draws the switch in the position it is actually in. */
  setPair(two: boolean): void;
}

export function createChrome(): Chrome {
  const plate = must("plate");
  const strip = must<HTMLOListElement>("strip");
  const art = must<HTMLImageElement>("plate-art");
  const name = must("plate-name");
  const line = must("plate-line");
  const whatCard = must("card-what");
  const whatPips = must("what-pips");
  const whereCard = must("card-where");
  const wherePips = must("where-pips");
  const whereName = must("where-name");
  const whereLine = must("where-line");
  const oneDie = must<HTMLButtonElement>("one-die");
  const twoDice = must<HTMLButtonElement>("two-dice");

  strip.append(...POSITIONS.map((position) => cluster(position.value)));
  const clusters = [...strip.children] as HTMLElement[];

  plate.style.setProperty("--open-from", String(OPEN_FROM));

  // Every picture is in the browser's cache before the first throw ends, so the
  // placard never opens on a blank frame.
  for (const position of POSITIONS) new Image().src = position.src;

  const throwHandlers: (() => void)[] = [];
  const whereHandlers: (() => void)[] = [];
  const layHandlers: (() => void)[] = [];
  const pairHandlers: ((two: boolean) => void)[] = [];

  const wire = (ids: string[], handlers: (() => void)[]) => {
    const fire = () => {
      for (const handler of handlers) handler();
    };
    for (const id of ids) must<HTMLButtonElement>(id).addEventListener("click", fire);
  };

  wire(["throw", "again"], throwHandlers);
  wire(["roll-where"], whereHandlers);
  wire(["lay"], layHandlers);

  const pick = (two: boolean) => () => {
    for (const handler of pairHandlers) handler(two);
  };
  oneDie.addEventListener("click", pick(false));
  twoDice.addEventListener("click", pick(true));

  /**
   * The patch of screen the die should hold in so `card` opens out of its face.
   *
   * Measured off the laid-out card rather than worked out from the stylesheet,
   * so a card that is a different size on a short phone, or that has just
   * stepped down to make room for a second one, moves the die with it.
   */
  function slotFor(card: HTMLElement): Slot {
    const box = card.getBoundingClientRect();
    const width = box.width * OPEN_FROM;
    const height = box.height * OPEN_FROM;
    return {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width,
      height,
    };
  }

  /**
   * Sets a word to fill the card the way the die fills its face: measured and
   * scaled rather than chosen, because the names run from three letters to
   * seven and one fixed size either overflows the short face or rattles around
   * on the long one.
   *
   * In container units, so a card that changes size — a phone turned sideways,
   * a second card arriving beside it — takes its word with it.
   */
  function fitWord(word: HTMLElement, card: HTMLElement) {
    word.style.fontSize = "10cqw";
    const measured = word.getBoundingClientRect().width;
    const box = card.getBoundingClientRect().width;
    if (measured <= 0 || box <= 0) return;
    word.style.fontSize = `${Math.min(
      (10 * WORD_WIDTH * box) / measured,
      WORD_CAP * 100,
    )}cqw`;
  }

  function lay(round: Round): HTMLElement {
    const position = positionFor(round.position);
    art.src = position.src;
    // The name is right underneath in a heading; an alt that repeats it makes
    // a screen reader say the position twice.
    art.alt = "";
    name.textContent = position.name;
    line.textContent = position.line;
    fillCluster(whatPips, position.value);

    for (const item of clusters) {
      item.dataset.landed =
        item.dataset.value === String(round.position) ? "true" : "false";
    }

    if (!round.wants) {
      plate.dataset.where = "off";
    } else if (round.location === null) {
      plate.dataset.where = "asking";
    } else {
      const location = locationFor(round.location);
      fillCluster(wherePips, location.value);
      whereName.textContent = location.name;
      whereLine.textContent = location.line;
      plate.dataset.where = "shown";
      fitWord(whereName, whereCard);
    }

    // Whichever card is holding the answer that just landed is the one the die
    // is behind, and the only one that grows.
    const live = round.location !== null ? whereCard : whatCard;
    whatCard.dataset.live = String(live === whatCard);
    whereCard.dataset.live = String(live === whereCard);
    return live;
  }

  function open() {
    plate.dataset.open = "true";
    document.body.classList.add("is-open");
  }

  return {
    prepare(round) {
      const slot = slotFor(lay(round));
      // A card with no size is a layout that has not happened yet, and a die
      // told to fly to it would fly to infinity.
      return slot.height > 0 ? slot : null;
    },

    reveal: open,

    post(round) {
      lay(round);
      open();
    },

    close() {
      plate.dataset.open = "false";
      document.body.classList.remove("is-open");
    },

    setUp(up) {
      plate.dataset.up = String(up);
    },

    setRolling(rolling) {
      document.body.classList.toggle("is-rolling", rolling);
    },

    onThrow(handler) {
      throwHandlers.push(handler);
    },

    onWhere(handler) {
      whereHandlers.push(handler);
    },

    onPair(handler) {
      pairHandlers.push(handler);
    },

    onLay(handler) {
      layHandlers.push(handler);
    },

    setPair(two) {
      oneDie.setAttribute("aria-pressed", String(!two));
      twoDice.setAttribute("aria-pressed", String(two));
    },
  };
}
