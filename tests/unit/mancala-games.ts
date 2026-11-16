// Whole Mancala games for the tests, found by a seeded random search. Each is
// a legal game from the opening position, as the pits played in order. With
// the other starter, the same pits play the same game with the seats swapped.

/** The starter empties its side in twelve moves and wins 28 to 20, 7 of them swept from the other side. */
export const QUICK = [4, 0, 0, 2, 3, 4, 2, 0, 4, 0, 1, 5];

/** The second player empties its side, the starter sweeps its own 15 seeds, and the second player still wins 25 to 23. */
export const SWEPT = [5, 1, 3, 0, 2, 2, 4, 2, 3, 0, 0, 2, 5];

/** 24 seeds each. */
export const DRAW = [5, 2, 1, 5, 0, 4, 3, 1, 2, 5, 0, 0];

/** The last move captures the last seeds on the board, so nothing is swept: 30 to 18 for the starter. */
export const CLEAN = [2, 1, 5, 4, 3, 2, 4, 3, 3, 5, 5, 2, 1, 4, 2, 1, 4];
