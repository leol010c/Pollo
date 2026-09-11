/**
 * The coin is fair, bounded, and cannot run away. Run with `npm run verify:coin`.
 *
 * Two properties are worth more than everything else in this file, and both were
 * asked for in those words: the flip must not be able to loop, and it must not
 * be able to go wrong.
 *
 * Neither is checkable by playing. A loop is a thing you only find by being
 * unlucky in exactly the right order — flip, win, flip, win — and a hundred
 * honest rounds prove nothing about the hundred and first. And the failure mode
 * of the coin *showing* the wrong face is silent by construction: the store
 * would be right, the app would behave correctly, and the only wrong thing in
 * the world would be the picture somebody is looking at while being told they
 * lost.
 *
 * So the loop is disproved by fuzzing the real store through ten thousand
 * arbitrary sequences and asserting an invariant that would be violated by any
 * loop that exists, and the face is disproved by reading which mark actually
 * points upward once the coin has come to rest. Both import what actually runs;
 * neither reimplements it.
 *
 * The framing is checked the same way and for a related reason: where a corner
 * is, and how high a throw can go, are different answers on every shape of
 * screen this runs on, and getting them wrong is invisible until somebody plays
 * on the one shape nobody tried.
 */
import * as THREE from "three";
import { betOffer, useDiceStore } from "../lib/store";
import type { DeckEntry } from "../lib/dice/deck";
import { DIE_RADIUS } from "../lib/dice/types";
import { cameraPoseFor, computeTrayBounds } from "../lib/scene/bounds";
import { asideSpot } from "../lib/scene/presentation";
import {
  BOUNCE_COUNT,
  COIN_RADIUS,
  COIN_THICKNESS,
  SPIN_TURNS,
  coinFaceNormal,
  floorClearance,
  getCoinGeometry,
  launchAngle,
  restQuaternion,
  spinRemaining,
  tossApex,
  tossAt,
  tossHeight,
  wobbleAt,
} from "../lib/scene/coin";

const problems: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok && !problems.includes(msg)) problems.push(msg);
};

const store = useDiceStore;

function fakeDeck(size: number): DeckEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `entry-${i + 1}`,
    kind: "position" as const,
    name: `Entry ${i + 1}`,
    intensity: 2 as const,
    source: [`/dice/image-${i + 1}.png`],
  }));
}

function reset(size = 12) {
  store.setState({
    mode: "dice",
    dieType: "d6",
    phase: "idle",
    value: null,
    drawn: null,
    pile: [],
    disabled: [],
    favourites: [],
    history: [],
    stake: null,
    lastPositionId: null,
    rollId: 0,
    rollRequest: 0,
    layRequest: 0,
    discreet: false,
    coin: null,
    flipId: 0,
    // The store's own initial values. True is the "no round yet" state — see
    // betUsed — and a reset that started false would be a round nobody threw,
    // which is exactly the state the first-load check below exists to catch.
    betUsed: true,
    betPrize: false,
    // The card mode's bet shares the round token with this one, so a stale pair
    // left on the felt would read as the app being busy and refuse every throw
    // below.
    bet: null,
    betId: 0,
    shoe: [],
    forfeit: null,
    chosenEntry: null,
  });
  store.getState().setDeck(fakeDeck(size));
}

/**
 * Forces the toss without giving the store a test-only entry point.
 *
 * flipCoin() calls Math.random() exactly once and compares it against 0.5, so
 * swapping the global for the duration of the call is enough — and it leaves the
 * production path a plain fair coin with no argument on it that only a script
 * ever passes. Restored in a finally so a failure here cannot corrupt the
 * fairness sample at the end of the file.
 */
