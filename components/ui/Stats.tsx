"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useDiceStore } from "@/lib/store";

/**
 * A frame-time readout for the phone.
 *
 * Every other check in this project is headless, which works because everything
 * they check is arithmetic. Smoothness is not: it is what a particular GPU does
 * with a particular frame, and the only place to find out is the device itself.
 * So this is the one instrument that has to run in a browser — and it is built
 * to be read at arm's length on a phone rather than scraped by a script.
 *
 * Off unless the URL says `?stats=1`. Not gated on `NODE_ENV`, deliberately:
 * the thing worth measuring is the deployed build on the real device, and a
 * readout that only exists in development cannot measure the thing that is
 * actually slow. It mounts nothing and samples nothing without the flag.
 *
 * ## Why percentiles rather than FPS
 *
 * An average frame rate hides exactly the thing being chased here. Sixty frames
 * where fifty-nine take 8ms and one takes 400ms averages out to a healthy
 * number and reads as a stutter, because a stutter *is* the tail. p95 is the
 * number to watch; p50 is there to say whether the baseline is also short.
 */

/** Reused, so sampling allocates nothing. */
const scratch = new THREE.Vector2();

/** Frames kept for the percentiles — about two seconds at 60Hz. */
const WINDOW = 120;

/** How often the numbers are published. Fast enough to watch, slow enough that
 *  reading them is not itself a cost worth measuring. */
const PUBLISH_MS = 500;

/**
 * Frame times, kept separately for the throw and for everything else.
 *
 * One combined figure is close to useless here. A throw lasts about a second
 * out of every ten, so its frames are a tenth of the window and get averaged
 * into invisibility by a scene that is doing nothing — and the throw is both
 * the most expensive thing the app does and, because a cube strobes once it
 * turns more than 45° between frames, the thing that suffers most from a frame
 * it does not get.
 */
export interface Band {
  p50: number;
  p95: number;
  worst: number;
  frames: number;
}

const EMPTY: Band = { p50: 0, p95: 0, worst: 0, frames: 0 };

export interface Sample {
  /** While the die is in the air. The number that matters. */
  rolling: Band;
  /** Everything else — settled, idle, being presented. */
  resting: Band;
  calls: number;
  triangles: number;
  /**
   * Compiled shader programs.
   *
   * The single most diagnostic number here. It should climb once while the room
   * is built and then stay flat forever — three caches programs by a key that
   * includes the scene's light counts, so anything that changes how many lights
   * are in the frame recompiles every material in it. A jump in this number is
   * that happening, and a jump is always paid for on one frame.
   */
  programs: number;
  textures: number;
  geometries: number;
  dpr: number;
  /** Drawing buffer, in device pixels. */
  width: number;
  height: number;
  /** False while the Freezer has the loop stopped, so an idle readout is not
   *  mistaken for a dead one. */
  awake: boolean;
}

let current: Sample | null = null;
const listeners = new Set<() => void>();

function publish(next: Sample) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server and client agree on null, so there is nothing to mismatch. */
const NOTHING = () => null;

export function statsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("stats") === "1";
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

function band(times: number[]): Band {
  if (!times.length) return EMPTY;
  const sorted = times.slice().sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    worst: sorted[sorted.length - 1],
    frames: sorted.length,
  };
}

/**
 * Lives inside the Canvas, because `gl.info` is only reachable from in there.
 *
 * Costs one `performance.now()` and a ring-buffer write per frame while it is
 * mounted, and mounts nothing at all without the flag.
 */
