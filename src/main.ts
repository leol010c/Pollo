/**
 * Wiring. The scene draws, the dice decide, the placard posts the result, and
 * this is the only place that knows about all three.
 *
 * It also holds the one rule the page runs on: the position die opens a round
 * and the location die finishes it. Whatever you press — the table, a button,
 * the space bar — does whichever of those two comes next.
 */

import { createStage } from "./scene";
import { createLocationDie, createPositionDie } from "./die";
import { Dice, type Roller } from "./roll";
import { createChrome } from "./ui";
import { frame } from "./framing";
import { readFace } from "./faces";
import { DIE_HALF } from "./physics";

/** A press this short and this still is a tap; anything more is a flick. */
const TAP_MILLIS = 400;
const TAP_PIXELS = 12;

/** A beat between the dice stopping and the placard, so the stop registers. */
const REVEAL_DELAY = 220;

/** Where the two dice are left sitting when the page opens. */
const KERB = 0.95;

async function start() {
  const canvas = document.getElementById("table") as HTMLCanvasElement;
  const stage = createStage(canvas);
  const chrome = createChrome();

  const dice = new Dice(frame(window.innerWidth, window.innerHeight).play);
  const what = { roller: dice.add(), die: await createPositionDie(stage.renderer) };
  const where = { roller: dice.add(), die: await createLocationDie(stage.renderer) };
  const pair = [what, where];
  for (const { die } of pair) stage.scene.add(die.mesh);

  function resize() {
    const play = stage.resize(window.innerWidth, window.innerHeight);
    dice.setPlay(play);
    return play;
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  const play = resize();
  what.roller.rest({ x: -KERB, z: play.halfZ * 0.28 });
  where.roller.rest({ x: KERB, z: play.halfZ * 0.28 });
  for (const { roller, die } of pair) die.sync(roller.body, false);

  /** What is currently printed on the placard. */
  let round: { position: number | null; location: number | null } = {
    position: null,
    location: null,
  };
  /** Which die is in the air, and when its result may be posted. */
  let inFlight: "what" | "where" | null = null;
  let postAt = 0;

  /** Somewhere on the felt that is not under the die being thrown. */
  const clearOf = (roller: Roller) => ({
    x: roller.body.position.x,
    z: roller.body.position.z,
  });

  function begin(
    which: "what" | "where",
    aim?: { x: number; z: number },
    drag?: { x: number; z: number },
  ) {
    const thrown = which === "what" ? what.roller : where.roller;
    const other = which === "what" ? where.roller : what.roller;

    chrome.close();
    chrome.setRolling(true);
    inFlight = which;
    postAt = 0;
    if (which === "what") round = { position: null, location: null };

    if (drag) thrown.flickDie(drag, clearOf(other));
    else thrown.throwDie(aim, clearOf(other));
  }

  /**
   * The one action the page has.
   *
   * A round that has a position but no place yet is halfway done, and the
   * obvious next thing is the place. Anything else starts again.
   */
  function next(aim?: { x: number; z: number }, drag?: { x: number; z: number }) {
    const halfway = round.position !== null && round.location === null;
    begin(halfway ? "where" : "what", aim, drag);
  }

  chrome.onThrow(() => begin("what"));
  chrome.onWhere(() => begin("where"));

  document.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    // The buttons already answer both keys themselves.
    if (document.activeElement instanceof HTMLButtonElement) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    next();
  });

  // A press on the felt throws whichever die is next. Where it lands and how
  // hard depends on whether the hand stayed put: a tap sends the die to the
  // spot, a drag throws it the way the drag went.
  let pressed: { x: number; y: number; at: number; felt: { x: number; z: number } } | null = null;

  canvas.addEventListener("pointerdown", (event) => {
    pressed = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      felt: stage.aimAt(event.clientX, event.clientY),
    };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!pressed) return;
    const start = pressed;
    pressed = null;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const quick = performance.now() - start.at < TAP_MILLIS;

    if (moved < TAP_PIXELS) return next(start.felt);
    const end = stage.aimAt(event.clientX, event.clientY);
    if (!quick) return next(end);
    next(undefined, { x: end.x - start.felt.x, z: end.z - start.felt.z });
  });

  canvas.addEventListener("pointercancel", () => {
    pressed = null;
  });

  function post(now: number) {
    if (!inFlight || dice.rolling) return;

    if (postAt === 0) {
      postAt = now + REVEAL_DELAY;
      chrome.setRolling(false);
      return;
    }
    if (now < postAt) return;

    if (inFlight === "what") round.position = what.roller.result?.value ?? null;
    else round.location = where.roller.result?.value ?? null;

    inFlight = null;
    if (round.position !== null) chrome.post({ position: round.position, location: round.location });
  }

  let last = performance.now();

  function tick(now: number) {
    const dt = (now - last) / 1000;
    last = now;

    dice.step(dt);
    for (const { roller, die } of pair) die.sync(roller.body, roller.correcting);
    post(now);

    stage.render();
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // A handle for driving the page from a test browser: throw on demand, and
  // read what each die is actually showing rather than what the placard says.
  // Vite strips this from a production build.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      pollo: {
        next: () => next(),
        throwWhat: () => begin("what"),
        throwWhere: () => begin("where"),
        rolling: () => dice.rolling || inFlight !== null,
        round: () => ({ ...round }),
        upFaces: () => ({
          what: readFace(what.roller.body.quaternion).value,
          where: readFace(where.roller.body.quaternion).value,
        }),
        gap: () =>
          Math.hypot(
            what.roller.body.position.x - where.roller.body.position.x,
            what.roller.body.position.z - where.roller.body.position.z,
          ) -
          DIE_HALF * 2,
      },
    });
  }
}

start().catch((error) => {
  console.error(error);
  document.body.innerHTML =
    '<p style="font:400 0.85rem/1.6 ui-monospace,monospace;color:#7e97a6;padding:2rem">' +
    "The table did not load. Check the console." +
    "</p>";
});
