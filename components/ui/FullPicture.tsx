"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useDiceStore } from "@/lib/store";
import { isOwn } from "@/lib/dice/own";
import { resolvedSource } from "@/lib/dice/stencil";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Intensity } from "./Intensity";
import { PresentControls } from "./PresentControls";
import { OwnMark } from "./OwnMark";
import { WildMark } from "./WildMark";

/**
 * The landed position, opened out from the die.
 *
 * On the die the artwork is small, inset, and sampled from a 512px atlas cell.
 * This is the original file at its own resolution, shown the moment the die
 * finishes turning its face to the camera.
 *
 * The name sits directly under the picture rather than down with the buttons.
 * Phone-first: a title separated from the thing it names reads as two unrelated
 * pieces of UI, and the gap is worst on a tall screen where they end up at
 * opposite ends.
 */

/**
 * How large the picture starts, relative to its final size.
 *
 * Derived from SCREEN_FILL in lib/scene/presentation.ts times the share of the
 * face the artwork covers — so it opens from roughly the size the face occupied
 * on screen.
 */
const OPEN_FROM_SCALE = (46 * 0.78) / 52;

/** Held back until the die has finished arriving. */
const RISE_SETTLE_DELAY = 0.5;

/**
 * Vertical travel on the fades.
 *
 * Deliberately tiny. Anything past about 16px stops reading as a fade and
 * starts reading as a slide, which is a different, busier gesture than the one
 * this moment wants.
 */
const FADE_TRAVEL = 12;

