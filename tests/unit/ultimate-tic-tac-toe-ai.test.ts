import { describe, expect, it } from "vitest";
import {
  LEVELS,
  bestCells,
  computerMove,
  think,
  type Level,
} from "../../src/games/ultimate-tic-tac-toe/core/ai.ts";
import {
  BOARDS,
  SPOTS,
  at,
  boardOf,
  canPlay,
  isOver,
  legalMoves,
  lineOf,
  newBoard,
  play,
  replay,
  spotOf,
  type Board,
  type Cell,
  type Seat,
} from "../../src/games/ultimate-tic-tac-toe/core/board.ts";
import { SENT_TO_FULL, WIN } from "./ultimate-tic-tac-toe-games.ts";

const levels = Object.keys(LEVELS) as Level[];

/** Levels that never throw a move away. */
const careful = levels.filter((l) => LEVELS[l].mistake === 0);

/** A small board that seat 0 won, one that seat 1 won, one that is full for nobody, and an empty one. */
const X = "XXX......";
const O = "OOO......";
const FULL = "XOXXOOOXX";
const EMPTY = ".........";

/**
 * A position set by hand: nine small boards of nine spots each, "X" for seat
 * 0, "O" for seat 1 and "." for an empty spot. It must not be over.
 */
const position = (boards: string[], turn: Seat, target: number | null): Board => {
  expect(boards).toHaveLength(BOARDS);
  const cells = boards.flatMap((spots) => {
    expect(spots).toHaveLength(SPOTS);
    return [...spots].map((c): Cell => (c === "X" ? 0 : c === "O" ? 1 : null));
  });
  const won = boards.map((_, i): Cell => {
    if (lineOf(cells, 0, at(i, 0)).length) return 0;
    return lineOf(cells, 1, at(i, 0)).length ? 1 : null;
  });
  expect(lineOf(won, 0)).toEqual([]);
  expect(lineOf(won, 1)).toEqual([]);
  return { ...newBoard(turn), cells, won, target };
};

/** A whole game between two levels, never cut short by the clock. Returns the final board. */
const game = (seat0: Level, seat1: Level, seed: number, starter: Seat): Board => {
  let b = newBoard(starter);
  while (!isOver(b)) b = play(b, think(b, b.turn === 0 ? seat0 : seat1, seed, Infinity).cell)!;
  return b;
};

/** How many of `games` seeded games `a` wins against `b`, with each seat and each starter in turn. */
const wins = (a: Level, b: Level, games: number): number => {
  let n = 0;
  for (let seed = 0; seed < games; seed++) {
    const seat = (seed % 2) as Seat;
    const end = game(seat === 0 ? a : b, seat === 0 ? b : a, seed, ((seed >> 1) % 2) as Seat);
    if (end.winner === seat) n++;
  }
  return n;
};

