"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Shuffle } from "lucide-react";
import { useDiceStore } from "@/lib/store";
import { CARD_WIDTH, PRESENT_LIFT_REM } from "@/lib/cards/layout";
import { DECK_ARRIVE_Y, MODE_FADE, MODE_FADE_MS } from "@/lib/modeSwitch";
import { type DeckEntry } from "@/lib/dice/deck";
import { isOwn } from "@/lib/dice/own";
import { resolvedSource } from "@/lib/dice/stencil";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { hapticShuffle, hapticThrow } from "@/lib/haptics";
import { playFlip, playShuffle } from "@/lib/audio";
import {
  CARD_SHADOW,
  CardBack,
  FACE,
  FACE_INK,
  FACE_MUTED,
  FACE_RULE,
  INK,
} from "./CardStock";
import { Intensity } from "./Intensity";
import { PresentControls } from "./PresentControls";
import { OwnMark } from "./OwnMark";
import { WildMark } from "./WildMark";

/**
 * Card mode: a stack of positions face-down on the same table the die rolls on.
 *
 * The scene stays mounted underneath — this is a layer over the felt, not a
 * different screen. Two reasons. Every <Canvas> remount allocates a WebGL
 * context and browsers cap how many can exist, which is why DiceApp mounts the
 * scene exactly once; and the lit room is most of what the app *is*, so a mode
 * that threw it away to show cards on a flat colour would be a different, worse
 * product.
 *
 * The turned card is the reveal. There is no full-screen picture on top of it,
 * the way there is for the die — the die has to open out because its face is a
 * 512px atlas cell viewed at an angle, whereas a card is already a rectangle
 * facing you at whatever size it likes.
 *
 * This owns the flip and reports back with settleCard(), exactly as Die.tsx owns
 * the throw and reports back with settle(). The store never reaches in here.
 */

/** How long the turn takes, start to face-up. Matches the die's rise closely
 *  enough that PresentControls' fade-in lands on the same beat in both modes. */
const FLIP_DURATION = 0.6;

/** Cards given a visible resting offset, purely for thickness. Three reads as a
 *  deck; more reads as a fan, and one reads as a single card lying there. */
const STACK_DEPTH = 3;

/**
 * How many cards the stack actually renders.
 *
 * More than the three you can see at rest, because a shuffle needs a deck to
 * shuffle. The extras sit exactly behind the third card — identical, opaque, and
 * therefore invisible — until the shuffle pulls them apart.
 */
const SHUFFLE_CARDS = 6;

/**
 * How far each card steps back from the one in front of it.
 *
 * Shared by the markup and the shuffle, which is the point of it being here: the
 * shuffle moves cards between depths, and it can only land them true if it uses
 * the same step the resting stack was laid out with.
 */
const STEP_X = 2.5;
const STEP_Y = 3;
const STEP_ROT = 0.5;

/**
 * The depth a card sits at when it is `order`th from the front.
 *
 * Collapsed past the visible few: everything below the third card piles up in
 * the same place, hidden behind it. Letting the offset keep growing would fan
 * the deck into a spread at rest.
 */
function depthOf(order: number) {
  return Math.min(order, STACK_DEPTH);
}

/**
 * How dark a card sits at a given depth. The front card is depth 0.
 *
 * A function of *position*, never of which card happens to be there — that is
 * what lets the shuffle hand a new card to the front and have it look right, and
 * what lets the deck snap home afterwards without a flicker.
 */
function depthBrightness(step: number) {
  return Math.max(0.62, 1 - step * 0.13);
}

/**
 * That brightness as a `filter` value — and `none`, never `brightness(1)`, when
 * the card is at the front.
 *
 * This is load-bearing, not tidiness. The top card carries
 * `transform-style: preserve-3d`, which is the whole mechanism of the flip: it
 * is what lets the face, pre-rotated 180°, swing into view as the card turns.
 * And `filter` is one of the grouping properties that force `transform-style` to
 * compute to `flat` — *any* filter, including an identity one. A card left with
 * `brightness(1)` on it is a card whose two sides no longer occupy 3D space, so
 * the back simply stays visible however far the element rotates. It turns, and
 * you never see the picture.
 *
 * Dimming a buried card is still fine: it is face-down and behind the deck for
 * exactly as long as the filter is on it.
 */
function shadeFor(step: number) {
  const value = depthBrightness(step);
  return value === 1 ? "none" : `brightness(${value})`;
}


/** Painting order: the card nearest the front paints over the rest. */
const LAYER_TOP = 20;
function layerZ(order: number) {
  return LAYER_TOP - order;
}
/** Below the whole deck, for a card in transit round the back of it. */
const BURIED_Z = 0;

/**
 * How many cards come off the front together on each pass.
 *
 * Two, not one. A single card going round to the back is a fiddle; a packet is a
 * shuffle — and with identical backs, how *much* of the deck is visibly moving
 * is the only thing carrying the impression that it got mixed.
 */
