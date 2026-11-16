// The computer player, with no DOM: a negamax with alpha-beta that deepens one
// ply at a time. It scores a position by where the discs sit, by how many
// moves each side has, and by the final count once the game ends. Each level
// is a search depth plus a chance of a random move. The search is capped by
// positions, not by the clock, and all randomness comes from a seed stored
// with the game, so a move is a pure function of the board, the level and the
// seed: a reload replays the same game and the computer's pending move.

import { CELLS, SIZE, at, legalMoves, type Board } from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

/**
 * Depth is in plies (both players' discs). With `exact` or fewer empty cells
 * the search runs to the end of the game, so the level plays a perfect
 * endgame. `budget` caps the positions scored: a deeper pass that runs out
 * falls back to the last pass that finished, which keeps Hard within about
 * 300 ms on a phone.
 */
export const LEVELS: Record<Level, { depth: number; exact: number; budget: number; mistake: number }> = {
  easy: { depth: 1, exact: 0, budget: 1_000, mistake: 0.3 },
  medium: { depth: 3, exact: 6, budget: 8_000, mistake: 0.1 },
  hard: { depth: 7, exact: 12, budget: 40_000, mistake: 0 },
};

/** A finished game outscores every guess: the disc margin times this. */
const FINAL = 10_000;
/** What one more legal move than the other player is worth. */
const MOBILITY = 8;

/**
 * What a disc on each cell is worth. Corners can never flip. The cells next
 * to a corner give it away, so they cost, but only while that corner is empty.
 */
// prettier-ignore
const WEIGHTS = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120,
] as const;

/** Each corner with the three cells that touch it. */
const CORNERS = [
  [at(0, 0), at(0, 1), at(1, 0), at(1, 1)],
  [at(0, 7), at(0, 6), at(1, 7), at(1, 6)],
  [at(7, 0), at(7, 1), at(6, 0), at(6, 1)],
  [at(7, 7), at(7, 6), at(6, 7), at(6, 6)],
] as const;

/** Best cells first, so alpha-beta cuts sooner. Equal weights stay in board order. */
const ORDER = Array.from({ length: CELLS }, (_, i) => i).sort((a, b) => WEIGHTS[b]! - WEIGHTS[a]! || a - b);

/** The cells in each of the eight directions from every cell, nearest first. */
const RAYS: number[][][] = Array.from({ length: CELLS }, (_, cell) => {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const rays: number[][] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const ray: number[] = [];
      for (let r = row + dr, c = col + dc; r >= 0 && r < SIZE && c >= 0 && c < SIZE; r += dr, c += dc) {
        ray.push(at(r, c));
      }
      // A ray of one cell can't outflank anything.
      if (ray.length > 1) rays.push(ray);
    }
  }
  return rays;
});

/** One move of the computer's, with the search behind it. */
export interface Thought {
  cell: number;
  /** How many positions the search scored. */
  positions: number;
  /** How long the search took, in milliseconds. */
  ms: number;
  /** The plies of the deepest pass that finished. */
  depth: number;
}

/** The cell the computer plays on `b` for the player on turn. The board must not be over. */
export function computerMove(b: Board, level: Level, seed: number): number {
  return think(b, level, seed).cell;
}

/** The computer's move on `b`, with how much it searched and how long it took. The board must not be over. */
export function think(b: Board, level: Level, seed: number): Thought {
  const legal = legalMoves(b);
  if (legal.length === 0) throw new Error("no legal move");
  // Each move gets its own stream, so the answer depends only on the position.
  const rand = rng(seed ^ Math.imul(b.moves.length + 1, 0x9e3779b1));
  const { depth, exact, budget, mistake } = LEVELS[level];
  const empty = b.cells.filter((c) => c === null).length;
  // The search runs even for a move thrown away, so every move has its numbers.
  // It draws nothing from the stream, so the moves are the same as without it.
  const t0 = performance.now();
  const found = search(b, empty <= exact ? empty : depth, budget);
  const ms = performance.now() - t0;
  const cell =
    rand() < mistake
      ? legal[Math.floor(rand() * legal.length)]!
      : found.best[Math.floor(rand() * found.best.length)]!;
  return { cell, positions: found.positions, ms, depth: found.depth };
}

/** Every cell that scores best for the player on turn, searching up to `depth` plies within `budget` positions. */
export function bestCells(b: Board, depth: number, budget = Infinity): number[] {
  return search(b, depth, budget).best;
}

function search(
  b: Board,
  depth: number,
  budget: number,
): { best: number[]; depth: number; positions: number } {
  const s = new Search(b);
  const me = b.turn === 0 ? 1 : -1;
  // Best first from the pass before, so each deeper pass cuts more.
  let order = ORDER.filter((c) => s.canPlay(c, me));
  let best = order;
  let reached = 0;
  for (let d = 1; d <= depth; d++) {
    // The first pass always finishes, so there is always a move.
    s.budget = d === 1 ? Infinity : budget;
    const scores = new Map<number, number>();
    let top = -Infinity;
    let found: number[] = [];
    try {
      for (const c of order) {
        // A window just under the best so far: equal scores come back exact.
        const score = s.score(c, me, d, top - 1, Infinity);
        scores.set(c, score);
        if (score > top) {
          top = score;
          found = [c];
        } else if (score === top) found.push(c);
      }
    } catch (e) {
      if (e !== OUT_OF_BUDGET) throw e;
      break;
    }
    best = found;
    reached = d;
    order = order.slice().sort((x, y) => scores.get(y)! - scores.get(x)!);
  }
  return { best, depth: reached, positions: s.positions };
}

