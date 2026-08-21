/**
 * The menu nobody is meant to find.
 *
 * Three fast taps on the wordmark and the dice can be told what to land on.
 * There is no button for it and nothing on the page hints at it, which is the
 * point: whoever set it up knows, and whoever is watching the dice does not.
 *
 * All this holds is a set of allowed faces per die, and it is held in memory
 * only — closing the page forgets it. Nothing is written to the phone, so there
 * is nothing to come across later.
 *
 * How the dice are actually loaded is in cheat.ts, which has no idea this file
 * exists.
 */

import { POSITIONS } from "./positions";
import { LOCATIONS } from "./locations";
import { fillCluster } from "./ui";

/** Three presses inside this many milliseconds. */
const RUN = 800;
const TAPS = 3;

/**
 * Or one press held this long.
 *
 * Three fast taps is the gesture that was asked for, and it is the one a phone
 * fights hardest: tapping twice quickly is how a browser is told to zoom, and
 * some of them take it as read before the third tap arrives. Holding the mark
 * down does the same job and there is nothing else it could mean.
 */
const HOLD = 550;

export type Which = "what" | "where";

export interface Menu {
  /**
   * The faces that die is allowed to land on. Empty is the honest die, and it
   * is what the page starts every time it is opened.
   */
  allowed(which: Which): number[];
  /** True while the panel is up, so the page's own keys stay out of the way. */
  readonly open: boolean;
}

function chip(value: number, name: string, picked: Set<number>): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.setAttribute("aria-pressed", "false");

  const pips = document.createElement("span");
  pips.className = "cluster";
  fillCluster(pips, value);

  const label = document.createElement("span");
  label.className = "chip__name";
  label.textContent = name;

  button.append(pips, label);
  button.addEventListener("click", () => {
    if (picked.has(value)) picked.delete(value);
    else picked.add(value);
    button.setAttribute("aria-pressed", String(picked.has(value)));
  });

  return button;
}

function row(
  title: string,
  faces: { value: number; name: string }[],
  picked: Set<number>,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "rig__set";

  const heading = document.createElement("h4");
  heading.className = "rig__title";
  heading.textContent = title;

  const list = document.createElement("div");
  list.className = "rig__chips";
  list.append(...faces.map((face) => chip(face.value, face.name, picked)));

  section.append(heading, list);
  return section;
}

export function createMenu(): Menu {
  const picked: Record<Which, Set<number>> = { what: new Set(), where: new Set() };

  let panel: HTMLElement | null = null;
  let open = false;

  function build(): HTMLElement {
    const shade = document.createElement("div");
    shade.className = "rig";
    shade.dataset.open = "false";

    const sheet = document.createElement("div");
    sheet.className = "rig__sheet";

    const label = document.createElement("p");
    label.className = "rig__label";
    label.textContent = "Loaded";

    const note = document.createElement("p");
    note.className = "rig__note";
    note.textContent = "Nothing lit is a fair die.";

    const done = document.createElement("button");
    done.type = "button";
    done.className = "button";
    done.textContent = "Done";
    done.addEventListener("click", close);

    sheet.append(
      label,
      row("What", POSITIONS, picked.what),
      row("Where", LOCATIONS, picked.where),
      note,
      done,
    );
    shade.append(sheet);

    // A press anywhere off the sheet puts it away. It is stopped from reaching
    // the table underneath, or putting the menu away would also throw a die.
    shade.addEventListener("pointerdown", (event) => {
      if (event.target === shade) close();
    });

    document.body.append(shade);
    return shade;
  }

  function show() {
    panel ??= build();
    // A frame between the panel arriving and being told to open, or the
    // transition has nothing to run from.
    requestAnimationFrame(() => {
      if (panel) panel.dataset.open = "true";
    });
    open = true;
  }

  function close() {
    if (panel) panel.dataset.open = "false";
    open = false;
  }

  const mark = document.querySelector(".mark");
  if (mark) {
    let taps: number[] = [];
    let held: ReturnType<typeof setTimeout> | undefined;

    const toggle = () => {
      taps = [];
      if (open) close();
      else show();
    };

    const forget = () => {
      clearTimeout(held);
      held = undefined;
    };

    mark.addEventListener("pointerdown", () => {
      const now = performance.now();
      taps = taps.filter((at) => now - at < RUN);
      taps.push(now);

      forget();
      held = setTimeout(toggle, HOLD);

      if (taps.length >= TAPS) {
        forget();
        toggle();
      }
    });

    for (const done of ["pointerup", "pointercancel", "pointerleave"]) {
      mark.addEventListener(done, forget);
    }

    // The one thing that stops a phone zooming on the second of three fast
    // taps. touch-action alone is advice; this is not, and there is no click on
    // the mark to lose — the taps are already counted by the time it fires.
    mark.addEventListener("touchend", (event) => event.preventDefault(), {
      passive: false,
    });
  }

  document.addEventListener("keydown", (event) => {
    if (open && event.key === "Escape") close();
  });

  return {
    allowed: (which) => [...picked[which]],
    get open() {
      return open;
    },
  };
}
