# Pollo

Two dice on a lit table. One says what, one says where. Tap, watch them tumble,
and read what they landed on. That is the whole product.

They are thrown one at a time and only one of them is ever on the felt: the die
you have just read leaves at the instant the next one is released, so every
throw lands on an empty table. The page opens with the position die alone, which
is the question most people came for; the switch under the wordmark brings the
place in, and is the one thing about a session that is remembered.

A die that has answered comes up to be read. It rises off the cloth, turns the
landed face square-on, and holds it exactly where the placard is about to print
that face — and the placard then opens out of it. Put it back down and it goes
and lies where it landed.

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
src/present.ts     where a die goes to be read, solved from the screen
src/positions.ts   what each face of the light die is called
src/locations.ts   what each face of the dark die is called
src/settings.ts    the one preference the page keeps
src/ui.ts          the placard, and the chrome around the canvas
src/menu.ts        the menu nobody is meant to find
src/main.ts        the loop, and the only file that knows about both halves
```

The loop only draws when there is something to draw. Between throws the table
is still — same dice, same light, same camera — so it stops rendering a second
and a half after the last thing moved, and starts again the moment anything
does. A screen dense enough to need no multisampling does not get any, either.
Both are for the phone: a phone drawing a picture that is not changing gets
warm, and a warm phone is a slow one by the next throw.

The split is not tidiness. `scripts/verify-roll.ts` imports the first half and
throws the dice thousands of times with no screen attached, which only proves
something about the page because it is running the page's own code.

### Four rules that hold it together

**The order of the faces is one fact, written once.** `FACE_VALUES` in
`faces.ts` is in three.js's box-group order — `+X, -X, +Y, -Y, +Z, -Z` — and it
is the array `die.ts` builds its materials from *and* the array the face reading
searches. There is no second table mapping a value to a picture, so the physics
and the artwork cannot drift apart. Both dice use it.

**Only one die is ever on the table.** The dice are thrown one at a time, and
the one already lying there is taken out of the world on the tick the next one
is released — `lift()` in `physics.ts`, on the same line as the throw. Nothing
is in the way, nothing is bounced off, and a throw is aimed at an empty felt.
What you see is the picture catching up: the die that has gone fades out over a
quarter of a second, which is a good deal less than the half-second the new one
spends in the air, so there is nothing to wait for. A die that has been read is
frozen while it sits there, so what is printed on the placard is what the table
is showing until the moment it leaves — and while it is up at the camera being
read, the body has never moved off the spot it landed on, which is where "lay it
down" puts the picture of it back.

**The card opens out of the face, not over it.** The placard is laid out first
and asked where its card is going to be; the die is then sent to that patch of
screen, and the card grows out of the face it finds sitting there. Both sides
work from the one measurement — `prepare()` in `ui.ts` hands `holdFor()` in
`present.ts` a rectangle, and the fraction of that rectangle the die covers is
set in one place and passed to the stylesheet as a custom property. Nothing is
tuned to a screen size, so a phone turned sideways, a card that has stepped down
to make room for a second one, and a window dragged wider all take the die with
them.

**The dice always answer.** If one stops leaning on a rail or perched on its
neighbour, it is knocked loose and allowed to fall again, three times. If it
still will not lie flat it is laid flat on the face it was nearest to showing,
and the scene eases it there rather than cutting. A page whose one job is
deciding something must never reply "it is on its edge".

### The reveal

The rise is `present()` in `die.ts` and it touches no physics at all. There is
nothing else on the felt for a raised die to still be part of, so the body stays
frozen where it landed and this is a picture of it leaving — which is why it can
be a plain interpolation rather than a kinematic body fighting gravity. It takes
just over half a second, on a curve that leaves quickly and arrives gently, with
one extra revolution wound in at the start and unwound across the way up. A turn
of 2π is the identity, so both ends of the move are exactly where they would
have been without it; all it does is make the arrival a small performance.

`prefers-reduced-motion` skips the flight rather than slowing it. The die arrives
and the card opens with it: a reveal that never happened would be worse than one
that happened at once.

### Adding a position or a place

Drop a PNG into `src/assets/dice/` and add a line to `POSITIONS` in
`src/positions.ts` naming it; places are text alone, so a new one is just a line
in `src/locations.ts`. Either die has six faces, though, so a seventh entry
means deciding what to do about that — it is not a drop-in.

### The loaded dice

Three fast taps on the wordmark open a menu with the twelve faces on it — or
one press held on it, since tapping twice quickly is also how a phone is told
to zoom and some of them take it as read before the third tap lands. Tick some
faces, and the dice land on those from then on. It is meant to be invisible to
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

Nothing is written down. Close the page and it is a fair die again. The one and
only thing the page does remember is in `settings.ts`, and it is the switch
under the wordmark: one die or two, off by default. That is a preference rather
than a secret.

## Checking it

```bash
pnpm verify        # thousands of throws, headless
pnpm verify:cheat  # the same again, with the dice loaded
pnpm typecheck
pnpm build
```

`pnpm verify` runs the real `Dice` on the felt each real viewport produces, in
the real order — a position, then a place, then a position again, each onto a
table the other die has just been lifted off, which is what the page does.

It fails on any of four things: a throw that never stops, a die that leaves the
table, a die that has to be laid flat too often, and a die that favours a face
(chi-square, p = 0.001). It takes well under a second, so there is no reason not
to run it after touching anything in the first half of the list above.

`pnpm verify:cheat` runs the same throws with `rig()` in the middle of them, and
fails on three things: a loaded throw that did not land on one of the faces it
was told to, the *solid* favouring a side while it is being loaded — the
printing may be rigged, the physics may not — and a throw thrown twice from the
same wound state going anywhere different, compared step by step rather than
just at the end. Three thousand loaded throws, no misses.

The numbers they are currently holding: a throw settles in about two seconds,
the slowest in four and a half, and fewer than one throw in five hundred has to
be laid flat — a tenth of what it was when the second die was still lying on the
felt to be landed on. Over twenty thousand throws, neither die left the table or
favoured a face.
