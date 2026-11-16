// Whole Ultimate Tic-Tac-Toe games for the tests, found by a seeded random
// search. Each is a legal game from the empty board, as the cells played in
// order. With the other starter, the same cells play the same game with the
// seats swapped.

/** The starter wins small board 4 on the fifth mark, and the sixth mark sends them to it. */
export const SENT_TO_WON = [41, 49, 38, 22, 44, 76];

/** Small board 8 is full with no line when the 25th mark is down, and the 26th sends the starter to it. */
export const SENT_TO_FULL = [
  78, 54, 8, 76, 42, 62, 77, 53, 75, 27, 0, 2, 26, 74, 23, 48, 35, 79, 67, 44, 80, 72, 7, 71, 73, 17,
];

/** The starter wins small boards 2, 4 and 6, a diagonal, in 23 marks. The second player holds board 8. */
export const WIN = [18, 0, 6, 58, 38, 22, 41, 48, 35, 76, 44, 78, 56, 25, 71, 74, 19, 13, 62, 17, 59, 47, 20];

/** No open board is left and nobody has a line: the starter holds five boards, the second player three, and board 4 is full for nobody. */
export const DRAW = [
  65, 22, 38, 23, 48, 29, 20, 21, 33, 58, 44, 79, 67, 41, 51, 59, 45, 5, 11, 77, 13, 37, 17, 80, 76, 36, 6,
  55, 15, 57, 35, 73, 40, 42, 2, 28, 4, 43, 69, 72, 34, 78, 39,
];
