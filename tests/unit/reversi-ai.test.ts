import { describe, expect, it } from "vitest";
import { LEVELS, bestCells, computerMove, think, type Level } from "../../src/games/reversi/core/ai.ts";
import {
  at,
  canPlay,
  count,
  legalMoves,
  newBoard,
  play,
  type Board,
  type Cell,
  type Seat,
} from "../../src/games/reversi/core/board.ts";

const levels = Object.keys(LEVELS) as Level[];

/** Levels that never throw a move away. */
const careful = levels.filter((l) => LEVELS[l].mistake === 0);

/** A position drawn by hand: `x` is seat 0, `o` is seat 1, `.` is empty. */
const position = (rows: string[], turn: Seat): Board => ({
  ...newBoard(turn),
  cells: rows
    .join("")
    .split("")
    .map((ch): Cell => (ch === "x" ? 0 : ch === "o" ? 1 : null)),
});

/** A whole game between two levels. Returns the final board. */
const game = (seat0: Level, seat1: Level, seed: number, starter: Seat): Board => {
  let b = newBoard(starter);
  while (!b.over) b = play(b, computerMove(b, b.turn === 0 ? seat0 : seat1, seed))!;
  return b;
};

/** The final disc margin for the player on turn with perfect play, by plain search. */
const solve = (b: Board): number => {
  if (b.over) {
    const n = count(b.cells);
    return n[b.turn] - n[(1 - b.turn) as Seat];
  }
  let best = -Infinity;
  for (const c of legalMoves(b)) {
    const next = play(b, c)!;
    const v = solve(next);
    best = Math.max(best, next.turn === b.turn ? v : -v);
  }
  return best;
};