function flipping<T>(outcome: "won" | "lost", fn: () => T): T {
  const real = Math.random;
  Math.random = () => (outcome === "won" ? 0.1 : 0.9);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

/**
 * Deterministic noise for the fuzz, so a failure is reproducible.
 *
 * Its own generator rather than Math.random, which is being swapped out from
 * under the flips above — a fuzz whose choices came from the same source would
 * silently stop being random inside the very call it is testing.
 */
let seed = 0x2f6e2b1;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

/**
 * What the die does when the store asks for a throw.
 *
 * Die.tsx watches rollRequest and answers with beginRoll() then, once it stops,
 * settle(). Nothing here can mount a scene, so this stands in for it — and
 * standing in for it is the point: the loop, if there were one, would run
 * through this exact handoff.
 */
/**
 * One throw, as the die reports it — and now and then reported twice.
 *
 * beginRoll is a component's callback: an effect in Die.tsx, one counter-bump
 * behind whatever asked for the throw. Effects re-run, and a scene that answers
 * twice for one throw is the failure the round boundary has to be immune to,
 * because the second answer is the one that would hand a spent flip back. So it
 * happens here at random rather than in a test written to expect it, and every
 * property in this file is asserted through it.
 */
function answerThrow() {
  store.getState().beginRoll();
  if (rand() < 0.2) store.getState().beginRoll();
  store.getState().settle(1 + Math.floor(rand() * 6));
}

let lastRequest = 0;
function pumpDie(): boolean {
  const request = store.getState().rollRequest;
  if (request === lastRequest) return false;
  lastRequest = request;
  answerThrow();
  return true;
}

function syncDie() {
  lastRequest = store.getState().rollRequest;
}

/**
 * The die thrown by hand, which is the path the feature originally missed.
 *
 * Tapping the die or picking it up and flinging it goes from the scene into
 * throwWith() — beginRoll() and then, once it stops, settle() — without ever
 * passing through play(), requestRoll() or any counter. It is the ordinary way
 * to throw a die in this app, and while the round boundary lived in play() a
 * round begun this way never got its coin back. Every property below that talks
 * about "a throw" has to hold for this one too.
 */
function handThrow() {
  answerThrow();
  // The scene bumps no counter for a hand throw, so pumpDie() must not later
  // read this as an unanswered request.
  syncDie();
}

/**
 * Paying a lost bet in full: their position, then their number.
 *
 * Two taps where "Fine" used to be one, and the fuzz has to make both — a
 * forfeit left half-open is a screen still waiting to be answered, and every
 * throw after it would be refused. A no-op unless a loss is actually pending,
 * so the fuzz can reach for it on any step.
 */
function payForfeit() {
  const first = store.getState().inPlay()[0];
  if (!first) return;
  store.getState().forfeitPick(first);
  store.getState().forfeitAmount(40);
}

/*
 * The coin cannot come to rest on the wrong face.
 *
 * restQuaternion is the entire mechanism now that the coin lands on the table
 * instead of holding in front of the lens: it lies flat with the outcome's face
 * upward, and the turning on the way down is a whole number of turns unwound to
 * exactly zero. A whole turn is the identity, so no amount of spinning — at any
 * frame rate, on any device — can reach a different face than this one names.
 *
 * Anything fractional left at the end would leave a disc resting at an angle,
 * which means resting on its edge, showing neither face and having announced a
 * result anyway.
 */
{
  check(
    Number.isInteger(SPIN_TURNS),
    "the coin turns a fractional number of times, so it lands on its edge",
  );
  check(
    spinRemaining(1) === 0,
    "the coin still has turning left to do when it lands — it rests at an angle",
  );
  check(
    Math.abs(spinRemaining(0) % (Math.PI * 2)) < 1e-9,
    "the toss does not begin a whole number of turns from where it lands, " +
      "so the turning itself decides the face",
  );

  // Which way each mark actually points once the coin is lying still, read
  // through the same functions the renderer uses.
  const upness = (outcome: "won" | "lost", face: "won" | "lost"): number =>
    coinFaceNormal(face).applyQuaternion(restQuaternion(outcome)).y;

  check(
    upness("won", "won") > 0.999,
    "a won flip does not land heart-up — the win shows the wrong face",
  );
  check(
    upness("lost", "lost") > 0.999,
    "a lost flip does not land crown-up — the loss shows the wrong face",
  );
  check(
    upness("won", "lost") < -0.999 && upness("lost", "won") < -0.999,
    "both marks end up on the same side — every flip would read the same",
  );

  check(
    Math.abs(wobbleAt(0)) < 1e-9 && Math.abs(wobbleAt(1)) < 1e-9,
    "the tumble is still leaning when it lands, so the lean moves the face",
  );

  // The coin has to be on the table when it gets there, not hovering above it
  // or sunk into it.
  check(
    Math.abs(tossHeight(1, tossApex(390 / 844)) - COIN_THICKNESS / 2) < 1e-9,
    "the coin does not come to rest lying on the felt",
  );

  /*
   * And it has to be a throw, not a drop.
   *
   * Sampled rather than read off the midpoint: the arc is deliberately lopsided
   * now — the coin leaves a hand above the felt and travels across the table —
   * so its apex is not at the halfway mark and a check that looked there would
   * be measuring the way down.
   */
  // A phone's, since the phone is what this is for. Every shape is projected
  // for framing further down; this block is about the shape of the throw.
  const height0 = tossApex(390 / 844);

  let apex = 0;
  let apexAt = 0;
  let touchdowns = 0;
  let previous = tossHeight(0, height0);
  let falling = false;

  for (let i = 1; i <= 1000; i++) {
    const at = i / 1000;
    const height = tossHeight(at, height0);
    if (height > apex) {
      apex = height;
      apexAt = at;
    }
    // Every turn from falling back to rising is the coin coming off the felt
    // again, which is a bounce.
    if (falling && height > previous) touchdowns++;
    falling = height < previous;
    previous = height;
  }

  check(
    apex > tossHeight(0, height0) + 0.8,
    "the toss barely leaves the table — it reads as a drop, not a throw",
  );
  check(
    apexAt < 0.5,
    "the coin is still rising past the halfway mark, so it drops rather than arcs",
  );
  check(
    touchdowns === BOUNCE_COUNT,
    `the coin bounces ${touchdowns} times rather than ${BOUNCE_COUNT} — ` +
      "it lands dead, which is the thing that read as animated",
  );
  check(
    tossHeight(0, height0) > COIN_THICKNESS,
    "the coin is thrown from the felt rather than from a hand above it",
  );
}

/*
 * ...and the face it lands on is the one the outcome names.
 *
 * finalSpin above proves the coin stops square to the camera. It says nothing
 * about *which* face is then pointing at it — that comes from the geometry,
 * where the winning mark is painted onto the cap that faces +Z and the losing
 * one onto the cap that faces away.
 *
 * This is the single mistake in the whole feature that no other check could
 * catch and no amount of playing would reliably reveal: swap those two and the
 * app is correct in every respect except that it shows a crown when you have
 * won and a heart when you have lost. So the two caps are read straight out of
 * the buffer the renderer draws from.
 */
{
  const geometry = getCoinGeometry();
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");

  check(
    geometry.groups.length === 3,
    "the coin is not built from three material groups — rim, near cap, far cap",
  );

  // Averaged rather than sampled: a cap is a fan of triangles and any one
  // vertex of it sits on the rim, where z is whatever the cap's thickness says.
  const capDepth = (materialIndex: number): number => {
    const group = geometry.groups.find(
      (g) => g.materialIndex === materialIndex,
    );
    if (!group || !index) return NaN;

    let total = 0;
    for (let i = group.start; i < group.start + group.count; i++) {
      total += position.getZ(index.getX(i));
    }
    return total / group.count;
  };

  check(
    capDepth(1) > 0,
    "the face painted with the heart points away from the camera — " +
      "every won flip would land showing the crown",
  );
  check(
    capDepth(2) < 0,
    "the face painted with the crown points at the camera — " +
      "every lost flip would land showing the heart",
  );
}

/*
 * No part of the coin is ever inside the table.
 *
 * This is what "half the coin isn't visible, it's glitching" was. The coin is
 * drawn rather than simulated, so nothing stops it passing through the cloth,
 * and near the felt it is still turning — a disc on its edge reaches a whole
 * radius below its own centre, more than ten times what it reaches lying flat.
 * For a stretch either side of every bounce it was simply inside the floor.
 *
 * Checked against the real vertex buffer rather than against the formula that
 * is supposed to describe it: floorClearance() being self-consistent is worth
 * nothing if what it describes is not the shape the renderer draws.
 */
{
  const geometry = getCoinGeometry();
  const position = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  // Every tilt the coin passes through on its way down, and a few axes to be
  // tilted about — the toss turns about the screen's horizontal and leans about
  // the direction of travel, so the axis is not fixed.
  for (let turn = 0; turn <= 48; turn++) {
    for (const about of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 1).normalize(),
    ]) {
      quaternion.setFromAxisAngle(about, (turn / 48) * Math.PI * 2);

      axis.set(0, 0, 1).applyQuaternion(quaternion);
      const centre = floorClearance(axis.y);

      let lowest = Infinity;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyQuaternion(quaternion);
        lowest = Math.min(lowest, centre + vertex.y);
      }

      check(
        lowest >= 0,
        "the coin passes through the table part-way through its turn",
      );
    }
  }

  // And it is not left floating either — lying flat it should be resting on the
  // cloth, not hovering over it.
  check(
    floorClearance(1) < COIN_THICKNESS,
    "the coin hovers above the felt when it is lying flat",
  );
  check(
    floorClearance(1) > COIN_THICKNESS / 2,
    "the coin rests exactly on the floor plane, which is two surfaces in the " +
      "same place — the shimmer that reads as the coin glitching",
  );
}

