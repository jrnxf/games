// The computer player, with no DOM: a negamax with alpha-beta that deepens one
// ply at a time. It scores a position by the difference between the stores,
// and by the final count once the game ends. An extra turn is one more ply for
// the same player, so the search reads a run of extra turns like any other
// line. Each level is a search depth plus a chance of a random move. The
// search is capped by positions, not by the clock, and all randomness comes
// from a seed stored with the game, so a move is a pure function of the board,
// the level and the seed: a reload replays the same game and the computer's
// pending move.

import { HOLES, PITS, legalMoves, type Board } from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

/**
 * Depth is in plies: one sowing each, an extra turn included. `budget` caps
 * the positions scored: a deeper pass that runs out falls back to the last
 * pass that finished, which keeps Hard within about 300 ms on a phone.
 */
export const LEVELS: Record<Level, { depth: number; budget: number; mistake: number }> = {
  easy: { depth: 1, budget: 1_000, mistake: 0.3 },
  medium: { depth: 4, budget: 8_000, mistake: 0.1 },
  hard: { depth: 32, budget: 150_000, mistake: 0 },
};

/** A finished game outscores every guess: the seed margin times this. */
const FINAL = 100;

/** One move of the computer's, with the search behind it. */
export interface Thought {
  pit: number;
  /** How many positions the search scored. */
  positions: number;
  /** How long the search took, in milliseconds. */
  ms: number;
  /** The plies of the deepest pass that finished. */
  depth: number;
  /** The search read every line to the end of the game. */
  exact: boolean;
}

/** The pit the computer plays on `b` for the player on turn. The board must not be over. */
export function computerMove(b: Board, level: Level, seed: number): number {
  return think(b, level, seed).pit;
}

/** The computer's move on `b`, with how much it searched and how long it took. The board must not be over. */
export function think(b: Board, level: Level, seed: number): Thought {
  const legal = legalMoves(b);
  if (legal.length === 0) throw new Error("no legal move");
  // Each move gets its own stream, so the answer depends only on the position.
  const rand = rng(seed ^ Math.imul(b.moves.length + 1, 0x9e3779b1));
  const { depth, budget, mistake } = LEVELS[level];
  // The search runs even for a move thrown away, so every move has its numbers.
  // It draws nothing from the stream, so the moves are the same as without it.
  const t0 = performance.now();
  const found = search(b, depth, budget);
  const ms = performance.now() - t0;
  const pit =
    rand() < mistake
      ? legal[Math.floor(rand() * legal.length)]!
      : found.best[Math.floor(rand() * found.best.length)]!;
  return { pit, positions: found.positions, ms, depth: found.depth, exact: found.exact };
}

/** Every pit that scores best for the player on turn, searching up to `depth` plies within `budget` positions. */
export function bestPits(b: Board, depth: number, budget = Infinity): number[] {
  return search(b, depth, budget).best;
}

function search(
  b: Board,
  depth: number,
  budget: number,
): { best: number[]; depth: number; positions: number; exact: boolean } {
  const me = b.turn;
  // The pits nearest the store first: they reach it soonest.
  let order = legalMoves(b).reverse();
  let best = order;
  let reached = 0;
  let exact = false;
  let positions = 0;
  for (let d = 1; d <= depth && !exact; d++) {
    // A pass cut short leaves its board mid-move, so each pass starts clean.
    const s = new Search(b, d);
    // The first pass always finishes, so there is always a move.
    s.budget = d === 1 ? Infinity : budget - positions;
    const scores = new Map<number, number>();
    let top = -Infinity;
    let found: number[] = [];
    try {
      for (const pit of order) {
        // A window just under the best so far: equal scores come back exact.
        const score = s.score(pit, me, d, top - 1, Infinity);
        scores.set(pit, score);
        if (score > top) {
          top = score;
          found = [pit];
        } else if (score === top) found.push(pit);
      }
    } catch (e) {
      if (e !== OUT_OF_BUDGET) throw e;
      positions += s.positions;
      break;
    }
    positions += s.positions;
    best = found;
    reached = d;
    // No line stopped at a guess: a deeper pass would find nothing new.
    exact = !s.guessed;
    // Best first from the pass before, so each deeper pass cuts more.
    order = order.slice().sort((x, y) => scores.get(y)! - scores.get(x)!);
  }
  return { best, depth: reached, positions, exact };
}

// ---------- search ----------

