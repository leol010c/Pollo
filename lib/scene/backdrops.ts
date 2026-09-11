/**
 * The lighting and surface treatment for the scene.
 *
 * There used to be six of these — a reflective plinth, a theatrical cone, a
 * matte void, a warm tabletop — on the theory that having alternatives to hand
 * made the look easy to change. In practice it made it easy to *fiddle*: the
 * frame kept getting retuned a few degrees at a time and never actually became
 * a different picture. All five were deleted.
 *
 * ## Why there are six again, and why that is not the same mistake
 *
 * Those six were *alternatives*: a second look for whoever was working on the
 * first one to reach for instead of finishing it. Nobody using the app ever saw
 * them. The rooms below are the opposite — they are the feature. `bedside`,
 * `bare`, `navy`, `midnight` and `ember` are offered to the person holding the
 * phone and they pick one; `plain` is the disguise the app puts on. Each is
 * written to its own brief and can be held to it, which is the test the deleted
 * six failed.
 *
 * So: adding a room because the current one could be *better* is the mistake,
 * and the fix for that is still to change the room you have. Adding one because
 * somebody wants a different picture is the feature. If these are ever weighed
 * for deletion, weigh them against that.
 *
 * `bedside` is the default and its brief is: sensual and romantic. Not a card
 * room, not a séance, not a product shot on velvet.
 *
 * ## What a new room may and may not change
 *
 * The spot's *geometry* is solved, not authored — `pooled` computes the cone
 * from the play area so it covers the floor the die can reach and little more,
 * on every viewport. A room may recolour and re-aim the light's character
 * (colour, intensity, `gobo`, `flicker`); it may not move the lamp. `verify:pool`
 * fails on anything that does.
 *
 * And the rule below about `decay: 0` is not negotiable per room either. Every
 * room's spot must be near-white. A room's *temperature* lives in its rim, its
 * flames and its ambient — never in the one light that bathes the whole floor.
 */

import { poolAngle, type TrayBounds } from "./bounds";

type Vec3 = [number, number, number];

export interface Light {
  position: Vec3;
  intensity: number;
  color: string;
  /** Subtle intensity wander, as a fraction. Reads as candlelight. */
  flicker?: number;
}

export interface Spot extends Light {
  angle: number;
  penumbra: number;
  /**
   * Solve the cone from the play area instead of using `angle`.
   *
   * The cone has to cover the floor the die can reach and little more, and how
   * much floor that is depends on the viewport. `angle` stays as the fallback
   * and as the thing `verify:pool` fails on if this is ever turned off.
   */
  pooled?: boolean;
  /**
   * Break the cone up with a soft dapple, as if the light came through
   * something. Costs one projected texture and puts nothing in the frame.
   */
  gobo?: boolean;
}

/**
 * A flame's light.
 *
 * No position: the flames sit on the candles, and the candles solve their own
 * places from the viewport (props.ts). Authoring a position here would be
 * authoring it twice, and the two would drift.
 */
export interface Flame {
  /** At the wick. Scaled per candle by its `strength`. */
  intensity: number;
  color: string;
  flicker: number;
}

export interface Floor {
  color: string;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  /**
   * Fabric sheen, 0–1. A retroreflective lobe on top of the diffuse, which is a
   * different thing from lowering roughness: it brightens the surface where it
   * turns away from the eye rather than sweeping a specular band across it, so
   * it gives cloth its glow without the artifact that a glossier velvet kept
   * producing.
   */
  sheen?: number;
  /** Usually a lighter, less saturated version of the surface colour. */
  sheenColor?: string;
  /** Low is satin, high is velvet. */
  sheenRoughness?: number;
}

