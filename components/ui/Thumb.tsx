"use client";

import type { DeckEntry } from "@/lib/dice/deck";
import { isOwn } from "@/lib/dice/own";
import { resolvedSource } from "@/lib/dice/stencil";
import { OwnMark } from "./OwnMark";
import { WildMark } from "./WildMark";

/**
 * A position at thumbnail size: the artwork, or the drawn mark for a wild.
 *
 * Lived inside DeckPanel until the forfeit picker needed the same square. Two
 * grids of the same deck should not be able to disagree about what a position
 * looks like, and copying eleven lines is exactly how they would.
 */
export function Thumb({
  entry,
  className = "",
}: {
  entry: DeckEntry;
  className?: string;
}) {
  const url = resolvedSource(entry.source);

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-raised ${className}`}
    >
      {entry.kind === "wild" ? (
        <WildMark className="size-1/2 text-brand" />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-[85%] object-contain" />
      ) : isOwn(entry.id) ? (
        // Written by hand, so there is no file — the monogram is the picture.
        <OwnMark name={entry.name ?? ""} className="size-2/3 text-brand" />
      ) : null}
    </span>
  );
}