/*
 * The die is in the corner, and the coin is in shot, on every shape of window.
 *
 * "Top right on all views" is a claim about a frame, and a frame is a different
 * shape on every device this runs on — so it is checked against the real camera
 * the app builds for each one, by projecting the real poses and reading where
 * they land in normalised device coordinates. A phone held upright and an
 * ultrawide desktop disagree about where a corner is by a factor of four.
 *
 * The two failures this rules out are the ones nobody would see coming: a die
 * parked half off the edge of a narrow screen, and a toss whose apex leaves the
 * top of the frame, so the coin vanishes mid-flip and reappears having landed.
 */
{
  const shapes: [string, number, number][] = [
    ["ultrawide 2560×1080", 2560, 1080],
    ["desktop 1920×1080", 1920, 1080],
    ["laptop 1440×716", 1440, 716],
    ["square 900×900", 900, 900],
    ["tablet portrait 768×1024", 768, 1024],
    ["phone 390×844", 390, 844],
    ["phone small 320×568", 320, 568],
  ];

  for (const [label, w, h] of shapes) {
    const aspect = w / h;
    const pose = cameraPoseFor(aspect);
    const bounds = computeTrayBounds(aspect);

    const camera = new THREE.PerspectiveCamera(pose.fov, aspect, 0.1, 100);
    camera.position.set(...pose.position);
    camera.lookAt(new THREE.Vector3(...pose.target));
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const spot = asideSpot(bounds);

    /*
     * It stands on the felt, not over the edge of it.
     *
     * Being inside the play area is what makes the die impossible to lose off
     * the side of a frame, because the play area is solved to be framed. The
     * previous version of this pose was measured in screen space and this check
     * had to argue about pixels; now the containment is the guarantee and the
     * projection below is only confirming which corner it reads as.
     */
    check(
      Math.abs(spot.x) + DIE_RADIUS <= bounds.halfX + 1e-9,
      `the die stands over the side rail when set aside on ${label}`,
    );
    check(
      spot.z - DIE_RADIUS >= bounds.zMin - 1e-9 &&
        spot.z + DIE_RADIUS <= bounds.zMax + 1e-9,
      `the die stands off the far end of the felt when set aside on ${label}`,
    );

    // And it is well clear of where the coin comes down, which is the middle.
    check(
      Math.hypot(spot.x - bounds.home[0], spot.z - bounds.home[2]) >
        DIE_RADIUS + COIN_RADIUS,
      `the die is set aside on top of where the coin lands on ${label}`,
    );

    // Back and to the right, as seen through the camera rather than asserted
    // about world axes — which corner of the picture a corner of the table
    // reads as is a question about the framing.
    const ndc = new THREE.Vector3(spot.x, DIE_RADIUS, spot.z).project(camera);
    check(
      ndc.x > 0 && ndc.y > 0,
      `the die does not step to the top-right of the picture on ${label}`,
    );
    check(
      Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1,
      `the die is off screen when set aside on ${label}`,
    );

    /*
     * And the coin stays in shot for the whole of its throw, from every
     * direction it can be thrown from.
     *
     * Twenty points along the way rather than the two ends, because the coin
     * travels across the table as well as up and being in frame where it starts
     * and stops says nothing about the middle — and forty tosses' worth of
     * launch angles, because the direction varies per flip now and the ones
     * that come in from the side peak over a different part of the table than
     * the ones that come straight on.
     */
    for (let flip = 1; flip <= 40; flip++) {
      const angle = launchAngle(flip);
      for (let i = 0; i <= 20; i++) {
        const at = tossAt(i / 20, bounds, tossApex(aspect), angle);
        const point = new THREE.Vector3(at.x, at.y, at.z).project(camera);
        check(
          Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
          `the coin leaves the frame part-way through its throw on ${label}`,
        );
      }
    }
  }
}

