"use client";

import { useEffect } from "react";

/**
 * The last thing standing when a render throws.
 *
 * Everything on screen below the page is one client tree — the scene, both
 * modes, every notice — so an exception anywhere in it unmounts all of it. What
 * the user gets without this is a white page, on a phone, in a room, with no
 * way back other than knowing to pull down and reload.
 *
 * It is deliberately the twin of the "3D rendering stopped" panel in
 * DiceApp.tsx: same surface, same measurements, same two-sentence shape. Those
 * two are the only failure states the app has, and somebody meeting either of
 * them should not be able to tell they were written at different times.
 *
 * What it does *not* do is say what went wrong. A stack trace is not something
 * this audience can act on, and the disguise is worth keeping even here — an
 * error screen naming a component called CardTable is a sentence about what the
 * app is, on a screen somebody may be handing over.
 */
export default function Error({
  error,
  /*
   * `unstable_retry`, not `reset`.
   *
   * They are different recoveries and this version of Next names both: reset()
   * re-renders the boundary's children from what it already has, while
   * unstable_retry() re-fetches first and then re-renders. The docs in
   * node_modules/next/dist/docs prescribe retry for all but a narrow case, and
   * the underscore is worth tolerating for that — this app has no data to
   * re-fetch, so the two do nearly the same thing here, and the one to be
   * holding when the prefix is dropped is the one the docs point at.
   */
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // The console is the right place for the detail the screen deliberately
  // withholds — it is where somebody debugging would already be looking.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid h-dvh w-full place-items-center bg-background px-6 text-center">
      <div className="max-w-xs">
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          The app hit an error it couldn&apos;t recover from on its own. Trying
          again usually clears it.
        </p>
        {/*
          Recovery before reload, because it is the cheaper of the two: it
          re-renders the tree in place rather than dropping the document. A full
          reload is what the WebGL panel offers instead, and correctly — by the
          time that one is up, the graphics context is the thing that has failed
          and only a new document will get another.
        */}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="press mt-4 h-11 rounded-md bg-brand px-4 text-sm font-semibold text-on-brand"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
