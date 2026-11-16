import { describe, expect, it } from "vitest";
import {
  HOLES,
  TOTAL,
  canPlay,
  hole,
  inPits,
  legalMoves,
  newBoard,
  opposite,
  owner,
  play,
  replay,
  score,
  sowing,
  store,
  type Board,
  type Seat,
} from "../../src/games/mancala/core/board.ts";
import { rng } from "../../src/games/connect-four/core/ai.ts";
import { CLEAN, DRAW, QUICK, SWEPT } from "./mancala-games.ts";

const game = (moves: number[], starter: Seat = 0): Board => {
  const b = replay(starter, moves);
  if (!b) throw new Error(`illegal moves ${moves.join(",")}`);
  return b;
};

/** A position mid-game: seat 0's pits, its store, seat 1's pits, its store. */
const position = (holes: number[], turn: Seat = 0): Board => {
  expect(holes).toHaveLength(HOLES);
  return { ...newBoard(turn), holes };
};

const total = (b: Board) => b.holes.reduce((a, n) => a + n, 0);

describe("mancala board", () => {
  it("starts with four seeds in every pit, empty stores and the starter to move", () => {
    const b = newBoard();
    expect(b.holes).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(total(b)).toBe(TOTAL);
    expect(legalMoves(b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(b.turn).toBe(0);
    expect(newBoard(1).turn).toBe(1);
  });

  it("numbers the holes in sowing order, with each pit facing one across the board", () => {
    expect(hole(0, 0)).toBe(0);
    expect(store(0)).toBe(6);
    expect(hole(1, 0)).toBe(7);
    expect(store(1)).toBe(13);
    expect(opposite(hole(0, 0))).toBe(hole(1, 5));
    expect(opposite(hole(0, 5))).toBe(hole(1, 0));
    expect(opposite(hole(1, 2))).toBe(hole(0, 3));
    expect(owner(store(0))).toBe(0);
    expect(owner(hole(1, 0))).toBe(1);
  });

  it("sows one seed a hole and passes the turn", () => {
    const b = game([0]);
    expect(b.holes).toEqual([0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(b.turn).toBe(1);
    expect(b.again).toBe(false);
    expect(b.moves).toEqual([0]);
  });

  it("gives another turn when the last seed falls in the mover's store", () => {
    const b = game([2]);
    expect(sowing(newBoard(), 2)).toEqual([3, 4, 5, 6]);
    expect(b.holes).toEqual([4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
    expect(b.turn).toBe(0);
    expect(b.again).toBe(true);
    expect(game([2, 5]).turn).toBe(1);
  });

  it("counts a pit from its mover's left, for either seat", () => {
    const b = game([2], 1);
    expect(b.holes).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 0, 5, 5, 5, 1]);
    expect(b.turn).toBe(1);
    expect(game([0, 0]).holes).toEqual([0, 5, 5, 5, 5, 4, 0, 0, 5, 5, 5, 5, 4, 0]);
  });

  it("sows past the mover's own store and skips the other one", () => {
    const b = position([1, 1, 1, 1, 1, 10, 0, 1, 1, 1, 1, 1, 1, 0]);
    expect(sowing(b, 5)).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
    const after = play(b, 5)!;
    expect(after.holes).toEqual([2, 2, 2, 1, 1, 0, 1, 2, 2, 2, 2, 2, 2, 0]);
    const theirs = position([1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 10, 0], 1);
    expect(sowing(theirs, 5)).toEqual([13, 0, 1, 2, 3, 4, 5, 7, 8, 9]);
  });

  it("captures the last seed and the seeds opposite when it lands in the mover's empty pit", () => {
    const b = play(position([1, 0, 3, 0, 0, 0, 2, 3, 3, 3, 3, 5, 3, 0]), 0)!;
    expect(b.captured).toBe(6);
    expect(b.holes).toEqual([0, 0, 3, 0, 0, 0, 8, 3, 3, 3, 3, 0, 3, 0]);
    expect(b.turn).toBe(1);
    expect(b.over).toBe(false);
  });

  it("captures nothing when the pit opposite is empty", () => {
    const b = play(position([1, 0, 3, 0, 0, 0, 2, 3, 3, 3, 3, 0, 3, 0]), 0)!;
    expect(b.captured).toBe(0);
    expect(b.holes).toEqual([0, 1, 3, 0, 0, 0, 2, 3, 3, 3, 3, 0, 3, 0]);
  });

  it("captures nothing in an empty pit on the other side, or in a pit that had seeds", () => {
    const far = play(position([3, 0, 0, 0, 0, 2, 0, 0, 3, 3, 3, 3, 3, 0]), 5)!;
    expect(far.captured).toBe(0);
    expect(far.holes).toEqual([3, 0, 0, 0, 0, 0, 1, 1, 3, 3, 3, 3, 3, 0]);
    const full = play(position([1, 2, 3, 0, 0, 0, 2, 3, 3, 3, 3, 5, 3, 0]), 0)!;
    expect(full.captured).toBe(0);
    expect(full.holes[1]).toBe(3);
  });

  it("captures after a full lap of thirteen seeds back to the pit it left", () => {
    const b = position([13, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 2, 0]);
    expect(sowing(b, 0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0]);
    const after = play(b, 0)!;
    expect(after.captured).toBe(4);
    expect(after.holes).toEqual([0, 1, 1, 1, 1, 2, 5, 2, 2, 2, 2, 2, 0, 0]);
  });

  it("ends when the mover's side is empty, and the other side's seeds go to their owner", () => {
    const b = play(position([0, 0, 0, 0, 0, 1, 20, 2, 0, 0, 3, 0, 0, 22]), 5)!;
    expect(b.over).toBe(true);
    expect(b.again).toBe(false);
    expect(b.swept).toEqual([0, 5]);
    expect(b.holes).toEqual([0, 0, 0, 0, 0, 0, 21, 0, 0, 0, 0, 0, 0, 27]);
    expect(b.winner).toBe(1);
    expect(legalMoves(b)).toEqual([]);
    expect(play(b, 0)).toBeNull();
  });

  it("ends when a capture empties the other side", () => {
    const b = play(position([0, 0, 1, 0, 5, 0, 20, 0, 0, 2, 0, 0, 0, 20]), 2)!;
    expect(b.captured).toBe(3);
    expect(b.over).toBe(true);
    expect(b.swept).toEqual([5, 0]);
    expect([score(b, 0), score(b, 1)]).toEqual([28, 20]);
    expect(b.winner).toBe(0);
  });

  it("refuses an empty pit, a pit off the board and a move after the end", () => {
    const b = game([0]);
    expect(canPlay(game([0, 1]), 0)).toBe(false);
    expect(play(game([0, 1]), 0)).toBeNull();
    for (const pit of [-1, 6, 1.5, Number.NaN]) expect(play(b, pit)).toBeNull();
    expect(sowing(b, 6)).toEqual([]);
    expect(replay(0, [0, 1, 0])).toBeNull();
    expect(replay(0, [...QUICK, 0])).toBeNull();
  });

  it("plays whole games to a win, a sweep that does not save the game, and a draw", () => {
    const quick = game(QUICK);
    expect([quick.over, quick.winner, quick.draw]).toEqual([true, 0, false]);
    expect([score(quick, 0), score(quick, 1)]).toEqual([28, 20]);
    expect(quick.swept).toEqual([0, 7]);

    const swept = game(SWEPT);
    expect(swept.winner).toBe(1);
    expect([score(swept, 0), score(swept, 1)]).toEqual([23, 25]);
    expect(swept.swept).toEqual([15, 0]);

    const draw = game(DRAW);
    expect([draw.over, draw.winner, draw.draw]).toEqual([true, null, true]);
    expect([score(draw, 0), score(draw, 1)]).toEqual([24, 24]);

    const clean = game(CLEAN);
    expect(clean.swept).toEqual([0, 0]);
    expect(clean.captured).toBeGreaterThan(0);
    expect([score(clean, 0), score(clean, 1)]).toEqual([30, 18]);
  });

  it("plays the same game with the seats swapped for the other starter", () => {
    const a = game(SWEPT, 0);
    const b = game(SWEPT, 1);
    expect(b.winner).toBe(0);
    expect(b.holes).toEqual([...a.holes.slice(7), ...a.holes.slice(0, 7)]);
    expect(b.swept).toEqual([a.swept[1], a.swept[0]]);
  });

  it("keeps all 48 seeds through random games, and ends each with empty pits", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed);
      let b = newBoard((seed % 2) as Seat);
      while (!b.over) {
        const moves = legalMoves(b);
        expect(moves.length).toBeGreaterThan(0);
        b = play(b, moves[Math.floor(random() * moves.length)]!)!;
        expect(total(b)).toBe(TOTAL);
      }
      expect(inPits(b.holes, 0) + inPits(b.holes, 1)).toBe(0);
      expect(score(b, 0) + score(b, 1)).toBe(TOTAL);
      expect(b.draw).toBe(score(b, 0) === score(b, 1));
      expect(replay(b.starter, b.moves)).toEqual(b);
    }
  });
});