/*
 * One flip per round, and a won flip does not buy the next one.
 *
 * The sequence the whole feature has to survive, written out longhand: throw,
 * flip, win, be thrown again automatically — and then find the coin gone.
 *
 * Run once for each way a die can be thrown, and that is not padding. Every
 * property here held for the asked-for throw and none of them held for the
 * hand throw: the boundary lived in play(), the die's own tap and fling go
 * nowhere near it, and so the second round of a session — whichever way it was
 * begun — never got its coin back. One throw style is the bug this file failed
 * to catch; both is the fix.
 */
for (const style of ["asked for", "by hand"] as const) {
  const throwDie = () => {
    if (style === "by hand") {
      handThrow();
      return true;
    }
    store.getState().play();
    return pumpDie();
  };

  reset();
  syncDie();

  check(throwDie(), `the first throw ${style} never happened`);
  check(
    store.getState().phase === "settled",
    `the first throw ${style} did not settle`,
  );
  check(
    !store.getState().betUsed,
    `a fresh round begun ${style} started with the coin spent`,
  );

  flipping("won", () => store.getState().flipCoin());
  check(store.getState().coin !== null, "the flip did not take");
  check(store.getState().coin?.outcome === "won", "the forced win did not take");
  check(
    store.getState().betUsed,
    "flipping did not spend the round's coin, so it could be flipped again",
  );
  check(
    store.getState().phase === "idle",
    "the reveal was left standing over the coin",
  );

  store.getState().landCoin();
  const requestBefore = store.getState().rollRequest;
  store.getState().settleCoin();
  check(store.getState().coin === null, "a won coin stayed on the table");
  check(
    store.getState().rollRequest !== requestBefore,
    "winning the flip did not throw the die again, which is what was bet for",
  );

  /*
   * The prize throw, answered twice by the scene on purpose.
   *
   * beginRoll is a component's callback — an effect in Die.tsx, one counter-bump
   * behind whatever asked for the throw — and an effect that runs twice is the
   * one shape of failure that could hand a spent flip back, on precisely this
   * throw. The repeat arrives while the phase is still "rolling", which is what
   * makes it the same throw rather than a new round. See beginRoll.
   */
  store.getState().beginRoll();
  store.getState().beginRoll();
  store.getState().beginRoll();
  check(
    store.getState().betUsed,
    `repeated answers to the throw the win bought, ${style}, restored the flip`,
  );
  store.getState().settle(5);
  syncDie();
  check(
    store.getState().betUsed,
    "the throw a won flip paid for handed the coin back — this is the loop",
  );
  check(
    !store.getState().betPrize,
    "the prize outlived the throw it paid for, so it could exempt a second one",
  );

  const beforeRefused = store.getState().flipId;
  flipping("won", () => store.getState().flipCoin());
  check(
    store.getState().flipId === beforeRefused && store.getState().coin === null,
    `a second flip in the same round was allowed, ${style}`,
  );

  /*
   * And the next throw is a new round, whichever way it is made.
   *
   * This is the reported bug, stated as a check: after a won flip has been
   * collected, throwing again by hand has to hand the coin back. It did not,
   * and nothing here could see it, because "throw" only ever meant play().
   */
  throwDie();
  check(
    !store.getState().betUsed,
    `a throw made ${style} after collecting a win did not restore the flip`,
  );
  check(
    store.getState().phase === "settled" && store.getState().value !== null,
    `a throw made ${style} after collecting a win left no result to bet against`,
  );
}

