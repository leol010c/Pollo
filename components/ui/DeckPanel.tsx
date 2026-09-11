"use client";

import { useState } from "react";
import { Dialog, Tabs } from "radix-ui";
import {
  Eye,
  Check,
  ChevronRight,
  EyeOff,
  GripVertical,
  Heart,
  Layers,
  Pencil,
  Plus,
  Shuffle,
  X,
} from "lucide-react";
import {
  inPlayOf,
  poolSections,
  poolWithoutHalf,
  useDiceStore,
} from "@/lib/store";
import { useTapRun } from "@/lib/useTapRun";
import { useReorder } from "@/lib/useReorder";
import { currentDeal, type DeckEntry } from "@/lib/dice/deck";
import { isOwn } from "@/lib/dice/own";
import { DIE_SIDES } from "@/lib/dice/types";
import { THEMES, themeById } from "@/lib/scene/backdrops";
import { PositionEditor } from "./PositionEditor";
import { Thumb } from "./Thumb";
import { Intensity } from "./Intensity";

/**
 * Which room the scene is in.
 *
 * A row of four swatches rather than a list of names, because the choice is
 * about how something *looks* and a word for a colour is a worse description of
 * it than the colour. The names are still there — under the row, for the
 * selected one, and on every swatch for a screen reader.
 *
 * Each swatch is the room's floor colour graded into its rim colour, which is
 * not decoration: every room in this app is built out of a warm side and a cool
 * side (see the header of lib/scene/backdrops.ts), so the two ends of that
 * gradient are the most compact honest picture of the room there is. It also
 * means a room authored with both hues on the same side of the wheel shows up as
 * a flat swatch here, which is a useful thing to be able to notice.
 *
 * Lives inside the panel's non-discreet branch. Discreet mode forces its own
 * room and outranks this, so the control would sit there doing nothing visible —
 * and the disguise's whole job is to leave nothing on screen worth a second look.
 */
