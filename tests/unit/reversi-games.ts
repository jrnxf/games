// Whole Reversi games for the tests, found by a seeded random search. Each is
// a legal game from the opening position, as the cells played in order. With
// the other starter, the same cells play the same game with the seats swapped.

/** The eighth disc, the second player's fourth, leaves the starter with no move. */
export const PASS = [37, 45, 19, 38, 39, 31, 53, 47];

/** The starter takes every disc in nine moves: 13 to 0. */
export const WIPEOUT = [26, 34, 45, 19, 10, 17, 33, 25, 24];

/** A full board with 32 discs each. */
export const DRAW = [
  19, 20, 13, 12, 21, 34, 44, 26, 4, 22, 31, 3, 14, 6, 17, 30, 2, 42, 43, 52, 53, 54, 39, 11, 50, 49, 62, 18,
  46, 38, 10, 25, 51, 29, 56, 16, 23, 57, 24, 59, 8, 37, 60, 9, 1, 15, 5, 47, 45, 61, 7, 0, 58, 32, 63, 55,
  41, 48, 40, 33,
];

/** Neither player can move with five cells still empty: 58 to 1 for the starter. */
export const EARLY_END = [
  26, 20, 45, 44, 53, 42, 43, 50, 37, 34, 41, 46, 47, 51, 38, 25, 52, 62, 16, 29, 13, 61, 60, 39, 58, 54, 31,
  24, 30, 59, 55, 49, 17, 18, 63, 19, 56, 40, 11, 12, 32, 14, 48, 10, 3, 4, 33, 9, 0, 8, 1, 22, 15, 2, 5,
];