export function FullPicture() {
  const phase = useDiceStore((s) => s.phase);
  const mode = useDiceStore((s) => s.mode);
  /*
   * Subscriptions, not values.
   *
   * currentEntry() is a getter over exactly these, and this component reads none
   * of them directly — so without subscribing, the reveal would go on showing
   * the previous result. `dealId` is in the list because a die's entry is looked
   * up through the deal, which is re-dealt on every throw. The same pattern
   * PresentControls uses, and for the same reason.
   */
  useDiceStore((s) => s.value);
  useDiceStore((s) => s.drawn);
  useDiceStore((s) => s.dealId);
  const chosenEntry = useDiceStore((s) => s.chosenEntry);
  const rollId = useDiceStore((s) => s.rollId);
  const layDown = useDiceStore((s) => s.layDown);
  const discreet = useDiceStore((s) => s.discreet);
  const reduced = useReducedMotion();

  const scrimRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);

  // This is the die's reveal specifically. A card is its own reveal — the
  // artwork is printed on the thing you just turned over — so opening this on
  // top of one would be the same picture twice, the second copy covering the
  // first.
  /*
   * Read from currentEntry(), not from the die's face value.
   *
   * This used to ask defaultFaceSet what was on face `value`, and every one of
   * those accessors is `dealtTo(value)` underneath — the same deck entry,
   * reached the long way round. Going through the store's own seam instead
   * costs nothing and buys the case the long way round could not express: a
   * forfeit puts a position on the table without any die having landed on it,
   * so there is no `value`, so the reveal simply never opened. The position
   * somebody had just won showed as an action bar over bare felt.
   *
   * It also lets that position be one the deck does not contain at all. See
   * EXTRAS — a name with no artwork behind it, which the plate below handles
   * the same way it has always handled a wild.
   */
  const landed = useDiceStore.getState().currentEntry();

  /*
   * The die's reveal — and a forfeit's, in either mode.
   *
   * A card is normally its own reveal: the artwork is printed on the thing you
   * just turned over, so opening this on top of one would be the same picture
   * twice. A forfeit is the exception, because nothing was turned over — the
   * card on the felt is the one from *before* the bet, and leaving it up would
   * show the position they just replaced.
   */
  const presenting =
    phase === "settled" &&
    Boolean(landed) &&
    (mode === "dice" || chosenEntry !== null);
  const symbol = landed ? resolvedSource(landed.source) : undefined;
  const label = landed?.name;
  const intensity = landed?.intensity;
  const wild = landed?.kind === "wild";
  // The other kind of entry with nothing to load: one somebody wrote. Without
  // this the reveal opens onto an empty box above the name.
  const own = !wild && landed !== undefined && isOwn(landed.id);
  /*
   * A wild's rule, and only a wild's.
   *
   * Positions have a line of their own now (see `description` on DeckEntry) and
   * for a while it was printed here too, under the intensity. It did not fit.
   * Everything in this column is `shrink-0` inside a centred flex box, so a
   * fourth row does not compress the ones above it — it pushes the stack past
   * the ends of the box, and the last element is the one that goes over the
   * edge. The description was always the last element, so on any short window it
   * was the one thing on screen you could not read.
   *
   * It is printed on the card face instead, which is the reveal in card mode and
   * has the room for it, and spoken by ResultAnnouncer. A wild's hint stays: a
   * rule that is never stated is not a rule, and there is exactly one wild in
   * the deck, so it is never competing with a picture for the same line.
   */
  const hint = landed?.hint;
  // Artwork, a drawn wild, or a name with neither — the last is what an off-deck
  // pick is, and it opens on its plate alone.
  const hasMark = Boolean(symbol) || wild || Boolean(label);

  useEffect(() => {
    const scrim = scrimRef.current;
    const picture = pictureRef.current;
    const image = imageRef.current;
    const plate = plateRef.current;
    // None of these are rendered in discreet mode, so there is nothing to open.
    if (
      !scrim ||
      !picture ||
      !image ||
      !plate ||
      !presenting ||
      !hasMark ||
      discreet
    )
      return;

    // context().revert() rather than kill(): a `from`-style tween applies its
    // start state immediately, so tearing one down mid-flight would strand the
    // picture invisible.
    const ctx = gsap.context(() => {
      const name = nameRef.current;
      const targets = [scrim, picture, image, plate, name].filter(Boolean);

      if (reduced) {
        gsap.set(targets, { opacity: 1, y: 0, filter: "blur(0px)" });
        gsap.set(picture, { scale: 1 });
        return;
      }

      const tl = gsap.timeline({ delay: RISE_SETTLE_DELAY });

      // The scrim first, so the scene recedes before anything arrives on top
      // of it. Without it the picture competes with a lit table behind it.
      tl.fromTo(
        scrim,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power1.out" },
      );

      // Starts matching the face, then opens out — the artwork appears to peel
      // off the die rather than fade in on top of it.
      //
      // Scale, not height. Animating a layout property forces a reflow every
      // frame and, worse here, changes the block's measured size mid-tween so
      // whatever sits below it moves around. Scale is composited and leaves
      // layout alone.
      //
      // The blur goes on the image, never on the container: a `filter` on an
      // ancestor breaks `backdrop-filter` on the frosted plate inside it.
      tl.fromTo(
        picture,
        { scale: OPEN_FROM_SCALE },
        { scale: 1, duration: 0.5, ease: "power3.out" },
        0.06,
      );

      // The plate fades in with the picture it backs.
      //
      // It used to have no starting opacity, so the moment the die settled a
      // fully-opaque blurred square appeared over it and sat there until the
      // picture arrived. The backdrop should never exist without the thing it
      // is a backdrop for.
      tl.fromTo(
        plate,
        { opacity: 0 },
        { opacity: 1, duration: 0.4, ease: "power1.out" },
        0.06,
      );

      tl.fromTo(
        image,
        { opacity: 0, filter: "blur(8px)" },
        { opacity: 1, filter: "blur(0px)", duration: 0.45, ease: "power1.out" },
        0.06,
      );

      // The name last, and only a hair of travel — it should settle under the
      // picture, not fly in.
      if (name) {
        tl.fromTo(
          name,
          { opacity: 0, y: FADE_TRAVEL },
          { opacity: 1, y: 0, duration: 0.4, ease: "power1.out" },
          0.34,
        );
      }
    });

    return () => ctx.revert();
    // rollId is a dependency so the same face twice still replays.
  }, [presenting, symbol, label, hasMark, rollId, reduced, discreet]);

  // Tapping the scrim puts the die down, and a scrim is not something you can
  // tap with a keyboard. Escape is the same gesture by the other route.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") layDown();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, layDown]);

  /*
   * Nothing at all in discreet mode, and that is the whole design rather than a
   * shortcut.
   *
   * Everything in here — the picture, the name, the intensity, the wild's hint —
   * is the thing being hidden, so a "discreet version" of this layer would be a
   * scrim, a plate and an action bar arranged around an empty square. The die
   * itself is already a perfectly good reveal without any of it: it rises, turns
   * its face to the camera, and shows a numeral, which is exactly what a dice
   * roller does and all a dice roller offers.
   *
   * That takes <PresentControls /> with it, which is right for the same reason —
   * a gamble, a favourite and "Not tonight" are all opinions about a position,
   * and there are no positions on screen. It also avoids the layout problem
   * their absence would otherwise create: this bar normally sits over the bottom
   * chrome and is only legible because the scrim hides what is underneath it.
   * With no scrim it would land squarely on the deck chip and the mute button.
   *
   * Rolling again is a tap on the felt, handled by onPointerMissed in
   * DiceScene.tsx — which reads `discreet` and throws rather than putting the die
   * down, so the gesture stays one tap.
   */
  if (discreet) return null;

  // Unmounted rather than merely hidden in card mode: this subtree owns
  // <PresentControls />, and CardTable renders its own. Two of them would mean
  // two action bars, two GSAP contexts, and two of every button for a screen
  // reader.
  if (!hasMark || mode === "cards") return null;

  return (
    <div
      // z-40, above the bottom bar's z-30. The die's reveal *is* modal — the
      // result is the only thing on screen and its actions are the only ones
      // offered — which is the opposite of how a card sits on the table.
      className="fixed inset-0 z-40 flex flex-col"
      style={{
        pointerEvents: presenting ? "auto" : "none",
        visibility: presenting ? "visible" : "hidden",
      }}
    >
      {/*
        Dims the scene; does not blur it.

        Blurring the whole screen threw away the thing you had just watched —
        the die, still sitting there. The only blur is behind the picture
        itself, which is enough to separate it without erasing everything else.
      */}
      {/*
        The dismiss handler lives here and on the picture, never on the wrapper.
        On the wrapper it caught every click inside the reveal by bubbling — so
        gambling a duration, which doesn't change the phase, put the die down
        instead. Buttons are siblings of this element, so their clicks can't
        reach it.
      */}
      {/*
        Graded and warm, not a flat wash.

        This was a single near-black at 78%, and a flat dark field over the
        whole viewport is the thing that turned the reveal into a modal: the
        candlelit room you had just been looking at vanished at precisely the
        moment the app was meant to feel most like a room. It also read cheap
        for the ordinary reason flat overlays do — nothing in a lit space is
        evenly dark.

        So the warmth comes from its *colour* — a warm plum rather than a
        neutral near-black — while it stays dense enough to do the covering. A
        first pass took the centre down to 62% instead, which let the room back
        in beautifully and also let the die back in: its face carries the same
        picture, so a ghost of the artwork appeared directly behind the artwork.
        Density is not the thing that was making this cold.
      */}
      <div
        ref={scrimRef}
        onClick={layDown}
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.91) 0%, rgba(16,5,11,0.94) 55%, rgba(7,2,5,0.97) 100%)",
        }}
      />

      {/*
        The softening behind the artwork, and the thing that covers the die.

        Centred on the *viewport*, not on the picture — which is the correction
        that matters. It used to live inside the picture's box, and the picture
        is centred in whatever space the controls leave rather than in the
        window, so the two were about a hundred pixels apart. The die presents
        itself at dead centre (RISE = 0 in lib/scene/presentation.ts, chosen so
        the picture could sit over it), so anything meant to cover the die has
        to be centred where the die is.

        That matters because the die's face carries the same picture that is now
        open above it. Left showing it is a second, smaller, dimmer copy of the
        artwork directly behind the artwork, and the lit cube reads as a hard
        rectangle behind the name.

        Its earlier form was a frosted plate: a backdrop-blur behind a
        translucent fill, masked to have no edge. It had a very obvious one — a
        `backdrop-filter` samples a rectangle and the boundary of what it
        blurred stayed visible straight through the mask, so every result
        arrived sitting on a grey card. A radial gradient to `transparent`
        cannot have an edge; that is what a gradient is.
      */}
      <div
        ref={plateRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 aspect-square h-[min(92vh,124vw)] -translate-x-1/2 -translate-y-1/2"
        style={{
          opacity: 0,
          background:
            "radial-gradient(closest-side," +
            " color-mix(in srgb, var(--surface-raised) 92%, transparent) 0%," +
            " color-mix(in srgb, var(--surface-raised) 80%, transparent) 46%," +
            " color-mix(in srgb, var(--surface) 44%, transparent) 66%," +
            " color-mix(in srgb, var(--bg) 18%, transparent) 84%," +
            " transparent 96%)",
        }}
      />

      {/*
        Picture and name as one block, centred in whatever space the controls
        leave. Laying them out in the same column as the buttons is what stops
        the name landing on top of them on a short window — the two used to be
        positioned independently and collided.
      */}
      <div
        onClick={layDown}
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6"
      >
        {/* The artwork carries no information a screen reader can use — the
            position's name sits right below it, and ResultAnnouncer says it
            aloud the moment the die settles. */}
        <div
          ref={pictureRef}
          aria-hidden="true"
          className="relative aspect-square h-[min(52vh,68vw)] shrink-0"
        >
          {/* A frosted plate behind the artwork. The pictures are transparent,
              so without something behind them the die and the table show
              straight through and the two images read as one muddle. */}
          {/*
            The separation the transparent artwork needs, as light rather than
            as a surface.

            This was a frosted plate: a backdrop-blur behind a translucent fill,
            masked with a radial falloff and meant to have no edge. It had a
            very obvious one. A `backdrop-filter` samples a rectangle and the
            boundary of what it blurred stayed visible straight through the
            mask, so every result arrived sitting on a grey card — a second
            shape competing with the picture, and the single cheapest thing on
            the screen.

            A radial gradient to `transparent` cannot have an edge; that is what
            a gradient is. So the softening is now a warm glow, as though the
            pool below had come up behind the picture, and it fades out well
            inside its own box. No blur, nothing sampled, nothing to notice.
          */}
          {/* One wrapper for both kinds of mark, so the reveal animates the
              same element whether the face carries artwork or a drawn wild. */}
          <div
            ref={imageRef}
            className="relative size-full"
            style={{ opacity: 0 }}
          >
            {symbol ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={symbol}
                alt=""
                className="size-full object-contain drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
              />
            ) : wild ? (
              <div className="flex size-full items-center justify-center p-[14%]">
                <WildMark className="text-brand drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]" />
              </div>
            ) : own ? (
              <div className="flex size-full items-center justify-center p-[14%]">
                <OwnMark
                  name={landed?.name ?? ""}
                  className="text-brand drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
                />
              </div>
            ) : null}
          </div>
        </div>

        {label && (
          <div
            ref={nameRef}
            className="mt-7 flex shrink-0 flex-col items-center gap-3"
            style={{ opacity: 0 }}
          >
            {/*
              The display serif, and a size up.

              It was Inter semibold at tracking-tight — the same face, weight
              and spacing as a settings label, which is exactly what it looked
              like. A name is the one piece of text here that is not interface,
              and setting it like interface is most of why the reveal read
              cheap. Tracking goes back to normal because a serif is drawn with
              its own spacing already in it.
            */}
            <p className="text-center font-[family-name:var(--font-display)] text-[clamp(2rem,8.5vw,2.75rem)] font-medium leading-[1.1] text-foreground">
              {label}
            </p>
            {intensity && (
              /*
                With its word. Three pink dots on their own under a title read
                as a loading indicator or a carousel — which is what they looked
                like here, directly below the name and nowhere near anything
                that would explain them. In the deck's list, where they sit in a
                row of identical rows, they still read fine.
              */
              <Intensity
                level={intensity}
                withLabel
                className="text-muted-foreground"
              />
            )}
            {/* Only wilds carry a hint. A picture of a position explains
                itself; an instruction has to say what it means. */}
            {hint && (
              <p className="max-w-[22rem] text-balance text-center text-sm leading-relaxed text-muted-foreground">
                {hint}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Controls occupy their own row rather than floating over the block. */}
      <PresentControls />
    </div>
  );
}