export interface Backdrop {
  id: string;
  /**
   * What the picker calls this room.
   *
   * Here rather than in the picker so a room arrives with its own name — the
   * alternative is a lookup table in a component that has to be kept in step
   * with this file, and the two would drift the first time a room was renamed.
   */
  label: string;
  /**
   * Canvas clear colour.
   *
   * Worth knowing that this is never rendered. Every camera pose looks down
   * between 47° and 66°, so all four frustum corners strike the floor and every
   * pixel of the canvas is velvet — see `visibleFloor` in bounds.ts. What this
   * actually colours is the three places outside the canvas: the browser theme
   * colour, the overscroll area, and the placeholder behind the scene while it
   * loads. It must track `--bg` in globals.css and `themeColor` in layout.tsx.
   *
   * Anything that tunes this expecting the picture to change will be
   * disappointed, which has happened at least once already.
   */
  background: string;
  ambient: number;
  /**
   * Tint on the fill.
   *
   * Ambient reaches every surface the key and rim don't, so its colour is the
   * colour of every shadow in the frame — the cheapest way to decide whether
   * the dark side of an object is warm or simply grey.
   */
  ambientColor?: string;
  floor: Floor;
  /**
   * Haze in the air, which is what gives the frame a *depth* rather than only
   * an edge.
   *
   * The floor runs sixty units and simply gets darker; nothing ever told the
   * eye that the far cloth was far rather than unlit. Exponential-squared fog
   * costs nothing, touches no light, and is the difference between a lit
   * surface and a lit room.
   *
   * `colour` is deliberately a shade *above* the clear colour and warmer than
   * it. Fogging toward the background would only re-darken what is already
   * dark; fogging toward a lifted warm value reads as air catching the flames,
   * and keeps the far field a colour rather than a void.
   *
   * `density` is low enough to leave the play area alone — see verify:pool's
   * sibling note in folds.ts about not fighting the pool.
   */
  fog?: { color: string; density: number };
  /** Cone light — produces a visible pool. */
  spot?: Spot;
  /** Parallel light — flat, even illumination and crisp shadows. */
  key?: Light;
  rim?: Light;
  /** The light on top of each candle. */
  flame?: Flame;
  /**
   * Whether petals are scattered in the margin. Absent means yes.
   *
   * The candles need no equivalent — they only exist where there is a `flame` to
   * put on them, so leaving that out removes them. Petals light themselves off
   * whatever is in the room, so they need to be told.
   */
  petals?: boolean;
  /**
   * What colour the petals are. Absent means the scarlet in petals.ts.
   *
   * They have to be able to move with the room: a scarlet rose on an indigo
   * sheet is not a petal that happens to be red, it is the only warm thing in
   * a cool frame and it takes over. The one rule that survives the recolour is
   * that they stay *lighter* than the floor — the contrast against the cloth is
   * what makes them read as petals rather than as marks on it.
   */
  petal?: { color: string; sheenColor: string };
  /** Multiplier on the studio panels the die reflects. */
  envIntensity: number;
  /**
   * Tint on those panels.
   *
   * A glossy die is mostly a mirror of the studio, so this decides whether its
   * highlights are warm or neutral — independently of the lights, which colour
   * the diffuse shading instead.
   */
  envTint?: string;
  /** Tone-mapping exposure. Unset means 1. */
  exposure?: number;
}

/**
 * ## Why the felt used to be brown, since it took three attempts to find out
 *
 * The surface was never brown in the code. It was `#33101b`, a garnet, and it
 * came out brick on screen. Each attempt to fix it moved the albedo a few
 * degrees around the hue wheel or dropped the light's intensity, and neither
 * did anything, because neither was the cause.
 *
 * The cause was the key. It was `#ffbe86`, an amber, with `decay: 0` — so it
 * reached the entire floor at full strength — and a light multiplies the
 * surface it lands on. In linear terms that amber carries about a quarter of
 * the blue it does red, so the lit felt kept roughly a quarter of the blue it
 * had: a colour with no blue and little green is orange-red, and orange-red at
 * low brightness is the definition of brown. The felt was not lit garnet. It
 * was lit amber, and the garnet was barely participating.
 *
 * ACES tone mapping then made it worse. Its highlight roll-off skews saturated
 * warm reds toward orange as they brighten, which is exactly the range the lit
 * felt sat in. The renderer now uses `NeutralToneMapping`, which holds albedo
 * hue through the shadows and midtones and only desaturates approaching white
 * — so the wine stays wine and only the flames and the die's highlights roll.
 *
 * ### The rule that falls out of it
 *
 * **A light with `decay: 0` reaches the whole floor, so it must be near
 * neutral. A light with `decay: 2` is local, so it may be as orange as a
 * flame.**
 *
 * That is what makes a room read as candlelit rather than as a picture with a
 * warm filter over it: the warmth is *somewhere*, falling off, with a visible
 * source — not spread evenly across every pixel. `verify:hue` enforces the
 * numeric half of this so it cannot quietly regress again.
 */
