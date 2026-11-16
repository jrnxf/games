// The computer player, with no DOM: a Monte Carlo tree search. Each playout
// walks the tree by the UCT rule, adds one position, and plays the game to the
// end with random marks. A playout takes a mark that wins the whole game when
// there is one, which makes the random games far more telling. Before the
// search, the computer takes a win in one, and it leaves out every mark that
// hands the other player a win in one. Each level is a number of playouts plus
// a chance of a random mark. The search is capped by playouts first and by the
// clock second. All randomness comes from a seed stored with the game, so
// while the clock does not cut the search short, a move is a pure function of
// the board, the level and the seed: a reload replays the same game and the
// computer's pending move.

import { BOARDS, LINES, SPOTS, legalMoves, type Board } from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

/**
 * `playouts` caps the random games of one move. `ms` caps the time: a slow
 * phone stops there and plays the best mark so far, which keeps Hard within
 * about 300 ms.
 */
export const LEVELS: Record<Level, { playouts: number; ms: number; mistake: number }> = {
  easy: { playouts: 40, ms: 250, mistake: 0.3 },
  medium: { playouts: 600, ms: 250, mistake: 0.1 },
  hard: { playouts: 12_000, ms: 250, mistake: 0 },
};

/** How much the search favours a mark it tried little over one that scores well. */
const EXPLORE = 1;

/** The clock is read once per this many playouts. */
const CLOCK_EVERY = 64;

/** One move of the computer's, with the search behind it. */
export interface Thought {
  cell: number;
  /** How many random games the search played. */
  playouts: number;
  /** How long the search took, in milliseconds. */
  ms: number;
  /** The clock stopped the search before it played all its games. */
  capped: boolean;
}

/** The cell the computer plays on `b` for the player on turn. The board must not be over. */
export function computerMove(b: Board, level: Level, seed: number): number {
  return think(b, level, seed).cell;
}

/**
 * The computer's move on `b`, with how much it searched and how long it took.
 * The board must not be over. `ms` is the time cap: pass `Infinity` for a move
 * that never depends on the clock.
 */
export function think(b: Board, level: Level, seed: number, ms = LEVELS[level].ms): Thought {
  const legal = legalMoves(b);
  if (legal.length === 0) throw new Error("no legal move");
  // Each move gets its own stream, so the answer depends only on the position.
  const rand = rng(seed ^ Math.imul(b.moves.length + 1, 0x9e3779b1));
  const { playouts, mistake } = LEVELS[level];
  // The search runs even for a move thrown away, so every move has its numbers.
  const t0 = performance.now();
  const found = search(b, playouts, ms, Math.floor(rand() * 4294967296));
  const took = performance.now() - t0;
  const cell =
    rand() < mistake
      ? legal[Math.floor(rand() * legal.length)]!
      : found.best[Math.floor(rand() * found.best.length)]!;
  return { cell, playouts: found.playouts, ms: took, capped: found.capped };
}

/** Every cell the search likes best for the player on turn, after at most `playouts` random games. */
export function bestCells(b: Board, playouts: number, seed = 1): number[] {
  return search(b, playouts, Infinity, seed).best;
}

