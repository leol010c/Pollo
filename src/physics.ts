/**
 * The table, and what everything on it is made of.
 *
 * These numbers live here rather than in the scene because the headless check
 * simulates against them; a throw proved good in scripts/verify-roll.ts is only
 * the page's throw if both are rolling the same die on the same felt.
 */

import * as CANNON from "cannon-es";
import type { Play } from "./throw";

/** Half the die's edge. The die is one world unit across. */
export const DIE_HALF = 0.5;

/**
 * How much time one solver step covers.
 *
 * Fixed rather than the frame's own delta, so a throw plays out identically on
 * a 60Hz laptop, a 120Hz phone, and in Node with no screen at all.
 */
export const PHYSICS_STEP = 1 / 60;

/**
 * Deliberately heavier than earth.
 *
 * At 9.8 a thrown die hangs, drifts, and lands like a balloon. Dice on a table
 * are small and quick, and reading them as small means falling fast — this is
 * the single number that most decides whether the throw looks like dice.
 */
export const GRAVITY = -30;

export const DIE_MASS = 1;
export const DIE_LINEAR_DAMPING = 0.04;
export const DIE_ANGULAR_DAMPING = 0.05;

/**
 * The felt: grippy enough to stop the die, live enough to bounce it twice.
 * The rim: slick and springy, so a die arriving at speed comes off it with most
 * of what it brought and crosses the table again. A grippy wall turns travel
 * into spin and the die drops at the foot of it, which looks stuck rather than
 * rebounded.
 */
export const FELT_CONTACT = { friction: 0.4, restitution: 0.3 };
export const RIM_CONTACT = { friction: 0.15, restitution: 0.62 };

/**
 * One die against the other: grippy and nearly dead, so a die that lands on top
 * of its neighbour stays there and topples off it, rather than skating away
 * like it hit ice.
 */
export const DIE_CONTACT = { friction: 0.55, restitution: 0.16 };

export interface Table {
  world: CANNON.World;
  /** Puts another die on the felt and hands back its body. */
  addDie(): CANNON.Body;
  /** Moves the four rails to a new play area, on resize. */
  setPlay(play: Play): void;
}

/**
 * The rails are infinite half-spaces rather than boxes, which is what makes
 * "the die left the table" impossible rather than unlikely: there is no top
 * edge for it to clear and no corner gap for it to squeeze through.
 */
function rail(material: CANNON.Material, normal: CANNON.Vec3): CANNON.Body {
  const body = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material });
  body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), normal);
  return body;
}

/**
 * Stops a settled die dead, so nothing that happens later can change what it
 * says.
 *
 * There are two dice on this table and they are thrown one at a time, so the
 * second regularly arrives where the first is sitting. Left dynamic, a die
 * could be knocked onto a new face while its old face was still printed on the
 * placard, and the page would be posting a result the table no longer agreed
 * with. Frozen, it is something the other die bounces off — which is also how
 * a die you have already read and set aside behaves.
 */
export function freeze(die: CANNON.Body): void {
  die.velocity.setZero();
  die.angularVelocity.setZero();
  die.mass = 0;
  die.type = CANNON.Body.STATIC;
  die.updateMassProperties();
}

/**
 * Hands a frozen die back to gravity, for its next throw.
 *
 * Measured square and at the origin, which matters more than it looks. The
 * solver works a body's inertia out from the box its shape takes up in the
 * *world*, so a die asked the question while lying at an angle is handed the
 * inertia of a bigger, lopsided brick, and one asked far from the middle of the
 * table is handed a slightly different one again — the two ends of the box are
 * large numbers being subtracted. Neither is a fact about a die. A cube resists
 * turning the same amount about every axis wherever it is sitting, so it is
 * lifted to the middle of the table and squared up for the measurement and put
 * straight back.
 *
 * The throw is the better for it: dice that tumble the same however they were
 * left lying settle sooner and land cocked less often. And it is what makes the
 * same throw twice the same throw, which the loaded die in cheat.ts is built
 * on.
 */
export function thaw(die: CANNON.Body): void {
  const at = die.position.clone();
  const held = die.quaternion.clone();
  die.position.setZero();
  die.quaternion.set(0, 0, 0, 1);

  die.mass = DIE_MASS;
  die.type = CANNON.Body.DYNAMIC;
  die.updateMassProperties();

  die.position.copy(at);
  die.quaternion.copy(held);
  die.aabbNeedsUpdate = true;
  die.wakeUp();
}

export function createTable(play: Play): Table {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  (world.solver as CANNON.GSSolver).iterations = 12;
  // Sleeping would stop a die a frame or two before the stillness test does,
  // and the two would disagree about when the throw ended.
  world.allowSleep = false;

  const dieMaterial = new CANNON.Material("die");
  const feltMaterial = new CANNON.Material("felt");
  const rimMaterial = new CANNON.Material("rim");

  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, feltMaterial, FELT_CONTACT),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, rimMaterial, RIM_CONTACT),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(dieMaterial, dieMaterial, DIE_CONTACT),
  );

  const felt = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: feltMaterial,
  });
  felt.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 1, 0));
  world.addBody(felt);

  const rails = {
    left: rail(rimMaterial, new CANNON.Vec3(1, 0, 0)),
    right: rail(rimMaterial, new CANNON.Vec3(-1, 0, 0)),
    far: rail(rimMaterial, new CANNON.Vec3(0, 0, 1)),
    near: rail(rimMaterial, new CANNON.Vec3(0, 0, -1)),
  };
  for (const body of Object.values(rails)) world.addBody(body);

  function setPlay(next: Play) {
    rails.left.position.set(-next.halfX, 0, 0);
    rails.right.position.set(next.halfX, 0, 0);
    rails.far.position.set(0, 0, -next.halfZ);
    rails.near.position.set(0, 0, next.halfZ);
  }

  setPlay(play);

  return {
    world,
    setPlay,
    addDie() {
      const die = new CANNON.Body({
        mass: DIE_MASS,
        shape: new CANNON.Box(new CANNON.Vec3(DIE_HALF, DIE_HALF, DIE_HALF)),
        material: dieMaterial,
        linearDamping: DIE_LINEAR_DAMPING,
        angularDamping: DIE_ANGULAR_DAMPING,
      });
      die.position.set(0, DIE_HALF, 0);
      world.addBody(die);
      return die;
    },
  };
}