export function StatsProbe() {
  const gl = useThree((s) => s.gl);
  const frameloop = useThree((s) => s.frameloop);

  const rolling = useRef<number[]>([]);
  const resting = useRef<number[]>([]);
  const cursor = useRef({ rolling: 0, resting: 0 });
  const last = useRef(0);
  const lastPublish = useRef(0);

  const on = statsEnabled();

  useFrame(() => {
    if (!on) return;

    const now = performance.now();

    // The first frame after a mount or a thaw has no meaningful predecessor —
    // the gap to it is however long the loop was stopped, which would land in
    // the window as a 4000ms frame and own the p95 for the next two seconds.
    if (last.current !== 0) {
      const dt = now - last.current;
      if (dt < 1000) {
        // Read rather than subscribed to: this runs sixty times a second, and
        // a component that re-renders on phase would be measuring itself.
        const airborne = useDiceStore.getState().phase === "rolling";
        const band = airborne ? rolling : resting;
        const key = airborne ? "rolling" : "resting";
        band.current[cursor.current[key] % WINDOW] = dt;
        cursor.current[key] += 1;
      }
    }
    last.current = now;

    if (now - lastPublish.current < PUBLISH_MS) return;
    lastPublish.current = now;

    const size = gl.getDrawingBufferSize(scratch);

    publish({
      rolling: band(rolling.current),
      resting: band(resting.current),
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      geometries: gl.info.memory.geometries,
      dpr: gl.getPixelRatio(),
      width: size.x,
      height: size.y,
      awake: true,
    });
  });

  // The loop stopping is not a reading of zero, and the last numbers published
  // are still the truth about the last frame drawn. Only the liveness changes.
  useEffect(() => {
    if (!on) return;
    // A thaw must not be measured against the frame before the freeze.
    if (frameloop === "always") last.current = 0;
    if (current) publish({ ...current, awake: frameloop === "always" });
  }, [frameloop, on]);

  return null;
}

function Row({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="opacity-55">{label}</span>
      <span className={`tabular ${tone}`}>{value}</span>
    </div>
  );
}

/**
 * The readout, outside the Canvas.
 *
 * Deliberately not inside it: an overlay drawn by the renderer would be part of
 * what it is measuring.
 */
export function StatsReadout() {
  const sample = useSyncExternalStore(subscribe, () => current, NOTHING);

  if (!statsEnabled() || !sample) return null;

  const ms = (v: number) => `${v.toFixed(1)}ms`;

  /*
   * 16.7ms is the frame. Amber past it, red past 22 — which is where a fast
   * tumble crosses 45° between frames and a cube stops reading as a cube.
   */
  const tint = (v: number) =>
    v === 0 ? "" : v > 22 ? "text-red-400" : v > 17 ? "text-amber-300" : "";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-50 w-[11.5rem] rounded-md bg-black/75 px-2.5 py-2 font-mono text-[10px] leading-[1.45] text-white"
    >
      <div className="opacity-45">throw</div>
      <Row label="p50" value={ms(sample.rolling.p50)} tone={tint(sample.rolling.p50)} />
      <Row label="p95" value={ms(sample.rolling.p95)} tone={tint(sample.rolling.p95)} />
      <Row label="worst" value={ms(sample.rolling.worst)} tone={tint(sample.rolling.worst)} />
      <div className="my-1 h-px bg-white/20" />
      <div className="opacity-45">at rest</div>
      <Row label="p50" value={ms(sample.resting.p50)} tone={tint(sample.resting.p50)} />
      <Row label="p95" value={ms(sample.resting.p95)} tone={tint(sample.resting.p95)} />
      <div className="my-1 h-px bg-white/20" />
      <Row label="calls" value={String(sample.calls)} />
      <Row label="tris" value={sample.triangles.toLocaleString()} />
      <Row label="programs" value={String(sample.programs)} />
      <Row label="textures" value={String(sample.textures)} />
      <Row label="geoms" value={String(sample.geometries)} />
      <div className="my-1 h-px bg-white/20" />
      <Row label="dpr" value={sample.dpr.toFixed(2)} />
      <Row label="buffer" value={`${sample.width}×${sample.height}`} />
      <Row label="loop" value={sample.awake ? "running" : "frozen"} />
    </div>
  );
}