/*
 * The invariant, fuzzed.
 *
 * Ten thousand arbitrary but legal steps through the real store, asserting
 * throughout that no more coins have been flipped than there have been throws
 * somebody actually asked for. Any loop — this one or one introduced later by
 * an innocent-looking reset somewhere else — has to violate that, because a
 * loop is precisely a flip that did not cost a throw.
 *
 * Deliberately not a scripted sequence. The failure this is guarding against is
 * an ordering nobody thought of, and a test that only walks the orderings
 * somebody thought of would be checking the wrong thing.
 */
{
  reset();
  syncDie();

  let userThrows = 0;
  let flips = 0;
  /*
   * Flips since the last throw somebody asked for.
   *
   * Counted per round rather than as a running total against the throws, which
   * is the same property stated in a way that cannot catch anything: a total
   * accumulates slack every time the fuzz throws without flipping, and by the
   * hundredth step there is enough of it to hide any number of free flips.
   */
  let flipsThisRound = 0;
  let worst = 0;

  for (let step = 0; step < 10_000; step++) {
    const pick = rand();

    if (pick < 0.22) {
      // A throw the user asked for: a tap on the felt, a shake, or "Roll again".
      store.getState().play();
      if (pumpDie()) {
        userThrows++;
        flipsThisRound = 0;
      }
    } else if (pick < 0.28) {
      /*
       * The same thing meant a different way: the die tapped or flung by hand.
       *
       * Counted as a user throw because that is exactly what it is — somebody
       * wanted a result and picked the die up to get one. Reading it as
       * anything less is the mistake that produced the bug.
       */
      if (!store.getState().coin) {
        handThrow();
        userThrows++;
        flipsThisRound = 0;
      }
    } else if (pick < 0.55) {
      const before = store.getState().flipId;
      flipping(rand() < 0.5 ? "won" : "lost", () =>
        store.getState().flipCoin(),
      );
      if (store.getState().flipId !== before) {
        flips++;
        flipsThisRound++;
      }
    } else if (pick < 0.7) {
      store.getState().landCoin();
    } else if (pick < 0.85) {
      store.getState().settleCoin();
      // The die answering the throw a won flip bought. Not counted: nobody
      // asked for it.
      pumpDie();
    } else if (pick < 0.95) {
      payForfeit();
    } else {
      store.getState().layDown();
    }

    // The worst it ever got, rather than a failure per step: a loop trips this
    // on every step after the first and would otherwise print a thousand
    // near-identical lines over the rest of the report.
    worst = Math.max(worst, flipsThisRound);

    const coin = store.getState().coin;
    check(
      coin === null || store.getState().betUsed,
      "a coin was in play without the round's flip being marked spent",
    );
    // The prize is a token for one throw, not a state to sit in. If it can
    // outlive the throw it was minted for, it can exempt a later one, and a
    // throw exempted from being a new round is a free flip.
    check(
      !(store.getState().betPrize && store.getState().phase === "settled"),
      "a prize survived the throw it paid for and was still owed once it landed",
    );
  }

  check(
    worst <= 1,
    `the coin was flipped up to ${worst} times off a single throw — it loops`,
  );
  check(
    flips <= userThrows,
    `${flips} flips off ${userThrows} throws — flips are not being paid for`,
  );

  // A fuzz that never reached the interesting states would pass everything above
  // by doing nothing, which is the failure mode of every random test.
  check(flips > 100, "the fuzz never managed to flip the coin at all");
  check(userThrows > 100, "the fuzz never managed to throw the die at all");
}

