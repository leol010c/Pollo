/**
 * Wiring. The scene draws, the dice decide, the placard posts the result, and
 * this is the only place that knows about all three.
 *
 * It also holds the one rule the page runs on: the position die opens a round
 * and the location die finishes it — if the location die is in play at all,
 * which is what the switch under the wordmark decides. Whatever you press — the
 * table, a button, the space bar — does whichever of those comes next.
 *
 * And the other rule, which is why the throw looks the way it does: only one
 * die is ever on the felt. The die you have just read leaves at the instant the
 * next one is released, so every throw lands on an empty table rather than on
 * its neighbour.
 *
 * A die that has answered does not stay lying there to be squinted at, either.
 * It rises off the felt and holds its landed face square-on, in exactly the
 * place the placard is about to print that face — and the placard then opens
 * out of it. The plate is measured first and the die flies to what it says, so
 * the two are the same thing on the screen and not two things that agree.
 */

import { createStage } from "./scene";
import { holdFor } from "./present";
import { createLocationDie, createPositionDie, type Die } from "./die";
import { Dice } from "./roll";
import { createChrome } from "./ui";
import { createMenu } from "./menu";
import { loadWhereDie, saveWhereDie } from "./settings";
import { rig } from "./cheat";
import { frame } from "./framing";
import { multiply, readFace } from "./faces";

/** A press this short and this still is a tap; anything more is a flick. */
const TAP_MILLIS = 400;
const TAP_PIXELS = 12;

/** A beat between the dice stopping and the die rising, so the stop registers. */
const REVEAL_DELAY = 220;

/**
 * How long the scene keeps drawing after everything has stopped moving.
 *
 * Between throws the table is completely still — same dice, same light, same
 * camera — and drawing that sixty times a second is a phone getting warm over a
 * picture that is not changing, which is what makes the throw after it stutter.
 * The tail is for the die that had to be laid flat: the physics is finished
 * before the scene has eased it the last few degrees.
 */
const COAST = 1500;

/**
 * Where the die waiting to be thrown is left sitting when the page opens: dead
 * centre across the felt, and this far down it as a fraction of its half-depth.
 */
const KERB = 0.28;

