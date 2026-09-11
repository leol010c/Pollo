/**
 * How big the card is, and how much room the screen has to give it.
 *
 * This is a module rather than a class on the element for one reason: the size
 * is a *constraint satisfaction problem* — a card that fits the width, fits the
 * height, and still leaves the control bar somewhere to go — and a constraint
 * you cannot measure is a constraint you cannot trust. scripts/verify-cards.ts
 * imports cardWidthAt() and checks the same arithmetic the browser will do,
 * across every viewport shape, the way verify-bounds.ts checks the play area
 * against the real projection matrix.
 *
 * Keep CARD_WIDTH and cardWidthAt() in step. They are the same formula written
 * twice — once for CSS, which can do `min()` over mixed units at layout time,
 * and once in numbers, which is the only form a check script can assert on.
 */

/** Width over height. A playing card, not a photograph. */
export const CARD_ASPECT = 5 / 7;

/**
 * The card as a fraction of the viewport width.
 *
 * Was 0.74, which on a phone produced a card that filled the screen edge to
 * edge and left the deck feeling like a poster rather than something lying on a
 * table. Eleven percent off is enough to put air back around it without making
 * the artwork small.
 */
export const CARD_MAX_VW = 0.66;

/** And the ceiling on a wide screen, in rem. Was 19. */
export const CARD_MAX_REM = 17;

/**
 * The floor, in rem — below which a card stops being worth looking at.
 *
 * It exists to stop the height term below reducing the card to absurdity on a
 * very short viewport. A 568px-tall phone genuinely cannot hold a centred card
 * *and* the full control bar above and below it, and solving that by arithmetic
 * alone produced a 120px card: correctly centred, perfectly clear of
 * everything, and far too small to read the artwork on.
 *
 * So the trade is made explicitly in the other direction. On a screen that
 * short the control bar is allowed to overlap the bottom of a face-up card by a
 * small margin — the card is the content, the bar is chrome, and chrome
 * clipping content's edge is a smaller failure than content nobody can see.
 * verify:cards holds that overlap to a quarter of the card's height, which
 * keeps it off the subject of the picture.
 */
export const CARD_MIN_REM = 13;

/**
 * The vertical space PresentControls needs at its tallest, in rem.
 *
 * ~198px: the gamble button (48) + the action row (48) + "Put back" (44) + two
 * 8px gaps + 8px of top padding + up to 34px of home-indicator inset.
 *
 * It is doubled in the height cap below, and that is the part worth
 * understanding. A card centred on the viewport loses this space *twice* — the
 * bar takes it from the bottom, and centring means whatever the bottom loses the
 * top has to lose as well or the card stops being centred. Reserving it once is
 * how you get a card that is either off-centre or underneath the controls.
 */
export const CONTROLS_RESERVE_REM = 12.5;

/**
 * What that bar grows to once a timer is running, in rem.
 *
 * ~250px: the gamble button is replaced by a countdown *and* a "Double or
 * nothing" beneath it, which is another 52px the resting layout never sees.
 * This is the height the card actually has to clear, and reserving the resting
 * height for it is how a card ends up with buttons across its bottom edge the
 * moment someone gambles the time.
 */
export const CONTROLS_TALL_REM = 15.75;

/**
 * How far the stack rises when a card is face-up, in rem.
 *
 * The card is centred at rest — that is the whole point of the sizing above —
 * but a result is not a resting state. The controls come up underneath it, at
 * their tall height, and something has to give: either the card is small enough
 * to clear the worst case while centred, which makes it needlessly small the
 * 95% of the time no timer is running, or it moves out of the way when the
 * controls arrive.
 *
 * Moving is better, and not only arithmetically. The rise is the same gesture
 * the flip already makes — a card lifted off the stack to be looked at — so it
 * reads as presentation rather than as a layout correction.
 *
 * 5rem, which is CONTROLS_TALL_REM − CONTROLS_RESERVE_REM (3.25rem, the height
 * the resting reservation does not cover) plus a rem and a half of air.
 */
export const PRESENT_LIFT_REM = 5;

/** The gap between the card and the pile count beneath it, in px. */
export const CAPTION_GAP_PX = 20;
/** And the block that count sits in — `min-h-[4.5rem]`. */
export const CAPTION_HEIGHT_PX = 72;

/** One rem, in px. The app never changes the root font size. */
const REM = 16;