describe("reversi computer", () => {
  it("has a careful level", () => {
    expect(careful).toContain("hard");
  });

  it("takes a win in one", () => {
    // Seat 0 flips both of seat 1's discs from (1,3), and the game is over.
    const p = position(
      ["........", "xoo.....", ".x......", "........", "........", "........", "........", "........"],
      0,
    );
    expect(legalMoves(p)).toEqual([at(0, 1), at(0, 3), at(1, 3)]);
    expect(play(p, at(1, 3))!.winner).toBe(0);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(at(1, 3));
    }
    for (const depth of [1, 2, 4, 7]) expect(bestCells(p, depth)).toEqual([at(1, 3)]);
  });

  it("blocks a loss in one", () => {
    // Seat 1 may play either end of row 1. At (1,5) it hands seat 0 the whole
    // row from (1,6). At (1,0) it flips the disc that threatens.
    const p = position(
      ["........", ".xoox...", "........", "........", "........", "........", "........", "........"],
      1,
    );
    expect(legalMoves(p)).toEqual([at(1, 0), at(1, 5)]);
    const lost = play(play(p, at(1, 5))!, at(1, 6))!;
    expect(lost.over).toBe(true);
    expect(lost.winner).toBe(0);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(at(1, 0));
    }
    for (const depth of [2, 4, 7]) expect(bestCells(p, depth)).toEqual([at(1, 0)]);
  });

  it("takes a corner over a bigger flip", () => {
    // (0,0) flips one disc; (4,7) flips three.
    const p = position(
      [".ox.....", "........", "........", "........", "...xooo.", "........", "........", "........"],
      0,
    );
    expect(legalMoves(p)).toEqual([at(0, 0), at(4, 7)]);
    expect(bestCells(p, 1)).toEqual([at(0, 0)]);
  });

  it("plays a perfect endgame on Hard", () => {
    // Positions with 8 empty cells, from games between weaker levels.
    for (let seed = 0; seed < 6; seed++) {
      let b = newBoard((seed % 2) as Seat);
      while (!b.over && b.cells.filter((c) => c === null).length > 8) {
        b = play(b, computerMove(b, b.turn === 0 ? "easy" : "medium", seed))!;
      }
      if (b.over) continue;
      const next = play(b, computerMove(b, "hard", seed))!;
      const got = next.turn === b.turn ? solve(next) : -solve(next);
      // The computer counts empty cells for the winner, so only the result must match.
      expect(Math.sign(got)).toBe(Math.sign(solve(b)));
    }
  });

  it("beats Easy on Hard over many seeded games", () => {
    let wins = 0;
    const games = 10;
    for (let seed = 0; seed < games; seed++) {
      // Hard sits in each seat, and each seat starts, in turn.
      const hard = (seed % 2) as Seat;
      const b = game(
        hard === 0 ? "hard" : "easy",
        hard === 0 ? "easy" : "hard",
        seed,
        ((seed >> 1) % 2) as Seat,
      );
      if (b.winner === hard) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(games - 1);
  });

  it("beats Easy on Medium more often than not", () => {
    let wins = 0;
    const games = 20;
    for (let seed = 0; seed < games; seed++) {
      const medium = (seed % 2) as Seat;
      const b = game(
        medium === 0 ? "medium" : "easy",
        medium === 0 ? "easy" : "medium",
        seed,
        ((seed >> 1) % 2) as Seat,
      );
      if (b.winner === medium) wins++;
    }
    expect(wins).toBeGreaterThan(games / 2);
  });

  it("plays legal moves to the end of whole games at every level", () => {
    for (const level of levels) {
      // One game is enough for Hard: it throws no move away, and its games are slow.
      for (let seed = 0; seed < (level === "hard" ? 1 : 3); seed++) {
        let b = newBoard(seed % 2 === 0 ? 0 : 1);
        while (!b.over) {
          const cell = computerMove(b, level, seed);
          expect(canPlay(b, cell)).toBe(true);
          b = play(b, cell)!;
        }
      }
    }
  });

  it("is deterministic for a given seed", () => {
    for (const level of levels) {
      for (let seed = 0; seed < 20; seed++) {
        expect(computerMove(newBoard(0), level, seed)).toBe(computerMove(newBoard(0), level, seed));
      }
    }
    // A whole game against itself replays move for move.
    expect(game("easy", "medium", 7, 0).moves.join()).toBe(game("easy", "medium", 7, 0).moves.join());
    expect(game("hard", "medium", 3, 1).moves.join()).toBe(game("hard", "medium", 3, 1).moves.join());
  });

  it("varies with the seed on Easy", () => {
    const p = newBoard(1);
    const picks = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(p, "easy", seed)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("stays within its budget and answers a Hard move quickly", () => {
    // Every move of a whole game; the real budget is ~300 ms on a phone.
    let b = newBoard(0);
    let slowest = 0;
    while (!b.over) {
      const t = think(b, "hard", 5);
      // The first pass is never cut short, and it scores one position per move.
      expect(t.positions).toBeLessThanOrEqual(LEVELS.hard.budget + 64);
      expect(t.depth).toBeGreaterThanOrEqual(1);
      slowest = Math.max(slowest, t.ms);
      b = play(b, t.cell)!;
    }
    expect(slowest).toBeLessThan(150);
  });

  it("thinks the same move it plays, with its numbers", () => {
    const p = play(newBoard(0), legalMoves(newBoard(0))[0]!)!;
    for (const seed of [1, 2, 3]) {
      const t = think(p, "hard", seed);
      expect(t.cell).toBe(computerMove(p, "hard", seed));
      expect(t.positions).toBeGreaterThan(0);
      expect(t.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("searches to the end when few cells are left", () => {
    let b = newBoard(0);
    while (!b.over && b.cells.filter((c) => c === null).length > LEVELS.hard.exact) {
      b = play(b, computerMove(b, "medium", 2))!;
    }
    expect(b.over).toBe(false);
    const t = think(b, "hard", 2);
    expect(t.depth).toBeGreaterThan(LEVELS.hard.depth);
  });
});