export const bedside: Backdrop = {
  id: "bedside",
  label: "Bedside",
  background: "#150610",
  /*
   * Rose, and higher than the near-black this replaced.
   *
   * Ambient is the ceiling on how dark the corners get, and it is also their
   * colour. Pushed to near zero the frame falls off into grey sludge, which is
   * not the same thing as falling off into shadow — a room lit by flames has no
   * white light in it anywhere, least of all where the light isn't reaching.
   */
  ambient: 0.14,
  ambientColor: "#bd6a90",
  /*
   * A wine-dark haze.
   *
   * Density is chosen against the camera, not by eye: the die sits about six
   * and a half units from it, where exp(-(0.042·6.5)²) leaves roughly 93% of
   * the die unfogged — a touch of air, not a veil. By twenty units the cloth is
   * down to a third, and by forty it is gone. So the pool is untouched and the
   * distance dissolves, which is exactly the split that was wanted.
   */
  fog: { color: "#1d0813", density: 0.042 },
  floor: {
    /*
     * Deep rose-red, and both parts matter.
     *
     * Saturated, because a desaturated colour has no hue to defend and takes on
     * whatever the light gives it — which is how the old one ended up wearing
     * the key's amber. Light enough to actually be a colour: below about this
     * value the felt is closer to black than to red and the whole argument
     * about its hue is academic.
     */
    color: "#5a1130",
    /*
     * High, flat and barely reflective, on purpose.
     *
     * A lower roughness gives velvet its sheen, but on a plane this large seen
     * at a raking angle that sheen is a broad specular sweep — which reads as a
     * gradient painted on the table, and has been rejected under that
     * description three times. The normal map supplies the pile's texture; the
     * `sheen` lobe below supplies the glow without the sweep.
     */
    roughness: 0.84,
    metalness: 0,
    envMapIntensity: 0.05,
    // Low. Sheen is broad and only weakly tied to where the light is, so a
    // strong one lifts the whole surface evenly and undoes the pool.
    sheen: 0.3,
    // Barely lighter than the surface. Velvet's sheen is the pile catching
    // light, not a second colour laid over it.
    sheenColor: "#a8506b",
    sheenRoughness: 0.7,
  },
  /*
   * The key, and it is almost white.
   *
   * This is the fix. It has `decay: 0`, so it lands on every square inch of
   * floor at full strength — which makes it the one light in the scene whose
   * colour becomes the felt's colour. The faintest blush is all it may carry.
   * It still reads warm, because everything around it is rose and flame.
   *
   * Kept as a solved cone rather than a parallel light: an even wash is flat,
   * and the falloff has to be computed per pixel from a real light because a
   * painted one over this many world units bands.
   */
  spot: {
    // Low and off to one side. A lamp beside a bed, not a rig above a table.
    position: [-2.6, 4.6, 3.4],
    // Superseded by `pooled`; kept as the fallback and as the record of what
    // went wrong when it was authored by hand. See POOL_SPREAD in bounds.ts.
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    gobo: true,
    intensity: 2.75,
    color: "#fff0ea",
    // A flicker you notice is a bug; one you don't is atmosphere.
    flicker: 0.05,
  },
  /*
   * Separation from behind, and the second hue.
   *
   * A warm side and a rose side pulls the two halves of every object apart in
   * colour rather than only in brightness, which is what makes candlelit
   * photographs look candlelit. Low and behind, so it draws an edge on the die
   * rather than filling it. Never casts — one shadow in the frame reads as
   * deliberate, two as a mistake.
   */
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.85, color: "#e0628f" },
  /*
   * The flames, which are where all the orange in this scene now lives.
   *
   * `decay: 2` in the scene, so this falls to a tenth of itself within a couple
   * of units. It lights the wax, the petals near it, and a small patch of felt
   * — and contributes almost nothing to the play area, which is the entire
   * point. Warmth you can walk away from reads as fire; warmth everywhere reads
   * as a gel over the lens.
   */
  flame: { intensity: 2.4, color: "#ff9d4a", flicker: 0.16 },
  envIntensity: 0.88,
  /*
   * The die is glossy, so most of what you see on it is the studio reflected,
   * and the studio's panels are white. This is why the die read clinical
   * against the felt however warm the lights got: the lights shade it, but the
   * environment is what it mirrors.
   */
  envTint: "#ffd9d2",
  exposure: 1.02,
};

