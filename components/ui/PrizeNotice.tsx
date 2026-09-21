"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import { PRIZE_LADDER, STAKES, useDiceStore } from "@/lib/store";
import { potLabel } from "@/lib/cards/playing";
import type { DeckEntry } from "@/lib/dice/deck";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { Thumb } from "./Thumb";
import { RUNG_COPY } from "./prizeCopy";

/**
 * A won run, spent.
 *
 * The other half of the higher-or-lower run, and the reason the run pays in
 * control rather than in a number. HighLowTable owns the cards and stops the
 * moment the pot is taken; this owns everything after, which is a ladder and
 * up to three questions.
 *
 * ## Why it is not WinNotice
 *
 * WinNotice is a sentence and a beat: you won, here is the throw you won. It is
 * right for the coin, which pays one thing and cannot pay anything else. A run
 * pays a *choice* — several of them on the top rung — and a notice that waits
 * for nobody is the wrong shape for a screen somebody has to read. So the coin
 * keeps its notice and the run gets this, and settledBet() no longer reports a
 * won call at all so the two can never both be up.
 *
 * ## The rungs you cannot afford are still drawn
 *
 * Greyed, under the ones you can. That is deliberate and it is most of what
 * makes the ladder a ladder: a prize screen that only showed what you won would
 * make every run feel the same size. Seeing "pick anything" sitting one rung
 * above what you stopped at is the entire argument for going one more call next
 * time, and it costs a row of dimmed text to make.
 */

/** Matches the notices, so everything that opens over the felt opens alike. */
const FADE_TRAVEL = 12;
const OUTRO_SECONDS = 0.32;
const OUTRO_MS = OUTRO_SECONDS * 1000;

/** What each stage asks, in the app's own voice. */
const ASKS: Record<string, { title: string; hint: string }> = {
  choose: { title: "Two of them", hint: "Take whichever you like." },
  pick: { title: "Anything you like", hint: "The whole deck is open." },
  hand: { title: "And one for them", hint: "Something they owe you." },
};

/**
 * The deck as a grid, to be chosen from.
 *
 * A component rather than a function returning JSX inside the notice, and that
 * is not a style preference: the handler it is given closes over the dialog ref
 * on its way to a fade-out, and a ref-reading function handed to something
 * *called* during render is indistinguishable, to the linter and to anybody
 * reading it quickly, from a ref read during render. As a prop on a component
 * it is plainly a handler.
 *
 * Used twice on the top rung — once for the position you are taking, once for
 * the one you are handing over. The square is the same both times because the
 * gesture is; only the question above it changes.
 */
