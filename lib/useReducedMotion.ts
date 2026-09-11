"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot() {
  return matchMedia(QUERY).matches;
}

/** The server can't know the user's preference; motion is added after hydration. */
function getServerSnapshot() {
  return false;
}

/**
 * Tracks prefers-reduced-motion live — users can toggle it mid-session, and a
 * one-shot read at mount would miss that.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
