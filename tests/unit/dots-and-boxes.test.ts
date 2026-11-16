import { describe, expect, it } from "vitest";
import {
  BOXES,
  BOX_LINES,
  LINES,
  LINE_BOXES,
  across,
  at,
  canPlay,
  closes,
  down,
  legalMoves,
  lineAt,
  newBoard,
  play,
  replay,
  sides,
  type Board,
} from "../../src/games/dots-and-boxes/core/board.ts";
import { DOUBLE, GIFT, SWEEP } from "./dots-and-boxes-games.ts";

const game = (moves: number[], starter: 0 | 1 = 0): Board => {
  const b = replay(starter, moves);
  if (!b) throw new Error(`illegal moves ${moves.join(",")}`);
  return b;
};

describe("dots and boxes board", () => {
  it("starts empty, with 60 lines to draw and the starter to move", () => {
    const b = newBoard();
    expect(LINES).toBe(60);
    expect(BOXES).toBe(25);
    expect(legalMoves(b)).toHaveLength(60);
    expect(b.score).toEqual([0, 0]);
    expect(b.turn).toBe(0);
    expect(newBoard(1).turn).toBe(1);
  });

  it("numbers every line once, and maps a line back to its dot", () => {
    const seen = new Set<number>();
    for (let r = 0; r <= 5; r++) for (let c = 0; c < 5; c++) seen.add(across(r, c));
    for (let r = 0; r < 5; r++) for (let c = 0; c <= 5; c++) seen.add(down(r, c));
    expect(seen.size).toBe(LINES);
    expect(Math.max(...seen)).toBe(LINES - 1);
    expect(lineAt(across(5, 4))).toEqual({ across: true, row: 5, col: 4 });
    expect(lineAt(down(4, 5))).toEqual({ across: false, row: 4, col: 5 });
  });

  it("gives each box four lines, and each line one box on the rim or two inside", () => {
    expect(BOX_LINES[at(2, 3)]).toEqual([across(2, 3), across(3, 3), down(2, 3), down(2, 4)]);
    expect(LINE_BOXES[across(0, 2)]).toEqual([at(0, 2)]);
    expect(LINE_BOXES[down(4, 5)]).toEqual([at(4, 4)]);
    expect(LINE_BOXES[across(2, 1)]).toEqual([at(1, 1), at(2, 1)]);
    expect(LINE_BOXES[down(3, 2)]).toEqual([at(3, 1), at(3, 2)]);
    expect(LINE_BOXES.filter((boxes) => boxes.length === 1)).toHaveLength(20);
    expect(LINE_BOXES.filter((boxes) => boxes.length === 2)).toHaveLength(40);
  });

  it("passes the turn after a line that closes nothing", () => {
    const b = game([across(0, 0)]);
    expect(b.lines[across(0, 0)]).toBe(0);
    expect(b.turn).toBe(1);
    expect(b.again).toBe(false);
    expect(sides(b.lines, at(0, 0))).toBe(1);
    expect(legalMoves(b)).toHaveLength(59);
  });

  it("refuses a drawn line, a line off the board and a line that is not a whole number", () => {
    const b = game([across(0, 0)]);
    expect(canPlay(b, across(0, 0))).toBe(false);
    expect(play(b, across(0, 0))).toBeNull();
    expect(play(b, -1)).toBeNull();
    expect(play(b, LINES)).toBeNull();
    expect(play(b, 1.5)).toBeNull();
    expect(play(b, Number.NaN)).toBeNull();
    expect(replay(0, [3, 3])).toBeNull();
  });

  it("scores a closed box for the mover and gives them another turn", () => {
    const before = game(GIFT.slice(0, -1));
    expect(before.turn).toBe(1);
    expect(closes(before.lines, down(0, 1))).toEqual([at(0, 0)]);
    const b = game(GIFT);
    expect(b.boxes[at(0, 0)]).toBe(1);
    expect(b.score).toEqual([0, 1]);
    expect(b.turn).toBe(1);
    expect(b.again).toBe(true);
    // The extra turn ends with a line that closes nothing.
    const next = play(b, across(5, 0))!;
    expect(next.turn).toBe(0);
    expect(next.again).toBe(false);
  });

  it("closes two boxes with one line", () => {
    const before = game(DOUBLE.slice(0, -1));
    expect(closes(before.lines, down(0, 1))).toEqual([at(0, 0), at(0, 1)]);
    const b = game(DOUBLE);
    expect(b.boxes[at(0, 0)]).toBe(1);
    expect(b.boxes[at(0, 1)]).toBe(1);
    expect(b.score).toEqual([0, 2]);
    expect(b.turn).toBe(1);
  });

  it("ends when every line is drawn, and the most boxes wins", () => {
    const almost = game(SWEEP.slice(0, -1));
    expect(almost.over).toBe(false);
    expect(almost.winner).toBeNull();
    const b = game(SWEEP);
    expect(b.over).toBe(true);
    expect(b.again).toBe(false);
    expect(b.score).toEqual([10, 15]);
    expect(b.winner).toBe(1);
    // The rows alternate: the second player closes rows 0, 2 and 4.
    expect(b.boxes.map((box, i) => box === (Math.floor(i / 5) % 2 === 0 ? 1 : 0)).every(Boolean)).toBe(true);
    expect(legalMoves(b)).toEqual([]);
    expect(play(b, 0)).toBeNull();
  });

  it("plays the same game with the seats swapped when the other seat starts", () => {
    const b = game(SWEEP, 1);
    expect(b.score).toEqual([15, 10]);
    expect(b.winner).toBe(0);
  });

  it("always shares out all 25 boxes, so a finished game has a winner", () => {
    // A fixed shuffle of the lines: a different order, the same total.
    const order = SWEEP.map((line) => (line * 7 + 11) % LINES);
    expect(new Set(order).size).toBe(LINES);
    const b = game(order);
    expect(b.over).toBe(true);
    expect(b.score[0] + b.score[1]).toBe(BOXES);
    expect(b.winner).toBe(b.score[0] > b.score[1] ? 0 : 1);
    expect(b.boxes.filter((box) => box === 0)).toHaveLength(b.score[0]);
  });

  it("replays to the same board, and never changes the board it plays from", () => {
    const b = newBoard();
    const next = play(b, across(2, 2))!;
    expect(b.lines[across(2, 2)]).toBeNull();
    expect(b.moves).toEqual([]);
    expect(replay(0, next.moves)).toEqual(next);
    expect(replay(1, GIFT)).toEqual(game(GIFT, 1));
  });
});