/**
 * Nothing in the frame at all.
 *
 * The one the app is asked for most plainly: "only a plain background, with
 * nothing on". So no petals, no candles, no dapple, no flicker — one lamp on one
 * cloth, and the die is the entire picture.
 *
 * The trap here is that "plain" and "grey" are not the same word. A neutral grey
 * room would make the die read as a product shot on a seamless, which this
 * project has already rejected once under that description. The floor is
 * therefore a plum-charcoal: desaturated enough that nothing in it competes, but
 * still a colour, and still the app's colour.
 *
 * Which leaves the two-hue rule with nothing obvious to satisfy it — there are no
 * flames here to be the warm side. It is carried instead by the pair that is
 * left: the spot is faintly warm and the rim is frankly cool, so the die's lit
 * edge and its shadow edge are different colours even in an empty room. That
 * separation is doing more work here than anywhere else, because it is the only
 * thing between this and a grey box.
 *
 * Not to be confused with `plain` below. That one is a disguise and is chosen
 * *for* the user; this one is a taste and is chosen *by* them.
 */
export const bare: Backdrop = {
  id: "bare",
  label: "Bare",
  background: "#0e0a0e",
  // A shade higher than bedside's. With no flames anywhere, ambient is the only
  // thing filling the corners, and an empty room that falls off into black reads
  // as unfinished rather than as dark.
  ambient: 0.18,
  // Barely a colour, and that is the point — but it is a plum rather than a
  // grey, so the shadows belong to the same room as the floor.
  ambientColor: "#9c8d99",
  fog: { color: "#171018", density: 0.042 },
  floor: {
    /*
     * Plum-charcoal. Light enough to be a colour rather than an absence; dark
     * enough that the die stays the brightest thing in frame.
     *
     * Deliberately on the red side of plum rather than the middle of it, and
     * that is a measured decision rather than a taste. A floor at true magenta
     * carries about as much blue as red, so the cool rim shifts its ratio — and
     * therefore its hue — a long way for very little light: the first draft of
     * this room was `#372936` and `verify:hue` caught it drifting 11°. Wine-side
     * of the wheel, the same 9% of blue light moves it 4°. Nothing about the
     * lighting changed; the floor simply stopped standing on the tipping point.
     */
    color: "#48303a",
    // Between bedside's satin and plain's flat nap. A little sheen keeps the
    // plane from reading as painted card; much more and the empty room grows an
    // atmosphere it is meant not to have.
    roughness: 0.66,
    metalness: 0,
    envMapIntensity: 0.12,
    sheen: 0.22,
    sheenColor: "#7d6570",
    sheenRoughness: 0.7,
  },
  spot: {
    position: [-2.6, 4.6, 3.4],
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    // Off. The dapple reads as light coming through a shade or a curtain, and a
    // room with nothing in it may not imply furniture just outside the frame.
    gobo: false,
    // Brighter than the other rooms. Nothing else is lighting anything here.
    intensity: 3,
    // The faintest warmth, and no more: this has `decay: 0` and lands on the
    // whole floor, so its hue is the floor's hue.
    color: "#fff4f0",
  },
  // The cool half of the frame, and in this room the *only* thing supplying a
  // second hue. Dim and raking, as always — it draws the die's far edge rather
  // than filling it.
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.85, color: "#8fa8c4" },
  petals: false,
  envIntensity: 0.9,
  // Neutral, very slightly cool. The die is mostly a mirror of the studio, and
  // in an empty room there is nothing for its highlights to be warm *against*.
  envTint: "#f1eef3",
  exposure: 1.02,
};

