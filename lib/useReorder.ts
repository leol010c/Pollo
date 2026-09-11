"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Dragging rows into a different order, on a touch screen, inside a sheet that
 * scrolls.
 *
 * Worth being clear about what this changes and what it does not: the order is
 * how the list *reads*. Every deal is shuffled and every pile is shuffled, so
 * moving a position up does not make it likelier to come up. This is for
 * finding things, not for weighting them — the die is weighted by favourites,
 * which is a genuinely different control that does a genuinely different thing.
 *
 * Three problems, and they are the whole reason this is not four lines:
 *
 * **Drag against scroll.** A phone cannot tell a drag from a scroll by intent,
 * only by what the finger landed on. So the drag lives on a dedicated grip and
 * `touch-action: none` goes on the grip alone — put it on the row and the sheet
 * stops scrolling; leave it off entirely and the browser scrolls the sheet
 * instead of moving the row.
 *
 * **Measure once.** Every row's box is read at the moment the drag starts, not
 * per frame. Reading a rect while transforms are being applied to the same
 * element is how a reorder ends up chasing its own tail.
 *
 * **A grip needs a keyboard.** A control that can only be dragged is a control
 * some people cannot use at all, so the grip is a real button and the arrow
 * keys move the row. That is not a lesser path bolted on afterwards — it is the
 * one that works when a drag is fiddly, which on a small screen is often.
 */
export interface Reorder {
  /** Props for the grip: the thing you actually drag. */
  gripProps: (id: string) => {
    onPointerDown: (event: React.PointerEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    style: React.CSSProperties;
  };
  /** Props for the row being dragged or shifted out of its way. */
  rowProps: (id: string) => { style: React.CSSProperties };
  /** The row under the finger, if any. */
  dragging: string | null;
  listRef: React.RefObject<HTMLUListElement | null>;
}

export function useReorder(
  ids: string[],
  onReorder: (next: string[]) => void,
): Reorder {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
    dy: number;
    /** The lifted row's height, carried here so rowProps never reads a ref. */
    height: number;
  } | null>(null);

  // Not state: these are read on every pointer move and changing them must not
  // cost a render.
  const boxes = useRef<{ top: number; height: number }[]>([]);
  const startY = useRef(0);

  const move = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= ids.length || to === from) return;
      const next = [...ids];
      const [lifted] = next.splice(from, 1);
      next.splice(to, 0, lifted);
      onReorder(next);
    },
    [ids, onReorder],
  );

  const gripProps = useCallback(
    (id: string) => ({
      style: {
        // Only here. On the row it would stop the sheet scrolling; anywhere
        // less specific and the browser claims the gesture first.
        touchAction: "none" as const,
      },

      onKeyDown: (event: React.KeyboardEvent) => {
        const from = ids.indexOf(id);
        if (event.key === "ArrowUp") {
          event.preventDefault();
          move(from, from - 1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          move(from, from + 1);
        }
      },

      onPointerDown: (event: React.PointerEvent) => {
        // Primary button or a finger. A right-click drag is not a gesture.
        if (event.button !== 0) return;

        const list = listRef.current;
        if (!list) return;

        const from = ids.indexOf(id);
        if (from < 0) return;

        // Every box, once, before anything has been transformed.
        boxes.current = Array.from(list.children).map((child) => {
          const rect = child.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        });
        startY.current = event.clientY;

        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        setDrag({ id, from, to: from, dy: 0, height: boxes.current[from].height });

        const onMove = (moveEvent: globalThis.PointerEvent) => {
          const dy = moveEvent.clientY - startY.current;
          const centre =
            boxes.current[from].top + boxes.current[from].height / 2 + dy;

          // The row whose middle the lifted one has passed.
          let to = from;
          for (let i = 0; i < boxes.current.length; i++) {
            const box = boxes.current[i];
            if (centre > box.top && centre < box.top + box.height) {
              to = i;
              break;
            }
          }

          setDrag({ id, from, to, dy, height: boxes.current[from].height });
        };

        const onUp = () => {
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", onUp);
          target.removeEventListener("pointercancel", onUp);

          setDrag((current) => {
            if (current && current.to !== current.from) {
              move(current.from, current.to);
            }
            return null;
          });
        };

        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
      },
    }),
    [ids, move],
  );

  const rowProps = useCallback(
    (id: string) => {
      if (!drag) return { style: {} };

      const index = ids.indexOf(id);

      if (id === drag.id) {
        return {
          style: {
            transform: `translateY(${drag.dy}px)`,
            // Above its neighbours while it is in the air, and no transition —
            // a lifted row has to track the finger exactly.
            zIndex: 2,
            position: "relative" as const,
            transition: "none",
          },
        };
      }

      // Everything between where it was and where it is going steps aside by
      // exactly one row, in whichever direction closes the gap.
      const between =
        drag.to > drag.from
          ? index > drag.from && index <= drag.to
          : index < drag.from && index >= drag.to;

      const gap = drag.to > drag.from ? -drag.height : drag.height;

      return {
        style: {
          transform: between ? `translateY(${gap}px)` : undefined,
          transition: "transform 140ms ease",
        },
      };
    },
    [drag, ids],
  );

  return { gripProps, rowProps, dragging: drag?.id ?? null, listRef };
}
