// The computer player, with no DOM: a fixed-depth minimax with alpha-beta
// that tries the centre columns first. Each level is a search depth plus a
// chance of a random column. All randomness comes from a seed stored with the
// game, so a move is a pure function of the board, the level and the seed:
// a reload replays the same game and the computer's pending move.

import { COLS, ROWS, at, canDrop, type Board, type Seat } from "./board.ts";

export type Level = "easy" | "medium" | "hard";

/**
 * Depth is in plies (both players' chips). Hard looks five of its own moves
 * ahead, so it never misses a win or a block within reach, and still answers
 * in a few milliseconds. Every level takes a win and blocks a threat on the
 * moves it doesn't throw away.
 */
export const LEVELS: Record<Level, { depth: number; mistake: number }> = {
  easy: { depth: 2, mistake: 0.35 },
  medium: { depth: 4, mistake: 0.1 },
  hard: { depth: 9, mistake: 0 },
};

/** Centre first: the middle columns sit in the most lines, so alpha-beta cuts sooner. */
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const;
const WIN = 1_000_000;
const CENTRE = 3;

/** A small, fast seeded generator (mulberry32). Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new game. */
export const newSeed = () => Math.floor(Math.random() * 4294967296);

/** The column the computer plays on `b` for the player on turn. The board must not be over. */
export function computerMove(b: Board, level: Level, seed: number): number {
  const legal = ORDER.filter((c) => canDrop(b, c));
  if (legal.length === 0) throw new Error("no legal move");
  // Each move gets its own stream, so the answer depends only on the position.
  const rand = rng(seed ^ Math.imul(b.moves.length + 1, 0x9e3779b1));
  const { depth, mistake } = LEVELS[level];
  if (rand() < mistake) return legal[Math.floor(rand() * legal.length)]!;
  const best = bestColumns(b, depth);
  return best[Math.floor(rand() * best.length)]!;
}

/** Every column that scores best at `depth` for the player on turn, in centre-first order. */
export function bestColumns(b: Board, depth: number): number[] {
  const s = new Search(b);
  let top = -Infinity;
  let best: number[] = [];
  for (const c of ORDER) {
    if (s.heights[c] === ROWS) continue;
    // A window just under the best so far: equal scores come back exact.
    const score = s.score(b.turn, c, depth, top - 1, Infinity);
    if (score > top) {
      top = score;
      best = [c];
    } else if (score === top) best.push(c);
  }
  return best;
}

// ---------- search ----------

/** Every line of four on the board, as cell indexes, and the lines through each cell. */
const WINDOWS: number[][] = [];
const CELL_WINDOWS: number[][] = Array.from({ length: ROWS * COLS }, () => []);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ] as const) {
      const er = r + dr * 3;
      const ec = c + dc * 3;
      if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
      const w = [0, 1, 2, 3].map((i) => at(r + dr * i, c + dc * i));
      for (const i of w) CELL_WINDOWS[i]!.push(WINDOWS.length);
      WINDOWS.push(w);
    }
  }
}

/** What a line is worth to seat 0, given each seat's chips in it: open threes and twos count. */
function lineValue(mine: number, theirs: number): number {
  if (theirs === 0) return mine === 3 ? 5 : mine === 2 ? 2 : 0;
  if (mine === 0) return theirs === 3 ? -5 : theirs === 2 ? -2 : 0;
  return 0;
}

/**
 * A mutable board for the search. Dropping and undoing a chip updates each
 * line's chip counts and a running score, so a win check and a position
 * guess are both instant.
 */
class Search {
  readonly heights = new Int8Array(COLS);
  /** Chips per line: [seat 0, seat 1] for line i at 2i and 2i + 1. */
  private readonly counts = new Uint8Array(WINDOWS.length * 2);
  /** The position's score for seat 0. */
  private total = 0;
  private filled = 0;

  constructor(b: Board) {
    for (let c = 0; c < COLS; c++) {
      for (let r = ROWS - 1; r >= 0; r--) {
        const seat = b.cells[at(r, c)];
        if (seat === null || seat === undefined) break;
        this.place(seat, c);
      }
    }
  }

  /** `seat` plays `col`; the result is from `seat`'s side, higher is better. */
  score(seat: Seat, col: number, depth: number, alpha: number, beta: number): number {
    let score: number;
    // A sooner win scores higher, a later loss less badly.
    if (this.place(seat, col)) score = WIN + depth;
    else if (this.filled === ROWS * COLS) score = 0;
    else if (depth <= 1) score = seat === 0 ? this.total : -this.total;
    else score = -this.best((1 - seat) as Seat, depth - 1, -beta, -alpha);
    this.undo(seat, col);
    return score;
  }

  /** The best score `seat` can reach from here, cut off once it can't beat `beta`. */
  private best(seat: Seat, depth: number, alpha: number, beta: number): number {
    const other = (1 - seat) as Seat;
    let forced = -1;
    let threats = 0;
    for (const c of ORDER) {
      if (this.heights[c] === ROWS) continue;
      if (this.wouldWin(seat, c)) return WIN + depth;
      if (this.wouldWin(other, c)) {
        forced = c;
        threats++;
      }
    }
    // Two threats can't both be blocked: the other player wins next. Checked
    // only after every column, so a win of our own in a later column comes first.
    if (threats > 1) return -(WIN + depth - 1);
    // One threat: every other column loses at once, so only the block is worth searching.
    if (forced >= 0) return this.score(seat, forced, depth, alpha, beta);
    let best = -Infinity;
    for (const c of ORDER) {
      if (this.heights[c] === ROWS) continue;
      const v = this.score(seat, c, depth, alpha, beta);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** True when a chip of `seat`'s in `col` would make four. */
  private wouldWin(seat: Seat, col: number): boolean {
    for (const w of CELL_WINDOWS[at(ROWS - 1 - this.heights[col]!, col)]!) {
      if (this.counts[w * 2 + seat] === 3) return true;
    }
    return false;
  }

  /** Drops `seat`'s chip in `col`. Returns true when it makes four. */
  private place(seat: Seat, col: number): boolean {
    const cell = at(ROWS - 1 - this.heights[col]!, col);
    let win = false;
    for (const w of CELL_WINDOWS[cell]!) {
      const before = lineValue(this.counts[w * 2]!, this.counts[w * 2 + 1]!);
      if (++this.counts[w * 2 + seat]! === 4) win = true;
      this.total += lineValue(this.counts[w * 2]!, this.counts[w * 2 + 1]!) - before;
    }
    if (col === CENTRE) this.total += seat === 0 ? 3 : -3;
    this.heights[col]! += 1;
    this.filled += 1;
    return win;
  }

  private undo(seat: Seat, col: number): void {
    this.heights[col]! -= 1;
    this.filled -= 1;
    const cell = at(ROWS - 1 - this.heights[col]!, col);
    for (const w of CELL_WINDOWS[cell]!) {
      const before = lineValue(this.counts[w * 2]!, this.counts[w * 2 + 1]!);
      this.counts[w * 2 + seat]! -= 1;
      this.total += lineValue(this.counts[w * 2]!, this.counts[w * 2 + 1]!) - before;
    }
    if (col === CENTRE) this.total -= seat === 0 ? 3 : -3;
  }
}
