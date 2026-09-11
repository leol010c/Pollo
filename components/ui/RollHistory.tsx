"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useDiceStore } from "@/lib/store";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { WildMark } from "./WildMark";

/**
 * The last few results, as small chips.
 *
 * Sits centred at the top of the table, fading in as each result lands and
 * fading back with age.
 *
 * The point is to make the empty space useful rather than decorated — a glance
 * at what has come up recently, not a log. Deliberately short: past about five
 * it stops being glanceable and starts being a table, which is the panel that
 * got cut earlier for being too much.
 */
export function RollHistory() {
  const history = useDiceStore((s) => s.history);
  const discreet = useDiceStore((s) => s.discreet);
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLUListElement>(null);

  const newest = history[0]?.id;

  useEffect(() => {
    const list = listRef.current;
    if (!list || newest === undefined || reduced) return;

    const chip = list.firstElementChild;
    if (!chip) return;

    // Only the newest chip animates. Re-running the whole row on every roll
    // would draw the eye to history at the exact moment the result matters.
    const ctx = gsap.context(() => {
      gsap.from(chip, {
        opacity: 0,
        y: -10,
        scale: 0.85,
        duration: 0.35,
        ease: "power1.out",
      });
    });

    return () => ctx.revert();
  }, [newest, reduced]);

  if (history.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[max(0.85rem,env(safe-area-inset-top))] z-10 flex justify-center"
      aria-hidden="true"
    >
      <ul ref={listRef} className="flex items-center gap-2">
        {history.map((entry, i) => (
          <li
            key={entry.id}
            // No chip, no frame, no glass. The artwork alone at a small size
            // reads as a trace of what came before; boxing each one turned a
            // quiet row into a strip of buttons competing with the controls.
            className="grid size-7 place-items-center"
            style={{ opacity: 0.85 - i * 0.16 }}
          >
            {discreet ? (
              /*
                Bare numbers while disguised.

                This falls through to the same branch a missing file uses, which
                is not a coincidence worth hiding: a chip with no artwork behind
                it prints its face number, and that is exactly the chip a dice
                roller keeps. The history is cleared whenever the mode is toggled
                (see setDiscreet), so every chip reachable here was rolled by a
                die and has a number to print.
              */
              <span className="tabular text-[11px] font-medium text-muted-foreground">
                {entry.value}
              </span>
            ) : entry.kind === "wild" ? (
              // A wild has no artwork file — it is drawn, here as on the die.
              <WildMark className="size-4/5 text-brand" />
            ) : entry.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={entry.image}
                alt=""
                className="size-full object-contain"
              />
            ) : (
              // Only reachable for a face whose file is missing. A card draw
              // has no face number to fall back to, so it falls back to the
              // name rather than rendering an empty chip.
              <span className="tabular text-[11px] font-medium text-muted-foreground">
                {entry.value ?? entry.name}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
