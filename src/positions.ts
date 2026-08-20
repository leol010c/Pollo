/**
 * The six faces.
 *
 * The pictures are discovered from the folder rather than listed here, so the
 * artwork and the code cannot disagree about which files exist. What this file
 * declares is the part a folder cannot: which face of the die each picture is
 * printed on, what it is called, and the one line that goes under the name.
 *
 * Those lines are written to be read across a dim room in one glance. Each says
 * what to *do* rather than describing the drawing, which the drawing is already
 * doing; each names something belonging to that position alone, so no line
 * could be moved to another face without somebody noticing; and each one asks
 * for something. A caption is read once. An instruction is played.
 */

const artwork = import.meta.glob("./assets/dice/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** "./assets/dice/image-3.png" -> "image-3" */
const byStem = new Map(
  Object.entries(artwork).map(([path, url]) => [
    path.split("/").pop()!.replace(/\.png$/, ""),
    url,
  ]),
);

export interface Position {
  value: number;
  name: string;
  line: string;
  src: string;
}

const FACES: { value: number; stem: string; name: string; line: string }[] = [
  {
    value: 1,
    stem: "image-1",
    name: "Blowjob",
    line: "On your knees, hands behind your back. They say when it stops.",
  },
  {
    value: 2,
    stem: "image-2",
    name: "Doggy",
    line: "Face down, hips up. A fistful of hair, and no looking back.",
  },
  {
    value: 3,
    stem: "image-3",
    name: "Missionary",
    line: "Wrists pinned above their head. Nobody touches you until they ask.",
  },
  {
    value: 4,
    stem: "image-4",
    name: "Standing",
    line: "Up against the wall. Their feet touch the floor, you start again.",
  },
  {
    value: 5,
    stem: "image-5",
    name: "Lotus",
    line: "Wrapped up close, barely moving. First to look away loses.",
  },
  {
    value: 6,
    stem: "image-6",
    name: "Reverse Cowgirl",
    line: "They ride facing away. Hands off — let them do all the work.",
  },
];

export const POSITIONS: Position[] = FACES.map(({ value, stem, name, line }) => {
  const src = byStem.get(stem);
  if (!src) throw new Error(`Missing artwork for face ${value}: ${stem}.png`);
  return { value, name, line, src };
});

export function positionFor(value: number): Position {
  const found = POSITIONS.find((position) => position.value === value);
  if (!found) throw new Error(`No position on face ${value}`);
  return found;
}
