"use client";

import { useEffect, type RefObject } from "react";

/**
 * What `aria-modal="true"` promises, actually delivered.
 *
 * The three notices — the joker, the win, the higher-or-lower pair — all declare
 * themselves modal, and declaring it is the cheap half. The promise is that
 * nothing outside the dialog is reachable while it is up, and a screen reader
 * acts on that promise: it hides the rest of the page from its own navigation.
 * A dialog that says `aria-modal` and leaves focus outside itself has told a
 * blind user the page is gone while standing them in the middle of it.
 *
 * Three things, which is the whole of it:
 *
 *  - focus moves into the dialog when it opens,
 *  - Tab cycles within it rather than escaping behind,
 *  - focus goes back where it came from when it closes.
 *
 * Escape is deliberately *not* here. Each notice already handles it, and what
 * dismissing means differs — the joker notice pays a debt on the way out, the
 * win notice cannot be dismissed at all. Folding that in would make this a hook
 * about the app's rules rather than about focus.
 *
 * Takes the container's ref rather than handing one back, because one of the
 * three already has a ref on that element for its GSAP timeline and two refs
 * cannot be attached to one node. Passing it in keeps all three call sites the
 * same shape instead of making that one an exception.
 *
 * Pass `open` as whatever the component already returns null on, so the markup
 * is guaranteed to exist by the time this runs.
 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  container: RefObject<T | null>,
) {
  useEffect(() => {
    const root = container.current;
    if (!open || !root) return;

    /*
     * Where focus was, so it can be put back.
     *
     * Usually `body` on a phone, where nothing was focused to begin with —
     * restoring that is a no-op, which is the correct outcome rather than a
     * case to special-case away.
     */
    const before = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === root);

    /*
     * The first control, or the dialog itself.
     *
     * The win notice has no controls — it is a result being read out, and it
     * collects itself on a timer — so there is nothing in it to land on. Its
     * container carries tabIndex={-1} for exactly this, which is focusable
     * programmatically without joining the tab order.
     *
     * preventScroll because these are fixed, full-viewport layers: there is
     * nowhere to scroll to, and asking anyway makes some browsers jump the page
     * behind the scrim.
     */
    const first = focusable()[0] ?? root;
    first.focus({ preventScroll: true });

    // Tab, kept inside. Two elements at most in any of these, so the wrap is
    // usually between the same pair — but writing it generally costs nothing
    // and stops it being wrong the first time a notice grows a second button.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        // Nothing to move between; hold focus where it is rather than letting
        // it fall out of the dialog entirely.
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }

      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      // Also fires when focus is on the container itself, which is not in the
      // list — that is the case the `||` catches.
      if (document.activeElement === edge || !root.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus({
          preventScroll: true,
        });
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Only if it is still in the document. A notice that closed because the
      // screen changed underneath it may have taken its opener with it.
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [open, container]);
}
