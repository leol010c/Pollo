/**
 * Everything outside the canvas.
 *
 * The placard is the point of the page: the dice decide, and this is where the
 * decision is posted. It takes a whole round at once — what, and where, if
 * where has been thrown yet — because there is no state here to keep. What is
 * on the plate is what was passed to it.
 *
 * The strip along its top is the same six pip clusters printed on the faces of
 * the position die, dimmed except the one that landed, so the plate says both
 * what you got and what you did not.
 */

import { POSITIONS, positionFor } from "./positions";
import { locationFor } from "./locations";
import { pipCells } from "./pips";

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

/** Nine cells, some of them lit — one three-by-three pip cluster. */
function fillCluster(item: HTMLElement, value: number) {
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
}

export interface Chrome {
  post(round: Round): void;
  close(): void;
  setRolling(rolling: boolean): void;
  /** The position die: a new round. */
  onThrow(handler: () => void): void;
  /** The location die: the second half of this one. */
  onWhere(handler: () => void): void;
}

export function createChrome(): Chrome {
  const plate = must("plate");
  const strip = must<HTMLOListElement>("strip");
  const art = must<HTMLImageElement>("plate-art");
  const name = must("plate-name");
  const line = must("plate-line");
  const wherePips = must("where-pips");
  const whereName = must("where-name");
  const whereLine = must("where-line");

  strip.append(...POSITIONS.map((position) => cluster(position.value)));
  const clusters = [...strip.children] as HTMLElement[];

  // Every picture is in the browser's cache before the first throw ends, so the
  // placard never opens on a blank frame.
  for (const position of POSITIONS) new Image().src = position.src;

  const throwHandlers: (() => void)[] = [];
  const whereHandlers: (() => void)[] = [];

  const wire = (ids: string[], handlers: (() => void)[]) => {
    const fire = () => {
      for (const handler of handlers) handler();
    };
    for (const id of ids) must<HTMLButtonElement>(id).addEventListener("click", fire);
  };

  wire(["throw", "again"], throwHandlers);
  wire(["roll-where"], whereHandlers);

  return {
    post(round) {
      const position = positionFor(round.position);
      art.src = position.src;
      // The name is right underneath in a heading; an alt that repeats it makes
      // a screen reader say the position twice.
      art.alt = "";
      name.textContent = position.name;
      line.textContent = position.line;

      for (const item of clusters) {
        item.dataset.landed =
          item.dataset.value === String(round.position) ? "true" : "false";
      }

      if (round.location === null) {
        plate.dataset.where = "asking";
      } else {
        const location = locationFor(round.location);
        fillCluster(wherePips, location.value);
        whereName.textContent = location.name;
        whereLine.textContent = location.line;
        plate.dataset.where = "shown";
      }

      plate.dataset.open = "true";
      document.body.classList.add("is-open");
    },

    close() {
      plate.dataset.open = "false";
      document.body.classList.remove("is-open");
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
  };
}
