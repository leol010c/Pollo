/**
 * The one thing this page remembers.
 *
 * Everything else about a session is deliberately forgotten — the loaded faces
 * in menu.ts most of all, which are held in memory so that closing the page
 * makes the dice honest again. This is the exception: whether the second die is
 * in play at all is a preference rather than a secret, and being asked it again
 * on every reload would be a nuisance.
 *
 * Storage can throw outright — a phone browsing privately, or one told to keep
 * no site data — so every touch of it is guarded and the default stands if it
 * fails.
 */

const KEY = "pollo.where-die";

/**
 * True when the location die is in play.
 *
 * One die is how the page opens on a phone that has never been told otherwise:
 * the position is the question people came for, and the place is the one you go
 * looking for when you want it. The switch under the wordmark adds it, and this
 * is what remembers that you did.
 */
export function loadWhereDie(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function saveWhereDie(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Nothing to do about it, and nothing worth telling anybody.
  }
}
