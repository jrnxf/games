// The computer player, with no DOM. Easy and Medium follow plain rules: don't
// give a box its third side, take a box on offer, and give away the least when
// there is nothing else. Hard adds a search. While safe lines remain it tries
// every order of them, to be the one who does not have to open the first long
// chain (the long-chain rule). In the endgame it searches the chains and
// loops, and it leaves the last two boxes of a chain when that keeps the
// other player opening the next one (a double-deal). The search is capped by
// positions, not by the clock, and all randomness comes from a seed stored
// with the game, so a move is a pure function of the board, the level and the
// seed: a reload replays the same game and the computer's pending move.

import { BOXES, BOX_LINES, LINES, LINE_BOXES, type Board } from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

/**
 * `takes` is the chance to close a box on offer. With `least`, a level that
 * must give boxes away gives the fewest. `budget` caps the positions the
 * search scores, and 0 means no search: over the budget, the level falls back
 * to the plain rules, which keeps Hard within about 300 ms on a phone. The
 * search starts once `safe` or fewer safe lines are left.
 */
export const LEVELS: Record<Level, { takes: number; least: boolean; budget: number; safe: number }> = {
  easy: { takes: 0.5, least: false, budget: 0, safe: 0 },
  medium: { takes: 1, least: true, budget: 0, safe: 0 },
  hard: { takes: 1, least: true, budget: 40_000, safe: 24 },
};

/** The first box each line touches, and the second, or -1 on the rim. */
const FIRST = LINE_BOXES.map((boxes) => boxes[0]!);
const SECOND = LINE_BOXES.map((boxes) => boxes[1] ?? -1);

/** One move of the computer's, with the search behind it. */
export interface Thought {
  line: number;
  /** How many positions the search scored. 0 when the move came from the plain rules. */
  positions: number;
  /** How long the move took, in milliseconds. */
  ms: number;
  /** True when the search read the game to its end. Once no safe line is left, the move is then exact. */
  exact: boolean;
}

/** The line the computer draws on `b` for the player on turn. The board must not be over. */
export function computerMove(b: Board, level: Level, seed: number): number {
  return think(b, level, seed).line;
}

/** The computer's move on `b`, with how much it searched and how long it took. The board must not be over. */
export function think(b: Board, level: Level, seed: number): Thought {
  if (b.over) throw new Error("no legal move");
  // Each move gets its own stream, so the answer depends only on the position.
  const rand = rng(seed ^ Math.imul(b.moves.length + 1, 0x9e3779b1));
  const { takes, least, budget, safe } = LEVELS[level];
  const pick = (lines: number[]) => lines[Math.floor(rand() * lines.length)]!;
  const t0 = performance.now();
  const s = new Search(b);
  let line = -1;
  let exact = false;
  if (budget > 0 && s.safe().length <= safe) {
    const found = search(s, budget);
    if (found) {
      line = pick(found.best);
      exact = found.exact;
    }
  }
  if (line < 0) line = plain(s, takes, least, rand, pick);
  return { line, positions: s.positions, ms: performance.now() - t0, exact };
}

/** Every line that scores best for the player on turn, or null when the search runs out of `budget`. */
export function bestLines(b: Board, budget = Infinity): number[] | null {
  return search(new Search(b), budget)?.best ?? null;
}

/** The plain rules: take a box, else draw a safe line, else give boxes away. */
function plain(
  s: Search,
  takes: number,
  least: boolean,
  rand: () => number,
  pick: (lines: number[]) => number,
): number {
  const closing = s.closing();
  if (closing.length > 0 && rand() < takes) return pick(closing);
  const safe = s.safe();
  if (safe.length > 0) return pick(safe);
  // Every line left gives boxes away. A level that passed up a box still takes it when nothing else is left.
  const rest = s.open().filter((l) => !closing.includes(l));
  if (rest.length === 0) return pick(closing);
  if (!least) return pick(rest);
  const gifts = s.gifts();
  const fewest = Math.min(...gifts.map((g) => g.size));
  return pick(gifts.filter((g) => g.size === fewest).map((g) => g.line));
}

/**
 * Two passes. The first reads on until neither a box nor a safe line is left
 * and scores what remains as chains and loops. The second reads to the end of
 * the game. Each pass that runs out of budget is dropped.
 */
function search(s: Search, budget: number): { best: number[]; exact: boolean } | null {
  let best: number[] | null = null;
  let exact = false;
  for (const whole of [false, true]) {
    s.reset(whole, s.positions + budget);
    const lines = s.loud() ?? s.gifts().map((g) => g.line);
    let top = -Infinity;
    let found: number[] = [];
    try {
      for (const line of lines) {
        const score = s.score(line);
        if (score > top) {
          top = score;
          found = [line];
        } else if (score === top) found.push(line);
      }
    } catch (e) {
      if (e !== OUT_OF_BUDGET) throw e;
      break;
    }
    best = found;
    exact = whole;
  }
  return best && { best, exact };
}