function PositionPicker({
  positions,
  onChoose,
}: {
  positions: DeckEntry[];
  onChoose: (entry: DeckEntry) => void;
}) {
  return (
    <div className="grid w-full max-w-[26rem] grid-cols-3 gap-2 overflow-y-auto">
      {positions.map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-in=""
          style={{ opacity: 0 }}
          onClick={() => onChoose(entry)}
          className="press panel flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition-colors hover:text-brand"
        >
          <Thumb entry={entry} className="aspect-square w-full rounded-lg" />
          <span className="line-clamp-2 text-[0.7rem] leading-tight text-foreground">
            {entry.name}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PrizeNotice() {
  const prize = useDiceStore((s) => s.prize);
  const spendPrize = useDiceStore((s) => s.spendPrize);
  const prizePick = useDiceStore((s) => s.prizePick);
  const handPick = useDiceStore((s) => s.handPick);
  const handAmount = useDiceStore((s) => s.handAmount);
  const clearPrize = useDiceStore((s) => s.clearPrize);
  const available = useDiceStore((s) => s.available);
  // Subscribed to, so the grid rebuilds if the deck changes underneath it.
  useDiceStore((s) => s.deck);
  useDiceStore((s) => s.disabled);
  const reduced = useReducedMotion();

  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const open = prize !== null;

  /*
   * Held one beat past the store, so the last tap can be seen leaving.
   *
   * Every other full-screen layer in this app does exactly this — see
   * ForfeitNotice's `present` and HighLowTable's — and for the same reason: a
   * component that returns null cannot animate itself out.
   */
  const [held, setHeld] = useState(prize);
  const [present, setPresent] = useState(open);
  if (prize && prize !== held) setHeld(prize);
  if (open && !present) setPresent(true);
  const showing = prize ?? held;

  useDialogFocus(open, dialogRef);

  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setPresent(false), OUTRO_MS);
    return () => clearTimeout(id);
  }, [open]);

  const stage = showing?.stage ?? "ladder";

  /*
   * The entrance, per stage.
   *
   * Keyed on the stage rather than run once, because this layer is four screens
   * deep on its top rung and each of them is a new question. A single fade at
   * the start would leave the three that follow arriving as hard cuts.
   */
  useEffect(() => {
    if (!present) return;

    const ctx = gsap.context((self) => {
      const items = self.selector?.("[data-in]") ?? [];

      /*
       * The dialog itself is put back to full, before anything inside it moves.
       *
       * Every stage here is entered *through* `leave`, which fades this element
       * to nothing and only then tells the store — so that the question being
       * answered is seen to go before the next one arrives. The store changes
       * the stage, React re-renders new content into the same element, and that
       * element is still sitting at the opacity the fade left it on. Nothing
       * else touches it: the stagger below animates the `[data-in]` children,
       * not their container.
       *
       * Without this the ladder works and every screen after it is invisible —
       * a picker nobody can see, over a table that refuses every tap because a
       * prize is still unspent. HighLowTable had the same bug for the same
       * reason and it is worth stating twice: a fade-out is only half a
       * transition, and the half that restores has to be somewhere.
       */
      gsap.set(dialogRef.current, { opacity: 1 });

      if (reduced) {
        gsap.set(items, { opacity: 1, y: 0 });
        return;
      }

      gsap.fromTo(
        items,
        { opacity: 0, y: FADE_TRAVEL },
        {
          opacity: 1,
          y: 0,
          duration: 0.34,
          ease: "power2.out",
          stagger: 0.045,
        },
      );
    }, bodyRef);

    return () => ctx.revert();
  }, [present, stage, reduced]);

  /*
   * Out of the way first, then tell the store.
   *
   * A callback rather than a plain closure so that the two pickers can be
   * handed one function instead of building an arrow inside the JSX — which
   * reads the dialog ref, and a ref read from something the linter cannot
   * prove is an event handler is a ref read during render as far as it knows.
   * ForfeitNotice's takeAmount does the same dance for the same reason.
   */
  const leave = useCallback(
    (then: () => void) => {
      if (reduced) {
        then();
        return;
      }
      gsap.to(dialogRef.current, {
        opacity: 0,
        duration: OUTRO_SECONDS,
        ease: "power1.in",
        onComplete: then,
      });
    },
    [reduced],
  );

  /*
   * One handler for both pickers, because the difference is not the tap.
   *
   * The grid, the square and the gesture are identical whoever the position is
   * being chosen for; what changes is which of the two store actions it lands
   * in, and that is a reading of the stage rather than a second component.
   */
  const takePosition = useCallback(
    (entry: DeckEntry) => {
      leave(() => (stage === "pick" ? prizePick(entry) : handPick(entry)));
    },
    [leave, stage, prizePick, handPick],
  );

  if (!present || !showing) return null;

  /*
   * Wilds are kept out of both pickers.
   *
   * A wild is the card that says "whoever threw picks anything they like", and
   * on this screen that is either what you already have or what you are trying
   * to hand over. Offering one is a choice that evaluates to the absence of a
   * choice. ForfeitNotice filters them for the mirror-image reason.
   *
   * available() rather than inPlay(): the pool is a decision about what the
   * deck deals tonight, and a prize this expensive should not be narrowed by it.
   */
  const positions = available().filter((entry) => entry.kind !== "wild");

  const heading = (title: string, hint: string) => (
    <div data-in="" style={{ opacity: 0 }} className="shrink-0 text-center">
      <p
        id={headingId}
        className="font-[family-name:var(--font-display)] text-[clamp(1.6rem,6.5vw,2.25rem)] font-medium leading-[1.1] text-foreground"
      >
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    // z-50, over HighLowTable's z-40 — the cards are still fading out under it.
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.93) 0%, rgba(16,5,11,0.96) 55%, rgba(7,2,5,0.98) 100%)",
        }}
      />

      <div
        ref={bodyRef}
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-[max(1.25rem,env(safe-area-inset-top))]"
      >
        {stage === "ladder" && (
          <>
            <div data-in="" style={{ opacity: 0 }} className="text-center">
              <p className="text-sm text-muted-foreground">
                {showing.calls === 1
                  ? "One call."
                  : `${showing.calls} calls, all of them right.`}
              </p>
              <p
                id={headingId}
                className="font-[family-name:var(--font-display)] text-[clamp(3rem,15vw,4.5rem)] font-semibold leading-none text-brand"
              >
                {potLabel(showing.pot)}
              </p>
            </div>

            {/*
              Every rung, affordable or not. The ones above the pot are dimmed
              and unpressable rather than absent — see the note at the top of
              this file. They are the reason to go one more call next time.
            */}
            <div className="flex w-full max-w-[22rem] flex-col gap-2">
              {PRIZE_LADDER.map(({ rung, at }) => {
                const afford = showing.rungs.includes(rung);
                const copy = RUNG_COPY[rung];

                return (
                  <button
                    key={rung}
                    type="button"
                    data-in=""
                    style={{ opacity: 0 }}
                    disabled={!afford}
                    onClick={() => leave(() => spendPrize(rung))}
                    className={`press flex items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
                      afford
                        ? "panel text-foreground hover:text-brand"
                        : "cursor-default opacity-35"
                    }`}
                  >
                    <span
                      className="tabular grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold"
                      style={{
                        background: afford
                          ? "var(--brand-dim)"
                          : "rgba(255,255,255,0.06)",
                      }}
                    >
                      ×{at}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">
                        {copy.name}
                      </span>
                      <span className="block text-xs leading-tight text-muted-foreground">
                        {copy.blurb}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {stage === "choose" && showing.offer && (
          <>
            {heading(ASKS.choose.title, ASKS.choose.hint)}
            <div className="flex w-full max-w-[24rem] gap-3">
              {showing.offer.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-in=""
                  style={{ opacity: 0 }}
                  onClick={() => leave(() => prizePick(entry))}
                  className="press panel flex flex-1 flex-col items-center gap-2 rounded-2xl p-3 text-center transition-colors hover:text-brand"
                >
                  <Thumb entry={entry} className="aspect-square w-full rounded-xl" />
                  <span className="text-sm font-semibold leading-tight text-foreground">
                    {entry.name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {(stage === "pick" || stage === "hand") && (
          <>
            {heading(ASKS[stage].title, ASKS[stage].hint)}
            <PositionPicker positions={positions} onChoose={takePosition} />
          </>
        )}

        {stage === "amount" && showing.handed && (
          <>
            <div data-in="" style={{ opacity: 0 }} className="shrink-0 text-center">
              <Thumb
                entry={showing.handed.entry}
                className="mx-auto size-24 rounded-2xl"
              />
              <p
                id={headingId}
                className="mt-3 font-[family-name:var(--font-display)] text-[clamp(1.6rem,6.5vw,2.25rem)] font-medium leading-[1.1] text-foreground"
              >
                {showing.handed.entry.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {showing.handed.entry.measure === "strokes"
                  ? "And how many? Your call this time."
                  : "And how long? Your call this time."}
              </p>
            </div>

            {/*
              The forfeit's own numbers, so that what you hand out and what you
              are handed are drawn from one range. A prize with a wheel of its
              own would make the two incomparable in exactly the way that
              matters.
            */}
            <div className="grid w-full max-w-[22rem] shrink-0 grid-cols-4 gap-2">
              {Array.from(
                new Set(STAKES[showing.handed.entry.measure ?? "time"]),
              ).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  data-in=""
                  style={{ opacity: 0 }}
                  onClick={() => handAmount(amount)}
                  className="press panel tabular flex h-14 items-center justify-center rounded-xl text-base font-semibold text-foreground transition-colors hover:text-brand"
                >
                  {showing.handed?.entry.measure === "strokes"
                    ? amount
                    : amount >= 60
                      ? `${amount / 60}m`
                      : `${amount}s`}
                </button>
              ))}
            </div>
          </>
        )}

        {stage === "done" && showing.handed && (
          <>
            <div data-in="" style={{ opacity: 0 }} className="text-center">
              <p className="text-sm text-muted-foreground">They owe you</p>
              <Thumb
                entry={showing.handed.entry}
                className="mx-auto mt-3 size-24 rounded-2xl"
              />
              <p
                id={headingId}
                className="mt-3 font-[family-name:var(--font-display)] text-[clamp(1.6rem,6.5vw,2.25rem)] font-medium leading-[1.1] text-foreground"
              >
                {showing.handed.entry.name}
              </p>
              <p className="tabular mt-1 text-lg text-brand">
                {showing.handed.entry.measure === "strokes"
                  ? `${showing.handed.amount}`
                  : (showing.handed.amount ?? 0) >= 60
                    ? `${(showing.handed.amount ?? 0) / 60} minutes`
                    : `${showing.handed.amount} seconds`}
              </p>
            </div>

            {/*
              The only dismiss button in the whole flow, and it is here because
              this is the only screen that is telling rather than asking. Every
              other stage closes by being answered.
            */}
            <button
              type="button"
              data-in=""
              style={{ opacity: 0 }}
              onClick={() => leave(clearPrize)}
              className="press h-12 w-full max-w-[22rem] rounded-full bg-brand text-sm font-semibold text-foreground transition-opacity hover:opacity-90"
            >
              Good
            </button>
          </>
        )}
      </div>
    </div>
  );
}
