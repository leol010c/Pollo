"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Volume2, VolumeX } from "lucide-react";
import { ResultAnnouncer } from "@/components/ui/ResultAnnouncer";
import { FullPicture } from "@/components/ui/FullPicture";
import { ForfeitNotice } from "@/components/ui/ForfeitNotice";
import { WinNotice } from "@/components/ui/WinNotice";
import { CardTable } from "@/components/ui/CardTable";
import { HighLowTable } from "@/components/ui/HighLowTable";
import { RollHistory } from "@/components/ui/RollHistory";
import { StatsReadout } from "@/components/ui/Stats";
import { DieTypePicker } from "@/components/ui/DieTypePicker";
import { ModeSwitch } from "@/components/ui/ModeSwitch";
import { DeckPanel } from "@/components/ui/DeckPanel";
import { asPool, useDiceStore } from "@/lib/store";
import { useTapRun } from "@/lib/useTapRun";
import { hapticThrow } from "@/lib/haptics";
import { MODE_FADE_MS } from "@/lib/modeSwitch";
import { whenDeckReady } from "@/lib/dice/deck";
import { installAudioUnlock } from "@/lib/audio";
import {
  readDiscreet,
  readDieType,
  readHidden,
  readLoved,
  readOwn,
  readPool,
  readTheme,
} from "@/lib/prefs";
import { parseOwn } from "@/lib/dice/own";
import { plain, themeById } from "@/lib/scene/backdrops";
import {
  requestShakePermission,
  useCanShake,
  useShakeToRoll,
} from "@/lib/shake";

/**
 * Three.js and Rapier's WASM cannot run on the server, and keeping them out of
 * the initial bundle is worth a dynamic import.
 *
 * `loading` renders in the canvas's place rather than the canvas being mounted
 * behind a condition. That distinction matters: every remount of a <Canvas>
 * allocates a new WebGL context, browsers cap how many can exist at once, and
 * hot reloads during development burn through that budget fast. This component
 * mounts the scene exactly once.
 */
const DiceScene = dynamic(() => import("@/components/scene/DiceScene"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-background">
      <div className="size-10 animate-pulse rounded-lg bg-surface-raised" />
    </div>
  ),
});

/** Automatic recovery is attempted before the user is ever told anything. */
const MAX_AUTO_RECOVERIES = 2;

