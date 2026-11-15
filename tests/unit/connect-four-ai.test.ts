import { describe, expect, it } from "vitest";
import {
  LEVELS,
  bestColumns,
  computerMove,
  rng,
  think,
  winIn,
  type Level,
} from "../../src/games/connect-four/core/ai.ts";
import {
  canDrop,
  drop,
  isOver,
  newBoard,
  replay,
  type Board,
} from "../../src/games/connect-four/core/board.ts";

const play = (cols: number[], starter: 0 | 1 = 0): Board => {
  const b = replay(starter, cols);
  if (!b) throw new Error(`illegal moves ${cols.join(",")}`);
  return b;
};

/** Levels that never throw a move away. */
const careful = (Object.keys(LEVELS) as Level[]).filter((l) => LEVELS[l].mistake === 0);

describe("connect four computer", () => {
  it("has a careful level", () => {
    expect(careful).toContain("hard");
  });

  it("takes an immediate win", () => {
    // Seat 1 to move, with three stacked in column 6.
    const p = play([0, 6, 1, 6, 4, 6, 0]);
    expect(p.turn).toBe(1);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(6);
    }
    // Every depth sees a win in one.
    for (const depth of [1, 2, 4, 9]) expect(bestColumns(p, depth)).toEqual([6]);
  });

  it("blocks an immediate loss", () => {
    // Seat 0 has 0, 1, 2 along the bottom; seat 1 must take 3.
    const p = play([0, 6, 1, 6, 2]);
    expect(p.turn).toBe(1);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(3);
    }
    for (const depth of [2, 4, 9]) expect(bestColumns(p, depth)).toEqual([3]);
  });

  it("blocks a win in one even when it faces two threats after", () => {
    // Seat 0 has three in column 0. Seat 1 playing 2 would make two threats
    // along the bottom, but seat 0 wins in column 0 first, so 0 is the only move.
    const p = play([0, 3, 0, 4, 0]);
    expect(p.turn).toBe(1);
    for (const depth of [2, 4, 9]) expect(bestColumns(p, depth)).toEqual([0]);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(0);
    }
  });

  it("prefers its own win to a block", () => {
    // Both have three; seat 1 to move wins in column 6 rather than blocking column 3.
    const p = play([0, 6, 1, 6, 2, 6]);
    expect(p.turn).toBe(0);
    const q = drop(p, 5)!; // seat 0 throws its win away
    expect(computerMove(q, "hard", 1)).toBe(6);
  });

  it("never plays a full column", () => {
    // Columns 0, 3 and 6 full, without a winner.
    const p = play([0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 6, 6, 6, 6, 6, 6]);
    expect(isOver(p)).toBe(false);
    for (const level of Object.keys(LEVELS) as Level[]) {
      for (let seed = 0; seed < 200; seed++) {
        const c = computerMove(p, level, seed);
        expect(canDrop(p, c)).toBe(true);
      }
    }
  });

  it("plays legal moves to the end of whole games at every level", () => {
    for (const level of Object.keys(LEVELS) as Level[]) {
      for (let seed = 0; seed < 4; seed++) {
        let b = newBoard(seed % 2 === 0 ? 0 : 1);
        while (!isOver(b)) {
          const next = drop(b, computerMove(b, level, seed));
          expect(next).not.toBeNull();
          b = next!;
        }
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const p = play([3, 3, 2]);
    for (const level of Object.keys(LEVELS) as Level[]) {
      for (let seed = 0; seed < 50; seed++) {
        expect(computerMove(p, level, seed)).toBe(computerMove(play([3, 3, 2]), level, seed));
      }
    }
    // A whole game against itself replays move for move.
    const game = (seed: number) => {
      let b = newBoard(0);
      while (!isOver(b)) b = drop(b, computerMove(b, b.turn === 0 ? "easy" : "medium", seed))!;
      return b.moves.join();
    };
    expect(game(7)).toBe(game(7));
  });

  it("varies with the seed on Easy", () => {
    const p = newBoard(1);
    const picks = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(p, "easy", seed)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("has a seeded generator that repeats and stays in [0, 1)", () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("answers a Hard move quickly", () => {
    // A busy middle game; the real budget is ~150 ms on a phone.
    const p = play([3, 3, 2, 4, 4, 2, 5, 1]);
    const t = performance.now();
    computerMove(p, "hard", 3);
    expect(performance.now() - t).toBeLessThan(150);
  });

  it("thinks the same move it plays, with its numbers", () => {
    const p = play([6, 3, 3, 3, 6]);
    for (const seed of [1, 2, 3]) {
      const t = think(p, "hard", seed);
      expect(t.col).toBe(computerMove(p, "hard", seed));
      expect(t.positions).toBe(51674);
      expect(t.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("counts the chips to a forced win, its own chip included", () => {
    const p = play([0, 6, 1, 6, 4, 6, 0]);
    const t = think(p, "hard", 1);
    expect(t.col).toBe(6);
    expect(t.win).toBe(1);
    expect(think(newBoard(0), "hard", 1).win).toBeNull();
    expect(winIn(5, 9)).toBeNull();
  });
});