const OUT_OF_BUDGET = Symbol("out of budget");

/** What a sowing leaves: the turn passes, the mover plays again, or the game is over. */
const PASS = 0;
const AGAIN = 1;
const OVER = 2;

/**
 * A mutable board for the search. Each ply copies the holes to its own row of
 * a stack before it sows, so undoing a move is exact.
 */
class Search {
  private readonly holes = new Uint8Array(HOLES);
  private readonly stack: Uint8Array;
  /** Positions scored so far, for showing how much was searched. */
  positions = 0;
  budget = Infinity;
  /** True once any line stopped short of the end of the game. */
  guessed = false;

  constructor(b: Board, depth: number) {
    this.holes.set(b.holes);
    this.stack = new Uint8Array(HOLES * (depth + 1));
  }

  /** `me` plays `pit`; the result is from `me`'s side, higher is better. Throws once the budget is spent. */
  score(pit: number, me: number, depth: number, alpha: number, beta: number): number {
    this.save(depth);
    const v = this.after(this.sow(pit, me), me, depth - 1, alpha, beta);
    this.restore(depth);
    return v;
  }

  /** The score for `me` once its sowing left `result`. */
  private after(result: number, me: number, depth: number, alpha: number, beta: number): number {
    if (result === OVER) {
      if (++this.positions > this.budget) throw OUT_OF_BUDGET;
      return this.final(me, depth);
    }
    if (result === AGAIN) return this.best(me, depth, alpha, beta);
    return -this.best(1 - me, depth, -beta, -alpha);
  }

  /** The best score `me` can reach from here, cut off once it can't beat `beta`. */
  private best(me: number, depth: number, alpha: number, beta: number): number {
    if (++this.positions > this.budget) throw OUT_OF_BUDGET;
    const holes = this.holes;
    if (depth <= 0) {
      this.guessed = true;
      return holes[me * (PITS + 1) + PITS]! - holes[(1 - me) * (PITS + 1) + PITS]!;
    }
    let best = -Infinity;
    for (let pit = PITS - 1; pit >= 0; pit--) {
      if (holes[me * (PITS + 1) + pit] === 0) continue;
      this.save(depth);
      const v = this.after(this.sow(pit, me), me, depth - 1, alpha, beta);
      this.restore(depth);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** Sows `me`'s `pit`, which must hold seeds, with the capture and the sweep at the end of the game. */
  private sow(pit: number, me: number): number {
    const holes = this.holes;
    const mine = me * (PITS + 1) + PITS;
    const theirs = (1 - me) * (PITS + 1) + PITS;
    let h = mine - PITS + pit;
    let n = holes[h]!;
    holes[h] = 0;
    for (; n > 0; n--) {
      h = (h + 1) % HOLES;
      if (h === theirs) h = (h + 1) % HOLES;
      holes[h]!++;
    }
    // A capture needs seeds across the board, as in `play`.
    if (h !== mine && h >= mine - PITS && h < mine && holes[h] === 1 && holes[2 * PITS - h]! > 0) {
      holes[mine]! += 1 + holes[2 * PITS - h]!;
      holes[h] = 0;
      holes[2 * PITS - h] = 0;
    }
    let low = 0;
    let high = 0;
    for (let i = 0; i < PITS; i++) {
      low += holes[i]!;
      high += holes[PITS + 1 + i]!;
    }
    if (low === 0 || high === 0) {
      holes[PITS]! += low;
      holes[HOLES - 1]! += high;
      for (let i = 0; i < PITS; i++) holes[i] = holes[PITS + 1 + i] = 0;
      return OVER;
    }
    return h === mine ? AGAIN : PASS;
  }

  private save(depth: number): void {
    const at = depth * HOLES;
    for (let i = 0; i < HOLES; i++) this.stack[at + i] = this.holes[i]!;
  }

  private restore(depth: number): void {
    const at = depth * HOLES;
    for (let i = 0; i < HOLES; i++) this.holes[i] = this.stack[at + i]!;
  }

  /**
   * The score of a finished game for `me`: the seed margin. `depth` is the
   * plies left, so a sooner win scores higher and a later loss less badly.
   */
  private final(me: number, depth: number): number {
    const diff = this.holes[me * (PITS + 1) + PITS]! - this.holes[(1 - me) * (PITS + 1) + PITS]!;
    if (diff === 0) return 0;
    return diff > 0 ? FINAL * diff + depth : FINAL * diff - depth;
  }
}
