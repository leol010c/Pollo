"use client";

/**
 * The preferences that outlive a session.
 *
 * Whether the app is muted is still deliberately forgotten on reload. The rest
 * are exceptions for different reasons, and the difference is worth keeping
 * straight because it decides what each one does when storage is unavailable.
 *
 * **Discreet mode** has to persist: a disguise that falls off when the page
 * reloads is not a disguise. If someone else opens the app, or the browser
 * quietly reclaims the tab and restores it, it must come back the way it was
 * left.
 *
 * **The room** persists because it is a taste, and being asked for your taste
 * twice is the app forgetting you. Nothing goes wrong if it is lost, which is
 * why it may fail back to the default while discreet may not fail back to "on".
 *
 * **The die** persists for the same reason, with one wrinkle the other two do
 * not have: it can be *invalid* when it comes back. A d12 needs twelve positions
 * to fill it, and how many there are is decided by files in `public/dice/` that
 * are read after the page loads. So this one is restored later than the others
 * and against a deck, never applied blind — see DiceApp.
 *
 * Wrapped rather than called directly because `localStorage` is not merely
 * missing in some environments — it *throws* on access in Safari's private mode
 * and behind some cookie policies. A preference is not worth an exception, so
 * every path here fails silently back to the safe answer.
 */

const DISCREET_KEY = "dice-throw:discreet";
const THEME_KEY = "dice-throw:theme";
const DIE_KEY = "dice-throw:die";
const OWN_KEY = "dice-throw:own";
const HIDDEN_KEY = "dice-throw:hidden";
const LOVED_KEY = "dice-throw:loved";
const POOL_KEY = "dice-throw:pool";

export function readDiscreet(): boolean {
  try {
    return window.localStorage.getItem(DISCREET_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDiscreet(on: boolean): void {
  try {
    // Removed rather than stored as "0", so the ordinary state leaves no trace
    // in devtools for someone idly looking through storage.
    if (on) window.localStorage.setItem(DISCREET_KEY, "1");
    else window.localStorage.removeItem(DISCREET_KEY);
  } catch {
    // A preference that cannot be saved is still a preference for this session.
  }
}

/**
 * The room the user last chose, or null for "never chose one".
 *
 * Deliberately returns the raw string rather than a `Backdrop`. Storage is a
 * place ids come *from*, and this module has no business knowing which ids are
 * real — `themeById` in backdrops.ts owns that, and owns the fallback for an id
 * that no longer ships.
 */
export function readTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export function writeTheme(id: string | null): void {
  try {
    // The default is stored as absence, the same way "not discreet" is. It keeps
    // the ordinary state out of devtools, and it means a future rename of the
    // default room does not strand everyone who never touched the setting.
    if (id) window.localStorage.setItem(THEME_KEY, id);
    else window.localStorage.removeItem(THEME_KEY);
  } catch {
    // A preference that cannot be saved is still a preference for this session.
  }
}

/**
 * The solid the user last chose, or null.
 *
 * A raw string again, and for a stronger reason than the room: the set of valid
 * die types is decided by the deck, which does not exist yet when this is read.
 * Validating here would mean validating against a deck of nothing.
 */
export function readDieType(): string | null {
  try {
    return window.localStorage.getItem(DIE_KEY);
  } catch {
    return null;
  }
}

export function writeDieType(type: string): void {
  try {
    window.localStorage.setItem(DIE_KEY, type);
  } catch {
    // A preference that cannot be saved is still a preference for this session.
  }
}

/**
 * Positions somebody wrote themselves.
 *
 * The one key here that holds JSON rather than a word, and the one that holds
 * something the app did not come with. It is still parsed nowhere near here:
 * this returns whatever `JSON.parse` made of it and `parseOwn` in
 * lib/dice/own.ts decides which of it is a position, for the same reason
 * `readTheme` hands back an unchecked string and `themeById` rules on it.
 *
 * Worth being plain about what this is: a couple's own writing, in clear text,
 * in a store any script on the origin can read. There is no server to put it
 * behind, and an app that forgot what you wrote would not be worth writing in.
 * The key is named as dully as the others so that it does not announce itself.
 */
export function readOwn(): unknown {
  try {
    const raw = window.localStorage.getItem(OWN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Unavailable storage and malformed JSON land here alike, and the answer to
    // both is the same: this device has no custom positions today.
    return null;
  }
}

export function writeOwn(json: string | null): void {
  try {
    // Null means an empty deck, which is stored as absence — see serialiseOwn.
    if (json) window.localStorage.setItem(OWN_KEY, json);
    else window.localStorage.removeItem(OWN_KEY);
  } catch {}
}

/**
 * Which positions are switched off, and which are favourited.
 *
 * These two used to be the examples of what is deliberately *not* persisted,
 * on the reasoning that a night's curation is a night's. That was wrong in one
 * direction: switching off the six you never want is not a mood, it is a
 * standing opinion, and being made to switch them off again every time is the
 * app arguing with you. A favourite is the same kind of statement.
 *
 * Comma-joined rather than JSON because these are lists of ids and ids contain
 * no commas — every one is either `image-N`, `own-…`, `x-…` or `wild-choice`.
 * Whether an id in here still exists is not checked: a file can be removed
 * between sessions, and an id pointing at nothing simply never matches.
 */
function readIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? raw.split(",").filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    if (ids.length > 0) window.localStorage.setItem(key, ids.join(","));
    else window.localStorage.removeItem(key);
  } catch {}
}

export function readHidden(): string[] {
  return readIds(HIDDEN_KEY);
}

export function writeHidden(ids: string[]): void {
  writeIds(HIDDEN_KEY, ids);
}

export function readLoved(): string[] {
  return readIds(LOVED_KEY);
}

export function writeLoved(ids: string[]): void {
  writeIds(LOVED_KEY, ids);
}

/**
 * Which half of the deck the die draws from, when it is not drawing from all.
 *
 * Absence means everything, which is both the default and the state worth
 * leaving no trace of — the same shape as discreet and the room.
 */
export function readPool(): string | null {
  try {
    return window.localStorage.getItem(POOL_KEY);
  } catch {
    return null;
  }
}

export function writePool(pool: string | null): void {
  try {
    if (pool) window.localStorage.setItem(POOL_KEY, pool);
    else window.localStorage.removeItem(POOL_KEY);
  } catch {}
}