const PACKETS = [2, 3, 2] as const;
/** How many packets get stripped off. Seven cards, so the deck turns over. */
const SHUFFLE_PASSES = PACKETS.length;
/** How long one pass takes, front to back. */
const PASS_DURATION = 0.35;
/** The whole shuffle. */
const SHUFFLE_DURATION = SHUFFLE_PASSES * PASS_DURATION;

/**
 * One card in the stack, and the two elements it takes to move it.
 *
 * `el` is what animates. `layer` is the positioned element whose paint order has
 * to change with it — for a back that is the wrapper carrying its resting
 * offset, and for the top card it is the button. They have to be separate:
 * writing a transform to the element that already holds the resting offset as an
 * inline style would overwrite it and collapse the deck flat.
 */
interface StackCard {
  el: HTMLElement;
  layer: HTMLElement;
  /** The depth its wrapper already carries, so moves can be expressed as a delta. */
  home: number;
}

/** The deck, front to back. */
function stackCards(
  root: HTMLElement | null,
  top: HTMLElement | null,
  topLayer: HTMLElement | null,
): StackCard[] {
  if (!root || !top || !topLayer) return [];
  const backs = gsap.utils.toArray<HTMLElement>("[data-back]", root);
  return [
    { el: top, layer: topLayer, home: 0 },
    ...backs.map((el, i) => ({
      el,
      layer: el.parentElement as HTMLElement,
      home: depthOf(i + 1),
    })),
  ];
}

/**
 * The shuffle: packets are stripped off the front, alternately left and right,
 * and dropped in at the back.
 *
 * Two earlier attempts are worth recording, because both failed for the same
 * reason and the fix is not obvious.
 *
 * A **riffle** came first. Interleaving is only legible if you can tell the
 * cards apart, and every back in this deck is identical — so eight cards zipping
 * together read as the stack shivering, not as a shuffle.
 *
 * An **overhand** replaced it, taking the single front card round to the back
 * over and over. Better, because one card visibly changes places. But one card
 * at a time, always to the same side, is a tic rather than a shuffle: the deck
 * looks like it is being fiddled with, not mixed.
 *
 * What works with identical cards is *quantity* and *direction*. A packet of two
 * moves at once, so more of the deck is visibly in motion than at rest; and it
 * alternates sides, so each pass is a different gesture from the one before
 * rather than the same one repeated. The deck closes up by two places each time,
 * which means the whole stack shifts on every pass instead of just the front.
 *
 * The deck genuinely ends rearranged — after three passes six of the seven cards
 * have changed place. Then everything snaps home, and the snap is invisible
 * because the arrangement it snaps from is pixel-identical to the one it snaps
 * to: the same number of cards at every depth, and both brightness and shadow
 * are functions of depth rather than of card.
 *
 * Every step is placed at an explicit time. Appending with GSAP's default
 * position means "the end of the timeline *as it stands*", which is a moving
 * target while a timeline is still being built and lands steps in the wrong
 * order the moment anything else is added after them.
 */
