import { describe, expect, it } from "vitest";
import {
  BOARDS,
  CELLS,
  LINES,
  at,
  boardOf,
  canPlay,
  count,
  isFull,
  isOpen,
  isOver,
  legalMoves,
  lineOf,
  newBoard,
  openBoards,
  play,
  replay,
  spotOf,
  type Board,
  type Cell,
} from "../../src/games/ultimate-tic-tac-toe/core/board.ts";
import { DRAW, SENT_TO_FULL, SENT_TO_WON, WIN } from "./ultimate-tic-tac-toe-games.ts";

const game = (moves: number[], starter: 0 | 1 = 0): Board => {
  const b = replay(starter, moves);
  if (!b) throw new Error(`illegal moves ${moves.join(",")}`);
  return b;
};

const ALL = Array.from({ length: BOARDS }, (_, i) => i);

describe("ultimate tic-tac-toe board", () => {
  it("starts empty, and the starter may play anywhere", () => {
    const b = newBoard();
    expect(b.cells).toHaveLength(CELLS);
    expect(b.cells.every((c) => c === null)).toBe(true);
    expect(b.turn).toBe(0);
    expect(b.target).toBeNull();
    expect(openBoards(b)).toEqual(ALL);
    expect(legalMoves(b)).toHaveLength(CELLS);
    expect(newBoard(1).turn).toBe(1);
  });

  it("numbers a cell by its small board and its spot", () => {
    expect(at(0, 0)).toBe(0);
    expect(at(4, 5)).toBe(41);
    expect(at(8, 8)).toBe(CELLS - 1);
    expect(boardOf(41)).toBe(4);
    expect(spotOf(41)).toBe(5);
  });

  it("sends the other player to the small board that matches the spot", () => {
    const b = game([at(4, 5)]);
    expect(b.cells[at(4, 5)]).toBe(0);
    expect(b.turn).toBe(1);
    expect(b.target).toBe(5);
    expect(openBoards(b)).toEqual([5]);
    expect(legalMoves(b)).toEqual(ALL.map((s) => at(5, s)));
    // A mark on the spot of its own board keeps the game in that board.
    const same = game([at(4, 4)]);
    expect(same.target).toBe(4);
    expect(legalMoves(same)).toEqual(ALL.filter((s) => s !== 4).map((s) => at(4, s)));
  });

  it("refuses a cell outside the target board, a taken cell and cells off the board", () => {
    const b = game([at(4, 5)]);
    expect(canPlay(b, at(4, 0))).toBe(false);
    expect(play(b, at(4, 0))).toBeNull();
    expect(play(b, at(0, 5))).toBeNull();
    const next = play(b, at(5, 4))!;
    expect(next.target).toBe(4);
    expect(play(next, at(4, 5))).toBeNull();
    expect(play(b, -1)).toBeNull();
    expect(play(b, CELLS)).toBeNull();
    expect(play(b, 1.5)).toBeNull();
  });

  it("finds each of the eight lines, for the seat that holds it only", () => {
    for (const line of LINES) {
      const marks = Array<Cell>(9).fill(null);
      for (const i of line) marks[i] = 1;
      expect(lineOf(marks, 1)).toEqual([...line]);
      expect(lineOf(marks, 0)).toEqual([]);
      marks[line[1]] = 0;
      expect(lineOf(marks, 1)).toEqual([]);
    }
  });

  it("gives a small board to the player who makes three in a row in it", () => {
    const before = game(SENT_TO_WON.slice(0, 4));
    expect(before.won.every((w) => w === null)).toBe(true);
    const b = play(before, at(4, 8))!;
    expect(b.won[4]).toBe(0);
    expect(count(b.won)).toEqual([1, 0]);
    expect(isOpen(b, 4)).toBe(false);
    expect(isFull(b.cells, 4)).toBe(false);
    expect(isOver(b)).toBe(false);
    // The mark was on spot 8, and board 8 is open.
    expect(b.target).toBe(8);
  });

  it("lets a player sent to a won board play in any open board", () => {
    const b = game(SENT_TO_WON);
    expect(spotOf(SENT_TO_WON.at(-1)!)).toBe(4);
    expect(b.turn).toBe(0);
    expect(b.target).toBeNull();
    expect(openBoards(b)).toEqual(ALL.filter((i) => i !== 4));
    expect(legalMoves(b).some((c) => boardOf(c) === 4)).toBe(false);
    // The won board has empty spots, and it takes no more marks.
    expect(b.cells[at(4, 0)]).toBeNull();
    expect(play(b, at(4, 0))).toBeNull();
    expect(play(b, at(0, 0))?.target).toBe(0);
  });

  it("lets a player sent to a full board play in any open board", () => {
    const before = game(SENT_TO_FULL.slice(0, -1));
    expect(isFull(before.cells, 8)).toBe(true);
    expect(before.won[8]).toBeNull();
    expect(isOpen(before, 8)).toBe(false);
    const b = game(SENT_TO_FULL);
    expect(spotOf(SENT_TO_FULL.at(-1)!)).toBe(8);
    expect(b.target).toBeNull();
    expect(openBoards(b)).toEqual(ALL.filter((i) => i !== 8));
    expect(legalMoves(b)).toHaveLength(55);
    expect(count(b.won)).toEqual([0, 0]);
  });

  it("ends the game when a player holds three small boards in a row", () => {
    const before = game(WIN.slice(0, -1));
    expect(isOver(before)).toBe(false);
    const b = game(WIN);
    expect(b.winner).toBe(0);
    expect(b.line).toEqual([2, 4, 6]);
    expect(b.draw).toBe(false);
    expect(count(b.won)).toEqual([3, 1]);
    expect(isOver(b)).toBe(true);
    expect(b.target).toBeNull();
    expect(openBoards(b)).toEqual([]);
    expect(legalMoves(b)).toEqual([]);
    const empty = b.cells.indexOf(null);
    expect(canPlay(b, empty)).toBe(false);
    expect(play(b, empty)).toBeNull();
  });

  it("names the winner by seat, whoever started", () => {
    const b = game(WIN, 1);
    expect(b.winner).toBe(1);
    expect(count(b.won)).toEqual([1, 3]);
  });

  it("calls it a draw when no board is open and nobody has a line, however many boards each holds", () => {
    const before = game(DRAW.slice(0, -1));
    expect(isOver(before)).toBe(false);
    const b = game(DRAW);
    expect(b.draw).toBe(true);
    expect(b.winner).toBeNull();
    expect(b.line).toEqual([]);
    expect(count(b.won)).toEqual([5, 3]);
    // The full board nobody won counts for nobody.
    expect(b.won[4]).toBeNull();
    expect(isFull(b.cells, 4)).toBe(true);
    expect(legalMoves(b)).toEqual([]);
    expect(play(b, b.cells.indexOf(null))).toBeNull();
  });

  it("replays to the same board and rejects an illegal history", () => {
    let b = newBoard(1);
    for (const cell of SENT_TO_FULL) b = play(b, cell)!;
    expect(replay(1, SENT_TO_FULL)).toEqual(b);
    expect(replay(0, [at(4, 5), at(4, 0)])).toBeNull();
    expect(replay(0, [at(4, 5), at(5, 4), at(4, 5)])).toBeNull();
    expect(replay(0, [CELLS])).toBeNull();
  });

  it("plays random games to an end with every rule intact", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
    for (let g = 0; g < 200; g++) {
      let b = newBoard((g % 2) as 0 | 1);
      while (!isOver(b)) {
        const moves = legalMoves(b);
        expect(moves.length).toBeGreaterThan(0);
        for (const c of moves) expect(canPlay(b, c)).toBe(true);
        if (b.target !== null) expect(isOpen(b, b.target)).toBe(true);
        const mover = b.turn;
        b = play(b, moves[Math.floor(rand() * moves.length)]!)!;
        if (!isOver(b)) expect(b.turn).toBe(1 - mover);
      }
      expect(b.moves.length).toBeLessThanOrEqual(CELLS);
      if (b.winner !== null) expect(b.line.every((i) => b.won[i] === b.winner)).toBe(true);
      else expect(ALL.every((i) => !isOpen(b, i))).toBe(true);
    }
  });
});
