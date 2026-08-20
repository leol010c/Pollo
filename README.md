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
```

**Everything you can see** is on top of that:

```
src/scene.ts       renderer, lights, felt, rails, the camera
src/die.ts         the rounded cube, printed with pictures or with words
src/positions.ts   what each face of the light die is called
src/locations.ts   what each face of the dark die is called
src/ui.ts          the placard, and the chrome around the canvas
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

## Checking it

```bash
pnpm verify      # thousands of throws, headless
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

The numbers it is currently holding: half of all throws settle inside two
seconds and nine in ten inside two and a half, about one throw in a hundred has
to be laid flat, and over twenty thousand throws of each die neither left the
table, overlapped its neighbour, or favoured a face.
