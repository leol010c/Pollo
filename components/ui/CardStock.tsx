"use client";

import { WildMark } from "./WildMark";

/**
 * The stock both decks are printed on.
 *
 * Extracted from CardTable when the higher-or-lower bet brought a second deck
 * onto the table. That deck is fifty-two ordinary playing cards and has nothing
 * to do with the positions — but it lies on the same felt, in the same light,
 * inches from the other one, and two decks that disagreed about the colour of
 * card stock would read as two decks borrowed from different boxes.
 *
 * So this is the press, and both decks are printed on it: one back, one set of
 * inks, one shadow. Nothing here knows what is printed on a face.
 */

/*
 * The card's printed colours.
 *
 * Deliberately not design tokens. These are a *material* — bone card stock with
 * a wine ink printed on it — in the same way the die's body and marks are a
 * material, and lib/dice/faceSet.ts owns those outright rather than splitting
 * them between CSS and code. The stock is the die's own body colour family, so
 * the two objects read as belonging to the same set.
 */
export const STOCK = "#efe3d6";
export const STOCK_EDGE = "#d9c8b8";
export const INK = "#93314f";
export const INK_DEEP = "#5d1c31";
/** The lattice, printed in a pale tint of the stock rather than in white. */
export const PRINT = "rgba(247,231,220,";

/*
 * The face: white, the way a card face is.
 *
 * Not #ffffff, but as near as makes no difference — a trace of warmth, because
 * pure white beside the bone stock of the back and the wine of the room reads
 * blue, and a card whose two sides disagree about their colour temperature does
 * not read as one object. At this distance from white it is simply white.
 *
 * The ink is a very dark wine rather than black, for the same reason: it belongs
 * to the same press as the back.
 */
export const FACE = "#fdfbf7";
export const FACE_INK = "#3f1220";
export const FACE_RULE = "#8d5566";
export const FACE_MUTED = "#7a5462";

/**
 * The shadow a card casts, carried by every card rather than just the top one.
 *
 * It used to be on the top card alone, which was fine while the top card was
 * always the one at the front. The shuffle breaks that: a back spends most of
 * the sequence at the front, and a deck that loses its shadow the moment the
 * shuffle starts and gets it back at the end is the flicker that gives the whole
 * illusion away.
 *
 * On the *top* card it sits on the button, not on the element that turns. A
 * 44px-blur shadow on something being rotateY'd has to be re-rasterised every
 * frame of the turn, which is a real part of why the flip stuttered on a phone;
 * on the static button it is painted once and the card composites over it. It
 * is also the more honest reading — a card lifted off a table casts its shadow
 * on the table, it does not carry one round with it as it turns.
 */
export const CARD_SHADOW = "0 18px 44px rgba(0,0,0,0.55)";

/**
 * The card's back — a printed playing card, not a dark UI panel.
 *
 * The structure is what makes a back read as a card, and it is the same on
 * every deck ever made: a margin of bare stock, a panel of ink inside it held
 * by a rule, an all-over diaper pattern too dense to have a subject, and one
 * medallion at the centre. Miss the margin and it is a tile; miss the pattern
 * and it is a coloured rectangle.
 *
 * The diaper is two scales of crossed 45° lines rather than one. A single grid
 * reads as graph paper at any distance, whereas a coarse lattice with a finer
 * one inside it resolves into texture close up and into tone across the room —
 * which is exactly what an engraved back does.
 *
 * `hidden` backface on both this and the face is what makes the turn read as one
 * card rather than two panels swapping: without it the back stays visible,
 * mirrored, through the front.
 */
export function CardBack() {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl"
      style={{
        // The bare stock, and the edge shading that stops it looking die-cut
        // out of flat colour.
        background: `linear-gradient(158deg, ${STOCK} 0%, ${STOCK_EDGE} 100%)`,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      {/* The printed panel, inset to leave a margin of stock all round. */}
      <div
        aria-hidden="true"
        className="absolute inset-[5.5%] rounded-[0.55rem]"
        style={{
          backgroundImage: [
            // Coarse diaper.
            `repeating-linear-gradient(45deg, ${PRINT}0.20) 0 1.5px, transparent 1.5px 18px)`,
            `repeating-linear-gradient(-45deg, ${PRINT}0.20) 0 1.5px, transparent 1.5px 18px)`,
            // Fine diaper inside it.
            `repeating-linear-gradient(45deg, ${PRINT}0.09) 0 1px, transparent 1px 9px)`,
            `repeating-linear-gradient(-45deg, ${PRINT}0.09) 0 1px, transparent 1px 9px)`,
            // Ink, lit from above like everything else on this table.
            `radial-gradient(ellipse 120% 90% at 50% 0%, ${INK} 0%, ${INK_DEEP} 100%)`,
          ].join(","),
        }}
      />

      {/* The double rule. Two weights a hair apart is the whole trick — a single
          line reads as a border, two read as engraving. */}
      <div
        aria-hidden="true"
        className="absolute inset-[8%] rounded-[0.4rem] border"
        style={{ borderColor: `${PRINT}0.34)` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-[10%] rounded-[0.3rem] border"
        style={{ borderColor: `${PRINT}0.16)` }}
      />

      {/* The centre medallion: a cartouche of bare stock carrying the mark. The
          same sparkle the wild face uses, so the deck's iconography is its own
          rather than a borrowed suit pip. */}
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="grid aspect-square w-[30%] place-items-center rounded-full"
          style={{
            background: `linear-gradient(158deg, ${STOCK} 0%, ${STOCK_EDGE} 100%)`,
            boxShadow: `0 0 0 1.5px ${INK_DEEP}, 0 0 0 3.5px ${PRINT}0.5), 0 2px 8px rgba(0,0,0,0.28)`,
          }}
        >
          {/* Colour set on a wrapper: WildMark fills with currentColor, and
              these are print colours rather than tokens a class could name. */}
          <div className="size-[54%]" style={{ color: INK }}>
            <WildMark />
          </div>
        </div>
      </div>
    </div>
  );
}