async function start() {
  const canvas = document.getElementById("table") as HTMLCanvasElement;
  const stage = createStage(canvas);
  const chrome = createChrome();

  /** Whether the location die is in play. The one thing the page remembers. */
  let two = loadWhereDie();
  const menu = createMenu(() => two);

  const dice = new Dice(frame(window.innerWidth, window.innerHeight).play);
  const what = { roller: dice.add(), die: await createPositionDie(stage.renderer) };
  const where = { roller: dice.add(), die: await createLocationDie(stage.renderer) };
  const pair = [what, where];
  for (const { die } of pair) stage.scene.add(die.mesh);

  /** Everything still worth drawing has to be drawn before this. */
  let drawUntil = performance.now() + COAST;

  /** Which die is being held up at the camera, and whether the plate is open. */
  let holding: "what" | "where" | null = null;
  let revealed = true;

  /**
   * A big move like the rise is exactly what somebody who has turned motion
   * down does not want. They still get the result — the die arrives rather than
   * flying, and the card opens with it.
   */
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");


  function resize() {
    const play = stage.resize(window.innerWidth, window.innerHeight);
    dice.setPlay(play);
    // The plate is laid out to the new screen, so a die holding a face up
    // against it has to be told where that face has gone.
    if (holding) raise(holding, false);
    drawUntil = performance.now() + COAST;
    return play;
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  // Coming back to a page that was in the background, which a phone may have
  // taken the last drawn frame away from while it was gone.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) drawUntil = performance.now() + COAST;
  });

  const play = resize();
  // The felt opens with the die that is about to be thrown on it, alone. The
  // other one is off the table and unseen until it is its turn.
  what.roller.rest({ x: 0, z: play.halfZ * KERB });
  where.roller.rest({ x: 0, z: play.halfZ * KERB });
  where.roller.lift();
  where.die.dismiss(true);
  for (const { roller, die } of pair) die.sync(roller.body, roller.facing, false);

  chrome.setPair(two);

  /** What is currently printed on the placard. */
  let round: { position: number | null; location: number | null } = {
    position: null,
    location: null,
  };
  /** Which die is in the air, and when its result may be posted. */
  let inFlight: "what" | "where" | null = null;
  let postAt = 0;

  /**
   * Sends a settled die up to hold its face where the card is about to be.
   *
   * Also how a die already up there is re-aimed — at a plate that has changed
   * shape under it, or a window that has. Without the flourish, since it is
   * already holding and a second pirouette would be a die showing off.
   */
  function raise(which: "what" | "where", flourish = true) {
    const slot = chrome.prepare({
      position: round.position!,
      location: round.location,
      wants: two,
    });
    const entry = which === "what" ? what : where;
    const landed = entry.roller.result;

    if (!slot || !landed) {
      chrome.setUp(false);
      chrome.reveal();
      return;
    }

    entry.die.present(
      holdFor(stage.camera, slot, landed.index, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
      flourish && !still.matches,
    );
    holding = which;
    revealed = false;
    chrome.setUp(true);
  }

  /** Puts the held die back where it landed, and takes the plate away with it. */
  function layDown() {
    if (!holding) return;
    (holding === "what" ? what : where).die.lay();
    holding = null;
    chrome.setUp(false);
    chrome.close();
  }

  function begin(
    which: "what" | "where",
    aim?: { x: number; z: number },
    drag?: { x: number; z: number },
  ) {
    const thrown = which === "what" ? what : where;
    const other = which === "what" ? where : what;

    chrome.close();
    chrome.setRolling(true);
    inFlight = which;
    postAt = 0;
    if (which === "what") round = { position: null, location: null };

    // The table is cleared as the throw is made rather than before it. The body
    // leaves the world on this tick, so the die coming down cannot touch it or
    // be deflected by it, and the half-second it spends in the air is spent
    // over an empty felt while the picture of the old one fades.
    other.roller.lift();
    other.die.dismiss();
    thrown.die.appear();
    holding = null;
    chrome.setUp(false);

    if (drag) thrown.roller.flickDie(drag);
    else thrown.roller.throwDie(aim);

    // Nothing has been drawn yet, and this is the only moment at which the die
    // can be turned without anybody seeing it turn.
    rig(dice, thrown.roller, menu.allowed(which));
  }

  /**
   * The one action the page has.
   *
   * A round that has a position but no place yet is halfway done, and the
   * obvious next thing is the place. Anything else starts again.
   */
  function next(aim?: { x: number; z: number }, drag?: { x: number; z: number }) {
    const halfway = two && round.position !== null && round.location === null;
    begin(halfway ? "where" : "what", aim, drag);
  }

  chrome.onThrow(() => begin("what"));
  chrome.onWhere(() => begin("where"));

  /**
   * One die or two.
   *
   * Turning the location die off mid-round finishes that round where it stands:
   * the placard drops the half it was still asking for, and the die itself
   * leaves the table if it was sitting on it. A die actually in the air is left
   * alone to land — the switch is not reachable while anything is rolling, but
   * a keyboard can always find it.
   */
  function pairing(on: boolean) {
    if (on === two) return;
    two = on;
    saveWhereDie(on);
    chrome.setPair(on);

    if (!on && inFlight !== "where") {
      if (holding === "where") {
        holding = null;
        chrome.setUp(false);
      }
      where.roller.lift();
      where.die.dismiss();
    }
    if (inFlight === null && round.position !== null) {
      if (holding) raise(holding, false);
      else chrome.post({ position: round.position, location: round.location, wants: two });
    }
    drawUntil = performance.now() + COAST;
  }

  chrome.onPair(pairing);
  chrome.onLay(layDown);

  document.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    if (menu.open) return;
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

    const which = inFlight;
    if (which === "what") round.position = what.roller.result?.value ?? null;
    else round.location = where.roller.result?.value ?? null;

    inFlight = null;
    if (round.position !== null) raise(which);
  }

  let last = performance.now();

  function tick(now: number) {
    const dt = (now - last) / 1000;
    last = now;

    dice.step(dt);
    let moving = false;
    for (const { roller, die } of pair) {
      die.advance(dt);
      die.sync(roller.body, roller.facing, roller.correcting);
      moving ||= die.leaving || (die.held && !die.arrived);
    }
    post(now);

    // The plate waits for the die: the card opens out of a face that is already
    // sitting where the card is going to be.
    if (holding && !revealed && (holding === "what" ? what : where).die.arrived) {
      revealed = true;
      chrome.reveal();
    }

    if (dice.rolling || inFlight !== null || moving) drawUntil = now + COAST;
    if (now <= drawUntil) stage.render();

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
        pair: (on: boolean) => pairing(on),
        paired: () => two,
        // Which dice are on the felt, and how much of each one is still drawn.
        onTable: () => ({ what: what.roller.onTable, where: where.roller.onTable }),
        shown: () => ({ what: seen(what.die), where: seen(where.die) }),
        rolling: () => dice.rolling || inFlight !== null,
        round: () => ({ ...round }),
        upFaces: () => ({
          what: readFace(multiply(what.roller.body.quaternion, what.roller.facing)).value,
          where: readFace(multiply(where.roller.body.quaternion, where.roller.facing)).value,
        }),
      },
    });
  }
}

/** How much of a die is still being drawn. Dev handle only. */
function seen(die: Die) {
  const [face] = die.mesh.material as { opacity: number }[];
  return { visible: die.mesh.visible, opacity: face?.opacity, leaving: die.leaving };
}

start().catch((error) => {
  console.error(error);
  document.body.innerHTML =
    '<p style="font:400 0.85rem/1.6 ui-monospace,monospace;color:#7e97a6;padding:2rem">' +
    "The table did not load. Check the console." +
    "</p>";
});
