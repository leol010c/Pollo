"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Shake-to-roll.
 *
 * The one gesture a phone has that a desktop doesn't, and the natural way to
 * throw dice — so it is worth the platform-specific handling below.
 *
 * iOS 13+ gates motion events behind a permission prompt that can only be
 * raised from inside a user gesture, so the request is deliberately separate
 * from the listener: the app asks on the first tap it gets, and the hook simply
 * listens if that succeeded.
 */

type MotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** Desktops report the motion API but never fire it, and a mouse user shaking
 *  their monitor is not a case worth supporting. */
const TOUCH = "(hover: none) and (pointer: coarse)";

/**
 * Whether shaking is available, read directly.
 *
 * Safe from effects and event handlers. **Not** safe to call while rendering:
 * it reaches for `matchMedia`, which the server has no answer for, so a
 * component that branches on it renders one thing on the server and another in
 * the browser. Use `useCanShake` there.
 */
export function canShake(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof DeviceMotionEvent !== "undefined" &&
    matchMedia(TOUCH).matches
  );
}

function subscribe(onChange: () => void) {
  const query = matchMedia(TOUCH);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The server has no pointer to describe, so it assumes the plainer of the two
 *  and the answer arrives on hydration. */
function getServerSnapshot() {
  return false;
}

/**
 * The same answer, safe to render with.
 *
 * Rendering `canShake()` directly is what made the roll hint a hydration
 * mismatch: the server has no `matchMedia`, so it produced "Click to roll"
 * while a phone produced "Tap or shake to roll", and React threw out the tree.
 * Going through a store hands React both snapshots and lets it swap the text
 * itself, on the same path `useReducedMotion` already takes.
 */
export function useCanShake(): boolean {
  return useSyncExternalStore(subscribe, canShake, getServerSnapshot);
}

let permission: "unknown" | "granted" | "denied" = "unknown";

/** Must be called from inside a real user gesture handler. */
export async function requestShakePermission(): Promise<void> {
  if (!canShake() || permission !== "unknown") return;

  const ctor = DeviceMotionEvent as MotionEventWithPermission;
  if (typeof ctor.requestPermission !== "function") {
    // Android and older iOS need no permission.
    permission = "granted";
    return;
  }

  try {
    permission = await ctor.requestPermission();
  } catch {
    permission = "denied";
  }
}

/** Acceleration jerk that counts as a shake, in m/s². */
const THRESHOLD = 26;
/** Quiet period after a shake, so one flick doesn't fire several rolls. */
const COOLDOWN_MS = 900;

export function useShakeToRoll(onShake: () => void, enabled: boolean) {
  // Held in a ref so a changing callback doesn't tear down and re-attach the
  // motion listener, which would lose the acceleration baseline each time.
  // Written in an effect rather than during render: a ref mutated while
  // rendering is not safe under concurrent React.
  const callback = useRef(onShake);
  useEffect(() => {
    callback.current = onShake;
  }, [onShake]);

  useEffect(() => {
    if (!enabled || !canShake()) return;

    let last = { x: 0, y: 0, z: 0 };
    let lastFired = 0;
    let primed = false;

    const handle = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;

      // The first reading establishes a baseline; comparing against zero would
      // read gravity itself as a shake.
      if (!primed) {
        last = { x: a.x, y: a.y, z: a.z };
        primed = true;
        return;
      }

      const delta =
        Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
      last = { x: a.x, y: a.y, z: a.z };

      const now = Date.now();
      if (delta > THRESHOLD && now - lastFired > COOLDOWN_MS) {
        lastFired = now;
        callback.current();
      }
    };

    window.addEventListener("devicemotion", handle);
    return () => window.removeEventListener("devicemotion", handle);
  }, [enabled]);
}
