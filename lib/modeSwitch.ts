/**
 * How long it takes to change what game is on the table.
 *
 * One number, in its own module, because three files have to agree on it and
 * they are nowhere near each other:
 *
 *  - components/DiceApp.tsx transitions the room's blur,
 *  - components/ui/CardTable.tsx fades the deck in and lifts it onto the table,
 *  - components/scene/DiceScene.tsx holds the die on screen until the blur has
 *    closed over it.
 *
 * Those are three separate mechanisms — a CSS transition, a GSAP tween and a
 * React unmount — and the switch only reads as one gesture if they run for the
 * same length of time. Written three times it would read as one gesture until
 * somebody tuned one of them.
 */
export const MODE_FADE_MS = 450;

/** The same duration in seconds, for GSAP. */
export const MODE_FADE = MODE_FADE_MS / 1000;

/**
 * Where the deck sits before it arrives and after it leaves, in px, relative to
 * its resting place. Negative is above.
 *
 * It comes down from above and goes back up the same way, rather than fading in
 * place: cards are dealt down onto a table, and a stack that materialises at
 * its final position reads as a dialog opening. Above rather than below because
 * the deck is being dealt *to* the table — coming up from underneath it is the
 * one direction a real deck never arrives from.
 *
 * Modest, though. This is a deck being set down, not a card being thrown.
 */
export const DECK_ARRIVE_Y = -30;
