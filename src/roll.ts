/**
 * A throw, from the hand opening to the face being read — and the one clock
 * both dice run on.
 *
 * `Dice` owns the world and advances it in fixed steps. `Roller` owns one die
 * and watches it. The page and the headless check both drive this and nothing
 * else, so there is a single implementation of what a throw is, when it is
 * over, and what it landed on.
 */

import * as CANNON from "cannon-es";
import {
  createTable,
  freeze,
  thaw,
  DIE_HALF,
  PHYSICS_STEP,
  type Table,
} from "./physics";
import { flick, launch, type Launch, type Play } from "./throw";
import { isStill, SETTLE_TIMEOUT, STILL_STEPS, tolerance } from "./settle";
import { readFace, upright, type FaceReading } from "./faces";

export type Phase = "idle" | "rolling" | "settled";

export interface RollResult extends FaceReading {
  /** True when the die had to be helped off its edge to give an answer. */
  corrected: boolean;
  /** How long the throw took, in seconds of simulated time. */
  seconds: number;
}

/**
 * How many times a die that stopped cocked is knocked loose before the roll is
 * decided for it.
 *
 * Two was enough while there was one die on the table. With two, a throw
 * regularly ends up perched on its neighbour, and the first knock often just
 * puts it back on top — the third try is what took the tidy-ups from one throw
 * in sixty to one in a few hundred.
 */
const MAX_NUDGES = 3;

/** A knock hard enough to lift a leaning die clear, and no harder. */
const NUDGE_LIFT = 3.6;
const NUDGE_SPIN = 9;

/** One die, and the state of the throw it is in the middle of. */
export class Roller {
  private stillSteps = 0;
  private elapsed = 0;
  private nudges = 0;
  private phase: Phase = "idle";

  /** The reading, once the die has stopped. Null while it is moving. */
  result: RollResult | null = null;
  /** Set when the die was righted, so the scene can ease rather than snap. */
  correcting = false;

  constructor(
    readonly body: CANNON.Body,
    private play: Play,
  ) {}

  setPlay(play: Play) {
    this.play = play;
  }

  get state(): Phase {
    return this.phase;
  }

  /**
   * Lays the die flat where it is told, showing a face nobody chose.
   *
   * The opening state of the page, and it is a different face every time it is
   * loaded — a die that always sat the same way up would look placed rather
   * than left there.
   */
  rest(at: { x: number; z: number }) {
    const flat = upright(randomOrientation());
    this.body.position.set(at.x, DIE_HALF, at.z);
    this.body.quaternion.set(flat.x, flat.y, flat.z, flat.w);
    freeze(this.body);
    this.phase = "idle";
    this.result = null;
    this.correcting = false;
  }

  /**
   * Keeps a resting die on a felt that just got smaller.
   *
   * Turn a phone sideways and the table changes shape under whatever is sitting
   * on it; without this a die can be left outside the rails, which is the one
   * place the physics has no answer for.
   */
  confine() {
    if (this.phase === "rolling") return;
    const { position } = this.body;
    const limitX = Math.max(this.play.halfX - DIE_HALF * 1.5, 0);
    const limitZ = Math.max(this.play.halfZ - DIE_HALF * 1.5, 0);
    position.x = Math.min(limitX, Math.max(-limitX, position.x));
    position.z = Math.min(limitZ, Math.max(-limitZ, position.z));
  }

  /** Where the other die is, so a throw does not start on top of it. */
  throwDie(aim?: { x: number; z: number }, clear?: { x: number; z: number }) {
    this.begin(launch(this.play, aim, clear));
  }

  flickDie(drag: { x: number; z: number }, clear?: { x: number; z: number }) {
    this.begin(flick(this.play, drag, clear));
  }

  private begin(from: Launch) {
    const die = this.body;
    thaw(die);
    die.position.set(from.position.x, from.position.y, from.position.z);
    // A uniformly random starting orientation. Without it every throw begins
    // face-up and the tumble has to undo that, which is exactly the kind of
    // thing that quietly loads a die.
    die.quaternion.copy(randomOrientation());
    die.velocity.set(from.velocity.x, from.velocity.y, from.velocity.z);
    die.angularVelocity.set(from.angular.x, from.angular.y, from.angular.z);

    this.phase = "rolling";
    this.result = null;
    this.correcting = false;
    this.stillSteps = 0;
    this.elapsed = 0;
    this.nudges = 0;
  }

