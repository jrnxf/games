import { describe, expect, it } from "vitest";
import {
  COLS,
  ROWS,
  at,
  canDrop,
  drop,
  landingRow,
  newBoard,
  replay,
  type Board,
} from "../../src/games/connect-four/core/board.ts";

const play = (cols: number[], starter: 0 | 1 = 0): Board => {
  const b = replay(starter, cols);
  if (!b) throw new Error(`illegal moves ${cols.join(",")}`);
  return b;
};

describe("connect four board", () => {
  it("drops chips to the lowest free row and alternates turns", () => {
    const b = play([3, 3]);
    expect(b.cells[at(ROWS - 1, 3)]).toBe(0);
    expect(b.cells[at(ROWS - 2, 3)]).toBe(1);
    expect(b.turn).toBe(0);
    expect(landingRow(b, 3)).toBe(ROWS - 3);
  });

  it("lets either seat start", () => {
    const b = play([0], 1);
    expect(b.cells[at(ROWS - 1, 0)]).toBe(1);
    expect(b.turn).toBe(0);
  });

  it("refuses a full column and columns off the board", () => {
    const b = play([2, 2, 2, 2, 2, 2]);
    expect(canDrop(b, 2)).toBe(false);
    expect(drop(b, 2)).toBeNull();
    expect(drop(b, -1)).toBeNull();
    expect(drop(b, COLS)).toBeNull();
    expect(drop(b, 1.5)).toBeNull();
  });

  it("finds a horizontal win", () => {
    const b = play([0, 0, 1, 1, 2, 2, 3]);
    expect(b.winner).toBe(0);
    expect(b.line).toEqual([at(5, 0), at(5, 1), at(5, 2), at(5, 3)]);
    expect(b.turn).toBe(0);
  });

  it("finds a vertical win", () => {
    const b = play([4, 5, 4, 5, 4, 5, 4]);
    expect(b.winner).toBe(0);
    expect(b.line).toHaveLength(4);
  });

  it("finds both diagonals", () => {
    // Rising to the right: seat 0 on (5,0) (4,1) (3,2) (2,3).
    const up = play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(up.winner).toBe(0);
    expect(up.line).toEqual([at(2, 3), at(3, 2), at(4, 1), at(5, 0)]);
    // Falling to the right: the mirror image.
    const down = play([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    expect(down.winner).toBe(0);
  });

  it("counts a run longer than four, and the middle chip can complete it", () => {
    const b = play([0, 0, 1, 1, 4, 4, 5, 6, 2, 6, 3]);
    expect(b.winner).toBe(0);
    expect(b.line).toHaveLength(6);
  });

  it("stops the game after a win", () => {
    const b = play([0, 0, 1, 1, 2, 2, 3]);
    expect(canDrop(b, 6)).toBe(false);
    expect(drop(b, 6)).toBeNull();
  });

  it("calls a full board with no line a draw", () => {
    // Columns filled in pairs so no four ever line up.
    const order = [0, 1, 2, 3, 4, 5, 6].flatMap((c) => Array<number>(ROWS).fill(c));
    const cols = [
      0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5,
      4, 6, 6, 6, 6, 6, 6,
    ];
    expect(cols.slice().sort()).toEqual(order.slice().sort());
    const b = play(cols);
    expect(b.winner).toBeNull();
    expect(b.draw).toBe(true);
    expect(canDrop(b, 6)).toBe(false);
  });

  it("replays to the same board and rejects an illegal history", () => {
    const moves = [3, 2, 3, 4, 1];
    let b = newBoard(1);
    for (const c of moves) b = drop(b, c)!;
    expect(replay(1, moves)).toEqual(b);
    expect(replay(0, [0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});
