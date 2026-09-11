"use client";

import { initialOf } from "@/lib/dice/own";

/**
 * The mark for a position somebody wrote themselves: its initial, in a ring.
 *
 * Deliberately the same shape as drawMonogram() paints onto the die face in
 * lib/dice/faceSet.ts, and for the same reason WildMark is: a hand-written
 * position has no artwork file and never will, so both the face and the reveal
 * draw it, and they have to draw the same thing or the reveal stops reading as
 * that face opening out.
 *
 * If you change one, change the other.
 *
 * The letter comes from initialOf() rather than from `name[0]` here as well —
 * one function, shared, because a glyph derived two ways is a glyph that
 * eventually disagrees with itself. See the note there about why a name's first
 * character is not always safe to draw.
 */
export function OwnMark({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const letter = initialOf(name);

  return (
    <svg
      viewBox="0 0 100 100"
      className={`size-full ${className}`}
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      {letter && (
        <text
          x="50"
          // Not 50: a capital sits high in its em box, so a baseline-centred
          // letter reads as floating above the ring it is meant to sit inside.
          y="52"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="42"
          fontStyle="italic"
          fontWeight="600"
          fontFamily="var(--font-display), Cormorant Garamond, ui-serif, Georgia, serif"
        >
          {letter}
        </text>
      )}
    </svg>
  );
}