function search(
  b: Board,
  playouts: number,
  ms: number,
  seed: number,
): { best: number[]; playouts: number; capped: boolean } {
  const root = new Position();
  root.load(b);
  const me = root.turn;
  const pos = new Position();
  const wins: number[] = [];
  const safe: number[] = [];
  const legal = root.moves();
  for (const cell of legal) {
    pos.copy(root);
    pos.play(cell);
    if (pos.over === me) wins.push(cell);
    else if (pos.over !== NOT_OVER || pos.winningCell() < 0) safe.push(cell);
  }
  if (wins.length) return { best: wins, playouts: 0, capped: false };
  // With no safe mark, every mark loses to a good reply: search them all.
  const moves = safe.length ? safe : legal;
  if (moves.length === 1) return { best: moves, playouts: 0, capped: false };

  const random = new Random(seed);
  const top = new Node(-1, me, null, moves);
  const t0 = performance.now();
  let played = 0;
  let capped = false;
  while (played < playouts) {
    if (played % CLOCK_EVERY === 0 && played > 0 && performance.now() - t0 > ms) {
      capped = true;
      break;
    }
    pos.copy(root);
    let node = top;
    // Down the tree, by the best mix of score and curiosity.
    while (node.untried.length === 0 && node.children.length > 0) {
      node = node.pick();
      pos.play(node.cell);
    }
    // One new position per playout.
    if (node.untried.length > 0) {
      const i = random.below(node.untried.length);
      const cell = node.untried[i]!;
      node.untried[i] = node.untried[node.untried.length - 1]!;
      node.untried.pop();
      const mover = pos.turn;
      pos.play(cell);
      const child = new Node(cell, mover, node, pos.over === NOT_OVER ? pos.moves() : []);
      node.children.push(child);
      node = child;
    }
    const result = pos.playout(random);
    for (let n: Node | null = node; n; n = n.parent) {
      n.visits++;
      if (result === DRAWN) n.value += 0.5;
      else if (result === n.mover) n.value++;
    }
    played++;
  }

  // The mark tried most is the one the search trusts most.
  let most = -1;
  let best: number[] = [];
  for (const child of top.children) {
    if (child.visits > most) {
      most = child.visits;
      best = [child.cell];
    } else if (child.visits === most) best.push(child.cell);
  }
  // Fewer playouts than marks: the ones never tried are as good a guess.
  if (most <= 0) best = moves;
  return { best: best.sort((x, y) => x - y), playouts: played, capped };
}

// ---------- search ----------

/** Every spot of a small board, or every small board, as bits. */
const ALL = (1 << SPOTS) - 1;

const NOT_OVER = -1;
const DRAWN = 2;

/** For each set of nine marks as bits: does it hold a line? */
const WON = new Uint8Array(ALL + 1);
/** For each set of nine marks as bits: the empty places that would complete a line. */
const WINS_AT = new Uint16Array(ALL + 1);
/** For each set of nine marks as bits: how many are set. */
const COUNT = new Uint8Array(ALL + 1);
for (let m = 0; m <= ALL; m++) {
  WON[m] = LINES.some((line) => line.every((i) => m & (1 << i))) ? 1 : 0;
  for (let i = 0; i < SPOTS; i++) if (m & (1 << i)) COUNT[m]!++;
}
for (let m = 0; m <= ALL; m++) {
  for (let i = 0; i < SPOTS; i++) if (!(m & (1 << i)) && WON[m | (1 << i)]) WINS_AT[m]! |= 1 << i;
}

/** A small, fast generator for the playouts (xorshift32). */
class Random {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0 || 0x9e3779b1;
  }

  /** A whole number from 0 up to, not including, `n`. */
  below(n: number): number {
    let a = this.a;
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    this.a = a;
    return (a >>> 0) % n;
  }
}

/** One position of the tree: the mark that led to it and how its playouts went. */
class Node {
  readonly cell: number;
  /** The seat that played `cell`. */
  readonly mover: number;
  readonly parent: Node | null;
  /** The marks from here that have no position yet. */
  readonly untried: number[];
  readonly children: Node[] = [];
  visits = 0;
  /** Playouts won by `mover`, with half for a draw. */
  value = 0;

  constructor(cell: number, mover: number, parent: Node | null, untried: number[]) {
    this.cell = cell;
    this.mover = mover;
    this.parent = parent;
    this.untried = untried;
  }

  /** The child to try next (UCT). Every child has at least one playout. */
  pick(): Node {
    const log = Math.log(this.visits);
    let best = this.children[0]!;
    let top = -Infinity;
    for (const child of this.children) {
      const score = child.value / child.visits + EXPLORE * Math.sqrt(log / child.visits);
      if (score > top) {
        top = score;
        best = child;
      }
    }
    return best;
  }
}

/** A mutable board for the search, with each small board as two sets of bits. */
class Position {
  /** The marks of seat 0 on each small board, then those of seat 1. */
  private readonly marks = new Uint16Array(2 * BOARDS);
  /** The small boards each seat won, as bits. */
  private readonly held = new Uint16Array(2);
  /** The small boards that are won or full, as bits. */
  private closed = 0;
  /** The small board to play in, or -1 for any open board. */
  private target = -1;
  turn = 0;
  /** `NOT_OVER`, the seat that won, or `DRAWN`. */
  over = NOT_OVER;