/*
 * Everything else stands down while a coin is out.
 *
 * The coin is the only moment in this app where a result exists but has not been
 * shown yet, and every other control is a way of asking for a result. A tap on
 * the felt landing during the flight and quietly throwing the die underneath it
 * is the shape of most of the ways this could go wrong at once.
 */
{
  for (const stage of ["in the air", "landed"] as const) {
    reset();
    syncDie();
    store.getState().play();
    pumpDie();
    flipping("lost", () => store.getState().flipCoin());
    if (stage === "landed") store.getState().landCoin();

    const before = JSON.stringify(store.getState().rollRequest);
    const layBefore = store.getState().layRequest;

    store.getState().play();
    check(
      JSON.stringify(store.getState().rollRequest) === before,
      `play() threw the die while the coin was ${stage}`,
    );

    store.getState().layDown();
    store.getState().notTonight();
    check(
      store.getState().layRequest === layBefore,
      `the die was put down while the coin was ${stage}`,
    );
    check(
      store.getState().disabled.length === 0,
      `"Not tonight" ruled a position out while the coin was ${stage}`,
    );
    check(
      store.getState().coin !== null,
      `the coin was cleared by something other than settling while ${stage}`,
    );
  }
}

/*
 * Losing hands the choice over, and it is paid on the spot.
 *
 * The joker this replaced was an IOU — a flag, a chip claiming a debt, and an X
 * to tap when it had been settled somewhere the app could not see. Paying it
 * here instead means there is nothing to remember, so nothing to draw, and
 * nothing to dismiss. What follows walks the whole of it: their position, then
 * their number, then the round moving on with nothing left behind.
 */
{
  reset();
  syncDie();
  store.getState().play();
  pumpDie();

  flipping("lost", () => store.getState().flipCoin());
  store.getState().landCoin();
  check(
    store.getState().coin?.landed === true,
    "the lost coin never landed, so the notice would not open",
  );

  store.getState().settleCoin();
  check(
    store.getState().coin !== null,
    "a lost coin cleared itself — the notice would vanish unacknowledged",
  );
  check(
    store.getState().forfeit === null,
    "a forfeit opened before anybody had chosen anything",
  );

  // Their pick. One tap, and it both acknowledges the loss and pays it —
  // there is no moment in between for a token to exist in.
  const theirs = store.getState().inPlay()[0];
  store.getState().forfeitPick(theirs);
  check(
    store.getState().coin === null,
    "their pick left the coin on the table",
  );
  check(
    store.getState().chosenEntry?.id === theirs.id,
    "their pick did not reach the table",
  );
  check(
    store.getState().currentEntry()?.id === theirs.id,
    "currentEntry did not report the position they chose",
  );
  check(
    store.getState().phase === "settled",
    "their pick did not present as a result",
  );
  check(
    store.getState().forfeit?.stage === "amount",
    "their pick did not go on to ask how much",
  );
  check(
    store.getState().history[0]?.name === theirs.name,
    "a forfeited position was left out of the history",
  );

  /*
   * Its own id, not the one belonging to the throw it replaced.
   *
   * RollHistory keys its chips on this, and every other result gets a fresh one
   * from the round boundary in front of it — a forfeit has no such boundary, so
   * it bumps its own. Missing that handed React two children with the same key,
   * which it reports and then behaves unpredictably about.
   */
  const ids = store.getState().history.map((h) => h.id);
  check(
    new Set(ids).size === ids.length,
    `two history entries share an id: ${ids.join(", ")}`,
  );

  // And their number.
  store.getState().forfeitAmount(40);
  check(store.getState().stake?.amount === 40, "their number was not taken");
  check(
    store.getState().forfeit === null,
    "the forfeit stayed open after it had been paid in full",
  );

  /*
   * And none of it outlives the round.
   *
   * The joker this replaced deliberately survived everything that cleared the
   * screen, because it was a debt. A forfeit is the opposite: it *is* the
   * screen, and there is nothing left owing once it has been paid.
   */
  store.getState().play();
  pumpDie();
  check(
    store.getState().chosenEntry === null,
    "a thrown die left the forfeited position on the table",
  );
  check(
    store.getState().forfeit === null,
    "a forfeit survived into the next round",
  );
}