/**
 * Navy, and nothing else in the room.
 *
 * A sibling of `bare` rather than of `midnight`: same brief — no petals, no
 * candles, no dapple, no flicker — read in dark blue instead of plum. Where
 * `bare` is *empty*, this one is meant to be **expensive**. That is a real
 * difference and it comes down to one decision.
 *
 * An empty frame has only two things left to look at: the cloth and the light on
 * it. `bare` keeps the cloth quiet and the light matte, so the eye goes to the
 * die. Here the cloth is glossier and the rim is a warm champagne, so a bright
 * edge travels across the navy and stops on the die's shoulder. Deep blue under
 * a gold edge is about as close to a shorthand for "expensive" as lighting gets,
 * and it costs nothing in the frame: it is one number on the floor's roughness
 * and one colour on a light that was already there.
 *
 * The warm rim is also the two-hue rule being satisfied the same way `ember`
 * satisfies it, with the sides swapped — a cool room with a warm edge. It is not
 * an accent to be tidied away.
 */
export const navy: Backdrop = {
  id: "navy",
  label: "Navy",
  background: "#050b16",
  ambient: 0.16,
  /*
   * Blue, and saturated — not the blue-grey this was first written as.
   *
   * Ambient is the colour of every shadow in the frame. A desaturated one puts
   * grey into all of them, and grey in the shadows is most of what makes a
   * strong colour read as *pale*: the eye judges a hue by its darkest part, and
   * if that part has no hue the whole surface reads as a tint of grey rather
   * than as a colour. The shadows in a navy room are bluer than the cloth, not
   * greyer than it.
   */
  ambientColor: "#5c74a8",
  fog: { color: "#0a1322", density: 0.042 },
  floor: {
    // True navy, deep and saturated. Half the rendered brightness of
    // `midnight`'s indigo and a good deal more saturated — the two rooms are
    // both blue and must not be each other.
    color: "#152c58",
    /*
     * ## The glossiest floor in the file, and the one that had to learn what
     * gloss actually costs
     *
     * This room's premise is that a single travelling highlight on dark blue is
     * the whole picture — there is nothing else in the frame for it to compete
     * with, which is why the low roughness that has been trouble everywhere else
     * is welcome here. That much was right.
     *
     * What was wrong was reaching for that with `envMapIntensity: 0.25`, easily
     * the highest in the file. Those are two different things wearing the same
     * word. Roughness governs the *directional* highlight: the lamp's reflection,
     * which lands somewhere and falls off, and which is the thing wanted.
     * `envMapIntensity` governs how much of the studio the surface mirrors — and
     * the studio is a box of near-white panels, so it arrives from every
     * direction at once and lands everywhere equally. On a plane this size that
     * is not a highlight, it is a flat wash of white light, and a flat wash of
     * white light on a colour is the definition of washing it out.
     *
     * Measured: the floor used to render as `#7785aa`, keeping 47% of its
     * albedo's saturation — a steel grey with a memory of blue. Cutting the two
     * even lifters (this and `sheen`) and leaving the lamp alone brings it to
     * `#4e6296` at 70%. Nothing about the gloss was given up; what went was the
     * haze sitting on top of it.
     *
     * So: roughness low, environment low. Keep the streak, lose the fog.
     */
    roughness: 0.45,
    metalness: 0,
    envMapIntensity: 0.08,
    // Low, for the same reason. Sheen brightens the surface where it turns away
    // from the eye, which is a lift that follows the geometry rather than the
    // light — lovely on velvet, and on a large glossy plane just more even haze.
    sheen: 0.1,
    // And a real blue rather than a pale one. A sheen colour lighter and greyer
    // than the surface is a second way of painting white onto it.
    sheenColor: "#405f9c",
    sheenRoughness: 0.6,
  },
  spot: {
    position: [-2.6, 4.6, 3.4],
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    // Off, and no flicker either. Both read as atmosphere — light through a
    // shade, a flame wandering — and this room's restraint is the whole of it.
    // A steady lamp is furniture.
    gobo: false,
    intensity: 2.9,
    // Near-white, cool. It has `decay: 0` and lands on the whole floor, so the
    // navy underneath is what should be blue.
    color: "#f6f7ff",
  },
  /*
   * Gold, and a real one now rather than the pale champagne it started as.
   *
   * This is the one warm thing in the room and the reason it reads as expensive
   * rather than merely dark, so it is the last place to be timid. It can afford
   * the saturation precisely because it is dim and raking: it draws an edge on
   * the die and a line across the near folds, and contributes about a tenth of
   * the light on the floor. Warmth that lands *somewhere* is a lit edge; warmth
   * everywhere is a filter.
   */
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.9, color: "#f2b56a" },
  petals: false,
  envIntensity: 0.9,
  // Cool and clean. The die is mostly a mirror of the studio panels, and in this
  // room its highlights should belong to the cloth rather than to the rim.
  envTint: "#e7edfb",
  exposure: 1.02,
};

