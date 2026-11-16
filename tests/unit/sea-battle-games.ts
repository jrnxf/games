// Fleets and whole Sea Battle games for the tests. A game is two fleets plus
// the cells fired at, the starter first and then turn about.

import { at, cellsOf, type Fleet } from "../../src/games/sea-battle/core/board.ts";

/** Every ship along a row from the left edge: rows 0, 2, 4, 6 and 8. The odd rows are open water. */
export const ROWS: Fleet = [
  { cell: at(0, 0), len: 5, down: false },
  { cell: at(2, 0), len: 4, down: false },
  { cell: at(4, 0), len: 3, down: false },
  { cell: at(6, 0), len: 3, down: false },
  { cell: at(8, 0), len: 2, down: false },
];

/** Every ship down a column from the top edge: columns 9, 7, 5, 3 and 1. Ships touch nothing. */
export const COLUMNS: Fleet = [
  { cell: at(0, 9), len: 5, down: true },
  { cell: at(0, 7), len: 4, down: true },
  { cell: at(0, 5), len: 3, down: true },
  { cell: at(0, 3), len: 3, down: true },
  { cell: at(0, 1), len: 2, down: true },
];

/** The cells of every ship in `fleet`, ship by ship: 17 hits that sink it. */
export const decks = (fleet: Fleet) => fleet.flatMap(cellsOf);

/**
 * The starter sinks `target` ship by ship in 17 shots, and the other player
 * answers each shot but the last with a miss along the bottom row, then the
 * row above it. The starter's own fleet must leave rows 9 and 7 open (`ROWS`).
 */
export const rout = (target: Fleet): number[] => {
  const misses = [
    ...Array.from({ length: 10 }, (_, c) => at(9, c)),
    ...Array.from({ length: 10 }, (_, c) => at(7, c)),
  ];
  return decks(target).flatMap((cell, i, all) => (i < all.length - 1 ? [cell, misses[i]!] : [cell]));
};
