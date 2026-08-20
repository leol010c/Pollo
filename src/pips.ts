/**
 * Where the pips go, for a value from one to six.
 *
 * Cells of a three-by-three grid, read left to right and top to bottom. One
 * table, used twice: painted small into the corner of every face of the die, and
 * laid out in the strip along the top of the placard. A die that showed one
 * arrangement and a placard that showed another would be two objects.
 */
export const PIP_CELLS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function pipCells(value: number): readonly number[] {
  return PIP_CELLS[value] ?? [];
}