/*
 * A forfeit still open is cancelled by anything that clears the screen.
 *
 * The reverse of the joker's rule, and deliberately so. A joker was a debt that
 * had to survive the disguise going on; a grid of positions waiting to be
 * pointed at is exactly what must not still be there when somebody has just
 * hidden the app because a person walked in.
 */
{
  reset();
  syncDie();
  store.getState().play();
  pumpDie();
  flipping("lost", () => store.getState().flipCoin());
  store.getState().landCoin();
  store.getState().settleCoin();
  store.getState().forfeitPick(store.getState().inPlay()[0]);
  check(
    store.getState().forfeit?.stage === "amount",
    "the forfeit was not open before the disguise went on",
  );

  store.getState().setDiscreet(true);
  check(
    store.getState().forfeit === null,
    "the disguise left a forfeit picker open over a hidden app",
  );
  store.getState().setDiscreet(false);
}

/*
 * A decided loss is paid when the screen clears; an undecided one is not.
 *
 * Someone taps the disguise on because a person walked in. A coin still in the
 * air was never seen by anybody, so nothing may be opened off it — a forfeit
 * picker appearing over a screen somebody has just hidden is the exact failure
 * the disguise exists to prevent.
 */
{
  reset();
  syncDie();
  store.getState().play();
  pumpDie();
  flipping("lost", () => store.getState().flipCoin());
  store.getState().landCoin();
  store.getState().setDiscreet(true);
  check(store.getState().coin === null, "the disguise left a coin on the table");
  store.getState().setDiscreet(false);

  reset();
  syncDie();
  store.getState().play();
  pumpDie();
  flipping("lost", () => store.getState().flipCoin());
  store.getState().setDiscreet(true);
  check(store.getState().coin === null, "the disguise left a coin in the air");
}

/*
 * Where the coin is not offered at all.
 *
 * Card mode has no scene awake to flip it in and discreet mode has nothing it
 * could say about the result without saying what the app is. Both are refused in
 * the store rather than only hidden in the interface, so the rule does not
 * depend on which button somebody found.
 */
{
  reset();
  syncDie();
  store.getState().play();
  pumpDie();
  store.getState().setDiscreet(true);
  flipping("won", () => store.getState().flipCoin());
  check(store.getState().coin === null, "the coin was flippable while disguised");
  store.getState().setDiscreet(false);

  reset();
  syncDie();
  store.getState().setMode("cards");
  store.getState().play();
  store.getState().settleCard();
  flipping("won", () => store.getState().flipCoin());
  check(store.getState().coin === null, "the coin was flippable in card mode");

  reset();
  syncDie();
  flipping("won", () => store.getState().flipCoin());
  check(
    store.getState().coin === null,
    "the coin was flippable before the die had ever landed",
  );

  reset();
  syncDie();
  store.getState().beginRoll();
  flipping("won", () => store.getState().flipCoin());
  check(
    store.getState().coin === null,
    "the coin was flippable mid-throw, betting against a result that does not exist yet",
  );
}