/**
 * The cool one.
 *
 * Same brief as `bedside` — sensual, a bedroom rather than a venue — read at the
 * other end of the spectrum: late, blue, the lamp off and the candles still
 * going. Indigo sheet, cool fill, and the flames left in place.
 *
 * The flames are not decoration here, they are the structure. A cool room lit
 * only by cool light is the sepia failure with the hue rotated 180° — one
 * low-saturation family across the whole frame, which reads as a filter rather
 * than as a photograph. The candles are the warm side, and because they have
 * `decay: 2` the warmth stays where they are: a hot pool at each of them and
 * blue everywhere else, which is exactly the split that makes an image look lit.
 *
 * The petals go plum for the same reason in reverse. Scarlet on indigo is the
 * only warm thing in a cool frame at forty-four separate places, and it stops
 * being scenery and becomes the subject.
 */
export const midnight: Backdrop = {
  id: "midnight",
  label: "Midnight",
  background: "#070a14",
  ambient: 0.15,
  // Cool, and saturated enough to be blue rather than grey. Ambient is the
  // colour of every shadow in the frame; a desaturated one here would give the
  // room dishwater shadows and undo the whole idea.
  ambientColor: "#8098c4",
  fog: { color: "#0d1424", density: 0.042 },
  floor: {
    // Deep indigo, and well clear of black. The same argument bedside's wine
    // gets: a floor too dark to have a hue cannot defend one.
    color: "#22376b",
    // Satin, like bedside. The broad highlight travelling over the folds is the
    // subject in both rooms; only its colour changes.
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.2,
    sheen: 0.3,
    sheenColor: "#6484c2",
    sheenRoughness: 0.65,
  },
  spot: {
    position: [-2.6, 4.6, 3.4],
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    gobo: true,
    intensity: 2.8,
    // Near-white with the cool bias this room can afford. Still near-white: it
    // has `decay: 0`, and the indigo underneath it is what should be blue.
    color: "#f2f5ff",
    flicker: 0.05,
  },
  // Warm, and this is the room where the rim carries the counter-hue rather than
  // supporting it. Low and behind, never casting.
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.9, color: "#ff9d63" },
  // Hotter than bedside's by a hair. Against a cool floor a flame reads cooler
  // than it is, and the candles have to stay the warmest thing in the frame.
  flame: { intensity: 2.5, color: "#ff9a44", flicker: 0.16 },
  // Plum. Lighter than the indigo, as the rule requires, and a hue that belongs
  // to the cool half of the wheel without being another blue.
  petal: { color: "#7c2f6a", sheenColor: "#cf8fbe" },
  envIntensity: 0.9,
  // Cool, so the die's highlights come back the colour of the room. Barely — a
  // die with blue highlights on blue cloth loses its edge.
  envTint: "#e2e8ff",
  exposure: 1.04,
};

