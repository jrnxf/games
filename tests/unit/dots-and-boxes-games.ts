// Whole Dots and Boxes games as lists of lines, shared by the unit tests and
// the browser tests.

import { LINES, across, down } from "../../src/games/dots-and-boxes/core/board.ts";

/**
 * Every line in line order. The 30 horizontal lines close nothing. Then each
 * row of vertical lines starts with one that closes nothing, and the next
 * player closes the row's five boxes. The rows alternate, so the second
 * player takes three rows and the starter two: 15 to 10.
 */
export const SWEEP: number[] = Array.from({ length: LINES }, (_, i) => i);

/**
 * The starter draws three sides of the top-left box, with the other player
 * drawing far away in between, and the other player then closes it and plays
 * again.
 */
export const GIFT: number[] = [
  across(0, 0),
  across(5, 4),
  down(0, 0),
  across(5, 3),
  across(1, 0),
  down(0, 1),
];

/** One line that closes two boxes at once: the wall between the two top-left boxes, drawn last. */
export const DOUBLE: number[] = [
  across(0, 0),
  across(0, 1),
  across(1, 0),
  across(1, 1),
  down(0, 0),
  down(0, 2),
  across(5, 4),
  down(0, 1),
];
