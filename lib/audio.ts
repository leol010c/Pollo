"use client";

/**
 * Dice clatter, synthesised rather than sampled — a short noise burst through a
 * bandpass filter reads convincingly as a hard resin die striking felt or
 * another die, and it costs no asset download.
 *
 * The AudioContext is created lazily on the first user gesture because browsers
 * refuse to start one otherwise.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/** Impacts per frame are capped — a tray of 12 dice generates dozens of
 *  contacts a second and un-throttled playback turns into white noise. */
const MAX_VOICES_PER_FRAME = 3;
let voicesThisFrame = 0;
let frameResetQueued = false;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // One second of white noise, reused for every impact at different offsets so
  // repeated hits never sound identical.
  const length = Math.floor(ctx.sampleRate * 1.0);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

let primed = false;

/**
 * Plays one silent sample frame.
 *
 * Safari on iOS does not treat a context as usable until audio has actually
 * been *played* through it inside a gesture — resuming alone leaves it in a
 * state that reports "running" and emits nothing. Every audio library that
 * works on iPhone does some version of this, and its absence is the most likely
 * reason the dice were silent there while fine on a laptop.
 */
function primeContext(c: AudioContext) {
  if (primed) return;
  primed = true;
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, c.sampleRate);
  src.connect(c.destination);
  src.start(0);
}

/** Must be called from inside a real user gesture handler. */
export function unlockAudio() {
  const c = ensureContext();
  if (!c) return;
  // The rejection is expected and uninteresting when this runs outside a
  // gesture — iOS refuses, and the next real tap will get it. Swallowing it
  // keeps an unhandled rejection out of the console on every visibility change.
  if (c.state === "suspended") void c.resume().catch(() => {});
  primeContext(c);
}

/**
 * Listens for anything that could count as a gesture, and for coming back.
 *
 * Two problems beyond the first unlock. The canvas was the only thing asking,
 * so a tap that landed on a control unlocked nothing; and iOS suspends the
 * context whenever the tab is backgrounded or the phone locks — which, for an
 * app used on a phone in a room, is most of the time between throws.
 *
 * Returns its own teardown.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => {};

  const kick = () => unlockAudio();
  const passive = { passive: true } as const;

  // pointerdown covers mouse and most touch. touchend is kept alongside it
  // because it is the event iOS has historically been most willing to accept
  // as the gesture that unlocks audio.
  document.addEventListener("pointerdown", kick, passive);
  document.addEventListener("touchend", kick, passive);

  const resume = () => {
    if (document.visibilityState === "visible") unlockAudio();
  };
  document.addEventListener("visibilitychange", resume);
  // Fires on a back-forward cache restore, which is how iOS usually returns.
  window.addEventListener("pageshow", resume);

  return () => {
    document.removeEventListener("pointerdown", kick);
    document.removeEventListener("touchend", kick);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", resume);
  };
}

export interface ImpactOptions {
  /** Collision speed in world units/sec — drives loudness and brightness. */
  velocity: number;
  /** Die-on-die impacts ring higher than die-on-tray. */
  hard?: boolean;
}

export function playImpact({ velocity, hard = false }: ImpactOptions) {
  const c = ctx;
  if (!c || !noiseBuffer || !master || c.state !== "running") return;

  if (voicesThisFrame >= MAX_VOICES_PER_FRAME) return;
  voicesThisFrame++;
  if (!frameResetQueued) {
    frameResetQueued = true;
    requestAnimationFrame(() => {
      voicesThisFrame = 0;
      frameResetQueued = false;
    });
  }

  // Below this the die is just settling and shouldn't be audible.
  const strength = Math.min(1, Math.max(0, (velocity - 0.4) / 6));
  if (strength <= 0.02) return;

  const now = c.currentTime;
  const duration = hard ? 0.085 : 0.13;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;
  // Random offset so successive hits don't replay the same noise slice.
  const offset = Math.random() * 0.8;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = (hard ? 2400 : 1100) * (0.85 + Math.random() * 0.35);
  filter.Q.value = hard ? 3.2 : 1.8;

  const gain = c.createGain();
  const peak = strength * strength * (hard ? 0.9 : 0.6);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  src.start(now, offset, duration + 0.02);
  src.stop(now + duration + 0.03);
}

/**
 * A card being turned over.
 *
 * The same noise buffer the impacts use, but swept rather than struck: a
 * highpass climbing through the flip is the sound of card stock sliding and
 * releasing, where a bandpass ping at a fixed frequency is a click. Slow attack
 * and a long tail for the same reason — a card has no impact in it.
 *
 * No new asset. The whole audio layer here is synthesised, and one short whisk
 * is not worth a download.
 */
export function playFlip() {
  const c = ctx;
  if (!c || !noiseBuffer || !master || c.state !== "running") return;

  const now = c.currentTime;
  const duration = 0.34;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.55 + Math.random() * 0.2;

  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.Q.value = 0.9;
  // The sweep is the whole character. Held flat it is white noise; climbing, it
  // is something thin moving past.
  filter.frequency.setValueAtTime(700, now);
  filter.frequency.exponentialRampToValueAtTime(4200, now + duration * 0.7);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.09);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  src.start(now, Math.random() * 0.6, duration + 0.02);
  src.stop(now + duration + 0.03);
}

/**
 * One card pulled off a deck and dropped back onto it.
 *
 * Called once per pass of the overhand shuffle rather than once for the whole
 * thing, so the sound is built from the same units the motion is: a short
 * scrape of card on card, then the tap of it landing.
 *
 * Very short, very quiet clicks rather than a noise sweep — a smooth whoosh is
 * the sound of paper tearing. Scheduled on the audio clock in one go, not fired
 * from a JS timer: a setTimeout per click would jitter by whole frames.
 */
export function playShuffle() {
  const c = ctx;
  if (!c || !noiseBuffer || !master || c.state !== "running") return;

  const now = c.currentTime;
  const clicks = 5;

  for (let i = 0; i < clicks; i++) {
    const progress = i / clicks;
    /*
     * Accelerating: the gaps close as the card runs out from under the deck.
     *
     * The slope of this curve is what matters, not its shape — it has to be
     * *decreasing*, so successive clicks fall closer together. A squared ramp
     * is the obvious thing to reach for and does the exact opposite, spacing
     * the clicks further and further apart, which sounds like the shuffle
     * stalling halfway through.
     */
    const at = now + (1 - (1 - progress) ** 2) * 0.16;

    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 1.4 + Math.random() * 0.6;

    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2600 * (0.8 + Math.random() * 0.5);
    filter.Q.value = 1.4;

    const gain = c.createGain();
    // Quiet, and quieter as it runs out. Individually these are almost
    // inaudible; the run of them is the sound.
    const peak = 0.06 * (1 - progress * 0.5) * (0.7 + Math.random() * 0.6);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    src.start(at, Math.random() * 0.8, 0.05);
    src.stop(at + 0.06);
  }
}

export function setMuted(muted: boolean) {
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
}