// ---------- search ----------

const OUT_OF_BUDGET = Symbol("out of budget");

/** A way to give boxes away: the line, and the boxes the other player can then take in a row. */
interface Gift {
  line: number;
  /** One bit per box taken. */
  boxes: number;
  size: number;
  /** How many boxes the line gives a third side: two in the middle of a chain or in a loop, one at a chain's end. */
  thirds: number;
}

/**
 * A mutable board for the search. Who drew a line does not matter, only that
 * it is drawn, and a score is the boxes still to come for the player on turn
 * minus those for the other player.
 */
class Search {
  private readonly drawn = new Uint8Array(LINES);
  private readonly sides = new Uint8Array(BOXES);
  private left = LINES;
  /** The drawn lines as two 30-bit numbers, for the memo. */
  private lo = 0;
  private hi = 0;
  private readonly memo = new Map<number, Map<number, number>>();
  /** Scores of sets of chains and loops, by their sizes. */
  private readonly fights = new Map<string, number>();
  private whole = false;
  /** Positions scored so far, for showing how much was searched. */
  positions = 0;
  private budget = Infinity;

  constructor(b: Board) {
    for (let i = 0; i < LINES; i++) if (b.lines[i] !== null) this.draw(i);
  }

  /** Starts a pass. With `whole` it reads to the end of the game. */
  reset(whole: boolean, budget: number): void {
    this.whole = whole;
    this.budget = budget;
    this.memo.clear();
  }

  /** Every line not drawn yet. */
  open(): number[] {
    const out: number[] = [];
    for (let i = 0; i < LINES; i++) if (!this.drawn[i]) out.push(i);
    return out;
  }

  /** The lines that close a box. */
  closing(): number[] {
    return this.open().filter((l) => this.sides[FIRST[l]!] === 3 || this.third(SECOND[l]!) === 3);
  }

  /** The lines that give no box its third side and close none. */
  safe(): number[] {
    return this.open().filter((l) => this.sides[FIRST[l]!]! <= 1 && this.third(SECOND[l]!) <= 1);
  }

  /** The sides of `box`, or -1 past the rim. */
  private third(box: number): number {
    return box < 0 ? -1 : this.sides[box]!;
  }

  /** The player on turn draws `line`; the result is from that player's side, higher is better. Throws once the budget is spent. */
  score(line: number): number {
    const closed = this.draw(line);
    try {
      return closed > 0 ? closed + this.best() : -this.best();
    } finally {
      this.undraw(line);
    }
  }

  /** The best score the player on turn can reach from here. */
  private best(): number {
    if (this.left === 0) return 0;
    let row = this.memo.get(this.hi);
    const known = row?.get(this.lo);
    if (known !== undefined) return known;
    if (++this.positions > this.budget) throw OUT_OF_BUDGET;
    const lo = this.lo;
    let best = -Infinity;
    const loud = this.loud();
    if (!loud && !this.whole) best = this.fight();
    else {
      for (const line of loud ?? this.gifts().map((g) => g.line)) {
        const v = this.score(line);
        if (v > best) best = v;
      }
    }
    if (!row) this.memo.set(this.hi, (row = new Map()));
    row.set(lo, best);
    return best;
  }

  /**
   * The lines worth trying while a box is on offer or a safe line is left, or
   * null when there is neither. A box with no cost is always taken. Next to
   * taking, the mover may leave the last two boxes of a chain, or the last
   * four of a loop, to hand the turn over. With no box on offer, only the
   * safe lines count: the search never gives boxes away early.
   */
  loud(): number[] | null {
    const takes: number[] = [];
    const deals: number[] = [];
    const safe: number[] = [];
    for (let line = 0; line < LINES; line++) {
      if (this.drawn[line]) continue;
      const a = FIRST[line]!;
      const b = SECOND[line]!;
      const sa = this.sides[a]!;
      const sb = this.third(b);
      // Two boxes with one line cost nothing.
      if (sa === 3 && sb === 3) return [line];
      if (sa === 3 || sb === 3) {
        const deal = this.deal(line, sa === 3 ? b : a);
        if (deal < 0) return [line];
        takes.push(line);
        if (!deals.includes(deal)) deals.push(deal);
      } else if (sa <= 1 && sb <= 1) safe.push(line);
    }
    if (takes.length > 0) return [...takes, ...deals];
    return safe.length > 0 ? safe : null;
  }