  /**
   * One fixed step has been taken; look at the die.
   *
   * The world is stepped by `Dice`, not here — two dice sharing a table have to
   * share a clock, or one of them is living in the past.
   */
  observe() {
    if (this.phase !== "rolling") return;

    const die = this.body;
    this.elapsed += PHYSICS_STEP;

    if (isStill(die.velocity, die.angularVelocity, tolerance(this.elapsed))) this.stillSteps++;
    else this.stillSteps = 0;

    if (this.stillSteps >= STILL_STEPS) {
      const reading = readFace(die.quaternion);
      if (reading.clean) return this.finish(reading, false);
      if (this.nudges < MAX_NUDGES) return this.nudge();
      return this.settleFlat();
    }

    if (this.elapsed >= SETTLE_TIMEOUT) this.settleFlat();
  }

  /** Knocks a cocked die off its edge and lets it fall again. */
  private nudge() {
    const die = this.body;
    die.applyImpulse(
      new CANNON.Vec3(
        (Math.random() - 0.5) * 1.2,
        NUDGE_LIFT,
        (Math.random() - 0.5) * 1.2,
      ),
      new CANNON.Vec3(0, 0, 0),
    );
    die.angularVelocity.set(
      (Math.random() - 0.5) * NUDGE_SPIN,
      (Math.random() - 0.5) * NUDGE_SPIN,
      (Math.random() - 0.5) * NUDGE_SPIN,
    );
    this.nudges++;
    this.stillSteps = 0;
  }

  /**
   * The last resort: lay the die flat on the face it was closest to showing.
   *
   * A page that sometimes answers "it is leaning against the rail" has failed
   * at the one thing it does, so the roll is always decided. The scene eases
   * the die into this rather than cutting to it.
   */
  private settleFlat() {
    const die = this.body;
    const fixed = upright(die.quaternion);
    die.quaternion.set(fixed.x, fixed.y, fixed.z, fixed.w);
    // Never *down*: a die that stopped balanced on top of the other one is at
    // twice this height, and dropping it to the felt would bury it inside its
    // neighbour. Only a die that somehow got under the cloth is lifted.
    die.position.y = Math.max(die.position.y, DIE_HALF);
    this.correcting = true;
    this.finish(readFace(die.quaternion), true);
  }

  private finish(reading: FaceReading, corrected: boolean) {
    freeze(this.body);
    this.phase = "settled";
    this.result = { ...reading, corrected, seconds: this.elapsed };
  }
}

/**
 * The table and everything on it.
 *
 * Time is accumulated rather than passed through, so a dropped frame becomes
 * two steps instead of one long one — a long step is how a die tunnels through
 * the felt.
 */
export class Dice {
  readonly table: Table;
  private rollers: Roller[] = [];
  private accumulator = 0;
  private play: Play;

  constructor(play: Play) {
    this.play = play;
    this.table = createTable(play);
  }

  add(): Roller {
    const roller = new Roller(this.table.addDie(), this.play);
    this.rollers.push(roller);
    return roller;
  }

  setPlay(play: Play) {
    this.play = play;
    this.table.setPlay(play);
    for (const roller of this.rollers) {
      roller.setPlay(play);
      roller.confine();
    }
  }

  /** True while any die is still moving. */
  get rolling(): boolean {
    return this.rollers.some((roller) => roller.state === "rolling");
  }

  step(dt: number) {
    // A tab that was in the background comes back with a huge delta; catching
    // all of it up at once is a throw nobody saw.
    this.accumulator += Math.min(dt, 0.25);

    while (this.accumulator >= PHYSICS_STEP) {
      this.accumulator -= PHYSICS_STEP;
      this.table.world.step(PHYSICS_STEP);
      for (const roller of this.rollers) roller.observe();
    }
  }
}

/** Shoemake's uniform random rotation. */
function randomOrientation(): CANNON.Quaternion {
  const u1 = Math.random();
  const u2 = Math.random() * Math.PI * 2;
  const u3 = Math.random() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return new CANNON.Quaternion(
    a * Math.sin(u2),
    a * Math.cos(u2),
    b * Math.sin(u3),
    b * Math.cos(u3),
  );
}