function RoomPicker() {
  const theme = useDiceStore((s) => s.theme);
  const setTheme = useDiceStore((s) => s.setTheme);
  const active = themeById(theme);

  return (
    <section className="mb-5" aria-label="Room">
      {/* Named above the row rather than beside it. Four swatches with no word
          near them read as decoration in a panel that is otherwise all artwork,
          and the selected room's name has to be somewhere a sighted user can
          read it — the labels themselves are only on the controls. */}
      <p className="mb-2 text-xs text-muted-foreground">
        Room — <span className="text-foreground">{active.label}</span>
      </p>

      <div className="flex gap-2">
        {THEMES.map((room) => {
          const selected = room.id === active.id;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => setTheme(room.id)}
              aria-pressed={selected}
              aria-label={room.label}
              title={room.label}
              // 44px, like every other target in this app. The swatch inside is
              // smaller than the button it is in — the thumb needs the whole
              // square, the eye only needs the colour.
              className={`press grid size-11 shrink-0 place-items-center rounded-full transition-colors ${
                selected ? "bg-surface-raised" : "hover:bg-surface-raised/60"
              }`}
            >
              <span
                className={`size-6 rounded-full ring-1 transition-shadow ${
                  selected ? "ring-brand" : "ring-white/15"
                }`}
                style={{
                  // Inline because these are the room's own hexes, read off the
                  // same objects the renderer uses. Restating them as Tailwind
                  // classes would be a second copy to keep in step, and it would
                  // go stale the first time a room was retuned.
                  background: `linear-gradient(140deg, ${room.floor.color} 30%, ${
                    room.rim?.color ?? room.floor.color
                  } 100%)`,
                }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * What is on the die for this throw, and what is sitting out.
 *
 * The deck is deliberately larger than the die, which is a good arrangement and
 * an invisible one: six of the deck get dealt onto the faces each throw and
 * there is no way to tell which six. Showing them makes the die legible again —
 * you can see what it can land on before you throw it.
 *
 * It reads the deal through `dealId` rather than calling currentDeal() alone,
 * because the deal lives in a module and a module array changing is invisible
 * to React. Same reason the deck itself is mirrored into the store.
 */
function OnTheDie({ inPlay }: { inPlay: DeckEntry[] }) {
  useDiceStore((s) => s.dealId);
  const dieType = useDiceStore((s) => s.dieType);
  const faces = DIE_SIDES[dieType];
  // Slice defensively: the opening deal fills the largest die before the store
  // has re-dealt to the real one.
  const deal = currentDeal().slice(0, faces);
  if (deal.length === 0) return null;

  const onDie = new Set(deal.map((entry) => entry.id));
  const sittingOut = inPlay.filter((entry) => !onDie.has(entry.id));

  /*
   * Deliberately not claiming *why* something sits out.
   *
   * The hand is dealt at the start of a throw, and the deal leaves out whatever
   * landed on the throw before — so by the time you can read this, the entry
   * sitting out is the one from two results ago, not the one you just had.
   * Saying "you just rolled it" would be wrong, and it is not worth tracking a
   * second id to be able to say it.
   */
  let caption: string;
  if (sittingOut.length === 0) {
    caption =
      inPlay.length < faces
        ? `Everything in play is on the die — with ${inPlay.length} across ${faces} faces, some appear twice.`
        : "Everything in play is on the die.";
  } else if (sittingOut.length === 1) {
    caption = `${sittingOut[0].name ?? sittingOut[0].id} is sitting this one out.`;
  } else {
    caption = `${sittingOut.length} are sitting this one out.`;
  }

  return (
    <div className="mb-4 rounded-2xl bg-surface-raised/40 p-3">
      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        On the {dieType} now
      </p>
      {/* Wraps: a d12's twelve faces do not fit one phone-width row. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {deal.map((entry, face) => (
          // Keyed by face, not by id: with fewer than six in play the same
          // entry legitimately appears on more than one face.
          <Thumb key={face} entry={entry} className="size-10" />
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}

/**
 * What is left in the pile, and how to start it over.
 *
 * The card mode counterpart to OnTheDie, and a different question with the same
 * shape: that one asks which of the deck can come up on this throw, this one
 * asks which of the deck has not come up yet. Both exist because the deck is
 * bigger than what you can see, and neither state is legible from the table.
 */
function InThePile({ inPlay }: { inPlay: DeckEntry[] }) {
  const pile = useDiceStore((s) => s.pile);
  const shufflePile = useDiceStore((s) => s.shufflePile);
  const drawn = useDiceStore((s) => s.drawn);

  const left = new Set(pile);
  // Not simply "in play minus the pile": the card currently face-up has already
  // left the pile but has not been seen *and finished with*, so counting it as
  // spent would be a card off.
  const seen = inPlay.filter(
    (entry) => !left.has(entry.id) && entry.id !== drawn,
  );

  return (
    <div className="mb-4 rounded-2xl bg-surface-raised/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          Still in the pile
        </p>
        <button
          type="button"
          onClick={shufflePile}
          className="press -my-1 -mr-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Shuffle className="size-3" aria-hidden="true" />
          Shuffle
        </button>
      </div>

      {/* Undrawn cards at full strength, spent ones dimmed in place rather than
          removed — the row stays the same length as you work through it, so it
          reads as a deck emptying rather than a list shrinking. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {inPlay.map((entry) => (
          <Thumb
            key={entry.id}
            entry={entry}
            className={`size-10 ${left.has(entry.id) ? "" : "opacity-25"}`}
          />
        ))}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {pile.length === 0
          ? "That's the whole deck — the next draw shuffles it."
          : seen.length === 0
            ? `${pile.length} to come. Nothing repeats until the pile runs out.`
            : `${pile.length} to come, ${seen.length} already turned over.`}
      </p>
    </div>
  );
}

/**
 * The deck itself: every entry, in or out, favoured or not.
 *
 * Its own component rather than a block inside the panel because discreet mode
 * takes it away wholesale — this and the two summaries above it are the entire
 * explicit surface of the panel, and a section that can be removed in one line
 * is easier to be sure about than one wrapped in a conditional a hundred lines
 * long. It reads the store directly for the same reason the summaries do.
 */
/**
 * The head of a section, and the switch that puts the whole section out.
 *
 * This is where the "roll from" control ended up, and folding it in here is the
 * point rather than a tidy-up. It used to be three buttons above the list —
 * *everything / only ours / only built-in* — which said exactly what the two
 * section headings underneath already said, in a different vocabulary, four
 * hundred pixels away. One taxonomy expressed twice is the most reliable way to
 * make a simple choice feel like a complicated one.
 *
 * As a switch on the heading it is the same setting made spatial: the section
 * you can see is the section that is in play, and turning it off is the same
 * gesture as turning off a single position, one level up.
 *
 * The last section standing locks, exactly as the last position standing does —
 * a deck the die cannot deal from is not a state worth being able to reach, and
 * a control that refuses on tap teaches less than one that shows it is spent.
 */
function SectionHead({
  label,
  count,
  on,
  locked,
  onToggle,
  showSwitch,
  open,
  onOpen,
}: {
  label: string;
  count: number;
  on: boolean;
  locked: boolean;
  onToggle: () => void;
  showSwitch: boolean;
  /** Undefined for a section that is always open. */
  open?: boolean;
  onOpen?: () => void;
}) {
  const heading = (
    <>
      <span className="text-[0.7rem] font-medium uppercase tracking-wide">
        {label}
      </span>
      {count > 0 && <span className="tabular text-xs opacity-70">{count}</span>}
    </>
  );

  return (
    <div className="mb-2 flex items-center gap-2">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={open}
          className="press flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          {heading}
          <ChevronRight
            className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <p className="flex min-w-0 flex-1 items-center gap-2 px-1 text-muted-foreground">
          {heading}
        </p>
      )}

      {showSwitch && (
        <button
          type="button"
          onClick={onToggle}
          disabled={locked}
          aria-pressed={on}
          aria-label={`${label} — ${on ? "in play" : "sitting out"}`}
          title={
            locked
              ? "The only half still in play"
              : on
                ? "Sit this half out"
                : "Bring this half back"
          }
          className={`grid size-11 shrink-0 place-items-center rounded-lg transition-colors ${
            locked ? "cursor-default" : "active:bg-surface-raised/70"
          }`}
        >
          {/* The same switch the rows wear, one level up — the gesture is the
              same gesture, so it should not look like a different one. */}
          <span
            aria-hidden="true"
            className={`relative h-6 w-10 rounded-full transition-colors ${
              on ? "bg-brand" : "bg-surface-raised"
            } ${locked ? "opacity-60" : ""}`}
          >
            <span
              className={`absolute top-1 size-4 rounded-full bg-background transition-transform ${
                on ? "left-1 translate-x-4" : "left-1"
              }`}
            />
          </span>
        </button>
      )}
    </div>
  );
}

function PositionList() {
  const entries = useDiceStore((s) => s.deck);
  const disabled = useDiceStore((s) => s.disabled);
  const togglePosition = useDiceStore((s) => s.togglePosition);
  const favourites = useDiceStore((s) => s.favourites);
  const toggleFavourite = useDiceStore((s) => s.toggleFavourite);
  const cards = useDiceStore((s) => s.mode) === "cards";
  const pool = useDiceStore((s) => s.pool);
  const setEditing = useDiceStore((s) => s.setEditing);
  const reorderOwn = useDiceStore((s) => s.reorderOwn);
  const setPool = useDiceStore((s) => s.setPool);

  // The pool, read as two switches. Both halves in play is "all"; either one
  // switched off is the filter that used to be three buttons of its own.
  const { yours: yoursOn, stock: stockOn } = poolSections(pool);

  const [openStock, setOpenStock] = useState(false);

  // Counted through the same filter fitDie uses, so the row that refuses to
  // switch off and the die that refuses to grow agree about why.
  const atMinimum =
    inPlayOf(
      entries.filter((entry) => !disabled.includes(entry.id)),
      pool,
    ).length <= 1;

  // Split rather than sorted. Yours are the ones you came here to reach — to
  // fix a line, or to write another — and a list that buries them under
  // thirteen drawings makes the whole feature look like it is not there.
  const mine = entries.filter((entry) => isOwn(entry.id));
  const stock = entries.filter((entry) => !isOwn(entry.id));

  // Only ours are draggable, and only once there are two. The built-in half is
  // ordered by its filenames, which is a fact about the folder rather than a
  // preference — there would be nowhere to save a different answer.
  const { gripProps, rowProps, dragging, listRef } = useReorder(
    mine.map((entry) => entry.id),
    reorderOwn,
  );
  const draggable = mine.length > 1;

  const row = (entry: DeckEntry, sortable = false) => {
    const off = disabled.includes(entry.id);
          // The last one standing can't be switched off, so it shouldn't look
          // like it can be.
          const locked = !off && atMinimum;
          const favoured = favourites.includes(entry.id);

          return (
            // A row of two controls rather than one: in-play and favourited are
            // independent opinions about the same entry, and nesting a button
            // inside a button is not valid anyway. gap-2, not gap-1: these are
            // two adjacent tap targets that do different things, and 4px between
            // them is inside the margin of error of a thumb.
            <li
              key={entry.id}
              className="flex items-center gap-2"
              {...(sortable ? rowProps(entry.id) : {})}
            >
              {sortable && draggable && (
                <button
                  type="button"
                  aria-label={`Reorder ${entry.name ?? entry.id}. Use the arrow keys, or drag`}
                  title="Drag to reorder"
                  className={`press grid size-11 shrink-0 cursor-grab place-items-center rounded-lg transition-colors ${
                    dragging === entry.id
                      ? "text-foreground"
                      : "text-muted-foreground/40 hover:text-foreground"
                  }`}
                  {...gripProps(entry.id)}
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => togglePosition(entry.id)}
                disabled={locked}
                aria-pressed={!off}
                // The press state is a background rather than the shared
                // `.press`: an out-of-play row is already dimmed to 40%, and a
                // treatment that raises opacity would make pressing it look like
                // switching it back on.
                className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors active:bg-surface-raised/70 ${
                  off
                    ? "opacity-40 hover:opacity-70"
                    : "hover:bg-surface-raised"
                } ${locked ? "cursor-default" : ""}`}
              >
                <Thumb entry={entry} className="size-12" />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {entry.name ?? entry.id}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {entry.intensity && <Intensity level={entry.intensity} />}
                    {off ? "Not in play" : locked ? "Last one" : "In play"}
                  </span>
                </span>

                {/* A switch rather than a checkbox: this is a setting that takes
                    effect immediately, not part of a form. */}
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                    off ? "bg-surface-raised" : "bg-brand"
                  }`}
                >
                  <span
                    className={`absolute top-1 size-4 rounded-full bg-background transition-transform ${
                      off ? "left-1" : "left-1 translate-x-4"
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={() => toggleFavourite(entry.id)}
                aria-pressed={favoured}
                aria-label={`${favoured ? "Remove" : "Add"} ${entry.name ?? entry.id} ${favoured ? "from" : "to"} favourites`}
                // The die is genuinely weighted toward a favourite; a pile is
                // drawn through in full regardless, so there it is a note rather
                // than a thumb on the scales. Saying otherwise in card mode would
                // be a claim you could disprove by counting.
                title={
                  cards
                    ? "Favourite"
                    : "Favourite — the die is weighted toward these"
                }
                className={`press grid size-11 shrink-0 place-items-center rounded-lg transition-colors ${
                  favoured
                    ? "text-brand"
                    : "text-muted-foreground/50 hover:text-foreground"
                }`}
              >
                <Heart
                  className="size-4"
                  fill={favoured ? "currentColor" : "none"}
                  aria-hidden="true"
                />
              </button>

              {/* Only on the ones somebody wrote. A built-in's words live in a
                  file and cannot be edited from here, so offering it would be a
                  control that does nothing. */}
              {isOwn(entry.id) && (
                <button
                  type="button"
                  onClick={() => setEditing(entry.id)}
                  aria-label={`Edit ${entry.name ?? entry.id}`}
                  title="Edit"
                  className="press grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          );
  };

  return (
    <>
      <section aria-label="Yours">
        <SectionHead
          label="Yours"
          count={mine.length}
          on={yoursOn}
          locked={yoursOn && !stockOn}
          onToggle={() => setPool(yoursOn ? poolWithoutHalf("yours") : "all")}
          // Nothing to sit out until something has been written.
          showSwitch={mine.length > 0}
        />

        {mine.length > 0 && (
          <div className={yoursOn ? "" : "opacity-40"}>
            <ul ref={listRef} className="mb-2 flex flex-col gap-2">
              {mine.map((entry) => row(entry, true))}
            </ul>
            {draggable && (
              <p className="mb-2 px-1 text-xs leading-relaxed text-muted-foreground">
                Drag to reorder. It changes how this list reads, not what comes
                up — every throw is dealt fresh.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setEditing("new")}
          className="press mb-5 flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          {mine.length === 0 ? "Write one of your own" : "Write another"}
        </button>
      </section>

      <section aria-label="Built-in">
        <SectionHead
          label="Built-in"
          count={stock.length}
          on={stockOn}
          locked={stockOn && !yoursOn}
          onToggle={() => setPool(stockOn ? poolWithoutHalf("stock") : "all")}
          showSwitch={mine.length > 0}
          // Shut by default. Thirteen rows are most of this panel's height and
          // almost none of its use: the one you never want gets switched off
          // once, and the one you do not want *tonight* has its own tap on the
          // table. Opening the panel should not mean scrolling past them.
          open={openStock}
          onOpen={() => setOpenStock((was) => !was)}
        />

        {openStock ? (
          <ul className={`flex flex-col gap-2 ${stockOn ? "" : "opacity-40"}`}>
            {stock.map((entry) => row(entry))}
          </ul>
        ) : (
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            {stockOn
              ? `${stock.length - stock.filter((entry) => disabled.includes(entry.id)).length} of ${stock.length} in play.`
              : "Sitting out tonight."}
          </p>
        )}
      </section>
    </>
  );
}

/**
 * Which position the fix lands on.
 *
 * Only ever rendered once the title has been tapped five times, and only in this
 * panel — see the note on the run. It chooses *what* the fix is and nothing else:
 * putting it in and taking it out are two other gestures on two other controls
 * entirely (ModeSwitch and the speaker in DiceApp), which is why picking
 * something here does not have to be undone here.
 *
 * Compact rows with a small thumbnail rather than the full switch-and-heart rows
 * below. This is a list you read once and tap a few times; the position list
 * underneath is the one you actually work in, and it should stay the heavier of
 * the two.
 *
 * More than one can be picked, and that is the difference between two tricks
 * rather than a convenience. One picked is a decision made in advance and
 * dressed up as a throw. Several picked is a real throw over a shortlist — the
 * die is still deciding, it has just been handed a smaller argument. The second
 * is the one worth having, and the one a single-select list could not express.
 */
function FixedList() {
  const deck = useDiceStore((s) => s.deck);
  const disabled = useDiceStore((s) => s.disabled);
  const rigChoice = useDiceStore((s) => s.rigChoice);
  const rigOn = useDiceStore((s) => s.rigOn);
  const pool = useDiceStore((s) => s.pool);
  const toggleRigChoice = useDiceStore((s) => s.toggleRigChoice);
  const clearRigChoice = useDiceStore((s) => s.clearRigChoice);

  // Only what is in play, through the same filter the deal uses. Fixing the die
  // to something it is not allowed to deal is a fix that silently never happens.
  const eligible = inPlayOf(
    deck.filter((entry) => !disabled.includes(entry.id)),
    pool,
  );

  const picked = rigOn ? rigChoice.length : 0;

  /*
   * What the fix is going to do, said in one line.
   *
   * Worth the row, because one picked and three picked are different tricks and
   * the list alone does not distinguish them — three highlighted rows look like
   * a setting that has been left in a mess rather than a deliberate shortlist.
   * It is also the only place the randomness is admitted to: with several
   * picked, which one arrives is still a throw, and somebody about to hand the
   * phone over should know that before they do.
   */
  const caption =
    picked === 0
      ? "Nothing fixed — the throw is honest."
      : picked === 1
        ? "Every throw lands on this one."
        : `Every throw lands on one of these ${picked}, drawn fresh each time.`;

  return (
    <div className="mb-4 rounded-2xl bg-surface-raised/50 p-2">
      <div className="flex items-baseline justify-between gap-2 px-2 pb-1 pt-1">
        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          Fixed
        </p>
        {picked > 0 && (
          <span className="tabular text-[0.7rem] text-brand">{picked}</span>
        )}
      </div>

      {/* Scrolls: sixteen positions would push the rest of the panel off. */}
      <div className="flex max-h-52 flex-col overflow-y-auto overscroll-contain">
        <button
          type="button"
          onClick={clearRigChoice}
          aria-current={!rigOn ? "true" : undefined}
          className={`flex min-h-11 items-center rounded-xl px-2 text-left text-sm transition-colors active:bg-surface-raised ${
            !rigOn ? "text-brand" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Off — play it straight
        </button>
        {eligible.map((entry) => {
          const chosen = rigOn && rigChoice.includes(entry.id);
          return (
            // aria-pressed rather than aria-current: these are independent
            // toggles now, and "current" claims exactly one of them is the
            // answer — which was true when this was a list of one.
            <button
              key={entry.id}
              type="button"
              onClick={() => toggleRigChoice(entry.id)}
              aria-pressed={chosen}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-left text-sm transition-colors active:bg-surface-raised ${
                chosen
                  ? "text-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Thumb entry={entry} className="size-8 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {entry.name ?? entry.id}
              </span>
              <Check
                className={`size-4 shrink-0 transition-opacity ${
                  chosen ? "opacity-100" : "opacity-0"
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      <p className="px-2 pb-1 pt-1.5 text-xs leading-relaxed text-muted-foreground">
        {caption}
      </p>
    </div>
  );
}

/**
 * Chooses which positions are in play.
 *
 * The deck holds more than the die can show, so this is where you say what is
 * eligible to be dealt. Ruling something out matters more here than in most
 * apps: a die that keeps landing on something you would rather skip stops being
 * used at all.
 *
 * It is also where the app is put away. The discreet toggle sits beside the
 * title, and switching it on empties everything below — see the note there.
 */
export function DeckPanel() {
  const [open, setOpen] = useState(false);
  const disabled = useDiceStore((s) => s.disabled);

  /*
   * And it is where the fix is chosen, behind five quick taps on the title.
   *
   * The title is the right target because it is the one thing in this panel that
   * is not a control — tapping it cannot do anything else, so a run on it needs
   * nothing worked around and breaks nothing when it is abandoned. It is also
   * simply big, and this is a phone app: five taps on a 2xl heading is easier
   * than one press held on a chip, which is what this replaced.
   *
   * `select-none` is not cosmetic. Five rapid taps on text is how you select a
   * word on every platform there is, and a highlighted "Positions" with an iOS
   * callout over it is both ugly and a tell.
   */
  const [found, setFound] = useState(false);
  const { tap, reset } = useTapRun(5, () => setFound(true));

  /*
   * Closing puts the list away for good, not just out of sight.
   *
   * It used to survive for the session, which meant every later trip to this
   * panel — to actually switch a position off, in front of somebody — came with
   * the fix attached to it. The way back in is five taps, and five taps are
   * cheap; a secret that stays on screen after it has been used is not being
   * kept.
   */
  const onOpenChange = (next: boolean) => {
    if (!next) {
      setFound(false);
      reset();
      // A half-written position goes with the panel. Coming back to a form you
      // had walked away from is the app assuming you meant to finish it.
      setEditing(null);
      setTab("deck");
    }
    setOpen(next);
  };

  const mode = useDiceStore((s) => s.mode);
  const cards = mode === "cards";
  const [tab, setTab] = useState("deck");
  const editing = useDiceStore((s) => s.editing);
  const setEditing = useDiceStore((s) => s.setEditing);
  const discreet = useDiceStore((s) => s.discreet);
  const toggleDiscreet = useDiceStore((s) => s.toggleDiscreet);
  const dieType = useDiceStore((s) => s.dieType);
  const faces = DIE_SIDES[dieType];
  const entries = useDiceStore((s) => s.deck);
  const pool = useDiceStore((s) => s.pool);
  // What the die actually deals from, so the count in the chip, the summary
  // sentence and the row of thumbs all describe the same deck.
  const inPlay = inPlayOf(
    entries.filter((entry) => !disabled.includes(entry.id)),
    pool,
  );
  const active = inPlay.length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/*
        The count goes while discreet, and so does the label that explains it.
        "Positions: 13 in play" is the sentence a screen reader reads out of the
        chip, and it is the single most explicit string in the chrome — leaving it
        on a disguised app would mean the disguise held for everyone but the
        person using a screen reader.
      */}
      <Dialog.Trigger
        aria-label={
          discreet
            ? "Dice settings"
            : `Positions: ${active} in play. Choose which`
        }
        className="glass press flex h-11 items-center gap-2 rounded-full px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Layers className="size-4" aria-hidden="true" />
        {!discreet && <span className="tabular">{active}</span>}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0d0509]/75 backdrop-blur-sm" />
        {/*
          Two shapes, one sheet.

          The deck sits at the bottom of the screen because it is a list you
          reach into and let go of. The editor takes the whole height instead,
          and that is about the keyboard rather than about importance: a
          `bottom: 0` element does not move when the software keyboard opens —
          the visual viewport shrinks underneath it — so a bottom sheet with a
          text field in it gets covered by the thing typing into it. A
          full-height sheet just has less room to scroll, and scrollIntoView
          works. Setting `interactiveWidget` globally would fix it too, and would
          resize the WebGL canvas every time a keyboard opened anywhere.
        */}
        <Dialog.Content
          className={`glass fixed z-50 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-1/2 sm:bottom-auto sm:top-1/2 sm:h-auto sm:max-h-[80dvh] sm:w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl ${
            editing
              ? "inset-0 rounded-none"
              : "inset-x-0 bottom-0 max-h-[80dvh] rounded-t-3xl"
          }`}
        >
          {editing ? (
            <PositionEditor />
          ) : (
            <>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {/* Still a heading, not a button: no cursor, no focus ring, no
                  hover, nothing in the accessibility tree to say it is tappable.
                  The cost is that the run is touch- and mouse-only, which is the
                  right trade for a thing that is meant to be unfindable. */}
              <Dialog.Title
                onClick={() => tap()}
                className="select-none font-[family-name:var(--font-display)] text-2xl italic text-foreground"
              >
                {discreet ? "Dice" : "Positions"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {discreet
                  ? `A plain ${dieType}. Nothing is named or pictured until you turn this off — the deck is untouched and waiting.`
                  : cards
                    ? `${active} in play, shuffled into a pile and drawn one at a time.`
                    : active > faces
                      ? `${active} in play. Each throw deals a fresh ${faces} onto the ${dieType}, never repeating what you just landed on.`
                      : `${active} in play, dealt onto the ${dieType} each throw.`}
              </Dialog.Description>
            </div>

            {/*
              Beside the title rather than down with the list, because it is not
              an opinion about a position — it is an opinion about the whole
              screen, and it has to be findable in a hurry. It is also the only
              control that stays when the disguise is on, so it cannot live
              inside anything the disguise hides.
            */}
            <button
              type="button"
              onClick={toggleDiscreet}
              aria-pressed={discreet}
              aria-label={
                discreet
                  ? "Discreet mode is on. Show the positions again"
                  : "Discreet mode — plain dice, nothing named"
              }
              title={
                discreet
                  ? "Discreet — tap to bring the positions back"
                  : "Discreet — plain dice, nothing named"
              }
              className={`press grid size-11 shrink-0 place-items-center rounded-full transition-colors ${
                discreet
                  ? "bg-surface-raised text-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {discreet ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>

            <Dialog.Close
              aria-label="Close"
              className="press grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>

          {/*
            Everything below is a grid of the artwork with the names written under
            it, which is the one thing this panel is for and the one thing that
            cannot be shown while disguised. So the panel becomes its own toggle
            and nothing else — no summary, no list, no developer hint. Rendering a
            stripped-down version of the list instead was the obvious alternative
            and is worse: thirteen rows reading "Face 4" is not a dice simulator's
            settings screen, it is an app visibly with its hands over its eyes.
          */}
          {discreet ? null : (
            <>
              {/*
                Two tabs, because the room was never a position setting.

                It is scenography — how the scene looks — and it had been
                sitting between the deck's controls and the deck itself, so
                every trip to the list scrolled past a row of colour swatches
                that had nothing to do with what was being looked for. A tab is
                cheaper than a second sheet and keeps it one tap away.
              */}
              <Tabs.Root
                value={tab}
                onValueChange={setTab}
                // Reset on close rather than remembered: the panel is opened to
                // do something with the deck almost every time, and coming back
                // to the room swatches because that is where it was left last
                // week is the app second-guessing that.
              >
                <Tabs.List className="mb-4 flex gap-1 rounded-xl bg-surface-raised/60 p-1">
                  {[
                    { value: "deck", label: "Deck" },
                    { value: "room", label: "Room" },
                  ].map((one) => (
                    <Tabs.Trigger
                      key={one.value}
                      value={one.value}
                      className={`press min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors ${
                        tab === one.value
                          ? "bg-surface-raised text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {one.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>

                <Tabs.Content value="deck">
                  {/*
                    Above the list so that the five taps have something to show
                    for themselves without a scroll. A secret that appears below
                    the fold looks like a gesture that did not work.

                    Never while disguised — this is position names, which is the
                    one thing the disguise exists to keep off the screen. It sits
                    inside this branch for exactly that reason.
                  */}
                  {found && <FixedList />}

                  <PositionList />

                  {/*
                    Underneath, because it is a readout and not a control. It
                    used to sit above the list, which put the one thing on this
                    screen you cannot act on directly in the path of the things
                    you can.
                  */}
                  <div className="mt-5">
                    {cards ? (
                      <InThePile inPlay={inPlay} />
                    ) : (
                      <OnTheDie inPlay={inPlay} />
                    )}
                  </div>
                </Tabs.Content>

                <Tabs.Content value="room">
                  <RoomPicker />
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
