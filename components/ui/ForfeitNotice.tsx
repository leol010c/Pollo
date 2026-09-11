"use client";

import { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import { Accordion } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { STAKES, useDiceStore, useSettledBet } from "@/lib/store";
import {
  FORFEIT_CATEGORIES,
  FREE_CHOICE,
  type DeckEntry,
} from "@/lib/dice/deck";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { Thumb } from "./Thumb";
import { WildMark } from "./WildMark";

/**
 * The lost bet, paid where it was lost.
 *
 * This was JokerNotice, which said "they hold a joker now" and handed over a
 * token: a flag in the store, a chip on the felt claiming a debt, and an X to
 * tap when somebody decided the debt had been settled somewhere the app could
 * not see. Everything wrong with that came from one decision — deferring. A
 * reward the app cannot observe has to be remembered, remembering has to be
 * displayed, and a display of something unobservable can only be dismissed by
 * hand.
 *
 * So it is paid here instead, in two taps, by the person who won it. They choose
 * what; then they choose how much. Nothing survives the round, because by the
 * time the round is over there is nothing left owing.
 *
 * What they may choose is deliberately wider than the deck. Twelve photographs
 * is not "whatever they like", so Custom sits at the top offering exactly that —
 * off the list entirely — and the categories beneath it are there for when
 * nobody can think of anything. See FORFEIT_CATEGORIES.
 *
 * The scrim still cannot be tapped away, and that rule matters more here than
 * anywhere: everything else in this app can be waved off because everything else
 * is a result you are free to ignore. This is one somebody else won, and a stray
 * tap on the felt must not be able to spend it.
 */

/** Matches the reveal, so the two arrive with the same weight. */
const FADE_TRAVEL = 12;

/** How long the whole thing takes to get out of the way once it is paid. */
const OUTRO_SECONDS = 0.32;

/** What each gamble calls a loss. Only the headline differs; the cost is one. */
const LOST = {
  coin: "You lost the flip.",
  highlow: "Wrong call.",
} as const;

export function ForfeitNotice() {
  const bet = useSettledBet();
  const forfeit = useDiceStore((s) => s.forfeit);
  const forfeitPick = useDiceStore((s) => s.forfeitPick);
  const forfeitAmount = useDiceStore((s) => s.forfeitAmount);
  const available = useDiceStore((s) => s.available);
  // Subscribed to, so the grid rebuilds if the deck changes underneath it.
  useDiceStore((s) => s.deck);
  useDiceStore((s) => s.disabled);
  const reduced = useReducedMotion();

  const dialogRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const amountsRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const lost = bet?.outcome === "lost";
  const open = lost || forfeit !== null;
  const stage = forfeit?.stage ?? "pick";

  /*
   * Held one beat past the store, so the last tap can be seen leaving.
   *
   * Paying in full clears `forfeit`, which would otherwise unmount this on the
   * same frame — a hard cut from a full-screen picker to the reveal underneath
   * it. CardTable's `present` and HighLowTable's do exactly this for the same
   * reason: a component that returns null cannot animate itself out.
   */
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  useDialogFocus(open, dialogRef);

  /*
   * Where the tapped tile was, in viewport coordinates.
   *
   * Captured on the tap rather than looked up afterwards, because by the time
   * the second stage renders the grid is gone and there is nothing left to
   * measure. It is what lets their choice *travel* into the header of the next
   * question instead of the two screens simply cross-fading — the same trick the
   * old joker notice used to fly its crown down to the chip.
   */
  const from = useRef<DOMRect | null>(null);

  /*
   * The drawers, with the deck poured into whichever one asked for it.
   *
   * Wilds are filtered out of that: a wild is the card that says "whoever threw
   * picks anything they like", and offering one to the person who just won the
   * bet would let them hand the choice straight back — which is not a choice,
   * it is the absence of one wearing a card's clothes.
   */
  // available(), not inPlay(): a forfeit is "whatever they like", and the pool
  // is a decision about what the *die* deals tonight. Narrowing the things
  // somebody may be asked to do to the three they happened to write themselves
  // is not what setting the pool to "only ours" was asking for.
  const positions = available().filter((e) => e.kind !== "wild");
  const categories = FORFEIT_CATEGORIES.map((c) => ({
    ...c,
    entries: c.fromDeck ? positions : c.entries,
  })).filter((c) => c.entries.length > 0);

  const picked = forfeit?.entry;
  const wheel = STAKES[picked?.measure ?? "time"];

  const choose = (entry: DeckEntry, event: React.MouseEvent<HTMLElement>) => {
    from.current = event.currentTarget.getBoundingClientRect();
    forfeitPick(entry);
  };

  const takeAmount = (amount: number) => {
    if (reduced) {
      forfeitAmount(amount);
      return;
    }
    // Out of the way first, then tell the store — so the reveal underneath is
    // uncovered rather than cut to. The same ordering the joker notice used.
    gsap.to(dialogRef.current, {
      opacity: 0,
      duration: OUTRO_SECONDS,
      ease: "power1.in",
      onComplete: () => forfeitAmount(amount),
    });
  };

  // Unmount once the store has caught up and the outro has run.
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setPresent(false), OUTRO_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [open]);

  /*
   * The entrance, per stage.
   *
   * Staged rather than one fade of everything, which is what the rest of the app
   * does and what this was conspicuously not doing: the reveal opens its picture
   * then its name then its actions, and the win notice opens its mark then its
   * words. A single opacity tween on the whole screen reads as a page load.
   */
  useEffect(() => {
    if (!present) return;

    const ctx = gsap.context((self) => {
      const head = headRef.current;
      const hero = heroRef.current;
      /*
       * Marked rather than reached for by structure.
       *
       * The accordion's items are grandchildren of the column they sit in, so a
       * stagger over that column's `children` swept straight past them and left
       * every category at the opacity 0 they are authored at — a screen with a
       * heading, one card, and nothing under it. An attribute is indifferent to
       * how deeply Radix nests its own markup.
       */
      const items = self.selector?.("[data-in]") ?? [];

      if (reduced) {
        gsap.set([head, hero].filter(Boolean), {
          opacity: 1,
          y: 0,
          scale: 1,
          clearProps: "transform",
        });
        gsap.set(items, { opacity: 1, y: 0 });
        return;
      }

      const tl = gsap.timeline();

      if (stage === "pick") {
        tl.fromTo(
          head,
          { opacity: 0, y: FADE_TRAVEL },
          { opacity: 1, y: 0, duration: 0.36, ease: "power2.out" },
        );
        // The choices arrive as a sweep rather than a block. Small enough to
        // read as dealing them out; any slower and somebody waiting to choose
        // is watching an animation instead.
        tl.fromTo(
          items,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.3,
            ease: "power2.out",
            stagger: 0.04,
          },
          0.1,
        );
      } else {
        /*
         * Their choice, travelling from where they tapped it.
         *
         * Measured both ends and tweened between — the tile's old rect was
         * captured on the tap, and the hero's is read here. It is the difference
         * between the second question arriving *because* of the first and the
         * two merely following one another.
         */
        const from0 = from.current;
        if (hero && from0) {
          const end0 = hero.getBoundingClientRect();
          tl.fromTo(
            hero,
            {
              x: from0.left + from0.width / 2 - (end0.left + end0.width / 2),
              y: from0.top + from0.height / 2 - (end0.top + end0.height / 2),
              scale: from0.width / Math.max(1, end0.width),
              opacity: 1,
            },
            {
              x: 0,
              y: 0,
              scale: 1,
              duration: 0.44,
              ease: "power3.out",
              clearProps: "transform",
            },
          );
        } else if (hero) {
          tl.fromTo(
            hero,
            { opacity: 0, scale: 0.8 },
            { opacity: 1, scale: 1, duration: 0.4, ease: "power3.out" },
          );
        }

        tl.fromTo(
          head,
          { opacity: 0, y: FADE_TRAVEL },
          { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" },
          0.16,
        );
        tl.fromTo(
          items,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.28, ease: "power2.out", stagger: 0.03 },
          0.24,
        );
      }
    }, dialogRef);

    return () => ctx.revert();
  }, [present, stage, reduced]);

  if (!present) return null;

  return (
    // z-40, the layer the reveals use. Never up alongside the win notice —
    // a bet went one way or the other.
    <div
      ref={dialogRef}
      className="fixed inset-0 z-40 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      {/* The reveal's scrim: graded and warm rather than a flat wash, so the
          room is dimmed rather than replaced. No click handler — see above. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 115% 85% at 50% 44%, rgba(28,10,18,0.91) 0%, rgba(16,5,11,0.94) 55%, rgba(7,2,5,0.97) 100%)",
        }}
      />

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-8">
        {stage === "pick" ? (
          <>
            <div
              ref={headRef}
              className="flex shrink-0 flex-col items-center gap-1.5"
              style={{ opacity: 0 }}
            >
              {/* The display serif, as every other name and title in the app is
                  set. This is news, not interface. */}
              <p
                id={headingId}
                className="text-center font-[family-name:var(--font-display)] text-[clamp(1.75rem,7vw,2.5rem)] font-medium leading-[1.1] text-foreground"
              >
                {LOST[bet?.kind ?? "coin"]}
              </p>
              <p className="text-center text-sm text-muted-foreground">
                Their pick — anything they like.
              </p>
            </div>

            {/* Scrolls when the list outgrows the screen, which it does on a
                phone. The headline above stays put while the choices move.

                The bar itself is hidden: a phone overlays it and shows nothing,
                but a desktop paints a permanent light gutter down the side of a
                dim, warm screen — the one bright edge on it. */}
            <div className="min-h-0 w-full max-w-[22rem] flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex flex-col gap-3">
                {/*
                  Custom, first and largest.

                  This is the actual prize — "anything they like" — and the
                  categories below are a cure for a blank mind, not the menu it
                  is chosen from. Putting this at the bottom would make it the
                  last resort of somebody who found nothing they fancied, which
                  is the opposite of what winning a forfeit means.
                */}
                <button
                  type="button"
                  data-in=""
                  onClick={(e) => choose(FREE_CHOICE, e)}
                  style={{ opacity: 0 }}
                  className="press glass flex w-full flex-col items-center gap-2 rounded-2xl border border-brand-dim/40 px-4 py-5 transition-colors hover:text-brand"
                >
                  {/* Boxed rather than sized directly: WildMark carries
                      `size-full` of its own, and a size class passed alongside
                      it is two rules of equal specificity racing. */}
                  <span className="grid size-12 place-items-center">
                    <WildMark className="text-brand" />
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-xl font-medium text-foreground">
                    Custom
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Anything they like — they just say it.
                  </span>
                </button>

                <p
                  data-in=""
                  style={{ opacity: 0 }}
                  className="px-1 pt-1 text-xs text-muted-foreground"
                >
                  If you need some inspiration:
                </p>

                {/*
                  Radix rather than a hand-rolled toggle, for the reason
                  DieTypePicker gives about its dropdown: the keyboard handling
                  and the aria-expanded wiring are the parts everybody gets
                  wrong, and they are free here.

                  `collapsible` so the open one can be shut again — with four
                  drawers and a short screen, being unable to close the one you
                  opened means scrolling past it every time.
                */}
                <Accordion.Root
                  type="single"
                  collapsible
                  className="flex flex-col gap-2"
                >
                  {categories.map((category) => (
                    <Accordion.Item
                      key={category.id}
                      value={category.id}
                      data-in=""
                      style={{ opacity: 0 }}
                      className="glass overflow-hidden rounded-xl"
                    >
                      <Accordion.Header>
                        <Accordion.Trigger className="press group flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-sm font-medium text-foreground transition-colors hover:text-brand">
                          {category.name}
                          <ChevronDown
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
                          />
                        </Accordion.Trigger>
                      </Accordion.Header>

                      <Accordion.Content className="overflow-hidden">
                        {category.fromDeck ? (
                          <div className="grid grid-cols-3 gap-2 p-2.5 pt-0.5">
                            {category.entries.map((choice) => (
                              <button
                                key={choice.id}
                                type="button"
                                onClick={(e) => choose(choice, e)}
                                className="press flex flex-col items-center gap-1.5 rounded-lg p-1 transition-colors hover:text-brand"
                              >
                                <Thumb
                                  entry={choice}
                                  className="aspect-square w-full"
                                />
                                <span className="line-clamp-1 text-[0.65rem] text-muted-foreground">
                                  {choice.name ?? choice.id}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col px-1.5 pb-1.5">
                            {category.entries.map((choice) => (
                              <button
                                key={choice.id}
                                type="button"
                                onClick={(e) => choose(choice, e)}
                                className="press flex min-h-11 items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:text-brand"
                              >
                                {choice.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </Accordion.Content>
                    </Accordion.Item>
                  ))}
                </Accordion.Root>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              ref={heroRef}
              className="flex shrink-0 flex-col items-center gap-3"
            >
              {picked && (picked.source.length > 0 || picked.kind === "wild") && (
                <Thumb entry={picked} className="size-24 rounded-2xl" />
              )}
              <p
                id={headingId}
                className="max-w-[18rem] text-balance text-center font-[family-name:var(--font-display)] text-[clamp(1.75rem,7vw,2.5rem)] font-medium leading-[1.1] text-foreground"
              >
                {picked?.name ?? "Their pick"}
              </p>
            </div>

            <div ref={headRef} style={{ opacity: 0 }}>
              <p className="max-w-[20rem] text-balance text-center text-sm text-muted-foreground">
                {picked?.hint ??
                  (picked?.measure === "strokes"
                    ? "And how many? Their call."
                    : "And how long? Their call.")}
              </p>
            </div>

            {/*
              The same numbers the wheel could have landed on, laid out to be
              chosen from instead of spun for. Using the wheel's own values keeps
              a forfeit and a gamble comparable — they are picking from the range
              you would have risked, not from one invented for the occasion.
            */}
            <div
              ref={amountsRef}
              className="grid w-full max-w-[22rem] shrink-0 grid-cols-4 gap-2"
            >
              {Array.from(new Set(wheel)).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => takeAmount(amount)}
                  data-in=""
                  style={{ opacity: 0 }}
                  className="press panel tabular flex h-14 items-center justify-center rounded-xl text-base font-semibold text-foreground transition-colors hover:text-brand"
                >
                  {picked?.measure === "strokes"
                    ? amount
                    : amount >= 60
                      ? `${amount / 60}m`
                      : `${amount}s`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
