import { describe, expect, it } from "vitest";
import { LEVELS, bestPits, computerMove, think, type Level } from "../../src/games/mancala/core/ai.ts";
import {
  TOTAL,
  canPlay,
  inPits,
  legalMoves,
  newBoard,
  play,
  score,
  type Board,
  type Seat,
} from "../../src/games/mancala/core/board.ts";

const levels = Object.keys(LEVELS) as Level[];

/** Levels that never throw a move away. */
const careful = levels.filter((l) => LEVELS[l].mistake === 0);

/** A position set by hand: each side's pits from its left, and its store. */
const position = (pits0: number[], store0: number, pits1: number[], store1: number, turn: Seat): Board => {
  const holes = [...pits0, store0, ...pits1, store1];
  expect(holes.reduce((a, n) => a + n, 0)).toBe(TOTAL);
  return { ...newBoard(turn), holes };
};

/** A whole game between two levels. Returns the final board. */
const game = (seat0: Level, seat1: Level, seed: number, starter: Seat): Board => {
  let b = newBoard(starter);
  while (!b.over) b = play(b, computerMove(b, b.turn === 0 ? seat0 : seat1, seed))!;
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

/** The final seed margin for the player on turn with perfect play, by plain search. */
const solve = (b: Board, memo = new Map<string, number>()): number => {
  if (b.over) return score(b, b.turn) - score(b, (1 - b.turn) as Seat);
  const key = `${b.turn}:${b.holes.join()}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  let best = -Infinity;
  for (const pit of legalMoves(b)) {
    const next = play(b, pit)!;
    const v = solve(next, memo);
    best = Math.max(best, next.turn === b.turn ? v : -v);
  }
  memo.set(key, best);
  return best;
};

describe("mancala computer", () => {
  it("has a careful level", () => {
    expect(careful).toContain("hard");
  });

  it("takes a win in one", () => {
    // Pit 0's seed lands in the empty pit 1 and captures the six seeds
    // opposite, the last on the other side, so the game is over.
    const p = position([1, 0, 0, 1, 0, 0], 20, [0, 0, 0, 0, 6, 0], 20, 0);
    expect(legalMoves(p)).toEqual([0, 3]);
    const won = play(p, 0)!;
    expect(won.over).toBe(true);
    expect(won.winner).toBe(0);
    expect(play(p, 3)!.over).toBe(false);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(0);
    }
    for (const depth of [1, 2, 4, 8]) expect(bestPits(p, depth)).toEqual([0]);
  });

  it("blocks a loss in one", () => {
    // Seat 1's lone seed would land opposite pit 4 and capture it. If pit 4
    // then holds every seed on seat 0's side, the game is over and lost.
    const p = position([0, 0, 0, 1, 5, 0], 20, [1, 0, 0, 0, 0, 0], 21, 0);
    expect(legalMoves(p)).toEqual([3, 4]);
    const lost = play(play(p, 3)!, 0)!;
    expect(lost.over).toBe(true);
    expect(lost.winner).toBe(1);
    expect(play(p, 4)!.holes[4]).toBe(0);
    for (const level of careful) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(4);
    }
    for (const depth of [2, 4, 8]) expect(bestPits(p, depth)).toEqual([4]);
  });

  it("takes an extra turn first", () => {
    // Pit 5 drops its seed in the store and plays again; then pit 4 scores too.
    // Pit 4 first scores one seed and ends the turn.
    const p = position([0, 0, 0, 0, 2, 1], 10, [4, 4, 4, 4, 4, 4], 11, 0);
    expect(play(p, 5)!.again).toBe(true);
    expect(bestPits(p, 2)).toEqual([5]);
    for (let seed = 0; seed < 10; seed++) expect(computerMove(p, "hard", seed)).toBe(5);
  });

  it("takes a capture", () => {
    // Pit 1's seed lands in the empty pit 2, across from seven seeds.
    const p = position([3, 1, 0, 4, 4, 4], 4, [4, 4, 4, 7, 4, 4], 1, 0);
    expect(play(p, 1)!.captured).toBe(8);
    expect(bestPits(p, 1)).toEqual([1]);
    for (let seed = 0; seed < 10; seed++) expect(computerMove(p, "hard", seed)).toBe(1);
  });

  it("plays a perfect endgame on Hard", () => {
    // Positions with few seeds left in the pits, from games between weaker levels.
    let checked = 0;
    for (let seed = 0; seed < 12; seed++) {
      let b = newBoard((seed % 2) as Seat);
      while (!b.over && inPits(b.holes, 0) + inPits(b.holes, 1) > 12) {
        b = play(b, computerMove(b, b.turn === 0 ? "easy" : "medium", seed))!;
      }
      if (b.over) continue;
      const t = think(b, "hard", seed);
      if (!t.exact) continue;
      const next = play(b, t.pit)!;
      expect(next.turn === b.turn ? solve(next) : -solve(next)).toBe(solve(b));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it("beats Easy and Medium on Hard over many seeded games", () => {
    expect(wins("hard", "easy", 10)).toBeGreaterThanOrEqual(9);
    expect(wins("hard", "medium", 10)).toBeGreaterThanOrEqual(8);
  });

  it("beats Easy on Medium more often than not", () => {
    expect(wins("medium", "easy", 30)).toBeGreaterThan(20);
  });

  it("plays legal moves to the end of whole games at every level", () => {
    for (const level of levels) {
      // One game is enough for Hard: it throws no move away, and its games are slow.
      for (let seed = 0; seed < (level === "hard" ? 1 : 3); seed++) {
        let b = newBoard(seed % 2 === 0 ? 0 : 1);
        while (!b.over) {
          const pit = computerMove(b, level, seed);
          expect(canPlay(b, pit)).toBe(true);
          b = play(b, pit)!;
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

  it("plays the same game from either seat", () => {
    // A move counts from its mover's left, so the seats can swap.
    expect(game("hard", "hard", 4, 0).moves).toEqual(game("hard", "hard", 4, 1).moves);
  });

  it("varies with the seed on Easy", () => {
    const picks = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(newBoard(1), "easy", seed)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("stays within its budget and answers a Hard move quickly", () => {
    // Every move of a whole game. The real budget is ~300 ms on a phone, and a busy build machine is no faster.
    let b = newBoard(0);
    let slowest = 0;
    while (!b.over) {
      const t = think(b, "hard", 5);
      // The first pass is never cut short, and it scores a handful of positions.
      expect(t.positions).toBeLessThanOrEqual(LEVELS.hard.budget + 64);
      expect(t.depth).toBeGreaterThanOrEqual(1);
      slowest = Math.max(slowest, t.ms);
      b = play(b, t.pit)!;
    }
    expect(slowest).toBeLessThan(300);
  });

  it("thinks the same move it plays, with its numbers", () => {
    const p = play(newBoard(0), 0)!;
    for (const seed of [1, 2, 3]) {
      const t = think(p, "hard", seed);
      expect(t.pit).toBe(computerMove(p, "hard", seed));
      expect(t.positions).toBeGreaterThan(0);
      expect(t.ms).toBeGreaterThanOrEqual(0);
      expect(t.depth).toBeGreaterThan(LEVELS.medium.depth);
      expect(t.exact).toBe(false);
    }
  });

  it("reads to the end when few seeds are left", () => {
    const p = position([0, 0, 0, 0, 1, 1], 22, [1, 0, 0, 0, 0, 1], 22, 0);
    const t = think(p, "hard", 1);
    expect(t.exact).toBe(true);
    expect(t.depth).toBeLessThan(LEVELS.hard.depth);
  });
});
