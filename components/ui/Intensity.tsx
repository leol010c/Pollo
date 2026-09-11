"use client";

/**
 * The three words, and they are not the three they used to be.
 *
 * "Easy, Moderate, Athletic" measured effort, which is a different scale
 * wearing the same clothes — and pointing the wrong way, since the positions
 * that cost the most effort are usually the ones you can hold longest. These
 * name what the dots have always been for: how quickly it is going to be over.
 * See Intensity in lib/dice/deck.ts.
 */
const LABELS = ["Gentle", "Steady", "Intense"] as const;

/**
 * How intense a position is, as three dots.
 *
 * Dots rather than a number or a word: it's a comparison, not a measurement,
 * and three filled pips read at a glance without asking you to interpret a
 * scale. In a list of rows the pattern explains itself by repetition, so there
 * the label stays in `title`/`aria-label` and costs no space.
 *
 * Alone under a heading it does not explain itself at all — three dots in that
 * position is the universal shape of a loading indicator, which is precisely
 * what it was being read as on the reveal. `withLabel` spells it out for the
 * one place that needs it.
 */
export function Intensity({
  level,
  withLabel = false,
  className = "",
  style,
}: {
  level: 1 | 2 | 3;
  withLabel?: boolean;
  className?: string;
  /** For surfaces whose colours aren't tokens — the card face is printed ink,
   *  not interface, so its muted tone has no class to name it. */
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      style={style}
      title={LABELS[level - 1]}
      // Redundant with the visible word when there is one, and the only
      // statement of it when there isn't.
      aria-label={`Intensity: ${LABELS[level - 1]}`}
      role="img"
    >
      <span className="inline-flex items-center gap-1">
        {[1, 2, 3].map((pip) => (
          <span
            key={pip}
            className={`size-1.5 rounded-full transition-colors ${
              pip <= level ? "bg-brand" : "bg-current opacity-25"
            }`}
          />
        ))}
      </span>
      {withLabel && (
        // Small, letterspaced and upper case: it is a caption on the name
        // above, and should not compete with it.
        <span className="text-[0.7rem] font-medium uppercase tracking-[0.18em]">
          {LABELS[level - 1]}
        </span>
      )}
    </span>
  );
}
