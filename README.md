# Dice Throw

A physics die and a deck of cards on a candlelit table, for two people deciding
what to do next. Throw the die or turn a card; either way you get a position.
There is a coin to gamble the result on, a higher-or-lower call that does the
same job in card mode, and a disguise for when somebody walks in.

Built with Next.js 16, React Three Fiber and Rapier. **The phone is the
product** — everything here is designed for a phone held upright in a dim room,
and the desktop layout is the adaptation.

## Running it

```bash
pnpm install
pnpm dev
```

`next dev` binds `0.0.0.0` and prints a Network URL. Open that on a phone —
`next.config.ts` allows private-range dev origins so HMR and the dev overlay
work there, which matters because that is the only place the app can really be
judged.

pnpm, not npm: `packageManager` in `package.json` pins the version, and
`pnpm-workspace.yaml` carries the one setting the project needs (which
dependencies may run install scripts).

## How it is put together

The store is the whole of the app's state and the scene never reaches into it
backwards. The rule, held everywhere:

- **The store asks by bumping a counter.** `rollRequest`, `layRequest`,
  `asideRequest`, `shuffleId` — components watch these and act when the number
  changes. The store never calls into a component.
- **The component reports back by calling an action.** `settle()` for a landed
  die, `settleCard()` for a turned card, `landCoin()` and `turnHighLow()` for a
  decided bet.

Both game modes run through one pipeline. `currentEntry()` in `lib/store.ts` is
the seam: it returns the position on the table whichever object produced it, so
one action bar, one announcer and one history serve a die and a deck of cards
without either knowing about the other.

```
app/page.tsx          server component, ships no client JS of its own
components/DiceApp    the client tree — chrome, layers, the one <Canvas>
components/scene/     everything inside the canvas (Die, Coin, Tray, Props)
components/ui/        everything outside it
lib/store.ts          all state, all rules
lib/dice/             solids, atlas, face detection, the deck
lib/cards/            the draw pile and the playing deck the bet uses
lib/scene/            framing, lighting, physics constants, props placement
scripts/              the headless checks (see below)
```

### Adding a position

This is the developer's half — see *Writing your own* below for the half that
does not need one. Drop `image-14.png` into `public/dice/` and it is in play —
deck membership is discovered from the files themselves, not declared. To give it a name, an
intensity and a unit, add an entry to `POSITIONS` in `lib/dice/deck.ts`; without
one it still works, it is just announced by number and counted in time.

```ts
"image-13": { name: "Something", intensity: 2, measure: "strokes" },
```

`measure` is how the gamble counts that position — `"strokes"` for most of them,
`"time"` for the slow and mutual ones where there is no stroke to count. It is a
property of the position rather than a setting because the right unit is a fact
about what you are doing, not a preference. Absent means time, which applies to
anything.

`DECK_SLOTS` (16) is the ceiling on *built-in* artwork, not on the deck. The die
never has more faces than the deck has positions — `largestDieFor()` steps it
down instead, because a die that has to print the same position twice is lying
about how many outcomes it has.

### Writing your own

The other half of the deck, and the only half that does not need a developer.
The positions panel has a **Write one of your own**: a name, a line, how quickly
it ends and how it is counted — the same four things a built-in carries, so it
behaves like one. It has no artwork and never will, so it wears a monogram drawn
from its initial, the way the Joker wears a sparkle.

They live under `own-` ids, sit between the built-ins and the wilds in the deck,
and are unlimited — `DECK_SLOTS` does not apply to them, since there is no file
and no slot. **Roll from** switches the die between everything, only yours, and
only the built-ins.

Exclusions and favourites persist now too. Switching off the ones you never want
is a standing opinion, not a mood, and being made to restate it every evening
was the app arguing with you.

`lib/dice/own.ts` owns the record and its validation; `lib/prefs.ts` owns the
four keys. Adding a fifth means honouring the rules stated in that file's
header — every access in `try/catch`, and the default stored as *absence*.

Worth knowing: what you write is stored in clear text in `localStorage`, on the
device that wrote it. There is no server to put it behind and no copy anywhere
else — which also means clearing site data is a deletion with no undo. The key
is named as dully as the others so it does not announce itself, but that is
obscurity, not protection. See the note in `readOwn`.

### Discreet mode

The one piece of state that survives a reload, and the one feature whose failure
is not cosmetic. It swaps the artwork for plain numerals, the room for a green
baize table, and drops card mode entirely — a card carries its position printed
on its face, so there is no plain version of one.

What it does **not** do is change the deck: nothing is removed from play,
exclusions and favourites are untouched, and turning it off gives back the app
you left, mid-session. `verify:discreet` asserts that nothing about what the app
is can leak while it is on.

The cover extends outside the app too, and those surfaces are the ones worth
being careful about because they are visible without it being open: the title
and description in `app/layout.tsx`, the same strings again in
`app/manifest.ts`, and the home-screen icon (`app/icon.svg`, and
`app/apple-icon.tsx` which regenerates it as a PNG for iOS). All of it is a
plain dice roller — no plum, no brand colour, no name. If you change one, change
all of them.

## Checks

There is no browser in the loop here, which is why these exist: the failures
worth catching in this app are geometric, statistical or state-machine bugs that
you cannot see by looking, and several of them survived a long time precisely
because they were only *slightly* wrong on screen.

They import the production code rather than re-implementing it —
`verify-bounds` calls the real `computeTrayBounds()`, `verify-distribution`
throws the real convex hulls through Rapier in Node — so a check cannot drift
away from the thing it checks.

```bash
pnpm run verify           # all seventeen, about fifteen seconds
pnpm run verify:geometry  # or any one of them alone
```

| Check | What it holds |
| --- | --- |
| `geometry` | Die solids are structurally sound — planar faces, outward normals, no duplicate values |
| `bounds` | The tray walls stay inside the camera's view at every viewport shape |
| `faces` | Face artwork resolves, and isn't stroke-only or a solid blob |
| `pool` | The spotlight actually pools on the play area |
| `floor` | The felt runs off every side of the frame, at the density the folds need |
| `deal` | Every face of every die gets something dealt to it |
| `pile` | Card mode draws through the deck without repeating |
| `stake` | The gamble is counted in the position's own unit, and the floors hold |
| `modes` | The die and the cards really do share one result pipeline |
| `cards` | The card stack centres on the viewport and never collides with the controls |
| `props` | The scenery never gets in the die's way |
| `hue` | The felt is still the colour it was authored to be |
| `discreet` | The disguise holds — no artwork, no names, no candlelight |
| `distribution` | 1000 real throws per solid: no dead face, no dominant one, nothing unsettled |
| `loaded` | Favourites actually bias the die, and by roughly how much |
| `fix` | The forecast names the face the die actually stops on |
| `coin` | The flip cannot loop and cannot show the wrong face |

`distribution` and `loaded` take `ROLLS` from the environment if you want to run
them harder:

```bash
ROLLS=20000 pnpm run verify:distribution
```

CI runs typecheck, lint, build and all seventeen on every push.

## Conventions

- **Comments explain why, not what**, and they record approaches that were tried
  and removed — the deleted vignette, the `brightness(1)` trap that silently
  kills `preserve-3d`, the two earlier throw implementations. Those notes are
  load-bearing; several of them exist because the same mistake was made twice.
- **Tuned constants say what they were tuned against.** `LOAD_MASS` and
  `LOAD_REACH` in `Die.tsx` cite `verify:loaded`, because no amount of reading
  gets you to those numbers.
- **No Prettier here.** No config and no dependency — don't run it across the
  tree.