/**
 * The warm one.
 *
 * Copper and firelight — the room `bedside` would be if the roses were out and
 * the fire were in. Warm-dominant, which makes it the room in this file most
 * likely to go wrong, and in a specific way worth naming: **the brown.**
 *
 * A dark orange-red at low brightness is, definitionally, brown. This project
 * shipped that once and spent three sessions failing to fix it, and every one of
 * those attempts moved the albedo a few degrees because everyone assumed the
 * surface was the problem. It was the light. So the two things holding this room
 * out of the ditch are, in order:
 *
 *   1. The spot is near-white, like every other room's. The warmth is in the
 *      flames and nowhere else with any reach.
 *   2. The floor is a *red* with a gold sheen on it, not a gold. Copper reads as
 *      metal-warm because of what its highlight does, not because its albedo is
 *      the colour of the highlight — authoring the albedo as bronze is precisely
 *      how you get mud.
 *
 * The cool side is the rim, which is the mirror of what `midnight` does with its
 * flames. It is dim and it is blue and it is not optional.
 */
export const ember: Backdrop = {
  id: "ember",
  label: "Ember",
  background: "#120a06",
  ambient: 0.15,
  // Cool. In the warmest room in the file the shadows are the only place a
  // second hue can live at any size, and a warm ambient here would put every
  // pixel in the frame inside one hue family — the sepia failure, exactly.
  ambientColor: "#8496bb",
  fog: { color: "#1c1109", density: 0.042 },
  floor: {
    // A saturated ember red, not a bronze. See the note above about the brown.
    color: "#8f3220",
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.2,
    // The gold is here, in the sheen, where it is a highlight travelling over
    // the cloth rather than the colour of the cloth.
    sheen: 0.35,
    sheenColor: "#e09a5e",
    sheenRoughness: 0.6,
  },
  spot: {
    position: [-2.6, 4.6, 3.4],
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    gobo: true,
    intensity: 2.8,
    color: "#fff5ee",
    flicker: 0.05,
  },
  // Blue, dim, raking. The counterweight — see the header note on the two hues,
  // and do not "fix" this by warming it.
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.9, color: "#6d8fd6" },
  flame: { intensity: 2.4, color: "#ff9d4a", flicker: 0.16 },
  // Copper, and lighter than the floor. Same petal, later in the season.
  petal: { color: "#c25a26", sheenColor: "#f0a970" },
  envIntensity: 0.9,
  envTint: "#ffdcc4",
  exposure: 1.02,
};

/**
 * The room with nothing in it, for discreet mode.
 *
 * The note at the top of this file is about six backdrops that were deleted for
 * being alternatives — a second look to fiddle with instead of finishing the
 * first. This one is not that. It is not an alternative to `bedside`; it is the
 * denial of it, and the app switches to it to stop looking like what it is. If
 * it is ever weighed for deletion, weigh it against the feature and not against
 * the palette.
 *
 * Which means the brief is the opposite of the other one, and just as strict:
 * nothing here may be sensual. No candles, no petals, no rose, no flicker. A
 * green baize table under one plain lamp — a thing so ordinary that a glance
 * over your shoulder finds nothing to catch on.
 *
 * Everything structural is kept identical to `bedside`: the same spot position,
 * the same `pooled` cone, the same exposure, the same fog density. The room is a
 * different colour, not a different room, so nothing that was solved against the
 * geometry has to be solved twice.
 */
