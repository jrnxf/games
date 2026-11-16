import { describe, expect, it } from "vitest";
import {
  LEVELS,
  bestLines,
  computerMove,
  think,
  type Level,
} from "../../src/games/dots-and-boxes/core/ai.ts";
import {
  LINES,
  across,
  canPlay,
  closes,
  down,
  legalMoves,
  newBoard,
  play,
  replay,
  sides,
  type Board,
  type Seat,
} from "../../src/games/dots-and-boxes/core/board.ts";
import { GIFT } from "./dots-and-boxes-games.ts";

const levels = Object.keys(LEVELS) as Level[];

/** Levels that always take a box on offer. */
const greedy = levels.filter((l) => LEVELS[l].takes === 1);

/** A position with every line drawn but `open`, and `turn` to move. Who drew the lines does not matter. */
const allBut = (open: number[], turn: Seat): Board => {
  const moves = Array.from({ length: LINES }, (_, i) => i).filter((l) => !open.includes(l));
  const b = newBoard(turn);
  for (const l of moves) b.lines[l] = 0;
  return { ...b, moves };
};

/** A chain of five boxes along the bottom row, open at both ends. */
const ROW = [0, 1, 2, 3, 4, 5].map((col) => down(4, col));
/** A chain of three boxes along the top row from the corner, open at the left rim and at the top of its last box. */
const THREE = [down(0, 0), down(0, 1), down(0, 2), across(0, 2)];
/** A chain of two boxes in the top-left corner: the left rim, the wall between, and the top of the second. */
const TWO = [down(0, 0), down(0, 1), across(0, 1)];

/** A whole game between two levels. Returns the final board. */
const game = (seat0: Level, seat1: Level, seed: number, starter: Seat): Board => {
  let b = newBoard(starter);
  while (!b.over) b = play(b, computerMove(b, b.turn === 0 ? seat0 : seat1, seed))!;
  return b;
};

/** How many of `games` seeded games `level` wins against `against`, sitting in each seat and starting in turn. */
const wins = (level: Level, against: Level, games: number): number => {
  let n = 0;
  for (let seed = 0; seed < games; seed++) {
    const seat = (seed % 2) as Seat;
    const b = game(
      seat === 0 ? level : against,
      seat === 0 ? against : level,
      seed,
      ((seed >> 1) % 2) as Seat,
    );
    if (b.winner === seat) n++;
  }
  return n;
};

/** True when `line` gives a box its third side. */
const givesThird = (b: Board, line: number) => {
  const next = play(b, line)!;
  return next.boxes.some((owner, box) => owner === null && sides(next.lines, box) === 3);
};

/** The boxes still to come for the player on turn, minus the other player's, with perfect play, by plain search. */
const solver = () => {
  const memo = new Map<string, number>();
  const after = (b: Board, line: number): number => {
    const next = play(b, line)!;
    const gain = next.score[b.turn] - b.score[b.turn];
    return next.turn === b.turn ? gain + solve(next) : -solve(next);
  };
  const solve = (b: Board): number => {
    if (b.over) return 0;
    const key = b.lines.map((l) => (l === null ? "." : "x")).join("");
    const known = memo.get(key);
    if (known !== undefined) return known;
    const best = Math.max(...legalMoves(b).map((line) => after(b, line)));
    memo.set(key, best);
    return best;
  };
  return { solve, after };
};