/*
 * And not on the first frame of the app, before anybody has thrown anything.
 *
 * The die drops onto the table on load, comes to rest, and reports its face —
 * settle() fills the value in without promoting the phase, because that is not
 * a roll anybody made. The offer was gated on there being a value, so the app
 * opened by offering a bet against a result nobody had asked for, and the
 * "Tap or shake to roll" hint stood down to make room for it.
 *
 * Checked through betOffer() rather than by reading flags, because the thing
 * that was wrong was the conclusion the chip drew, not the state under it.
 */
{
  reset();
  syncDie();
  check(
    betOffer(store.getState()) === null,
    "the app offered a flip before anything had been thrown",
  );

  // The opening drop, exactly as Die.tsx reports it: settled while idle.
  store.getState().settle(3);
  check(
    store.getState().value === 3,
    "the opening drop did not report the face it came to rest on",
  );
  check(
    betOffer(store.getState()) === null,
    "the die's opening drop was treated as a round and offered a flip",
  );

  flipping("won", () => store.getState().flipCoin());
  check(
    store.getState().coin === null,
    "a flip taken against the opening drop was allowed, spending the coin before the game",
  );

  // And the moment there is a real round, the offer is there.
  handThrow();
  check(
    betOffer(store.getState()) === "flip",
    "the first real throw did not bring the offer up",
  );
}

/*
 * Changing the die cannot strand a coin.
 *
 * The picker and the deck panel both sit in the bottom bar, which stays
 * reachable through the coin's whole flight, and both blank the result the coin
 * was staked against — so without this the coin lands on a round that no longer
 * exists, and a loss lands a notice about a position that has been cleared.
 */
{
  for (const change of ["the picker", "the deck"] as const) {
    reset(12);
    syncDie();
    handThrow();
    flipping("lost", () => store.getState().flipCoin());
    check(store.getState().coin !== null, `no coin was in the air, ${change}`);

    if (change === "the picker") {
      store.getState().setDieType("d12");
    } else {
      // Enough positions off that a d6 no longer fits, which is what calls
      // fitDie() out of the deck panel.
      store.getState().setDeck(fakeDeck(4));
    }

    check(
      store.getState().coin === null,
      `a coin was left in the air by changing ${change}`,
    );
    check(
      !store.getState().betPrize,
      `a prize was left owing by changing ${change}`,
    );
    check(
      betOffer(store.getState()) === null,
      `a flip was offered against the result ${change} had just cleared`,
    );
    // Still undecided when the screen cleared, so nothing was owed on it.
    check(
      store.getState().forfeit === null,
      `changing ${change} opened a forfeit off a flip nobody saw land`,
    );

    // And the round after it is an ordinary one.
    syncDie();
    handThrow();
    check(
      betOffer(store.getState()) === "flip",
      `the round after changing ${change} did not get its coin`,
    );
  }
}

/*
 * Fair.
 *
 * Against the real Math.random, because a weighted coin is the sort of thing
 * that gets introduced by a comparison drifting to `<=` or a constant being
 * tuned "to feel better" — and either would be a lie told to somebody deciding
 * whether to take a bet.
 */
{
  const trials = 100_000;
  let won = 0;

  for (let i = 0; i < trials; i++) {
    reset(6);
    syncDie();
    store.getState().play();
    pumpDie();
    store.getState().flipCoin();
    if (store.getState().coin?.outcome === "won") won++;
  }

  const share = won / trials;
  // ±1% over 100k trials is a little over six standard deviations, so this fails
  // on a real bias and effectively never on luck.
  check(
    Math.abs(share - 0.5) < 0.01,
    `the coin is not fair — it wins ${(share * 100).toFixed(2)}% of the time`,
  );
}

console.log("Coin — one flip a round, and the face it shows is the one it means");

if (problems.length > 0) {
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  process.exit(1);
}

console.log("  OK  no loop, no wrong face, and a lost bet is paid where it is lost");