/**
 * The card's width, for a viewport of the given size.
 *
 * Three ceilings, whichever bites first:
 *
 *  - a fraction of the width, which is what governs on any normal phone;
 *  - a flat maximum, which stops the card ballooning on a desktop;
 *  - and a *height* term, which is the one that did not exist before. The card
 *    was sized off width alone, so on a short viewport it simply overflowed —
 *    there was no arrangement of the layout that could have saved it, because
 *    nothing in the card's own sizing knew how tall the screen was.
 *
 * The floor applies to the height term only, never to the two width terms. A
 * card too small to read is a problem; a card wider than the screen it is on is
 * not a solution to it.
 */
export function cardWidthAt(vw: number, dvh: number): number {
  const byWidth = vw * CARD_MAX_VW;
  const byMax = CARD_MAX_REM * REM;
  const byHeight = (dvh - 2 * CONTROLS_RESERVE_REM * REM) * CARD_ASPECT;
  return Math.min(byWidth, byMax, Math.max(byHeight, CARD_MIN_REM * REM));
}

/** The same terms as a CSS value, resolved at layout time. */
export const CARD_WIDTH = `min(${CARD_MAX_VW * 100}vw, ${CARD_MAX_REM}rem, max(${CARD_MIN_REM}rem, calc((100dvh - ${
  2 * CONTROLS_RESERVE_REM
}rem) * ${CARD_ASPECT})))`;

/* --- The bet's pair ------------------------------------------------------- */

/**
 * Two cards side by side, which is a different sizing problem from one.
 *
 * The higher-or-lower bet puts a card you call against next to the one you are
 * calling, and both have to be on screen at once with the two calls under them.
 * That makes *width* the binding constraint on a phone for the first time in
 * this file — a pair at the single card's 66vw would need 132vw — so the width
 * term here divides rather than scales, and the height term is what governs on
 * anything wide.
 *
 * Same contract as above: written once as numbers for verify:highlow and once
 * as a CSS min() for layout, and they have to be kept in step.
 */

/** The air between the two cards. */
export const BET_CARD_GAP_PX = 16;

/** And down each side of the pair — `px-6`, as the deck's own layer uses. */
export const BET_GUTTER_PX = 24;

/** The ceiling on a wide screen. Smaller than a single card's, because two of
 *  them side by side already fill more of the frame than one ever did. */
export const BET_CARD_MAX_REM = 13;

/**
 * The floor, in rem.
 *
 * Lower than CARD_MIN_REM, and it can afford to be: a position card has to
 * carry a photograph, while these carry a numeral and a pip. Legibility gives
 * out much later.
 */
export const BET_CARD_MIN_REM = 6.5;

/**
 * The vertical space the two calls need, in rem.
 *
 * ~108px: the Higher/Lower row (48) + the line above it saying what is at stake
 * (~20) + 8px of gap + 8px of top padding + up to 24px of home-indicator inset.
 *
 * Doubled in the height term below for the same reason CONTROLS_RESERVE_REM is:
 * the pair is centred on the viewport, so whatever the bottom loses the top has
 * to lose as well or it stops being centred.
 */
export const CALL_RESERVE_REM = 6.75;

/**
 * One card of the pair, for a viewport of the given size.
 *
 * Three ceilings, whichever bites first — the same three as cardWidthAt(), with
 * the width term halved to make room for the second card and the gap between
 * them. The floor applies to the height term only, never to the width term: a
 * pair too small to read is a problem, a pair wider than the screen is not a
 * solution to it.
 */
export function betCardWidthAt(vw: number, dvh: number): number {
  const byWidth = (vw - 2 * BET_GUTTER_PX - BET_CARD_GAP_PX) / 2;
  const byMax = BET_CARD_MAX_REM * REM;
  const byHeight = (dvh - 2 * CALL_RESERVE_REM * REM) * CARD_ASPECT;
  return Math.min(byWidth, byMax, Math.max(byHeight, BET_CARD_MIN_REM * REM));
}

/** The same terms as a CSS value, resolved at layout time. */
export const BET_CARD_WIDTH = `min(calc((100vw - ${
  2 * BET_GUTTER_PX + BET_CARD_GAP_PX
}px) / 2), ${BET_CARD_MAX_REM}rem, max(${BET_CARD_MIN_REM}rem, calc((100dvh - ${
  2 * CALL_RESERVE_REM
}rem) * ${CARD_ASPECT})))`;
