"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  type OwnPosition,
} from "@/lib/dice/own";
import type { Intensity, Measure } from "@/lib/dice/deck";
import { useDiceStore } from "@/lib/store";
import { OwnMark } from "./OwnMark";

/**
 * Writing a position of your own.
 *
 * The first form in this app, which is worth saying out loud because it is the
 * reason several small decisions here look deliberate rather than default.
 * Everything else in this interface is a button that takes effect the moment it
 * is pressed; a position is the one thing that has to be *composed* before it
 * means anything, so this is the one place with a Save.
 *
 * It replaces the panel's body rather than opening on top of it. Two stacked
 * sheets and a software keyboard is a fight nobody wins on a phone, and pushing
 * a detail screen over a settings screen is the gesture every phone already
 * teaches. One overlay, one focus trap, one scroll container.
 *
 * The fields are the same four a built-in carries, and for the same reason: a
 * position you wrote should behave exactly like one that came with the app —
 * the same pips on the reveal, the same stake wheel — rather than being a
 * second-class row that only has a name.
 */

const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: 1, label: "Gentle" },
  { value: 2, label: "Steady" },
  { value: 3, label: "Intense" },
];

const MEASURES: { value: Measure; label: string; hint: string }[] = [
  { value: "strokes", label: "Strokes", hint: "counted" },
  { value: "time", label: "Time", hint: "on a clock" },
];

/** A row of choices, which is how every other value in this app is picked. */
function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={on}
              className={`press min-h-11 flex-1 rounded-xl px-2 text-sm font-medium transition-colors ${
                on
                  ? "bg-brand text-on-brand"
                  : "bg-surface-raised text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
              {option.hint && (
                <span className="block text-[0.65rem] font-normal opacity-70">
                  {option.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PositionEditor() {
  const editing = useDiceStore((s) => s.editing);
  const own = useDiceStore((s) => s.own);
  const addOwn = useDiceStore((s) => s.addOwn);
  const updateOwn = useDiceStore((s) => s.updateOwn);
  const removeOwn = useDiceStore((s) => s.removeOwn);
  const setEditing = useDiceStore((s) => s.setEditing);

  const existing: OwnPosition | undefined =
    editing && editing !== "new"
      ? own.find((entry) => entry.id === editing)
      : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [intensity, setIntensity] = useState<Intensity>(
    existing?.intensity ?? 2,
  );
  const [measure, setMeasure] = useState<Measure>(existing?.measure ?? "time");
  const [showError, setShowError] = useState(false);
  /** Delete asks once before it does it. See the note on the button. */
  const [armed, setArmed] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only for a blank one. Opening the keyboard over a position somebody is
    // reading before they have said they want to change it is the app being
    // presumptuous with the bottom half of a small screen.
    if (!existing) nameRef.current?.focus();
  }, [existing]);

  // Disarm on any other interaction, so a confirm left standing does not sit
  // there waiting to be hit by a thumb that has moved on to something else.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid) {
      setShowError(true);
      return;
    }

    const draft = {
      name: name.trim(),
      description: description.trim(),
      intensity,
      measure,
    };

    if (existing) updateOwn(existing.id, draft);
    else addOwn(draft);

    setEditing(null);
  };

  const field =
    "min-h-11 w-full rounded-xl bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60";

  return (
    <>
      <div className="mb-4 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setEditing(null)}
          aria-label="Back to the deck, discarding this"
          className="press -ml-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          <Dialog.Title className="select-none font-[family-name:var(--font-display)] text-2xl italic text-foreground">
            {existing ? "Edit" : "Write one"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs leading-relaxed text-muted-foreground">
            It joins the deck like any other — dealt onto the die, drawn from the
            pile, and counted the way you say it is counted.
          </Dialog.Description>
        </div>

        {/* The mark it will wear, drawn from what is in the name field as it is
            typed. Three lines, and it explains what a monogram is without a
            paragraph saying so — which is the difference between "no pictures"
            reading as a decision and reading as a limitation. */}
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-surface-raised">
          <OwnMark name={name} className="size-2/3 text-brand" />
        </span>
      </div>

      <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="own-name">
        Name
      </label>
      <input
        id="own-name"
        ref={nameRef}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setShowError(false);
        }}
        maxLength={NAME_MAX}
        placeholder="Against the wall"
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="on"
        enterKeyHint="next"
        className={field}
      />
      {showError && !valid && (
        <p className="mt-1.5 text-xs text-brand">It needs a name, at least.</p>
      )}

      <label
        className="mb-1.5 mt-4 block text-xs text-muted-foreground"
        htmlFor="own-description"
      >
        What it asks for{" "}
        <span className="tabular opacity-60">
          {description.length}/{DESCRIPTION_MAX}
        </span>
      </label>
      <textarea
        id="own-description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        maxLength={DESCRIPTION_MAX}
        rows={3}
        placeholder="They decide when you are allowed to turn around."
        autoCapitalize="sentences"
        autoCorrect="on"
        enterKeyHint="done"
        // Centred rather than merely scrolled to: on a phone the keyboard takes
        // the bottom half, and "just visible" means sitting on top of it.
        onFocus={(event) =>
          event.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        className={`${field} resize-none leading-relaxed`}
      />
      <p className="mb-4 mt-1.5 text-xs leading-relaxed text-muted-foreground">
        One line, read across a room in one glance. The ones that land say who is
        allowed to move.
      </p>

      <Choice
        label="How quickly it ends"
        options={INTENSITIES}
        value={intensity}
        onChange={setIntensity}
      />

      <Choice
        label="How the stake is counted"
        options={MEASURES}
        value={measure}
        onChange={setMeasure}
      />

      <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
        {existing &&
          (armed ? (
            <>
              <button
                type="button"
                onClick={() => {
                  removeOwn(existing.id);
                  setEditing(null);
                }}
                className="press min-h-11 rounded-xl bg-brand px-4 text-sm font-medium text-on-brand"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="press min-h-11 rounded-xl px-3 text-sm text-muted-foreground"
              >
                Keep
              </button>
            </>
          ) : (
            // Asks in place rather than through a browser confirm, which on a
            // phone is a system sheet from nowhere — and which would put a modal
            // over a modal.
            <button
              type="button"
              onClick={() => setArmed(true)}
              aria-label={`Delete ${existing.name}`}
              className="press grid size-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:text-brand"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          ))}

        <button
          type="button"
          onClick={save}
          className={`press ml-auto min-h-11 rounded-xl px-5 text-sm font-medium transition-colors ${
            valid
              ? "bg-brand text-on-brand"
              : "bg-surface-raised text-muted-foreground"
          }`}
        >
          {existing ? "Save" : "Add to the deck"}
        </button>
      </div>
    </>
  );
}