describe("dots and boxes computer", () => {
  it("has a level that takes every box, and one that searches", () => {
    expect(greedy).toEqual(["medium", "hard"]);
    expect(LEVELS.hard.budget).toBeGreaterThan(0);
  });

  it("takes a box on offer", () => {
    // Three sides of the top-left box are drawn.
    const p = replay(0, GIFT.slice(0, 5))!;
    expect(closes(p.lines, down(0, 1))).toHaveLength(1);
    for (const level of greedy) {
      for (let seed = 0; seed < 20; seed++) expect(computerMove(p, level, seed)).toBe(down(0, 1));
    }
    // Easy takes it some of the time.
    const easy = Array.from({ length: 100 }, (_, seed) => computerMove(p, "easy", seed));
    const took = easy.filter((line) => line === down(0, 1)).length;
    expect(took).toBeGreaterThan(20);
    expect(took).toBeLessThan(80);
  });

  it("never gives a box its third side while a safe line is left", () => {
    // Two sides of the top-left box are drawn: its other two would give it away.
    const p = replay(0, [across(0, 0), down(0, 0)])!;
    for (const level of levels) {
      for (let seed = 0; seed < 50; seed++) {
        expect([across(1, 0), down(0, 1)]).not.toContain(computerMove(p, level, seed));
      }
    }
    // And in whole games: a line that gives a third side comes only when every line does.
    for (const level of levels) {
      for (let seed = 0; seed < 3; seed++) {
        let b = newBoard((seed % 2) as Seat);
        while (!b.over) {
          const line = computerMove(b, level, seed);
          expect(canPlay(b, line)).toBe(true);
          if (givesThird(b, line) && closes(b.lines, line).length === 0) {
            const rest = legalMoves(b).filter((l) => closes(b.lines, l).length === 0);
            expect(rest.every((l) => givesThird(b, l))).toBe(true);
          }
          b = play(b, line)!;
        }
      }
    }
  });

  it("gives away the short chain first on Medium and Hard", () => {
    const p = allBut([...TWO, ...ROW], 0);
    for (const level of greedy) {
      for (let seed = 0; seed < 20; seed++) expect(TWO).toContain(computerMove(p, level, seed));
    }
    const easy = new Set(Array.from({ length: 100 }, (_, seed) => computerMove(p, "easy", seed)));
    expect([...easy].some((line) => ROW.includes(line))).toBe(true);
  });

  it("opens a chain of two in the middle on Hard, so there is nothing to deal back", () => {
    // From either end, the other player leaves both boxes and keeps the row of five.
    const p = allBut([...TWO, ...ROW], 0);
    expect(bestLines(p)).toEqual([down(0, 1)]);
    for (let seed = 0; seed < 20; seed++) expect(computerMove(p, "hard", seed)).toBe(down(0, 1));
  });

  it("leaves the last two boxes of a chain on Hard to keep the long one", () => {
    // The other player opened the chain of three from the rim.
    let p = allBut([...THREE.slice(1), ...ROW], 0);
    expect(bestLines(p)).toEqual([down(0, 1)]);
    p = play(p, down(0, 1))!;
    expect(p.turn).toBe(0);
    // Taking both and opening the row loses 3 to 5. The top line gives two and wins the five.
    expect(bestLines(p)).toEqual([across(0, 2)]);
    for (let seed = 0; seed < 20; seed++) {
      expect(computerMove(p, "hard", seed)).toBe(across(0, 2));
      expect(computerMove(p, "medium", seed)).toBe(down(0, 2));
    }
    // The other player takes the two, opens the row, and Hard takes all five.
    let b = play(p, across(0, 2))!;
    b = play(b, down(0, 2))!;
    while (!b.over) b = play(b, computerMove(b, b.turn === 0 ? "hard" : "medium", 1))!;
    expect(b.score).toEqual([6, 2]);
  });

  it("takes every box of the last chain on Hard", () => {
    let b = allBut(THREE.slice(1), 1);
    while (!b.over) b = play(b, computerMove(b, "hard", 4))!;
    expect(b.score).toEqual([0, 3]);
  });

  it("plays a perfect endgame on Hard", () => {
    const { solve, after } = solver();
    let checked = 0;
    for (let seed = 0; seed < 12; seed++) {
      let b = newBoard((seed % 2) as Seat);
      while (!b.over) {
        if (LINES - b.moves.length <= 14) {
          const t = think(b, "hard", seed);
          expect(t.exact).toBe(true);
          expect(after(b, t.line)).toBe(solve(b));
          // Every line the search calls best is one.
          for (const line of bestLines(b)!) expect(after(b, line)).toBe(solve(b));
          checked++;
        }
        // Weaker levels make the positions, so they hold gifts of every shape.
        b = play(b, computerMove(b, seed % 3 === 0 ? "easy" : "medium", seed + 100))!;
      }
    }
    expect(checked).toBe(12 * 14);
  });

  it("beats Easy on Hard over many seeded games", () => {
    const games = 10;
    expect(wins("hard", "easy", games)).toBeGreaterThanOrEqual(games - 1);
  });

  it("beats Medium on Hard, and Easy on Medium", () => {
    const games = 20;
    expect(wins("hard", "medium", games)).toBeGreaterThanOrEqual(games - 4);
    expect(wins("medium", "easy", games)).toBeGreaterThanOrEqual(games - 4);
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

  it("varies with the seed", () => {
    for (const level of levels) {
      const picks = new Set(Array.from({ length: 50 }, (_, seed) => computerMove(newBoard(0), level, seed)));
      expect(picks.size).toBeGreaterThan(10);
    }
  });

  it("stays within its budget and answers a Hard move quickly", () => {
    // Every Hard move of whole games; the real budget is ~300 ms on a phone.
    let slowest = 0;
    let searched = 0;
    for (let seed = 0; seed < 4; seed++) {
      let b = newBoard((seed % 2) as Seat);
      while (!b.over) {
        const t = think(b, b.turn === 0 ? "hard" : "medium", seed);
        if (b.turn === 0) {
          // Two passes, each within the budget.
          expect(t.positions).toBeLessThanOrEqual(LEVELS.hard.budget * 2);
          slowest = Math.max(slowest, t.ms);
          if (t.positions > 0) searched++;
        } else expect(t.positions).toBe(0);
        b = play(b, t.line)!;
      }
    }
    expect(searched).toBeGreaterThan(0);
    expect(slowest).toBeLessThan(200);
  });

  it("opens from the plain rules, and searches once few safe lines are left", () => {
    const t = think(newBoard(0), "hard", 1);
    expect(t.positions).toBe(0);
    expect(t.exact).toBe(false);
    expect(bestLines(newBoard(0), 1_000)).toBeNull();
    // An endgame: nothing but two chains.
    const p = allBut([...TWO, ...ROW], 0);
    const end = think(p, "hard", 1);
    expect(end.line).toBe(computerMove(p, "hard", 1));
    expect(end.positions).toBeGreaterThan(0);
    expect(end.exact).toBe(true);
    expect(end.ms).toBeGreaterThanOrEqual(0);
  });
});