describe("ultimate tic-tac-toe computer", () => {
  it("has a careful level", () => {
    expect(careful).toContain("hard");
  });

  it("takes a win in one", () => {
    // Seat 0 holds small boards 0 and 1, and two marks in a row in board 2.
    const p = position([X, X, "XX.O.O...", EMPTY, O, EMPTY, EMPTY, O, EMPTY], 0, 2);
    expect(legalMoves(p)).toHaveLength(5);
    expect(play(p, at(2, 2))!.winner).toBe(0);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(at(2, 2));
    }
    for (const playouts of [0, 1, 50, 500]) expect(bestCells(p, playouts)).toEqual([at(2, 2)]);
  });

  it("takes a win in one in any open board", () => {
    // The last mark went to a won board, so seat 1 may play anywhere. Only board 8 wins.
    const p = position([O, EMPTY, X, "O.O......", O, EMPTY, X, EMPTY, ".O..O.X.X"], 1, null);
    expect(play(p, at(8, 7))!.winner).toBe(1);
    // Board 3 would be won too, with no line of three boards.
    expect(play(p, at(3, 1))!.winner).toBeNull();
    for (let seed = 0; seed < 20; seed++) expect(computerMove(p, "hard", seed)).toBe(at(8, 7));
  });

  it("does not send the other player to a win in one", () => {
    // Seat 1 holds boards 0 and 1 and needs one mark in board 2. Spot 2 sends
    // them there, and spots 0 and 1 send them to a won board: they play anywhere.
    const p = position([O, O, "OO.X.X...", EMPTY, EMPTY, X, EMPTY, EMPTY, X], 0, 4);
    for (const spot of [0, 1, 2]) {
      const sent = play(p, at(4, spot))!;
      expect(canPlay(sent, at(2, 2))).toBe(true);
      expect(play(sent, at(2, 2))!.winner).toBe(1);
    }
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) {
        const cell = computerMove(p, level, seed);
        expect(boardOf(cell)).toBe(4);
        expect(spotOf(cell)).toBeGreaterThan(2);
      }
    }
    for (const cell of bestCells(p, 50)) expect(spotOf(cell)).toBeGreaterThan(2);
  });

  it("blocks a loss in one", () => {
    // Every other board is closed, so any mark but the block lets seat 1
    // play anywhere, and they complete board 2 and the top row.
    const p = position([O, O, "OO.......", FULL, FULL, FULL, FULL, FULL, FULL], 0, 2);
    expect(legalMoves(p)).toHaveLength(7);
    expect(play(play(p, at(2, 5))!, at(2, 2))!.winner).toBe(1);
    expect(isOver(play(play(p, at(2, 2))!, at(2, 5))!)).toBe(false);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(at(2, 2));
    }
    for (const playouts of [0, 1, 50]) expect(bestCells(p, playouts)).toEqual([at(2, 2)]);
  });

  it("still plays a legal move when every move loses", () => {
    // Seat 1 needs one mark in board 2 or in board 8. Each block sends them
    // to the other board or to a closed one, and so does every other mark.
    const p = position([O, O, "O.XO.....", FULL, O, FULL, FULL, FULL, "OO......."], 0, null);
    expect(legalMoves(p)).toHaveLength(13);
    for (const cell of legalMoves(p)) {
      const sent = play(p, cell)!;
      expect(legalMoves(sent).some((reply) => play(sent, reply)!.winner === 1)).toBe(true);
    }
    for (let seed = 0; seed < 10; seed++) expect(canPlay(p, computerMove(p, "hard", seed))).toBe(true);
    expect(bestCells(p, 0)).toEqual(legalMoves(p));
  });

  it("wins a small board that wins the game two moves later", () => {
    // Spot 2 wins board 3 and sends seat 1 to a won board, so they may play
    // anywhere. Seat 0 then needs one mark in board 6 or in board 8, and a
    // block in one of them leaves seat 0 free to play in the other.
    const p = position([X, O, O, "XX.OO....", X, "XOXOXO...", "X.X.O....", EMPTY, "X.X.O...."], 0, 3);
    expect(bestCells(p, 2_000)).toEqual([at(3, 2)]);
  });

  it("beats Easy and Medium on Hard over many seeded games", () => {
    expect(wins("hard", "easy", 10)).toBeGreaterThanOrEqual(9);
    expect(wins("hard", "medium", 10)).toBeGreaterThanOrEqual(8);
  });

  it("beats Easy on Medium more often than not", () => {
    expect(wins("medium", "easy", 30)).toBeGreaterThan(22);
  });

  it("plays legal moves to the end of whole games at every level", () => {
    for (const level of levels) {
      for (let seed = 0; seed < (level === "hard" ? 1 : 3); seed++) {
        let b = newBoard(seed % 2 === 0 ? 0 : 1);
        while (!isOver(b)) {
          const cell = computerMove(b, level, seed);
          expect(canPlay(b, cell)).toBe(true);
          b = play(b, cell)!;
        }
      }
    }
  });

  it("is deterministic for a given seed while the clock does not stop it", () => {
    const p = replay(0, SENT_TO_FULL)!;
    for (const level of levels) {
      for (let seed = 0; seed < 5; seed++) {
        expect(think(p, level, seed, Infinity).cell).toBe(think(p, level, seed, Infinity).cell);
      }
    }
    // A whole game against itself replays move for move.
    expect(game("easy", "medium", 7, 0).moves.join()).toBe(game("easy", "medium", 7, 0).moves.join());
    expect(game("hard", "medium", 3, 1).moves.join()).toBe(game("hard", "medium", 3, 1).moves.join());
  });

  it("plays the same game from either seat", () => {
    expect(game("hard", "hard", 4, 0).moves).toEqual(game("hard", "hard", 4, 1).moves);
  });

  it("varies with the seed on Easy", () => {
    const picks = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(newBoard(1), "easy", seed)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("plays all its playouts and answers a Hard move quickly", () => {
    // Every move of a whole game. The real budget is ~300 ms on a phone, and a busy build machine is no faster.
    let b = newBoard(0);
    let slowest = 0;
    while (!isOver(b)) {
      const t = think(b, "hard", 5, Infinity);
      expect(t.capped).toBe(false);
      // No search at all for a win in one or a single safe mark.
      expect([0, LEVELS.hard.playouts]).toContain(t.playouts);
      slowest = Math.max(slowest, t.ms);
      b = play(b, t.cell)!;
    }
    expect(slowest).toBeLessThan(300);
  });

  it("stops at the time cap and still plays a legal move", () => {
    const p = replay(0, WIN.slice(0, 6))!;
    // The clock is read after the first batch of playouts, and no time is left.
    const t = think(p, "hard", 1, 0);
    expect(t.capped).toBe(true);
    expect(t.playouts).toBeGreaterThan(0);
    expect(t.playouts).toBeLessThan(LEVELS.hard.playouts);
    expect(canPlay(p, t.cell)).toBe(true);
    for (const level of levels) expect(LEVELS[level].ms).toBeLessThanOrEqual(300);
  });

  it("thinks the same move it plays, with its numbers", () => {
    const p = play(newBoard(0), at(4, 4))!;
    for (const seed of [1, 2, 3]) {
      const t = think(p, "hard", seed, Infinity);
      expect(t.cell).toBe(think(p, "hard", seed, Infinity).cell);
      expect(t.playouts).toBe(LEVELS.hard.playouts);
      expect(t.ms).toBeGreaterThanOrEqual(0);
      expect(t.capped).toBe(false);
    }
    expect(LEVELS.easy.playouts).toBeLessThan(LEVELS.medium.playouts);
    expect(LEVELS.medium.playouts).toBeLessThan(LEVELS.hard.playouts);
  });
});
