import { describe, expect, it } from "vitest";
import {
  CELLS,
  at,
  canPlay,
  count,
  flips,
  legalMoves,
  movesFor,
  newBoard,
  play,
  replay,
  type Board,
} from "../../src/games/reversi/core/board.ts";
import { DRAW, EARLY_END, PASS, WIPEOUT } from "./reversi-games.ts";

const game = (moves: number[], starter: 0 | 1 = 0): Board => {
  const b = replay(starter, moves);
  if (!b) throw new Error(`illegal moves ${moves.join(",")}`);
  return b;
};

describe("reversi board", () => {
  it("starts with four discs in the centre and four legal moves", () => {
    const b = newBoard();
    expect(count(b.cells)).toEqual([2, 2]);
    expect(b.cells[at(3, 4)]).toBe(0);
    expect(b.cells[at(4, 3)]).toBe(0);
    expect(b.cells[at(3, 3)]).toBe(1);
    expect(b.cells[at(4, 4)]).toBe(1);
    expect(legalMoves(b)).toEqual([at(2, 3), at(3, 2), at(4, 5), at(5, 4)]);
  });

  it("gives either starter the same opening", () => {
    const b = newBoard(1);
    expect(b.turn).toBe(1);
    expect(b.cells[at(3, 4)]).toBe(1);
    expect(legalMoves(b)).toEqual(legalMoves(newBoard(0)));
  });

  it("flips the outflanked disc and passes the turn", () => {
    const b = game([at(2, 3)]);
    expect(b.cells[at(2, 3)]).toBe(0);
    expect(b.cells[at(3, 3)]).toBe(0);
    expect(count(b.cells)).toEqual([4, 1]);
    expect(b.turn).toBe(1);
    expect(b.passed).toBe(false);
  });

  it("flips in several directions at once, and only up to its own disc", () => {
    const cells = newBoard().cells.fill(null);
    // Seat 0 on the ends of a row, a column and a diagonal through (3,3).
    const mine: [number, number][] = [
      [3, 0],
      [0, 3],
      [0, 0],
    ];
    const theirs: [number, number][] = [
      [3, 1],
      [3, 2],
      [1, 3],
      [2, 3],
      [1, 1],
      [2, 2],
      // A run with no disc of seat 0 behind it: it stays.
      [3, 4],
      [3, 5],
    ];
    for (const [r, c] of mine) cells[at(r, c)] = 0;
    for (const [r, c] of theirs) cells[at(r, c)] = 1;
    expect(flips(cells, at(3, 3), 0).sort((a, b) => a - b)).toEqual(
      [at(1, 1), at(1, 3), at(2, 2), at(2, 3), at(3, 1), at(3, 2)].sort((a, b) => a - b),
    );
    // A run that reaches the edge outflanks nothing.
    expect(flips(cells, at(3, 6), 0)).toEqual([]);
  });

  it("refuses a taken cell, a cell that outflanks nothing and cells off the board", () => {
    const b = newBoard();
    expect(canPlay(b, at(3, 3))).toBe(false);
    expect(play(b, at(3, 3))).toBeNull();
    expect(play(b, at(0, 0))).toBeNull();
    // Next to the other player's disc, but with no disc of its own behind it.
    expect(play(b, at(2, 2))).toBeNull();
    expect(play(b, -1)).toBeNull();
    expect(play(b, CELLS)).toBeNull();
    expect(play(b, 1.5)).toBeNull();
  });

  it("gives the mover another turn when the other player has no move", () => {
    const before = game(PASS.slice(0, -1));
    expect(before.turn).toBe(1);
    const b = game(PASS);
    expect(b.passed).toBe(true);
    expect(b.over).toBe(false);
    expect(b.turn).toBe(1);
    expect(movesFor(b.cells, 0)).toEqual([]);
    expect(legalMoves(b).length).toBeGreaterThan(0);
  });

  it("ends the game when one side has no discs left", () => {
    const b = game(WIPEOUT);
    expect(count(b.cells)).toEqual([13, 0]);
    expect(b.over).toBe(true);
    expect(b.passed).toBe(false);
    expect(b.winner).toBe(0);
    expect(legalMoves(b)).toEqual([]);
    expect(play(b, at(0, 0))).toBeNull();
  });

  it("ends with empty cells when neither player can move, and most discs wins", () => {
    const b = game(EARLY_END);
    expect(count(b.cells)).toEqual([58, 1]);
    expect(b.over).toBe(true);
    expect(b.winner).toBe(0);
    expect(b.draw).toBe(false);
  });

  it("names the winner by seat, whoever started", () => {
    const b = game(WIPEOUT, 1);
    expect(count(b.cells)).toEqual([0, 13]);
    expect(b.winner).toBe(1);
  });

  it("calls equal discs on a full board a draw", () => {
    const b = game(DRAW);
    expect(count(b.cells)).toEqual([32, 32]);
    expect(b.over).toBe(true);
    expect(b.draw).toBe(true);
    expect(b.winner).toBeNull();
  });

  it("replays to the same board and rejects an illegal history", () => {
    let b = newBoard(1);
    for (const cell of PASS) b = play(b, cell)!;
    expect(replay(1, PASS)).toEqual(b);
    expect(replay(0, [at(2, 3), at(2, 3)])).toBeNull();
    expect(replay(0, [at(0, 0)])).toBeNull();
  });
});
