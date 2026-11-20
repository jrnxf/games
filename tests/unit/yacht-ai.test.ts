import { describe, expect, it } from "vitest";
import {
  PAR,
  bestKeep,
  bonusChance,
  computerAction,
  maskOf,
  think,
  type Level,
} from "../../src/games/yacht/core/ai.ts";
import {
  CHANCE,
  FULL_HOUSE,
  LARGE_STRAIGHT,
  ROLL,
  YACHT,
  act,
  newCard,
  newGame,
  rollAction,
  total,
  type Card,
  type Game,
  type Seat,
} from "../../src/games/yacht/core/board.ts";
import { faces } from "../../src/games/yacht/core/dice.ts";

const seedOf = (n: number) => [n, n ^ 0x5bd1e995, 7, 11, 13, 17, 19, 23];

/** A whole game: seat 0 plays at `a`, seat 1 at `b`. */
function match(a: Level, b: Level, n: number, first: Seat = 0): Game {
  const seed = seedOf(n);
  const roll = (k: number) => faces(seed, k);
  let g = newGame(first);
  while (!g.over) {
    const next = act(g, computerAction(g, g.turn === 0 ? a : b, n), roll);
    if (!next) throw new Error("illegal action");
    g = next;
  }
  return g;
}

/** The game after the first player's first roll of `dice`. */
function rolled(dice: number[], c: Card = newCard()): Game {
  return act({ ...newGame(0), cards: [c, newCard()] }, rollAction(0), () => dice)!;
}

describe("the computer", () => {
  it("always rolls first, holding nothing", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      expect(computerAction(newGame(0), level, 1)).toBe(ROLL);
    }
  });

  it("scores a Yacht at once on Hard", () => {
    expect(computerAction(rolled([6, 6, 6, 6, 6]), "hard", 1)).toBe(YACHT);
  });

  it("scores a large straight at once on Hard", () => {
    expect(computerAction(rolled([2, 3, 4, 5, 6]), "hard", 1)).toBe(LARGE_STRAIGHT);
  });

  it("keeps four in a row and rolls for the fifth when the large straight is open", () => {
    const g = rolled([2, 3, 4, 5, 5]);
    const a = computerAction(g, "hard", 1);
    expect(a).toBeGreaterThanOrEqual(ROLL);
    const held = a - ROLL;
    expect([0, 1, 2, 3, 4].filter((i) => held & (1 << i)).map((i) => g.dice[i])).toEqual([2, 3, 4, 5]);
  });

  it("keeps a pair of sixes over a pair of ones", () => {
    const g = rolled([1, 1, 6, 6, 3]);
    const held = computerAction(g, "hard", 1) - ROLL;
    expect(held & 0b01100).toBe(0b01100);
    expect(held & 0b00011).toBe(0);
  });

  it("takes a full house when nothing better is near", () => {
    const c = newCard();
    c.boxes[YACHT] = 0;
    c.boxes[CHANCE] = 20;
    const g = act(
      act(rolled([1, 2, 4, 5, 6], c), rollAction(0), () => [3, 3, 3, 4, 4])!,
      rollAction(0),
      () => [3, 3, 3, 4, 4],
    )!;
    expect(g.rolls).toBe(3);
    expect(computerAction(g, "hard", 1)).toBe(FULL_HOUSE);
  });

  it("sees the upper bonus slip when a box would score under par", () => {
    const c = newCard();
    expect(bonusChance(c)).toBeCloseTo(0.5, 1);
    c.boxes[5] = 30;
    expect(bonusChance(c)).toBeGreaterThan(0.5);
    const low = newCard();
    low.boxes[5] = 6;
    expect(bonusChance(low)).toBeLessThan(0.5);
    for (let b = 0; b < 6; b++) low.boxes[b] = 1;
    expect(bonusChance(low)).toBe(0);
  });

  it("holds the dice of a keep, the first of each face", () => {
    expect(maskOf([3, 1, 3, 3, 2], [0, 0, 0, 2, 0, 0, 0])).toBe(0b00101);
    expect(maskOf([6, 5, 4, 3, 2], [0, 0, 1, 1, 1, 1, 0])).toBe(0b11110);
  });

  it("scores rather than rolls when nothing can do better", () => {
    expect(bestKeep(newCard(), [6, 6, 6, 6, 6], 2, () => 0)).toBeNull();
    expect(PAR).toHaveLength(13);
  });

  it("plays legal actions to the end of whole games at every level", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      for (let n = 1; n <= 4; n++) {
        const g = match(level, level, n, (n % 2) as Seat);
        expect(g.over).toBe(true);
        expect(g.actions.filter((a) => a < ROLL)).toHaveLength(26);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    for (const level of ["easy", "medium", "hard"] as const) {
      expect(match(level, level, 9).actions).toEqual(match(level, level, 9).actions);
    }
  });

  it("varies with the seed on Easy", () => {
    // The dice are the same, so only Easy's own randomness differs.
    const g = rolled([1, 2, 3, 5, 6]);
    const picks = new Set<number>();
    for (let s = 0; s < 40; s++) picks.add(computerAction({ ...g, rolls: 3 }, "easy", s));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("beats Easy on Hard by a clear margin over many seeded games", () => {
    let hard = 0;
    let easy = 0;
    let wins = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      // Each seat plays Hard half the time, and each seat starts half the time.
      const flip = i % 2 === 1;
      const g = match(
        flip ? "easy" : "hard",
        flip ? "hard" : "easy",
        1000 + i,
        (Math.floor(i / 2) % 2) as Seat,
      );
      const h = total(g.cards[flip ? 1 : 0]);
      const e = total(g.cards[flip ? 0 : 1]);
      hard += h;
      easy += e;
      if (h > e) wins++;
    }
    // Hard averages about 240 and Easy about 165.
    expect((hard - easy) / n).toBeGreaterThan(50);
    expect(wins / n).toBeGreaterThan(0.85);
  });

  it("beats Medium on Hard on average, and Medium beats Easy", () => {
    let hard = 0;
    let medium = 0;
    let easy = 0;
    for (let i = 0; i < 40; i++) {
      const hm = match("hard", "medium", 2000 + i, (i % 2) as Seat);
      hard += total(hm.cards[0]);
      medium += total(hm.cards[1]);
      easy += total(match("easy", "easy", 2000 + i).cards[0]);
    }
    expect(hard).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(easy);
  });

  it("answers quickly on Hard", () => {
    // Every action of a whole game. The limit is ~300 ms on a phone 4x slower than this machine.
    const seed = seedOf(3);
    const roll = (k: number) => faces(seed, k);
    let g = newGame(0);
    let slowest = 0;
    while (!g.over) {
      const t = think(g, "hard", 3);
      slowest = Math.max(slowest, t.ms);
      g = act(g, t.action, roll)!;
    }
    expect(slowest).toBeLessThan(75);
  });
});
