import { describe, expect, it } from "vitest";
import {
  LEVELS,
  computerMove,
  density,
  openHits,
  rng,
  think,
  type Level,
} from "../../src/games/sea-battle/core/ai.ts";
import {
  CELLS,
  DECKS,
  at,
  canFireAt,
  cellsOf,
  fire,
  newBoard,
  randomFleet,
  type Board,
  type Fleet,
  type Mark,
  type Seat,
  type Ship,
  type Sight,
} from "../../src/games/sea-battle/core/board.ts";
import { COLUMNS, ROWS } from "./sea-battle-games.ts";

/** Levels that follow a hit. */
const keen: Level[] = ["medium", "hard"];

/** A sight set by hand: misses, hits and the ships sunk (their cells count as hits). */
const sight = (misses: number[], hitCells: number[] = [], sunk: Ship[] = []): Sight => {
  const marks = Array<Mark>(CELLS).fill(null);
  for (const cell of misses) marks[cell] = "miss";
  for (const cell of [...hitCells, ...sunk.flatMap(cellsOf)]) marks[cell] = "hit";
  return { marks, sunk };
};

/** Two fleets laid out by `seed`. */
const fleets = (seed: number): [Fleet, Fleet] => {
  const rand = rng(seed * 7919 + 1);
  return [randomFleet(rand), randomFleet(rand)];
};

