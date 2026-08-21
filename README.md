# Pollo

Two dice on a lit table. One says what, one says where. Tap, watch them tumble,
and read what they landed on. That is the whole product.

The physics is real — rigid bodies, a felt with friction and bounce, four rails
they can never get past, and each other to bounce off — so the result is decided
by the throw rather than by `Math.random()` dressed up in an animation. Every
roll settles on a face; the one pointing at the ceiling is the one that gets
posted.

## Running it

```bash
pnpm install
pnpm dev
```

`vite --host` prints a Network URL as well as a local one. Open that on a phone:
the page is built for one held upright in a dim room, and the desktop layout is
the adaptation.

pnpm, not npm — `packageManager` pins the version and `pnpm-workspace.yaml`
carries the one setting the project needs (esbuild is allowed to run its install
script, which is how Vite gets its binary).

## How it is put together

Two halves that do not know about each other.

**The dice and the table** are plain TypeScript with no browser in them at all:

```
src/physics.ts   the world, the felt, the rails, what things are made of
src/throw.ts     the velocity and spin a gesture hands to the solver
src/settle.ts    when a throw counts as over
src/faces.ts     which face is up, read from the quaternion
src/framing.ts   how big the table is and where the camera stands
src/roll.ts      Dice owns the world and the clock; Roller owns one die
src/cheat.ts     loading the dice without touching the throw
```

**Everything you can see** is on top of that:

```
src/scene.ts       renderer, lights, felt, rails, the camera
src/die.ts         the rounded cube, printed with pictures or with words
src/positions.ts   what each face of the light die is called
src/locations.ts   what each face of the dark die is called
src/ui.ts          the placard, and the chrome around the canvas
src/menu.ts        the menu nobody is meant to find
src/main.ts        the loop, and the only file that knows about both halves
```

The split is not tidiness. `scripts/verify-roll.ts` imports the first half and
throws the dice thousands of times with no screen attached, which only proves
something about the page because it is running the page's own code.

### Three rules that hold it together

**The order of the faces is one fact, written once.** `FACE_VALUES` in
`faces.ts` is in three.js's box-group order — `+X, -X, +Y, -Y, +Z, -Z` — and it
is the array `die.ts` builds its materials from *and* the array the face reading
searches. There is no second table mapping a value to a picture, so the physics
and the artwork cannot drift apart. Both dice use it.

**A die that has been read is frozen.** The two dice are thrown one at a time,
so the second regularly lands where the first is sitting. Left dynamic, it could
knock the first onto a new face while its old face was still printed on the
placard. `freeze()` in `physics.ts` makes a settled die immovable — something
the other one bounces off, which is also how a die you have read and set aside
behaves.

**The dice always answer.** If one stops leaning on a rail or perched on its
neighbour, it is knocked loose and allowed to fall again, three times. If it
still will not lie flat it is laid flat on the face it was nearest to showing,
and the scene eases it there rather than cutting. A page whose one job is
deciding something must never reply "it is on its edge".

### Adding a position or a place

Drop a PNG into `src/assets/dice/` and add a line to `POSITIONS` in
`src/positions.ts` naming it; places are text alone, so a new one is just a line
in `src/locations.ts`. Either die has six faces, though, so a seventh entry
means deciding what to do about that — it is not a drop-in.

### The loaded dice

Three fast taps on the wordmark open a menu with the twelve faces on it. Tick
some, and the dice land on those from then on. It is meant to be invisible to
anyone watching the table, which rules out every obvious way of doing it: a die
that is placed, eased, slowed or spun on the way down is a die you can see is
being helped.

So the throw is not touched at all. The die is released exactly as always, that
throw is run to its end in the same tick with nothing drawn — `foretell` in
`roll.ts`, a couple of hundred steps and well under a millisecond — the die is
put back on the same throw, and the *printing* is turned round so the wanted
face is the one the throw was already going to finish on. Then it rolls, for
real, and everything anybody sees is what the solver did.

It works because a die is a symmetric solid: which picture is on which face has
no bearing on how it falls. The turn is one of the twenty-four ways a cube can
be set down, so the shape, the shadow and the sum of seven across opposite
faces all survive it. It is the same die, held a different way round, at the
one instant its pose jumps anyway.

Two things had to become true first. A throw is now a `Wound` — a release, a
starting orientation, and a seed the knocks come from — so the same throw made
twice is the same throw rather than one like it. And `thaw` measures the die
square and at the origin, because the solver reads a body's inertia off the box
its shape takes up in the *world*: a die measured while lying at an angle, or
far from the middle of the table, was handed a different one every time. Fixing
that made the honest dice better too — they settle sooner and land cocked a
third as often as they used to.

Nothing is written down. Close the page and it is a fair die again.

## Checking it

```bash
pnpm verify        # thousands of throws, headless
pnpm verify:cheat  # the same again, with the dice loaded
pnpm typecheck
pnpm build
```

`pnpm verify` runs the real `Dice` on the felt each real viewport produces, in
the real order — a position, then a place, then a position again, with the other
die sitting wherever it last stopped. A throw onto an empty felt and a throw
onto a felt with something already on it are not the same throw, and only one of
them is the one anybody makes.

It fails on any of five things: a throw that never stops, a die that leaves the
table, a die that has to be laid flat too often, a die that favours a face
(chi-square, p = 0.001), and two dice ending up inside one another. It takes
under two seconds, so there is no reason not to run it after touching anything
in the first half of the list above.

`pnpm verify:cheat` runs the same throws with `rig()` in the middle of them, and
fails on three things: a loaded throw that did not land on one of the faces it
was told to, the *solid* favouring a side while it is being loaded — the
printing may be rigged, the physics may not — and a throw thrown twice from the
same wound state going anywhere different, compared step by step rather than
just at the end. Three thousand loaded throws, no misses.

The numbers they are currently holding: half of all throws settle inside two
seconds and nine in ten inside two and a half, about one throw in two hundred
has to be laid flat, and over twenty thousand throws of each die neither left
the table, overlapped its neighbour, or favoured a face.