function addShuffle(
  tl: gsap.core.Timeline,
  cards: StackCard[],
  at: number,
): void {
  if (cards.length < 2) return;

  const els = cards.map((card) => card.el);

  /** Where a card sits when it is `order`th from the front, as a delta from the
   *  resting offset its wrapper already carries. */
  const place = (card: StackCard, order: number) => {
    const delta = depthOf(order) - card.home;
    return {
      x: delta * STEP_X,
      y: delta * STEP_Y,
      rotation: delta * STEP_ROT,
      filter: shadeFor(depthOf(order)),
    };
  };

  // Promoted for the duration and released at the end. Seven ornate cards held
  // on their own compositor layers permanently is memory a phone would rather
  // not spend on a stack that is motionless almost all of the time.
  tl.set(els, { willChange: "transform" }, at);

  let order = cards.slice();

  for (let pass = 0; pass < SHUFFLE_PASSES; pass++) {
    const t = at + pass * PASS_DURATION;
    // Right, left, right. The alternation is most of what separates this from
    // the single-sided version that preceded it.
    const dir = pass % 2 === 0 ? 1 : -1;

    // Uneven, on purpose. Equal packets every time is a machine feeding cards;
    // a hand grabs whatever it grabs, and the irregularity is a surprising
    // amount of what makes the gesture read as done by someone.
    const size = PACKETS[pass];
    const packet = order.slice(0, size);
    const rest = order.slice(size);

    tl.call(playShuffle, undefined, t);

    packet.forEach((card, k) => {
      // A beat between the two cards of a packet, so it reads as a couple of
      // cards taken together rather than one thick one.
      const lead = k * 0.03;
      const target = rest.length + k;

      /*
       * Off the front and out to the side.
       *
       * It lifts and grows slightly on the way out, and shrinks going back in.
       * The deck's cards are two and a half pixels apart, so "different cards
       * are on the front now" is not something the eye can read directly — what
       * it can read is cards coming toward it, leaving, and going back in
       * behind. The scale is carrying that.
       */
      tl.to(
        card.el,
        {
          x: dir * (86 + k * 12),
          y: -16 - k * 5,
          rotation: dir * (7 + k * 3),
          scale: 1.05,
          duration: 0.13,
          ease: "power2.out",
        },
        t + lead,
      );

      // Behind the deck the instant it is clear of it, which is what sells the
      // card going *into* the stack rather than round the front of it.
      tl.set(card.layer, { zIndex: BURIED_Z - k }, t + 0.13 + lead);

      tl.to(
        card.el,
        { ...place(card, target), scale: 1, duration: 0.15, ease: "power2.in" },
        t + 0.13 + lead,
      );
      tl.set(card.layer, { zIndex: layerZ(target) }, t + 0.15 + lead);
    });

    // The deck closes up over the gap — by two places, so every remaining card
    // moves rather than just the one behind the packet.
    rest.forEach((card, j) => {
      tl.to(
        card.el,
        { ...place(card, j), duration: 0.16, ease: "power2.inOut" },
        t + 0.1,
      );
      tl.set(card.layer, { zIndex: layerZ(j) }, t + 0.1);
    });

    order = [...rest, ...packet];
  }

  /*
   * Home.
   *
   * Each card returns to *its own* resting depth rather than a shared value:
   * they sit at different depths, and handing them all the front card's
   * brightness would flatten the deck into a single lit slab at the end of every
   * shuffle.
   */
  const end = at + SHUFFLE_DURATION;
  tl.set(
    els,
    {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      willChange: "auto",
      filter: (i: number) => shadeFor(cards[i].home),
    },
    end,
  );
  cards.forEach((card, i) => {
    tl.set(card.layer, { zIndex: layerZ(i) }, end);
  });
}

/**
 * The card's face, laid out like a Jass card.
 *
 * White field, a rule inset from the edge, and the identifying marks doubled
 * into diagonally opposite corners so the card reads the same whichever way up
 * it is picked up: the name top-left and bottom-right, the picture small in the
 * other two, and full size in the middle. That corner-and-rotation arrangement
 * is the entire visual grammar of a playing card, and it is what stops a card
 * face from looking like a poster with a caption.
 *
 * White works here because the artwork carries its own colour — saturated cyan
 * and pink, not line art. On a dark panel it glows; on white it prints. Had it
 * been white line art (which is what the die's lit bone face would have implied)
 * this layout would have needed a dark field and none of it would look like a
 * card.
 */