// ---------- search ----------

const OUT_OF_BUDGET = Symbol("out of budget");

/**
 * A mutable board for the search: 1 for seat 0, -1 for seat 1, 0 for empty.
 * A move pushes the cells it flips on a stack, so undoing it is exact.
 */
class Search {
  private readonly cells = new Int8Array(CELLS);
  private readonly flipped = new Uint8Array(CELLS * 32);
  private top = 0;
  /** Positions scored so far, for showing how much was searched. */
  positions = 0;
  budget = Infinity;

  constructor(b: Board) {
    for (let i = 0; i < CELLS; i++) this.cells[i] = b.cells[i] === null ? 0 : b.cells[i] === 0 ? 1 : -1;
  }

  /** True when `me` may play on `cell`. */
  canPlay(cell: number, me: number): boolean {
    const cells = this.cells;
    if (cells[cell] !== 0) return false;
    for (const ray of RAYS[cell]!) {
      if (cells[ray[0]!] !== -me) continue;
      for (let i = 1; i < ray.length; i++) {
        const v = cells[ray[i]!];
        if (v === me) return true;
        if (v === 0) break;
      }
    }
    return false;
  }

  /** `me` plays `cell`; the result is from `me`'s side, higher is better. Throws once the budget is spent. */
  score(cell: number, me: number, depth: number, alpha: number, beta: number): number {
    const n = this.place(cell, me);
    try {
      return -this.best(-me, depth - 1, -beta, -alpha, false);
    } finally {
      this.undo(cell, me, n);
    }
  }

  /** The best score `me` can reach from here, cut off once it can't beat `beta`. */
  private best(me: number, depth: number, alpha: number, beta: number, passed: boolean): number {
    if (++this.positions > this.budget) throw OUT_OF_BUDGET;
    if (depth <= 0) return this.guess(me);
    let best = -Infinity;
    for (const c of ORDER) {
      if (this.cells[c] !== 0) continue;
      const n = this.place(c, me);
      if (n === 0) continue;
      let v: number;
      try {
        v = -this.best(-me, depth - 1, -beta, -alpha, false);
      } finally {
        this.undo(c, me, n);
      }
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (best > -Infinity) return best;
    // No move: the game is over after two passes in a row. A pass costs no depth.
    return passed ? this.final(me, depth) : -this.best(-me, depth, -beta, -alpha, true);
  }

  /** Puts `me`'s disc on an empty `cell` and flips. Returns the discs flipped; at 0 the move is illegal and nothing changed. */
  private place(cell: number, me: number): number {
    const cells = this.cells;
    const start = this.top;
    for (const ray of RAYS[cell]!) {
      if (cells[ray[0]!] !== -me) continue;
      let i = 1;
      while (i < ray.length && cells[ray[i]!] === -me) i++;
      if (i === ray.length || cells[ray[i]!] !== me) continue;
      for (let j = 0; j < i; j++) {
        cells[ray[j]!] = me;
        this.flipped[this.top++] = ray[j]!;
      }
    }
    if (this.top > start) cells[cell] = me;
    return this.top - start;
  }

  private undo(cell: number, me: number, n: number): void {
    this.cells[cell] = 0;
    for (let i = 0; i < n; i++) this.cells[this.flipped[--this.top]!] = -me;
  }

  /**
   * The score of a finished game for `me`: the disc margin, with the empty
   * cells going to the winner. `depth` is the plies left, so a sooner win
   * scores higher and a later loss less badly.
   */
  private final(me: number, depth: number): number {
    let diff = 0;
    let empty = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] === 0) empty++;
      else diff += this.cells[i]!;
    }
    diff *= me;
    if (diff === 0) return 0;
    return diff > 0 ? FINAL * (diff + empty) + depth : FINAL * (diff - empty) - depth;
  }

  /** A guess at an unfinished position for `me`: where the discs sit, plus the moves each side has. */
  private guess(me: number): number {
    const cells = this.cells;
    let total = 0;
    let moves = 0;
    let discs = 0;
    let diff = 0;
    for (let i = 0; i < CELLS; i++) {
      const v = cells[i]!;
      if (v !== 0) {
        total += WEIGHTS[i]! * v;
        discs++;
        diff += v;
      } else moves += (this.canPlay(i, 1) ? 1 : 0) - (this.canPlay(i, -1) ? 1 : 0);
    }
    // One side has no disc left: the game is over, and no guess is needed.
    if (diff === discs || diff === -discs) return this.final(me, 0);
    // Next to a corner that is taken, a disc is no longer a risk.
    for (const [corner, a, b, x] of CORNERS) {
      if (cells[corner] === 0) continue;
      total -= WEIGHTS[a]! * cells[a]! + WEIGHTS[b]! * cells[b]! + WEIGHTS[x]! * cells[x]!;
    }
    return me * (total + MOBILITY * moves);
  }
}