  load(b: Board): void {
    this.marks.fill(0);
    this.held.fill(0);
    this.closed = 0;
    for (let board = 0; board < BOARDS; board++) {
      for (let spot = 0; spot < SPOTS; spot++) {
        const seat = b.cells[board * SPOTS + spot];
        if (seat !== null && seat !== undefined) this.marks[seat * BOARDS + board]! |= 1 << spot;
      }
      const won = b.won[board];
      if (won !== null && won !== undefined) this.held[won]! |= 1 << board;
      const full = (this.marks[board]! | this.marks[BOARDS + board]!) === ALL;
      if (full || (won !== null && won !== undefined)) this.closed |= 1 << board;
    }
    this.target = b.target ?? -1;
    this.turn = b.turn;
    this.over = b.winner ?? (b.draw ? DRAWN : NOT_OVER);
  }

  copy(from: Position): void {
    this.marks.set(from.marks);
    this.held.set(from.held);
    this.closed = from.closed;
    this.target = from.target;
    this.turn = from.turn;
    this.over = from.over;
  }

  /** The legal moves of the player on turn, in cell order. The game must not be over. */
  moves(): number[] {
    const out: number[] = [];
    for (let board = 0; board < BOARDS; board++) {
      if (this.target >= 0 ? board !== this.target : this.closed & (1 << board)) continue;
      const taken = this.marks[board]! | this.marks[BOARDS + board]!;
      for (let spot = 0; spot < SPOTS; spot++) if (!(taken & (1 << spot))) out.push(board * SPOTS + spot);
    }
    return out;
  }

  /** Plays a legal `cell` for the player on turn, as `play` of the rules does. */
  play(cell: number): void {
    const seat = this.turn;
    const board = Math.floor(cell / SPOTS);
    const spot = cell % SPOTS;
    const mine = (this.marks[seat * BOARDS + board]! |= 1 << spot);
    if (WON[mine]) {
      this.closed |= 1 << board;
      if (WON[(this.held[seat]! |= 1 << board)]) {
        this.over = seat;
        return;
      }
    } else if ((mine | this.marks[(1 - seat) * BOARDS + board]!) === ALL) this.closed |= 1 << board;
    if (this.closed === ALL) {
      this.over = DRAWN;
      return;
    }
    this.target = this.closed & (1 << spot) ? -1 : spot;
    this.turn = 1 - seat;
  }

  /** A cell that wins the whole game for the player on turn, or -1. */
  winningCell(): number {
    const seat = this.turn;
    // The open small boards that would complete a line of three.
    let boards = WINS_AT[this.held[seat]!]! & ~this.closed;
    if (this.target >= 0) boards &= 1 << this.target;
    for (let board = 0; boards; board++, boards >>= 1) {
      if (!(boards & 1)) continue;
      const mine = this.marks[seat * BOARDS + board]!;
      const spots = WINS_AT[mine]! & ~this.marks[(1 - seat) * BOARDS + board]!;
      if (spots) return board * SPOTS + (31 - Math.clz32(spots & -spots));
    }
    return -1;
  }

  /** Plays random marks to the end of the game. Returns the seat that won, or `DRAWN`. */
  playout(random: Random): number {
    while (this.over === NOT_OVER) {
      if (this.winningCell() >= 0) return this.turn;
      let board = this.target;
      let k: number;
      if (board >= 0) {
        k = random.below(SPOTS - COUNT[this.marks[board]! | this.marks[BOARDS + board]!]!);
      } else {
        let empty = 0;
        for (let i = 0; i < BOARDS; i++) {
          if (!(this.closed & (1 << i))) empty += SPOTS - COUNT[this.marks[i]! | this.marks[BOARDS + i]!]!;
        }
        k = random.below(empty);
        for (board = 0; ; board++) {
          if (this.closed & (1 << board)) continue;
          const here = SPOTS - COUNT[this.marks[board]! | this.marks[BOARDS + board]!]!;
          if (k < here) break;
          k -= here;
        }
      }
      const taken = this.marks[board]! | this.marks[BOARDS + board]!;
      let spot = 0;
      for (; ; spot++) {
        if (taken & (1 << spot)) continue;
        if (k === 0) break;
        k--;
      }
      this.play(board * SPOTS + spot);
    }
    return this.over;
  }
}
