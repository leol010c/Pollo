/**
 * The wild mark: a four-pointed sparkle with a small companion.
 *
 * Deliberately the same shape as drawWild() paints onto the die face in
 * lib/dice/faceSet.ts. A wild has no artwork file — it isn't a position — so
 * both the face and the reveal draw it, and they have to draw the same thing or
 * the reveal stops reading as that face opening out.
 *
 * If you change one, change the other.
 */
export function WildMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`size-full ${className}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M84 50 Q56.4 56.4 50 84 Q43.6 56.4 16 50 Q43.6 43.6 50 16 Q56.4 43.6 84 50 Z" />
      <path d="M90 26 Q80.1 28.1 78 38 Q75.9 28.1 66 26 Q75.9 23.9 78 14 Q80.1 23.9 90 26 Z" />
    </svg>
  );
}
