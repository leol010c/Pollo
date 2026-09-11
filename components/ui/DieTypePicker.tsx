"use client";

import { Popover } from "radix-ui";
import { inPlayOf, useDiceStore } from "@/lib/store";
import { DIE_SIDES, DIE_TYPES, type DieType } from "@/lib/dice/types";

/**
 * Which solid is in play.
 *
 * Nothing hidden lives here any more. This chip carried the way into the fix for
 * a while — a five-second hold — and it was the wrong home twice over: a hold is
 * a poor gesture on a phone, where the thumb has to stay still on a 44px target
 * while the OS decides whether it is a long-press of its own, and the list it
 * opened was a list of *positions*, which belongs with the positions rather than
 * hanging off the die. Both now live in DeckPanel.
 */
export function DieTypePicker() {
  const dieType = useDiceStore((s) => s.dieType);
  const setDieType = useDiceStore((s) => s.setDieType);
  const deck = useDiceStore((s) => s.deck);
  const disabled = useDiceStore((s) => s.disabled);
  const discreet = useDiceStore((s) => s.discreet);
  const pool = useDiceStore((s) => s.pool);

  // A die with more faces than the deck has positions would have to print one
  // of them twice, which makes the die lie about how many outcomes it has —
  // the same reason there is no d20. So those aren't offered.
  // Counted the way fitDie counts, so the greyed-out dice and the clamp that
  // actually shrinks the die never disagree about how many positions there are.
  const inPlay = inPlayOf(
    deck.filter((entry) => !disabled.includes(entry.id)),
    pool,
  ).length;
  const shortBy = (type: DieType) => Math.max(0, DIE_SIDES[type] - inPlay);

  // The reason a die is greyed out used to live only in `title`, which on a
  // phone is a tooltip that never opens — and this is a phone app. A disabled
  // control can't even be tapped to ask, so the reason is stated once, in the
  // open, under the row it explains.
  const short = DIE_TYPES.filter((type) => shortBy(type) > 0);

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Die type: ${dieType}. Change`}
        className="glass press tabular grid h-11 min-w-11 place-items-center rounded-full px-3 text-xs font-semibold text-foreground transition-colors hover:text-brand"
      >
        {dieType}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          className="glass z-50 rounded-xl p-1.5 shadow-2xl shadow-black/60 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <div className="flex gap-1" role="group" aria-label="Die type">
            {DIE_TYPES.map((type) => (
              <DieOption
                key={type}
                type={type}
                active={type === dieType}
                shortBy={shortBy(type)}
                onSelect={() => setDieType(type)}
              />
            ))}
          </div>

          {/*
            The explanation goes while disguised, and only the explanation. The
            limit itself is real either way — it is the deck that cannot fill a
            d12, and that does not stop being true because the die is wearing
            numerals — but "needs more positions in play" is the word this mode
            exists to keep off the screen. A greyed-out die with nothing said
            about it is unremarkable in a dice roller; the sentence is not.
          */}
          {short.length > 0 && !discreet && (
            <p className="max-w-[15rem] px-1.5 pb-0.5 pt-2 text-[0.7rem] leading-relaxed text-muted-foreground">
              {short.length === 1
                ? `${short[0]} needs`
                : `${short.slice(0, -1).join(", ")} and ${short.at(-1)} need`}{" "}
              more positions in play than the{" "}
              <span className="tabular">{inPlay}</span> you have.
            </p>
          )}

          <Popover.Arrow className="fill-[color-mix(in_srgb,var(--surface)_78%,transparent)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DieOption({
  type,
  active,
  shortBy,
  onSelect,
}: {
  type: DieType;
  active: boolean;
  /** How many more positions this die would need. 0 when it fits. */
  shortBy: number;
  onSelect: () => void;
}) {
  const discreet = useDiceStore((s) => s.discreet);
  const fits = shortBy === 0;

  // Says what is missing rather than just refusing. A disabled control with no
  // stated reason reads as broken, and the reason here is fixable in one tap.
  // Not while disguised, where the reason is the thing being hidden — and where
  // a screen reader is the one route the disguise could otherwise leak through.
  const label = fits
    ? type
    : discreet
      ? `${type} — unavailable`
      : `${type} — needs ${shortBy} more position${shortBy === 1 ? "" : "s"}`;

  return (
    <Popover.Close
      onClick={fits ? onSelect : undefined}
      disabled={!fits}
      aria-current={active ? "true" : undefined}
      aria-label={label}
      title={label}
      className={`press tabular grid size-11 place-items-center rounded-lg text-xs font-semibold transition-colors ${
        active
          ? "bg-brand text-on-brand"
          : fits
            ? "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
            : "cursor-not-allowed text-muted-foreground/30"
      }`}
    >
      {type}
    </Popover.Close>
  );
}
