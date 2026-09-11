"use client";

import { Dices, WalletCards } from "lucide-react";
import { hapticThrow } from "@/lib/haptics";
import { useDiceStore, type GameMode } from "@/lib/store";
import { useTapRun } from "@/lib/useTapRun";

/**
 * Die or cards.
 *
 * A visible two-segment pill rather than a chip that opens, which is the
 * opposite call from DieTypePicker next to it — and deliberately so. That has
 * five options and hides them because the screen is meant to be the table; this
 * has two, and which one you are in is the single most load-bearing fact about
 * what is on screen. A control you have to tap to learn the current state from
 * is the wrong shape for that.
 *
 * Icons alone. The words "Dice" and "Cards" doubled the width of the bottom bar
 * on a phone, and the objects themselves are already on the table saying it.
 */
const MODES: { mode: GameMode; label: string; Icon: typeof Dices }[] = [
  { mode: "dice", label: "Dice", Icon: Dices },
  { mode: "cards", label: "Cards", Icon: WalletCards },
];

export function ModeSwitch() {
  const mode = useDiceStore((s) => s.mode);
  const setMode = useDiceStore((s) => s.setMode);

  /*
   * The fix goes in here: three quick taps on the dice segment while dice mode
   * is already what you are in.
   *
   * On this control because those taps are the one gesture in the bottom bar
   * that already does nothing at all — setMode bails on an unchanged mode, so
   * there is no ordinary job to work around and no way for the run to disturb
   * anything if it is abandoned half way. Tapping in from cards switches modes
   * and does not count; the run starts from the next tap, so the gesture means
   * the same thing wherever you started.
   *
   * It only arms what was already chosen; choosing is the hold behind the die
   * chip. Taking it out again is on the speaker — see DiceApp. The buzz is the
   * whole of the feedback, which is as much as a secret can afford: felt in the
   * hand, invisible from the other side of a bed.
   */
  const setRigOn = useDiceStore((s) => s.setRigOn);
  const { tap, reset } = useTapRun(3, () => {
    setRigOn(true);
    hapticThrow();
  });

  return (
    <div
      role="group"
      aria-label="Game mode"
      className="glass flex h-11 items-center gap-0.5 rounded-full p-1"
    >
      {MODES.map(({ mode: value, label, Icon }) => {
        const active = value === mode;
        return (
          <button
            key={value}
            type="button"
            onClick={() => {
              // Enter and Space arrive here too, so the gesture works from a
              // keyboard as well as a thumb.
              if (value === "dice" && active) {
                tap();
                return;
              }
              reset();
              setMode(value);
            }}
            aria-pressed={active}
            aria-label={label}
            title={label}
            // No `.press` on the inactive segment: the shared press treatment
            // dims to 82%, and dimming something already at muted-foreground
            // makes tapping it look like it failed rather than took.
            className={`grid size-9 place-items-center rounded-full transition-colors ${
              active
                ? "bg-brand text-on-brand"
                : "press text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