export const plain: Backdrop = {
  id: "plain",
  label: "Plain",
  /*
   * The one value here that leaves the canvas.
   *
   * `bedside.background` is pinned to `--bg` in globals.css and `themeColor` in
   * layout.tsx, and it stays the authored default in all three. This one is
   * applied at runtime instead — DiceApp writes it into the theme-color meta tag
   * when the disguise goes on — because a plum browser bar above a green baize
   * table is precisely the loose thread the mode exists to avoid. On a phone that
   * strip is a good fraction of what anyone actually sees.
   */
  background: "#0c110e",
  // Neutral and slightly cool. Ambient is the colour of every shadow in the
  // frame, and a card room's shadows are grey.
  ambient: 0.16,
  ambientColor: "#93a099",
  // Same density as bedside, so the far cloth dissolves at the same distance;
  // only the colour changes, to a shade above the clear colour as before.
  fog: { color: "#111815", density: 0.042 },
  floor: {
    // Baize. Saturated enough to hold its own hue under the lamp, dark enough to
    // keep the die reading as the brightest thing in the frame.
    color: "#1f4d33",
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.05,
    /*
     * Barely any.
     *
     * Velvet's glow is half of what makes the other room feel like a bedroom.
     * Baize is a flat wool nap and is meant to look like one — but taken to zero
     * the plane goes dead and reads as a painted backdrop, so this keeps just
     * enough to say cloth.
     */
    sheen: 0.12,
    sheenColor: "#4e7a62",
    sheenRoughness: 0.85,
  },
  /*
   * One lamp, and near-white — which the rule in this file demands of it anyway,
   * since it has `decay: 0` and lands on the whole floor. Here that costs
   * nothing: neutral is what was wanted.
   *
   * `gobo` is off. The dapple reads as light coming through something — a shade,
   * a screen, a curtain — which is atmosphere, and atmosphere is the thing being
   * hidden. No flicker either, for the same reason: a steady lamp is furniture, a
   * wandering one is candlelight.
   */
  spot: {
    position: [-2.6, 4.6, 3.4],
    angle: 0.66,
    pooled: true,
    penumbra: 1,
    gobo: false,
    intensity: 2.6,
    color: "#fbf9f5",
  },
  // Kept, and neutral-cool. Without a rim the die loses its far edge against the
  // cloth and flattens into a sticker; this is structure, not mood.
  rim: { position: [3.4, 1.6, -4.6], intensity: 0.7, color: "#a9bcc4" },
  // No `flame`, which is what takes the candles out of the frame — Props only
  // builds them where there is a flame to sit on top.
  petals: false,
  envIntensity: 0.88,
  // The die is glossy and mostly mirrors the studio panels, so this is what stops
  // its highlights coming back rose. Very slightly cool, not clinically white.
  envTint: "#eef2f2",
  exposure: 1.02,
};

/**
 * The rooms offered to the person using the app, in the order the picker shows
 * them.
 *
 * `bedside` first because it is the default and the app's own taste. `plain` is
 * deliberately absent: it is the disguise, it is chosen for the user rather than
 * by them, and putting it in a row of aesthetics would advertise the one feature
 * that works by not being noticed.
 */
export const THEMES: Backdrop[] = [bedside, bare, navy, midnight, ember];

/**
 * Every backdrop that ships.
 *
 * Exists so `verify:hue` and `verify:pool` can hold *all* of them to the rules
 * rather than only the default. A second backdrop that nothing checks is a second
 * backdrop that quietly goes brown.
 *
 * Spread from THEMES rather than listed again, so a room cannot be added to the
 * picker and miss the checks — which is the failure this export was written
 * against, and it would be a quiet one.
 */
export const BACKDROPS: Backdrop[] = [...THEMES, plain];

/**
 * The room a saved id names.
 *
 * Falls back rather than throwing, because the id arrives from `localStorage`
 * and may name a room that no longer ships — someone who chose one that was
 * later renamed should get the default room, not a blank screen.
 */
export function themeById(id: string | null | undefined): Backdrop {
  return THEMES.find((theme) => theme.id === id) ?? defaultBackdrop;
}

/**
 * The half-angle a spot will actually be rendered with.
 *
 * One function rather than the choice being made inline in the scene, so
 * `verify:pool` measures the cone the scene draws instead of one it assumes.
 */
export function spotAngle(
  spot: Spot,
  bounds: TrayBounds,
  aimZ: number,
): number {
  return spot.pooled ? poolAngle(spot.position, bounds, aimZ) : spot.angle;
}

export const defaultBackdrop = bedside;