/** A whole game between two levels. Returns the final board. */
const game = (seat0: Level, seat1: Level, seed: number, starter: Seat): Board => {
  let b = newBoard(starter, fleets(seed));
  while (!b.over) b = fire(b, computerMove(b.seen[b.turn], b.turn === 0 ? seat0 : seat1, seed))!;
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

/** The shots `level` needs to sink `fleet` with nobody firing back. */
const shotsToSink = (fleet: Fleet, level: Level, seed: number): number => {
  let b = newBoard(0, [ROWS, fleet]);
  while (!b.over) b = { ...fire(b, computerMove(b.seen[0], level, seed))!, turn: 0 };
  return b.shots.length;
};

/** The mean of `shotsToSink` over `games` seeded fleets. */
const meanShots = (level: Level, games: number): number => {
  let total = 0;
  for (let seed = 0; seed < games; seed++) total += shotsToSink(fleets(seed)[1], level, seed);
  return total / games;
};

describe("sea battle computer", () => {
  it("fires next to a lone hit", () => {
    const s = sight([], [at(4, 4)]);
    const around = [at(3, 4), at(5, 4), at(4, 3), at(4, 5)];
    for (const level of keen) {
      for (let seed = 0; seed < 20; seed++) expect(around).toContain(computerMove(s, level, seed));
    }
  });

  it("extends a line of two hits", () => {
    const s = sight([], [at(4, 4), at(4, 5)]);
    for (const level of keen) {
      for (let seed = 0; seed < 20; seed++)
        expect([at(4, 3), at(4, 6)]).toContain(computerMove(s, level, seed));
    }
  });

  it("takes the one cell that can finish a ship", () => {
    // A line of two hits shut in by a miss on the left: the ship runs right.
    const s = sight([at(4, 3), at(3, 4), at(5, 4), at(3, 5), at(5, 5)], [at(4, 4), at(4, 5)]);
    for (const level of keen) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(s, level, seed)).toBe(at(4, 6));
    }
  });

  it("sinks the last ship in one shot when one cell is left for it", () => {
    // Every ship but the 2 is sunk, and its hit has one open cell beside it.
    const sunk = COLUMNS.slice(0, 4);
    const s = sight([at(1, 0), at(1, 2), at(2, 1)], [at(1, 1)], sunk);
    expect(openHits(s)).toEqual([at(1, 1)]);
    for (const level of keen) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(s, level, seed)).toBe(at(0, 1));
    }
    const won = fire({ ...newBoard(0, [ROWS, COLUMNS]), seen: [s, sight([])] }, at(0, 1))!;
    expect(won.winner).toBe(0);
  });

  it("leaves a sunk ship alone, and chases a hit that touches it", () => {
    const five = ROWS[0]!;
    // The five is sunk along the top row. Nothing is left to chase.
    const done = sight([], [], [five]);
    expect(openHits(done)).toEqual([]);
    expect(think(done, "hard", 1).chasing).toBe(false);
    for (let seed = 0; seed < 40; seed++) {
      // Medium goes back to its checkerboard.
      const cell = computerMove(done, "medium", seed);
      expect((Math.floor(cell / 10) + (cell % 10)) % 2).toBe(0);
    }
    // A hit under the sunk ship belongs to another ship.
    const touching = sight([], [at(1, 2)], [five]);
    expect(openHits(touching)).toEqual([at(1, 2)]);
    for (const level of keen) {
      const t = think(touching, level, 3);
      expect(t.chasing).toBe(true);
      expect([at(2, 2), at(1, 1), at(1, 3)]).toContain(t.cell);
    }
  });

  it("hunts on one colour of the checkerboard on Medium", () => {
    let b = newBoard(0, [ROWS, COLUMNS]);
    for (let i = 0; i < 12 && !b.over; i++) {
      const t = think(b.seen[0], "medium", 9);
      if (!t.chasing) expect((Math.floor(t.cell / 10) + (t.cell % 10)) % 2).toBe(0);
      b = { ...fire(b, t.cell)!, turn: 0 };
    }
  });

  it("counts no ship across a miss, a sunk ship or a fired cell", () => {
    const s = sight([at(0, 1), at(1, 0)], [at(5, 5)], [ROWS[4]!]);
    const { counts, placements } = density(s);
    expect(placements).toBeGreaterThan(0);
    // The corner is shut in: no ship of two or more fits.
    expect(counts[at(0, 0)]).toBe(0);
    s.marks.forEach((mark, cell) => {
      if (mark !== null) expect(counts[cell]).toBe(0);
    });
    // A cell next to the open hit outscores open water.
    expect(counts[at(5, 6)]).toBeGreaterThan(counts[at(2, 7)]! * 100);
  });

  it("prefers the middle of open water on Hard", () => {
    const { counts } = density(sight([]));
    expect(counts[at(4, 4)]).toBeGreaterThan(counts[at(0, 0)]!);
    const first = computerMove(sight([]), "hard", 1);
    expect(counts[first]).toBe(Math.max(...counts));
  });

  it("does not hunt where the smallest ship left can't fit", () => {
    // Only the five is afloat, and a lone open cell lies between misses.
    const sunk = ROWS.slice(1);
    const s = sight([at(1, 0), at(1, 1), at(1, 2), at(1, 4), at(0, 3), at(2, 3)], [], sunk);
    expect(density(s).counts[at(1, 3)]).toBe(0);
    for (let seed = 0; seed < 30; seed++) expect(computerMove(s, "hard", seed)).not.toBe(at(1, 3));
  });

  it("needs fewer shots at each level over many seeded fleets", () => {
    const easy = meanShots("easy", 40);
    const medium = meanShots("medium", 40);
    const hard = meanShots("hard", 40);
    expect(easy).toBeGreaterThan(85);
    expect(medium).toBeLessThan(60);
    expect(hard).toBeLessThan(50);
    expect(hard).toBeLessThan(medium - 2);
  });

  it("beats Easy and Medium on Hard over many seeded games", () => {
    expect(wins("hard", "easy", 40)).toBe(40);
    expect(wins("hard", "medium", 100)).toBeGreaterThanOrEqual(60);
  });

  it("beats Easy on Medium", () => {
    expect(wins("medium", "easy", 40)).toBeGreaterThanOrEqual(39);
  });

  it("fires legal shots to the end of whole games at every level", () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 5; seed++) {
        let b = newBoard((seed % 2) as Seat, fleets(seed));
        while (!b.over) {
          const cell = computerMove(b.seen[b.turn], level, seed);
          expect(canFireAt(b.seen[b.turn], cell)).toBe(true);
          b = fire(b, cell)!;
        }
        expect(b.seen[b.winner!].sunk).toHaveLength(5);
        // No level needs every cell: 17 hits at least, 100 shots at most.
        const mine = b.seen[b.winner!].marks.filter((m) => m !== null).length;
        expect(mine).toBeGreaterThanOrEqual(DECKS);
        expect(mine).toBeLessThanOrEqual(CELLS);
      }
    }
  });

  it("sees only the sight: the same marks give the same shot over any fleet", () => {
    // Both fleets leave the bottom row empty, so the same misses are true of each.
    const misses = [at(9, 0), at(9, 4), at(9, 8)];
    let a = newBoard(0, [ROWS, ROWS]);
    let b = newBoard(0, [ROWS, COLUMNS]);
    for (const cell of misses) {
      a = { ...fire(a, cell)!, turn: 0 };
      b = { ...fire(b, cell)!, turn: 0 };
    }
    expect(a.seen[0]).toEqual(b.seen[0]);
    for (const level of LEVELS) {
      for (let seed = 0; seed < 10; seed++) {
        expect(computerMove(a.seen[0], level, seed)).toBe(computerMove(b.seen[0], level, seed));
      }
    }
  });

  it("does not change the sight it is given", () => {
    const s = sight([at(0, 0)], [at(4, 4)], [ROWS[4]!]);
    const before = JSON.stringify(s);
    Object.freeze(s.marks);
    Object.freeze(s.sunk);
    for (const level of LEVELS) think(s, level, 2);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("is deterministic for a given seed", () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 20; seed++) {
        expect(computerMove(sight([]), level, seed)).toBe(computerMove(sight([]), level, seed));
      }
      expect(game(level, "medium", 7, 0).shots.join()).toBe(game(level, "medium", 7, 0).shots.join());
    }
  });

  it("varies with the seed", () => {
    for (const level of LEVELS) {
      const s = level === "hard" ? sight([], [at(4, 4)]) : sight([]);
      const picks = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(s, level, seed)));
      expect(picks.size).toBeGreaterThan(1);
    }
  });

  it("answers a Hard shot quickly, with its numbers", () => {
    // Every shot of a whole game; the real budget is ~300 ms on a phone.
    let b = newBoard(0, fleets(5));
    let slowest = 0;
    while (!b.over) {
      const t = think(b.seen[0], "hard", 5);
      expect(t.cell).toBe(computerMove(b.seen[0], "hard", 5));
      expect(t.placements).toBeGreaterThan(0);
      expect(t.chasing).toBe(openHits(b.seen[0]).length > 0);
      slowest = Math.max(slowest, t.ms);
      b = { ...fire(b, t.cell)!, turn: 0 };
    }
    expect(slowest).toBeLessThan(50);
    expect(think(sight([]), "easy", 1).placements).toBe(0);
  });

  it("throws with no cell left to fire at", () => {
    const full = sight(Array.from({ length: CELLS }, (_, cell) => cell));
    expect(() => think(full, "easy", 1)).toThrow();
  });
});