  /**
   * `line` closes a box and leads into `next`. Returns the line past `next`
   * that leaves both boxes for the other player instead, or -1 when the chain
   * goes on and there is nothing to leave yet.
   */
  private deal(line: number, next: number): number {
    if (next < 0 || this.sides[next] !== 2) return -1;
    const past = this.exit(next, line);
    const beyond = FIRST[past] === next ? SECOND[past]! : FIRST[past]!;
    // The chain ends at the rim, or at a box with room to spare.
    if (beyond < 0 || this.sides[beyond]! <= 1) return past;
    if (this.sides[beyond] !== 2) return -1;
    // Four boxes left of a loop: the two past this pair are closed off too.
    const last = this.exit(beyond, past);
    const end = FIRST[last] === beyond ? SECOND[last]! : FIRST[last]!;
    return end >= 0 && this.sides[end] === 3 ? past : -1;
  }

  /** The open line of `box` that is not `line`. The box must have two open lines. */
  private exit(box: number, line: number): number {
    for (const l of BOX_LINES[box]!) if (!this.drawn[l] && l !== line) return l;
    throw new Error("no way out of the box");
  }

  /**
   * Every different way to give boxes away, when no box is on offer and no
   * safe line is left. Lines that hand over the same boxes count once, apart
   * from a line in the middle of a chain and one at its end: the middle of a
   * chain of two leaves nothing to deal back.
   */
  gifts(): Gift[] {
    const out: Gift[] = [];
    for (let line = 0; line < LINES; line++) {
      if (this.drawn[line]) continue;
      const thirds = (this.sides[FIRST[line]!] === 2 ? 1 : 0) + (this.third(SECOND[line]!) === 2 ? 1 : 0);
      if (thirds === 0) continue;
      const boxes = this.sweep(line);
      if (out.some((g) => g.boxes === boxes && g.thirds === thirds)) continue;
      let size = 0;
      for (let m = boxes; m !== 0; m &= m - 1) size++;
      out.push({ line, boxes, size, thirds });
    }
    return out;
  }

  /** The boxes the other player can close in a row once `line` is drawn. Leaves the board as it was. */
  private sweep(line: number): number {
    const done = [line];
    const todo = [FIRST[line]!, SECOND[line]!];
    let boxes = 0;
    this.draw(line);
    while (todo.length > 0) {
      const box = todo.pop()!;
      if (box < 0 || this.sides[box] !== 3) continue;
      const l = BOX_LINES[box]!.find((x) => !this.drawn[x])!;
      this.draw(l);
      done.push(l);
      for (const hit of [FIRST[l]!, SECOND[l]!]) {
        if (hit < 0) continue;
        if (this.sides[hit] === 4) boxes |= 1 << hit;
        else todo.push(hit);
      }
    }
    for (const l of done) this.undraw(l);
    return boxes;
  }

  /**
   * A guess for the player who must give boxes away, with the board read as
   * separate chains and loops. It is exact when that is all the board holds.
   */
  private fight(): number {
    const parts: number[] = [];
    const gifts = this.gifts();
    let seen = 0;
    for (const g of gifts) {
      if (seen & g.boxes) continue;
      seen |= g.boxes;
      // A chain has an end to open it from. A loop has none.
      const loop = g.size >= 4 && !gifts.some((x) => x.boxes === g.boxes && x.thirds === 1);
      parts.push(g.size * 2 + (loop ? 1 : 0));
    }
    return this.fought(parts.sort((x, y) => x - y));
  }

  /**
   * The score for the player who must open one of `parts` (size times two,
   * plus one for a loop). The other player takes it all and opens the next,
   * or leaves two boxes of a chain of three or more (four of a loop) and
   * makes the opener open again.
   */
  private fought(parts: number[]): number {
    if (parts.length === 0) return 0;
    const key = parts.join();
    const known = this.fights.get(key);
    if (known !== undefined) return known;
    let best = -Infinity;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === parts[i - 1]) continue;
      const size = parts[i]! >> 1;
      const loop = (parts[i]! & 1) === 1;
      const rest = this.fought(parts.filter((_, j) => j !== i));
      const all = size + rest;
      const kept = loop ? size - 8 - rest : size >= 3 ? size - 4 - rest : -Infinity;
      best = Math.max(best, -Math.max(all, kept));
    }
    this.fights.set(key, best);
    return best;
  }

  /** Draws `line`. Returns the boxes it closes. */
  private draw(line: number): number {
    this.drawn[line] = 1;
    this.left--;
    if (line < 30) this.lo ^= 1 << line;
    else this.hi ^= 1 << (line - 30);
    let closed = 0;
    if (++this.sides[FIRST[line]!]! === 4) closed++;
    const b = SECOND[line]!;
    if (b >= 0 && ++this.sides[b]! === 4) closed++;
    return closed;
  }

  private undraw(line: number): void {
    this.drawn[line] = 0;
    this.left++;
    if (line < 30) this.lo ^= 1 << line;
    else this.hi ^= 1 << (line - 30);
    this.sides[FIRST[line]!]!--;
    const b = SECOND[line]!;
    if (b >= 0) this.sides[b]!--;
  }
}
