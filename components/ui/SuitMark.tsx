import { type Suit } from "@/lib/cards/playing";

/**
 * The four suit pips, drawn rather than typed.
 *
 * The obvious version of this file is the Unicode characters — ♥ ♦ ♣ ♠ — and it
 * is a trap. U+2665 and U+2666 have emoji presentation on iOS by default, so a
 * card face that set them as text got a glossy red emoji heart the size of the
 * line box on the one platform this app is actually used on. The variation
 * selector U+FE0E is the documented fix and it is honoured inconsistently; a
 * path is honoured everywhere.
 *
 * Drawn in currentColor, like WildMark, so the caller sets red or black on a
 * wrapper. The two files are siblings on purpose: this deck and the position
 * deck are printed on the same stock, and their marks are made the same way.
 */
export function SuitMark({
  suit,
  className = "",
}: {
  suit: Suit;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-full ${className}`}
      fill="currentColor"
      aria-hidden="true"
    >
      {suit === "hearts" && (
        <path d="M12 21.3 10.5 20C5.1 15 1.6 11.9 1.6 8.1A5.5 5.5 0 0 1 7.1 2.6a6 6 0 0 1 4.6 2.2h.6a6 6 0 0 1 4.6-2.2 5.5 5.5 0 0 1 5.5 5.5c0 3.8-3.5 6.9-8.9 11.9L12 21.3Z" />
      )}
      {suit === "diamonds" && <path d="M12 1.5 21.5 12 12 22.5 2.5 12 12 1.5Z" />}
      {suit === "spades" && (
        <path d="M12 2C9 6 4 8.6 4 12.6c0 2.4 1.9 4.2 4.1 4.2 1.2 0 2.3-.5 3.1-1.4-.2 2-1 3.6-2.2 4.9v.2h6v-.2c-1.2-1.3-2-2.9-2.2-4.9.8.9 1.9 1.4 3.1 1.4 2.2 0 4.1-1.8 4.1-4.2C20 8.6 15 6 12 2Z" />
      )}
      {suit === "clubs" && (
        <>
          <circle cx="12" cy="6.2" r="3.7" />
          <circle cx="6.8" cy="13.2" r="3.7" />
          <circle cx="17.2" cy="13.2" r="3.7" />
          <path d="M10.6 11.8h2.8c-.2 4-.9 6.9-2.3 8.5v.2h3.6v-.2c-1.4-1.6-2.1-4.5-2.3-8.5Z" />
        </>
      )}
    </svg>
  );
}