export function DiceApp() {
  const muted = useDiceStore((s) => s.muted);
  const toggleMuted = useDiceStore((s) => s.toggleMuted);
  const phase = useDiceStore((s) => s.phase);
  const mode = useDiceStore((s) => s.mode);
  const discreet = useDiceStore((s) => s.discreet);
  const setDiscreet = useDiceStore((s) => s.setDiscreet);
  const theme = useDiceStore((s) => s.theme);
  const setTheme = useDiceStore((s) => s.setTheme);
  const restoreDieType = useDiceStore((s) => s.restoreDieType);
  const coin = useDiceStore((s) => s.coin);
  const bet = useDiceStore((s) => s.bet);

  /*
   * The disguise, put back on before anything is drawn.
   *
   * In an effect rather than in the store's initial state, because this runs on
   * the server too and there is no localStorage there — reading one during
   * render means the markup the server sent and the markup the client builds
   * disagree, which React resolves by throwing the client's away.
   *
   * There is no flash to design around either way: the scene is a `ssr:false`
   * dynamic import, so the canvas mounts after hydration, and the chrome that
   * paints before it is a chip and a mute button.
   */
  useEffect(() => {
    if (readDiscreet()) setDiscreet(true);
  }, [setDiscreet]);

  /*
   * And the room they chose, restored the same way and for the same reason.
   *
   * Separate from the disguise above rather than folded into it, because the two
   * are independent: someone can leave the app disguised *and* in `midnight`, and
   * turning discreet off has to give the second one back. The store keeps both,
   * and `DiceScene` decides which is showing.
   */
  useEffect(() => {
    const saved = readTheme();
    if (saved) setTheme(saved);
  }, [setTheme]);

  /*
   * And the solid, restored here rather than when the deck arrives.
   *
   * It has to be in before the scene's chunk resolves. The die is mounted as
   * `<Die key={dieType}>`, so a type that changes after the canvas is up does
   * not adjust the die — it builds a new one and drops it. Restoring late meant
   * a saved d12 fell as a d6 first and then again as a d12.
   *
   * Nothing is validated against the deck here, because there is no deck yet.
   * `fitDie` does that when it lands. See `restoreDieType`.
   */
  useEffect(() => {
    const saved = readDieType();
    if (saved) restoreDieType(saved);
  }, [restoreDieType]);

  /*
   * The two strips of browser chrome, kept in step with the room.
   *
   * `themeColor` in layout.tsx is a static value and it is the right one for the
   * room the app is usually in. It is also the loudest thing left when the app is
   * pretending not to be itself: on a phone Safari paints the notch strip and the
   * address bar in it, and a plum bar above a green baize table is a loose thread
   * on an otherwise plain screen. So the tag is rewritten to match whichever
   * backdrop is out. See the note on `plain.background`.
   *
   * This is also the whole of what "the room changed" means outside the canvas.
   * The interface keeps its own colours — `--bg`, `--brand` and the surface
   * tokens in globals.css stay pinned to `bedside`, which is still the room the
   * app opens in and the one its chrome was designed against. Only the two
   * strips that have to *meet* the picture follow it.
   *
   * The selection is duplicated from DiceScene rather than shared, and that is a
   * seam worth watching: if the ordering there ever changes, this has to change
   * with it or the browser bar advertises a room that is not on screen.
   */
  useEffect(() => {
    const background = (discreet ? plain : themeById(theme)).background;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta instanceof HTMLMetaElement) meta.content = background;

    /*
     * And the two strips the app paints to *meet* that chrome.
     *
     * The seams below fade to this colour so the join between the browser's bars
     * and the lit room is a transition rather than a line — the whole point of
     * them. They were written against `--bg`, which is the plum the ordinary room
     * clears to, and a plum band across the top of a green baize table is the
     * hard line they exist to remove, drawn twice as brightly.
     *
     * Its own custom property rather than rewriting `--bg`, which also feeds the
     * panel and surface colours: the chrome should follow the room, the interface
     * should not.
     */
    document.documentElement.style.setProperty("--seam", background);
  }, [discreet, theme]);

  // Bumping this key remounts the canvas with a fresh context.
  const [sceneKey, setSceneKey] = useState(0);
  const [unrecoverable, setUnrecoverable] = useState(false);
  const recoveries = useRef(0);

  const handleContextLost = useCallback(() => {
    if (recoveries.current >= MAX_AUTO_RECOVERIES) {
      setUnrecoverable(true);
      return;
    }
    recoveries.current += 1;
    // A frame's delay lets the browser finish tearing the old context down
    // before a new one is requested.
    setTimeout(() => setSceneKey((k) => k + 1), 150);
  }, []);

  const handleContextRestored = useCallback(() => {
    setUnrecoverable(false);
  }, []);

  // Any gesture anywhere unlocks audio, not just one that lands on the canvas,
  // and coming back from a locked phone re-resumes it.
  useEffect(() => installAudioUnlock(), []);

  /*
   * And it comes out here, on the speaker: four quick taps, which is muting and
   * unmuting the room twice over.
   *
   * Deliberately not the same control it went in on. Putting both directions on
   * one button would make it a toggle, and a toggle is a thing you can find by
   * fiddling with something twice; two controls that each do one direction are
   * two accidents away from being discovered rather than one. The speaker also
   * has nothing whatever to do with the deck or the die, which is the point.
   *
   * Every tap really does mute or unmute — the run is not intercepted, it is
   * counted alongside the ordinary job. Four of them is an even number, so the
   * room ends up exactly as loud as it started and the gesture leaves no trace.
   * See useTapRun.
   */
  const setRigOn = useDiceStore((s) => s.setRigOn);
  const disarm = useTapRun(4, () => {
    setRigOn(false);
    hapticThrow();
  });

  // Read through a store rather than called during render: the server has no
  // matchMedia, and branching on it directly is a hydration mismatch.
  const shakeable = useCanShake();

  // The mode-aware entry point, so a shake throws the die or turns a card
  // depending on which is out — the gesture means "give me a result" either way.
  const play = useDiceStore((s) => s.play);

  // Idle only: a shake mid-tumble would restart a roll already in progress —
  // and a shake mid-flip would be asking for a result that has already been
  // decided. play() refuses in both cases anyway; this stops the gesture being
  // read as one at all.
  useShakeToRoll(play, phase !== "rolling" && !coin && !bet);

  // In dice mode the reveal covers the bottom bar and there is nothing to do.
  // In card mode nothing covers it, so it has to stand down on its own — and
  // the higher-or-lower bet is the other thing that owns the whole screen
  // there, with a bottom row of its own for the two calls.
  const chromeHidden = mode === "cards" && (phase !== "idle" || bet !== null);

  // The deck is discovered inside the scene; this is what carries it back out
  // into state so the panel can render it.
  const setDeck = useDiceStore((s) => s.setDeck);
  useEffect(() => {
    let live = true;
    whenDeckReady().then((entries) => {
      if (live) setDeck(entries);
    });
    return () => {
      live = false;
    };
  }, [setDeck]);

  /*
   * And the positions they wrote themselves.
   *
   * Restored in an effect for the same reason as the three above — there is no
   * localStorage on the server and reading one during render would make the
   * two markups disagree.
   *
   * Deliberately *not* sequenced against the deck arriving. The artwork probe
   * and this read finish in whichever order they finish, and the deck is
   * composed from both halves either way: whichever lands second rebuilds over
   * the first. That is the whole reason setOwnEntries exists rather than a
   * second promise to wait on. See lib/dice/deck.ts.
   *
   * Exclusions and favourites come back here too. They used to be the examples
   * of what is deliberately forgotten on reload, and that was right for a night
   * that ends; it is wrong for "we never want that one", which is a standing
   * opinion the app was making people restate every time.
   */
  const restoreOwn = useDiceStore((s) => s.restoreOwn);
  const restoreCuration = useDiceStore((s) => s.restoreCuration);
  useEffect(() => {
    restoreCuration(readHidden(), readLoved());
    restoreOwn(parseOwn(readOwn()), asPool(readPool()));
  }, [restoreCuration, restoreOwn]);

  return (
    <main
      className="relative h-dvh w-full overflow-hidden bg-background"
      // iOS only grants motion access from inside a gesture, so the first
      // touch anywhere is used to ask. Declining simply leaves shake off.
      onPointerDown={() => void requestShakePermission()}
    >
      {/*
        Full-bleed. The board is the screen, and the controls rest on it — an
        inset frame made the app look like a window onto the table rather than
        the table itself, and spent edge pixels a phone hasn't got.
      */}
      {/* The screen is a canvas and a few floating chips, so there is nothing
          on it a heading could reasonably be attached to — but a document with
          no h1 gives a screen reader nowhere to start. */}
      <h1 className="sr-only">Dice Throw</h1>

      <div className="relative h-full overflow-hidden">
        {/*
          The room, thrown out of focus while cards are out.

          Only the scene is inside this wrapper. RollHistory and the bottom bar
          are siblings and stay sharp — they are interface, and blurred
          interface is just broken interface.

          It has to be here rather than anywhere nearer the card, and that is
          not a stylistic preference. `filter` is one of the grouping properties
          that force `transform-style` to compute to `flat`, so a blur on any
          ancestor of the card would silently kill the flip — the same trap
          shadeFor() in CardTable.tsx exists to avoid. CardTable is a sibling of
          this div, so nothing about it is touched.

          `none`, not `blur(0px)`, in dice mode: an identity filter still routes
          the canvas through a filter pass every frame, and dice mode is the
          half of this app that was already right. CSS interpolates `none` as
          the identity filter list, so the transition still runs both ways.

          The scale is overscan. Blur samples transparency from outside the
          element's box and fades its edges; 6% pushes that fade off-screen,
          where the parent's overflow-hidden clips it.
        */}
        <div
          className="absolute inset-0 ease-out"
          style={{
            filter: mode === "cards" ? "blur(14px)" : "none",
            transform: mode === "cards" ? "scale(1.06)" : "none",
            // The one number the deck and the die are also timed to, so the
            // room softening, the cards arriving and the die leaving are one
            // gesture rather than three. See lib/modeSwitch.ts.
            transitionProperty: "filter, transform",
            transitionDuration: `${MODE_FADE_MS}ms`,
          }}
        >
          <DiceScene
            key={sceneKey}
            onContextLost={handleContextLost}
            onContextRestored={handleContextRestored}
          />
        </div>

        {/*
          There is no vignette here any more, and its removal is the point.

          A CSS radial-gradient used to sit over the canvas darkening the
          corners. It looked reasonable and it was quietly corrosive: fixed to
          the viewport, indifferent to where the die was, and — because it was
          composited *after* everything the renderer did — sitting on top of
          every change ever made to the lighting. Successive attempts to fix how
          this scene was lit kept producing no visible difference, and this is a
          large part of the mechanical reason why.

          The frame still falls off at the edges. It falls off because the spot
          is a real cone whose falloff is computed per pixel and whose angle is
          solved from the play area, so it moves when the framing moves, and
          because the flames have `decay: 2` and reach nothing far from them.
          Both of those are things a lighting change can actually change.
        */}

        {/*
          The seam where the browser's chrome meets the app.

          On a phone, Safari paints the strip behind the Dynamic Island and the
          strip behind the address bar in the page's `theme-color` — a flat
          #150610. The room between them is lit velvet. Two flat bars of a
          different colour with a hard line against a lit surface is what reads
          as "black edges at the top and bottom": the problem is not the colour,
          it is that the join is a line rather than a transition.

          So the app fades to exactly that colour at both edges, over the safe
          area and a little beyond. The chrome and the scene meet at the same
          value and there is no line left to see.

          This is a vignette, and the note above says a vignette was removed
          from this exact spot — worth being clear about why this one is not
          that one. That was a radial gradient over the whole canvas, fixed to
          the viewport, sitting on top of every lighting change ever made and
          silently undoing them. This touches only the two strips the browser
          already owns, leaves the entire lit centre alone, and exists to hide a
          seam rather than to shape the light. If it ever starts being tuned for
          how the room looks, it has turned into the thing that was deleted.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-[5]"
          style={{
            // Solid for exactly the depth the browser has taken, then gone
            // within a couple of rem. Anchoring the stops to the inset rather
            // than to a flat height is what keeps this off the lit middle of
            // the table — the part of the room Leo has repeatedly asked to be
            // brighter, not darker.
            height: "calc(env(safe-area-inset-top) + 3.5rem)",
            background:
              "linear-gradient(to bottom," +
              " var(--seam, var(--bg)) 0," +
              " var(--seam, var(--bg)) env(safe-area-inset-top)," +
              " color-mix(in srgb, var(--seam, var(--bg)) 45%, transparent)" +
              " calc(env(safe-area-inset-top) + 1.25rem)," +
              " transparent 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
          style={{
            height: "calc(env(safe-area-inset-bottom) + 4rem)",
            background:
              "linear-gradient(to top," +
              " var(--seam, var(--bg)) 0," +
              " var(--seam, var(--bg)) env(safe-area-inset-bottom)," +
              " color-mix(in srgb, var(--seam, var(--bg)) 45%, transparent)" +
              " calc(env(safe-area-inset-bottom) + 1.5rem)," +
              " transparent 100%)",
          }}
        />

        <RollHistory />

        {/* Fades out once the user has rolled — the hint has done its job.
            Card mode carries its own prompt directly under the stack, where the
            count already is, so this would be a second instruction for the same
            gesture. */}
        {/* Stays up between rolls while disguised. The reveal is what normally
            replaces this — it arrives with a "Roll again" button on it — and
            discreet mode has no reveal, so without this there would be nothing on
            screen saying how to throw the die a second time. */}
        {/* It has this band to itself again. A chip used to sit here claiming a
            joker somebody held, and the hint had to stand down for it; a lost
            bet is paid where it is lost now, so there is nothing left to
            share with. */}
        <p
          className="pointer-events-none absolute inset-x-0 bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.25rem))] z-10 text-center text-xs text-muted-foreground transition-opacity duration-500"
          style={{
            opacity:
              mode === "dice" &&
              (phase === "idle" || (discreet && phase === "settled"))
                ? 1
                : 0,
          }}
        >
          {shakeable ? "Tap or shake to roll" : "Click to roll"}
        </p>

        {/*
          Resting on the board rather than beneath it.

          z-30, above the card layer at z-20. Card mode is not a modal: the card
          lies on the table and this chrome floats over it the way it floats
          over the felt. At the same z-index it lost to CardTable on DOM order
          alone, and CardTable's scrim is a full-viewport click target — so
          every control down here was silently unclickable in card mode.

          It still gets out of the way of a *result*, though. A card that is
          face-up puts its own actions at the bottom of the screen, and two rows
          of controls in the same place is worse than one that steps aside. The
          die's reveal does the same thing by covering this outright.
        */}
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] transition-opacity duration-300"
          style={{
            opacity: chromeHidden ? 0 : 1,
            pointerEvents: chromeHidden ? "none" : "auto",
          }}
        >
          <DeckPanel />
          <div className="flex items-center gap-2">
            {/* Gone while disguised. A card carries its position's artwork and
                name printed on its face — that is the whole of what a card is
                here — so there is no plain version of one to switch to, and
                setDiscreet forces dice mode for the same reason. A dice
                simulator having only dice is also simply true. */}
            {!discreet && <ModeSwitch />}
            {/* Only when there is a die out. Which solid is in play is a real
                question in dice mode and a meaningless one in cards, and a
                greyed-out chip would be worse than no chip. */}
            {mode === "dice" && <DieTypePicker />}
            <button
              type="button"
              onClick={() => {
                // Counted, not intercepted: the room mutes on every one of
                // these, run or no run.
                disarm.tap();
                toggleMuted();
              }}
              aria-label={muted ? "Unmute dice sounds" : "Mute dice sounds"}
              aria-pressed={muted}
              className="glass press grid size-11 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              {muted ? (
                <VolumeX className="size-4" aria-hidden="true" />
              ) : (
                <Volume2 className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Only surfaced after automatic recovery has genuinely failed. */}
        {unrecoverable && (
          // Above every other layer: if the renderer has genuinely given up,
          // nothing behind this is worth reaching.
          <div className="absolute inset-0 z-50 grid place-items-center bg-background/90 px-6 text-center">
            <div className="max-w-xs">
              <p className="text-sm font-medium">3D rendering stopped</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Your browser repeatedly dropped the graphics context. This
                usually means WebGL is disabled or the GPU is under pressure.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="press mt-4 h-11 rounded-md bg-brand px-4 text-sm font-semibold text-on-brand"
              >
                Reload
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Exactly one of these is ever mounted — each returns null outside its
          own mode — but they are siblings rather than a ternary so that neither
          reaches for state belonging to the other. */}
      <FullPicture />
      <CardTable />
      {/* The card mode's bet, over its deck. A layer of its own rather than a
          branch inside CardTable, which has the position deck to look after and
          two hard-won rules about what may touch a preserve-3d subtree. */}
      <HighLowTable />
      {/* The other two reveals, and never up with either the picture or each
          other: taking the bet puts whatever was on screen back down before the
          coin leaves the ground, and a coin has one face up. */}
      <WinNotice />
      <ForfeitNotice />
      <ResultAnnouncer />
      {/* Over everything, and only ever present with `?stats=1`. */}
      <StatsReadout />
    </main>
  );
}