function CardFace({ entry }: { entry: DeckEntry | undefined }) {
  const url = entry ? resolvedSource(entry.source) : undefined;
  const name = entry?.name ?? entry?.id ?? "";

  /**
   * The picture, at whatever size the corner or the middle wants.
   *
   * Branches on what the entry *is*, not on whether a url turned up. Those were
   * the same question for as long as the wild was the only entry without a
   * file; a position somebody wrote themselves has no file either, and keying
   * on the url alone printed the wild's sparkle across a card that was not
   * wild — three times, since this runs for both corners and the middle.
   */
  const picture = (className: string) => {
    if (url) {
      /* eslint-disable-next-line @next/next/no-img-element */
      return <img src={url} alt="" className={`${className} object-contain`} />;
    }

    const drawn =
      entry && entry.kind !== "wild" && isOwn(entry.id) ? (
        <OwnMark name={entry.name ?? ""} />
      ) : (
        <WildMark />
      );

    return (
      <div className={`grid place-items-center ${className}`}>
        <div className="size-full" style={{ color: INK }}>
          {drawn}
        </div>
      </div>
    );
  };

  /*
   * A corner: the name, and the picture small beside it.
   *
   * One component used twice, the second rotated a half turn. Building the two
   * corners separately is how they drift apart — a real card's index is the same
   * block of ink stamped twice, and the rotation is the only difference.
   */
  const corner = (
    <div className="absolute left-[7.5%] right-[7.5%] top-[5.5%] flex items-start justify-between gap-2">
      <p
        className="max-w-[62%] text-balance font-[family-name:var(--font-display)] text-[clamp(0.72rem,3.3vw,1rem)] font-semibold uppercase leading-[1.05] tracking-[0.02em]"
        style={{ color: FACE_INK }}
      >
        {name}
      </p>
      {/* Width plus an aspect ratio, never a percentage height: the row it sits
          in is auto-height, so a percentage height has nothing to resolve
          against and collapses the picture to nothing. */}
      {picture("aspect-square w-[16%] shrink-0")}
    </div>
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-2xl"
      style={{
        background: FACE,
        // The card is turned, so its face is mirrored unless it is flipped back.
        transform: "rotateY(180deg)",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      {/* The rule. Every card has one, and it is most of why a white rectangle
          reads as card stock rather than as paper. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[3.5%] rounded-[0.45rem] border"
        style={{ borderColor: FACE_RULE }}
      />

      {/* The two indices. The artwork carries nothing a screen reader can use —
          ResultAnnouncer says the name aloud the moment the card is drawn. */}
      <div aria-hidden="true" className="absolute inset-0">
        {corner}
        <div className="absolute inset-0 rotate-180">{corner}</div>
      </div>

      {/* The middle. Sized off the card's own width so it scales with it, and
          centred on the card rather than on the space left between the indices —
          an off-centre subject is the one thing a card face cannot survive. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 flex w-[68%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
      >
        {picture("aspect-square w-full")}

        {entry?.intensity && (
          <Intensity level={entry.intensity} style={{ color: FACE_MUTED }} />
        )}
        {/* What it is, printed on the card — a wild's rule, or a position's own
            line. The card face is the reveal in this mode: there is no picture
            layer over it to carry the words instead. */}
        {(entry?.hint ?? entry?.description) && (
          <p
            className="text-balance text-center text-[0.7rem] leading-relaxed"
            style={{ color: FACE_MUTED }}
          >
            {entry.hint ?? entry.description}
          </p>
        )}
      </div>
    </div>
  );
}

export function CardTable() {
  const mode = useDiceStore((s) => s.mode);
  const phase = useDiceStore((s) => s.phase);
  const drawn = useDiceStore((s) => s.drawn);
  const pile = useDiceStore((s) => s.pile);
  const rollId = useDiceStore((s) => s.rollId);
  const shuffleId = useDiceStore((s) => s.shuffleId);
  const justShuffled = useDiceStore((s) => s.justShuffled);
  const play = useDiceStore((s) => s.play);
  const shufflePile = useDiceStore((s) => s.shufflePile);
  const layDown = useDiceStore((s) => s.layDown);
  const settleCard = useDiceStore((s) => s.settleCard);
  const deck = useDiceStore((s) => s.deck);
  const disabled = useDiceStore((s) => s.disabled);
  const reduced = useReducedMotion();

  const cardRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  // The button, not the card inside it: burying the top card means changing
  // what paints over what, and z-index has to go on the positioned element
  // React actually renders as a sibling of the backs.
  const topRef = useRef<HTMLButtonElement>(null);
  /*
   * The standalone shuffle's context, held so a draw can call it off.
   *
   * It cannot be cancelled through its own effect: `phase` and `rollId` are not
   * in that effect's dependencies — deliberately, since watching them there
   * would tear the shuffle down on its own settle — so nothing about drawing a
   * card reaches it. Left running it keeps animating the same cards the flip is
   * animating, and its cut buries the top card behind the deck a full second
   * after you asked for a card, which is a tap that lands on nothing.
   */
  const shuffleCtx = useRef<gsap.Context | null>(null);

  /** The whole layer, faded as a unit when the mode changes. */
  const layerRef = useRef<HTMLDivElement>(null);
  /** The card's box, which travels up onto the table as the layer arrives. */
  const boxRef = useRef<HTMLDivElement>(null);

  /*
   * Whether this is on screen at all — which is not the same question as
   * whether cards are the current mode.
   *
   * The deck used to be `mode === "cards" && …`, so it appeared and disappeared
   * on the frame the mode flipped: the room took 450ms to blur and the cards
   * simply arrived, fully formed, at the start of it. Two things happening on
   * the same gesture at wildly different speeds read as two events.
   *
   * Arriving is easy — the markup mounts and animates in. Leaving is the part
   * that needs state: a component that returns null cannot animate itself out,
   * so this holds the layer on screen for exactly as long as the exit takes.
   */
  const cards = mode === "cards";
  const [present, setPresent] = useState(cards);

  // Adjusted during render rather than in an effect, so the markup and its refs
  // exist on the same commit the entrance is started from.
  if (cards && !present) setPresent(true);

  useEffect(() => {
    if (cards) return;
    const id = setTimeout(() => setPresent(false), MODE_FADE_MS);
    return () => clearTimeout(id);
  }, [cards]);

  /*
   * The arrival, and the departure.
   *
   * Deliberately not a gsap.context: reverting one on cleanup would restore the
   * layer to its pre-tween state at the exact moment the mode flips, which is a
   * frame of fully-opaque deck immediately before it is asked to fade out.
   * Killing the tweens instead leaves the layer wherever it had got to, so an
   * exit interrupting an entrance carries on from there rather than jumping.
   */
  useEffect(() => {
    const layer = layerRef.current;
    const box = boxRef.current;
    if (!layer || !box) return;

    if (reduced) {
      gsap.set(layer, { opacity: cards ? 1 : 0 });
      gsap.set(box, { y: 0 });
      return;
    }

    if (cards) {
      gsap.to(layer, { opacity: 1, duration: MODE_FADE, ease: "power2.out" });
      gsap.fromTo(
        box,
        { y: DECK_ARRIVE_Y },
        { y: 0, duration: MODE_FADE, ease: "power3.out" },
      );
    } else {
      gsap.to(layer, { opacity: 0, duration: MODE_FADE, ease: "power2.in" });
      gsap.to(box, {
        y: DECK_ARRIVE_Y,
        duration: MODE_FADE,
        ease: "power2.in",
      });
    }

    return () => {
      gsap.killTweensOf([layer, box]);
    };
  }, [cards, present, reduced]);

  /*
   * The card the face is painted with.
   *
   * `drawn` is the card most recently turned over and survives layDown() — the
   * store keeps it for the same reason it keeps the die's `value` — so the face
   * stays painted while the card turns back down. `phase` is what says whether
   * it is face-up.
   */
  const showing = drawn ? deck.find((entry) => entry.id === drawn) : undefined;

  const inPlayCount = deck.filter(
    (entry) => !disabled.includes(entry.id),
  ).length;

  /*
   * The turn.
   *
   * Keyed on rollId so drawing the same position twice still replays — the same
   * reason the die's reveal depends on it.
   *
   * `phase` is deliberately *not* a dependency, even though it is read here.
   * The timeline's own onComplete promotes the phase to "settled", so listing it
   * would tear this context down at the exact moment the flip finished and
   * ctx.revert() would restore the card to face-down: the reveal would play and
   * then immediately undo itself. Reading the phase through getState() at the
   * moment the effect fires gets the guard without the feedback loop.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (!card || mode !== "cards") return;
    // rollId is shared with the die's counter, so arriving in card mode after a
    // few throws must not be mistaken for a card having been drawn.
    if (useDiceStore.getState().phase !== "rolling") return;

    // A draw that had to reshuffle folds the shuffle into the same timeline
    // rather than firing a second one: both move the same cards, and two
    // animations reaching for the same elements is how you get a stack that
    // jumps to a rest position mid-riffle.
    const shuffling = useDiceStore.getState().justShuffled;

    if (shuffling) hapticShuffle();
    else hapticThrow();

    // Call off a shuffle still in flight. Reverting rather than killing, so the
    // deck lands squared at rest instead of frozen half-cut — the flip below
    // starts from a known stack, and the top card is back on top of it.
    shuffleCtx.current?.revert();
    shuffleCtx.current = null;

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(card, { rotateY: 180, y: 0, scale: 1, x: 0, rotation: 0 });
        gsap.set(scrimRef.current, { opacity: 1 });
        settleCard();
        return;
      }

      /*
       * Face-down first, every time.
       *
       * "Draw again" replaces the card without putting the old one back, so by
       * the second draw the card is already sitting at 180° — and a tween *to*
       * 180° from 180° animates nothing at all. The first draw flipped and
       * every one after it silently popped. Nothing errors; the card is simply
       * already where it was being asked to go.
       *
       * Set before the timeline exists rather than as its first step: a `set` at
       * position 0 still waits for the timeline's first tick, which is a frame
       * of the previous card's face showing before it snaps away.
       *
       * x, rotation and filter are in here because a cut leaves all three set.
       * Without them a draw straight after a shuffle starts from a card still
       * sitting askew, and still dimmed to the brightness of the bottom of the
       * deck.
       */
      /*
       * `none`, not `brightness(1)` — see shadeFor. An identity filter here is
       * what stopped the card ever showing its face.
       *
       * And nothing else goes in here either. `will-change: transform` was
       * added to this set once, to promote the card for the turn the way
       * addShuffle promotes the backs, and it produced exactly the symptom
       * shadeFor warns about: the back visible straight through the face.
       *
       * The mechanism is the same one, reached by a different route. The
       * promotion hands the element to the compositor, and WebKit flattens a
       * promoted `preserve-3d` subtree — so the two sides stop occupying 3D
       * space and `backface-visibility: hidden` has nothing left to hide. What
       * is safe on the backs in addShuffle is unsafe here for one reason: those
       * are flat elements, and this one is the 3D context itself.
       *
       * There is nothing to buy back, either. This card's frames were being
       * eaten by the renderer running flat out underneath it, and that is fixed
       * where it was caused — in DiceScene's Freezer, not here.
       */
      gsap.set(card, {
        rotateY: 0,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        filter: "none",
      });

      /*
       * The turn, on its own timeline — built first, and never sharing one with
       * the shuffle.
       *
       * They used to be a single timeline, and that is what produced a card that
       * settled face-down: the shuffle half is built after the flip tweens are
       * planned but before they are added, so anything that went wrong while
       * assembling it left a timeline with no flip in it at all. A timeline with
       * nothing in it completes on the next tick, `onComplete` fires, settleCard
       * promotes the phase to settled — and the controls appear over a card that
       * never turned. Separated, the flip exists and runs whatever the shuffle
       * does.
       *
       * The gap after the shuffle is a real beat, not a safety margin: the deck
       * has to be seen to settle before a card lifts off it.
       */
      const start = shuffling ? SHUFFLE_DURATION + 0.06 : 0;
      const tl = gsap.timeline({ delay: start, onComplete: settleCard });

      tl.call(playFlip);

      // Lifted off the stack, turned, and set down. Three beats rather than a
      // bare rotation: a card that spins in place reads as a CSS demo, whereas
      // a hand picking one up and turning it over has a lift in it.
      tl.to(
        card,
        { y: -22, scale: 1.06, duration: 0.18, ease: "power2.out" },
        0,
      );
      tl.to(
        card,
        { rotateY: 180, duration: FLIP_DURATION - 0.16, ease: "power2.inOut" },
        0.08,
      );
      tl.to(
        card,
        { y: 0, scale: 1, duration: 0.26, ease: "power2.out" },
        FLIP_DURATION - 0.26,
      );

      // The scrim comes up with the turn, so the felt settles back as the
      // artwork arrives rather than the two competing. A plain `to` rather than
      // a `fromTo`: drawing again straight from a result leaves it already up,
      // and forcing it back to 0 first is a flash of bare table mid-turn.
      tl.to(
        scrimRef.current,
        { opacity: 1, duration: 0.45, ease: "power1.out" },
        0.1,
      );

      // The shuffle, on its own timeline, added last. Nothing about it can now
      // reach the flip above.
      if (shuffling) {
        addShuffle(
          gsap.timeline(),
          stackCards(stackRef.current, card, topRef.current),
          0,
        );
      }
    });

    return () => ctx.revert();
  }, [rollId, mode, reduced, settleCard]);

  /*
   * A shuffle asked for outright, from the deck panel.
   *
   * Separate from the draw's built-in one because it stands alone: no card
   * follows it, and the deck simply gets squared up where it lies. Guarded so it
   * never runs over a card that is face-up or turning — the stack is not the
   * thing you are looking at then, and riffling it would pull the eye off the
   * result.
   */
  const lastShuffle = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== "cards") return;

    // The first run is the mount, not a shuffle. setMode() shuffles on the way
    // in, so without this every visit to card mode would open mid-riffle.
    if (lastShuffle.current === null) {
      lastShuffle.current = shuffleId;
      return;
    }
    if (shuffleId === lastShuffle.current) return;
    lastShuffle.current = shuffleId;

    if (useDiceStore.getState().phase !== "idle") return;

    hapticShuffle();

    /*
     * Settle the top card before touching it.
     *
     * `phase` goes idle the moment a card is put back, but the card itself is
     * still turning over for another few tenths of a second — and that turn
     * animates y and scale, which is exactly what the riffle is about to
     * animate. Two tweens on one property is a wobble, not a shuffle. Snapping
     * it face-down is the honest resolution: a shuffle only runs with the deck
     * closed, so that is where the card was heading anyway.
     */
    gsap.killTweensOf(cardRef.current);
    gsap.set(cardRef.current, { rotateY: 0, y: 0, scale: 1 });

    const ctx = gsap.context(() => {
      const cards = stackCards(
        stackRef.current,
        cardRef.current,
        topRef.current,
      );
      if (reduced) {
        gsap.set(
          cards.map((c) => c.el),
          { x: 0, y: 0, rotation: 0 },
        );
        return;
      }
      addShuffle(gsap.timeline(), cards, 0);
    });

    shuffleCtx.current = ctx;

    return () => {
      ctx.revert();
      shuffleCtx.current = null;
    };
  }, [shuffleId, mode, reduced]);

  // Turning back face-down. Not part of the timeline above: it is triggered by a
  // different gesture at an unpredictable time, and gsap.context() reverting on
  // unmount would strand a half-turned card.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || mode !== "cards" || phase !== "idle") return;

    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set(card, { rotateY: 0, y: 0, scale: 1 });
        gsap.set(scrimRef.current, { opacity: 0 });
        return;
      }
      // No will-change here either, for the reason given at the reveal above:
      // promoting this element flattens its 3D and the back shows through.
      gsap.to(card, {
        rotateY: 0,
        y: 0,
        scale: 1,
        duration: 0.4,
        ease: "power2.inOut",
      });
      gsap.to(scrimRef.current, {
        opacity: 0,
        duration: 0.35,
        ease: "power1.out",
      });
    });

    return () => ctx.revert();
  }, [phase, mode, reduced]);

  // Escape puts the card back, the same gesture as tapping away from it. The
  // die's reveal offers the same, and losing it in card mode would be a
  // regression for anyone on a keyboard.
  useEffect(() => {
    if (mode !== "cards" || phase !== "settled") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") layDown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, phase, layDown]);

  // `present`, not `mode` — see above. The layer outlives card mode by exactly
  // the length of its own exit.
  if (!present) return null;

  const faceUp = phase !== "idle";
  const remaining = pile.length;

  return (
    // Starts transparent and is faded in by the effect above. Mounting it at
    // full opacity would show one frame of finished deck before the entrance
    // had a chance to start from anywhere.
    <div ref={layerRef} className="fixed inset-0 z-20" style={{ opacity: 0 }}>
      {/*
        The same warm radial as the die's reveal, at a fraction of the density.

        The die needs covering: its face carries the picture that is opening out
        above it, so a ghost of the artwork sits behind the artwork. There is no
        die out here, and the card is opaque — so this only has to stop the lit
        felt competing for attention, and taking the room away entirely would
        undo the reason cards sit on the table at all.
      */}
      <div
        ref={scrimRef}
        onClick={faceUp ? layDown : play}
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.62) 0%, rgba(16,5,11,0.72) 55%, rgba(7,2,5,0.82) 100%)",
        }}
      />

      {/*
        The stack, dead centre of the viewport — and centred against the
        viewport itself rather than against whatever space its siblings leave
        over, which is the whole fix.

        It used to be a row in a flex column, and two other things in that
        column pushed it upward. PresentControls never leaves the flow (it only
        fades to opacity 0), so ~198px of invisible control bar sat under the
        card at all times; and the pile count below the stack took another
        ~92px. Between them the card's centre landed about 145px above the
        middle of the screen — which on a phone reads as the deck being stuck to
        the top of the display.

        Both are now out of the way: the count hangs off the stack rather than
        sitting beside it, and the controls are an overlay. Nothing left in this
        tree can move the card off centre.

        `pointer-events-none` so a tap on bare table still reaches the scrim
        underneath. This layer covers the whole viewport, and without it every
        such tap landed on a div with no handler and did nothing at all.

        And it rises when a card is face-up. Centred is right for a deck lying
        there waiting; it is not right once the controls have come up under it,
        because the bar is at its tallest exactly when a timer is running and
        the card ends up with buttons across its bottom edge. See
        PRESENT_LIFT_REM — the alternative was a permanently smaller card, sized
        for a worst case that is not what you are usually looking at.

        The transform goes here, two levels above the stack, rather than on the
        card. Nearer the flip it would be one more thing touching a preserve-3d
        subtree, and this file has now paid for that twice.
      */}
      <div
        className="pointer-events-none absolute inset-0 grid place-items-center px-6 transition-transform duration-500 ease-out"
        style={{
          transform: faceUp ? `translateY(-${PRESENT_LIFT_REM}rem)` : "none",
        }}
      >
        {/*
          The card's box, and the thing the count below hangs off. Separate from
          the stack for one reason: the stack carries `perspective`, which makes
          a 3D rendering context of everything inside it, and text rasterised
          inside one of those is text at the mercy of how a browser decides to
          composite a 3D layer. The count stays out here on flat ground.
        */}
        <div ref={boxRef} className="relative" style={{ width: CARD_WIDTH }}>
          <div
            ref={stackRef}
            className="pointer-events-auto relative"
            style={{ perspective: "1400px" }}
          >
            {/*
            The rest of the pile, showing under the top card as thickness.

            Hidden once the deck is spent, because a stack that still looks two
            millimetres thick while claiming to be empty is the kind of small
            lie that makes a count untrustworthy.
          */}
            {remaining > 0 &&
              Array.from({ length: Math.min(SHUFFLE_CARDS, remaining) }).map(
                (_, i) => {
                  /*
                   * Only the first few step back visibly. The rest sit exactly
                   * where the third one does, completely hidden behind it — they
                   * exist so the shuffle has a deck to work through, not to make
                   * the stack look thicker.
                   */
                  const step = depthOf(i + 1);
                  return (
                    <div
                      key={i}
                      aria-hidden="true"
                      className="absolute inset-0"
                      style={{
                        transform: `translate(${step * STEP_X}px, ${step * STEP_Y}px) rotate(${step * STEP_ROT}deg)`,
                        // Explicit, so the shuffle can push a card underneath
                        // them. Left to DOM order it is the button that always
                        // wins, and a card cannot be buried in a deck it paints
                        // over.
                        zIndex: layerZ(i + 1),
                        // Decoration, and never a tap target. Without this a tap
                        // during a shuffle — when a back is at the front and the
                        // real card is buried — lands on a div with no handler
                        // and simply does nothing.
                        pointerEvents: "none",
                      }}
                    >
                      {/*
                      The shuffle animates this inner element, never the wrapper
                      above it — the wrapper carries the card's resting offset as
                      an inline transform, and GSAP writing x/rotation to the
                      same element would overwrite it and collapse the stack
                      flat.
                    */}
                      <div
                        data-back
                        className="relative aspect-[5/7] w-full"
                        style={{
                          /*
                           * Darkened rather than faded — a card deeper in a stack
                           * sits in shadow, it does not become see-through. These
                           * used to drop to 40% opacity, which was fine while the
                           * back was a dark panel and turns bone stock into grey
                           * slivers the moment it isn't. Floored, because a riffle
                           * brings every one of these into the open and a card
                           * dimmed to black is a hole in the deck.
                           *
                           * On the element that *moves*, not on the wrapper. A
                           * filter on an ancestor of an animating element has to
                           * be recomputed over the changed region every frame,
                           * which throws away the composited layer the transform
                           * would otherwise ride on for free — seven ornate cards
                           * doing that at once is most of a phone's frame budget.
                           */
                          filter: `brightness(${depthBrightness(step)})`,
                          boxShadow: CARD_SHADOW,
                          borderRadius: "1rem",
                        }}
                      >
                        <CardBack />
                      </div>
                    </div>
                  );
                },
              )}

            {/*
            The card you interact with.

            A button, not a div with a click handler: it is the primary control
            of this mode and has to be reachable and operable from a keyboard.
          */}
            <button
              ref={topRef}
              type="button"
              onClick={faceUp ? layDown : play}
              disabled={inPlayCount === 0}
              aria-label={
                faceUp
                  ? `${showing?.name ?? "Card"}. Put back`
                  : `Draw a card. ${remaining} left in the pile`
              }
              className="press relative block aspect-[5/7] w-full rounded-2xl disabled:opacity-40"
              // The shadow lives out here rather than on the card that turns —
              // see CARD_SHADOW. This element never moves, so it is painted once.
              style={{ zIndex: layerZ(0), boxShadow: CARD_SHADOW }}
            >
              <div
                ref={cardRef}
                className="relative size-full rounded-2xl"
                style={{ transformStyle: "preserve-3d" }}
              >
                <CardBack />
                <CardFace entry={showing} />
              </div>
            </button>
          </div>

          {/*
            The state of the pile, under the stack where you are already
            looking. A chip in the bottom bar would have been another thing
            floating over the table for a number that only matters in this mode.

            Hung off the bottom of the stack rather than laid out beneath it. In
            flow it was half of why the card sat high: a centred column centres
            the card *and this*, so the card rose by half this block's height to
            make room. Out of flow the stack is the only thing being centred,
            and this simply follows it down.
          */}
          <div className="pointer-events-none absolute inset-x-0 top-full mt-5 flex min-h-[4.5rem] flex-col items-center gap-2 text-center">
            {!faceUp && (
              <>
                <p className="text-sm text-muted-foreground">
                  {inPlayCount === 0
                    ? "Nothing in play"
                    : remaining === 0
                      ? "That's the whole deck — draw to shuffle"
                      : "Tap to draw"}
                </p>
                {inPlayCount > 0 && remaining > 0 && (
                  <p className="tabular text-xs text-muted-foreground/70">
                    {remaining} left of {inPlayCount}
                  </p>
                )}
                {/*
                Reshuffling belongs here, beside the count it acts on, not
                buried in the deck panel two taps away. It is the one thing you
                might want to do to the pile without drawing from it — you have
                changed your mind about the run you are on — and that impulse
                arrives while looking at the stack.

                Quiet, though. It is a way of *not* getting a result, sitting
                directly under the thing that gives you one.
              */}
                {inPlayCount > 1 && (
                  <button
                    type="button"
                    onClick={shufflePile}
                    // The one thing in this block that is a control rather than a
                    // label, so it is the one thing that takes the taps its
                    // wrapper is passing through.
                    className="glass press pointer-events-auto mt-0.5 inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Shuffle className="size-3.5" aria-hidden="true" />
                    Shuffle
                  </button>
                )}
              </>
            )}
            {/* Said once, on the card that follows a reshuffle. A deck that
              silently starts over looks like a deck that was repeating itself
              all along. */}
            {faceUp && justShuffled && (
              <p className="text-xs text-muted-foreground/70">
                Shuffled — {inPlayCount} fresh
              </p>
            )}
          </div>
        </div>
      </div>

      {/*
        An overlay here, and a row everywhere else.

        PresentControls itself is unchanged: FullPicture lays it out as a real
        row in a real column, and the die's picture genuinely needs that space
        reserved above it. Card mode is the opposite case — the card has to sit
        in the middle of the screen whether the controls are showing or not, and
        a row that always occupies ~198px whatever its opacity says is precisely
        what stopped it doing so.

        That it clears the stack is arranged rather than lucky:
        CONTROLS_RESERVE_REM in lib/cards/layout.ts is this bar's height, and the
        card's own size formula reserves it top and bottom before choosing a
        width. verify:cards holds the two apart at every viewport shape.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <PresentControls />
      </div>
    </div>
  );
}
