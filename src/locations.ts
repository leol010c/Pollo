/**
 * The six places.
 *
 * There is no artwork for these and there should not be: a location is a word
 * you already have a picture of. The die prints them, which makes it a
 * different object from the position die at a glance — one carries drawings,
 * the other carries type — and it is why the deck is declared here in full
 * rather than discovered from a folder.
 *
 * The lines follow the same rule as the positions: each names something only
 * that place has, and each asks for something. "Bed" on its own is where you
 * were going anyway, and a die that can land on "where you were going anyway"
 * has one dead face.
 */

export interface Location {
  value: number;
  /** Short enough to print across a face of a die you are looking down at. */
  name: string;
  line: string;
}

export const LOCATIONS: Location[] = [
  {
    value: 1,
    name: "Bed",
    line: "Strip it to the sheet first. Nothing to hide under afterwards.",
  },
  {
    value: 2,
    name: "Sofa",
    line: "Sitting room, lamps on. Whatever's playing stays on.",
  },
  {
    value: 3,
    name: "Floor",
    line: "Wherever you're standing when you read this. Nothing goes underneath you.",
  },
  {
    value: 4,
    name: "Shower",
    line: "Water hot as you'll both take it, and it stays on until you're done.",
  },
  {
    value: 5,
    name: "Kitchen",
    line: "On the counter, everything swept aside. Neither of you gets to be careful.",
  },
  {
    value: 6,
    name: "Stairs",
    line: "Halfway up, and nobody makes it to the top. Hold the rail.",
  },
];

export function locationFor(value: number): Location {
  const found = LOCATIONS.find((location) => location.value === value);
  if (!found) throw new Error(`No location on face ${value}`);
  return found;
}
