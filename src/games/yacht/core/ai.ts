// The computer player, with no DOM. Each call picks the next action for the
// player on turn: a roll with some dice held, or a box to score.
//
// Hard plays by expected value. A hand of five dice is a multiset (252 of
// them), and so is any set of dice kept (462, of sizes 0 to 5). With no
// rolls left, a hand is worth its best box. With rolls left, a hand is worth
// the best keep: the average, over every way the other dice can land, of what
// the new hand is worth with one roll fewer. That is exact for the turn and
// takes about a millisecond. A box's worth is its points less a par (what the
// box scores on average in good play), plus the change in the chance of the
// upper bonus, so the computer doesn't spend a box it can fill better later.
//
// Medium uses the same search but looks only one roll ahead, and values a box
// by points less par, with no bonus sense, and a quarter of its actions are
// Easy's. Easy keeps its most common face,
// scores the box with the most points, and now and then picks a box at random.
//
// All randomness comes from a seed stored with the game, so an action is a
// pure function of the game, the level and the seed: a reload replays it.

import {
  ALL_HELD,
  BOXES,
  BONUS_AT,
  DICE,
  EXTRA_YACHT,
  ONES,
  ROLLS,
  SIXES,
  UPPER_BONUS,
  canScore,
  earnsExtra,
  isUpper,
  isYacht,
  rollAction,
  scoreFor,
  upperSum,
  type Card,
  type Game,
} from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

/** What a box scores on average when a good player fills it, in card order. */
export const PAR = [2, 5, 8, 11, 14, 17, 22, 13, 22, 29, 32, 16, 22];

/** Easy picks a box at random this often. */
const EASY_SLIP = 0.2;
/** Medium plays an action the way Easy would this often. */
const MEDIUM_SLIP = 0.25;

export interface Thought {
  action: number;
  /** How long the choice took, in milliseconds. */
  ms: number;
}

/** The next action of the player on turn. The game must not be over. */
export function computerAction(g: Game, level: Level, seed: number): number {
  return think(g, level, seed).action;
}

export function think(g: Game, level: Level, seed: number): Thought {
  if (g.over) throw new Error("the game is over");
  const t0 = performance.now();
  // Each action gets its own stream, so the answer depends only on the game.
  const rand = rng(seed ^ Math.imul(g.actions.length + 1, 0x9e3779b1));
  const action = g.rolls === 0 ? rollAction(0) : choose(g, level, rand);
  return { action, ms: performance.now() - t0 };
}

function choose(g: Game, level: Level, rand: () => number): number {
  const card = g.cards[g.turn];
  const left = ROLLS - g.rolls;
  // Medium slips into Easy's play now and then.
  if (level === "easy" || (level === "medium" && rand() < MEDIUM_SLIP)) return easy(card, g.dice, left, rand);
  const value = level === "hard" ? boxValue : plainValue;
  const plan = bestKeep(card, g.dice, level === "hard" ? left : Math.min(left, 1), value);
  if (plan === null) return bestBox(card, g.dice, value);
  return rollAction(maskOf(g.dice, plan));
}

// ---------- easy ----------

function easy(card: Card, dice: readonly number[], left: number, rand: () => number): number {
  const legal = [...Array(BOXES).keys()].filter((b) => canScore(card, b, dice));
  const raw = (b: number) => scoreFor(card, b, dice)! + (earnsExtra(card, dice) ? EXTRA_YACHT : 0);
  const best = legal.reduce((a, b) => (raw(b) > raw(a) ? b : a));
  // A made hand of 25 or more is enough for Easy.
  if (left === 0 || isYacht(dice) || raw(best) >= 25) {
    return rand() < EASY_SLIP ? legal[Math.floor(rand() * legal.length)]! : best;
  }
  const c = counts6(dice);
  let face = 6;
  for (let f = 6; f >= 1; f--) if (c[f]! > c[face]!) face = f;
  let mask = 0;
  dice.forEach((d, i) => {
    if (d === face) mask |= 1 << i;
  });
  return rollAction(mask === ALL_HELD ? 0 : mask);
}

// ---------- box values ----------

type Value = (card: Card, box: number, dice: readonly number[]) => number;

/** The chance the upper section still reaches the bonus, a rough guess from what is open. */
export function bonusChance(card: Card): number {
  const have = upperSum(card);
  if (have >= BONUS_AT) return 1;
  let par = 0;
  let open = 0;
  for (let b = ONES; b <= SIXES; b++) {
    if (card.boxes[b] === null) {
      par += 3 * (b + 1);
      open++;
    }
  }
  if (open === 0) return 0;
  return 1 / (1 + Math.exp(-(have + par - BONUS_AT) / 5));
}

/** Hard's worth of scoring `dice` in `box`: points less par, plus the bonus gained or lost. */
const boxValue: Value = (card, box, dice) => {
  const points = scoreFor(card, box, dice);
  if (points === null) return -Infinity;
  let v = points + (earnsExtra(card, dice) ? EXTRA_YACHT : 0) - PAR[box]!;
  if (isUpper(box)) {
    const boxes = card.boxes.slice();
    boxes[box] = points;
    v += UPPER_BONUS * (bonusChance({ boxes, extra: card.extra }) - bonusChance(card));
  }
  return v;
};

/** Medium's worth: points less par. */
const plainValue: Value = (card, box, dice) => {
  const points = scoreFor(card, box, dice);
  if (points === null) return -Infinity;
  return points + (earnsExtra(card, dice) ? EXTRA_YACHT : 0) - PAR[box]!;
};

function bestBox(card: Card, dice: readonly number[], value: Value): number {
  let best = -1;
  let top = -Infinity;
  for (let b = 0; b < BOXES; b++) {
    const v = value(card, b, dice);
    if (v > top) {
      top = v;
      best = b;
    }
  }
  return best;
}

// ---------- the dice search ----------

/** How many of each face, indexed 1 to 6. */
function counts6(dice: readonly number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]!++;
  return c;
}

/** A multiset's key: its counts in base 6, so every multiset of up to five dice has its own. */
const keyOf = (c: readonly number[]) =>
  c[1]! + 6 * (c[2]! + 6 * (c[3]! + 6 * (c[4]! + 6 * (c[5]! + 6 * c[6]!))));

interface Tables {
  /** Every hand of five, as counts. */
  hands: number[][];
  /** A hand's place in `hands`, by key. */
  handAt: Map<number, number>;
  /** Every keep of 0 to 5 dice, as counts. */
  keeps: number[][];
  keepAt: Map<number, number>;
  /** For each keep, the hands a roll of the other dice can make, with their chances. */
  next: { hand: number; p: number }[][];
}

let tables: Tables | null = null;

/** Every multiset of `n` dice, as counts indexed 1 to 6. */
function multisets(n: number): number[][] {
  const out: number[][] = [];
  const c = [0, 0, 0, 0, 0, 0, 0];
  const go = (face: number, left: number) => {
    if (face === 6) {
      c[6] = left;
      out.push(c.slice());
      return;
    }
    for (let k = left; k >= 0; k--) {
      c[face] = k;
      go(face + 1, left - k);
    }
  };
  go(1, n);
  return out;
}

const FACT = [1, 1, 2, 6, 24, 120];

function build(): Tables {
  const hands = multisets(DICE);
  const handAt = new Map(hands.map((h, i) => [keyOf(h), i]));
  const keeps: number[][] = [];
  for (let n = 0; n <= DICE; n++) keeps.push(...multisets(n));
  const keepAt = new Map(keeps.map((k, i) => [keyOf(k), i]));
  const next = keeps.map((k) => {
    const m = DICE - k.reduce((a, b) => a + b, 0);
    return multisets(m).map((o) => {
      let ways = FACT[m]!;
      for (let f = 1; f <= 6; f++) ways /= FACT[o[f]!]!;
      const hand = k.map((x, f) => x + o[f]!);
      return { hand: handAt.get(keyOf(hand))!, p: ways / 6 ** m };
    });
  });
  return { hands, handAt, keeps, keepAt, next };
}

/** Every keep from a hand, as counts: each face kept 0 up to as many times as it shows. */
function keepsOf(hand: readonly number[]): number[][] {
  const out: number[][] = [];
  const c = [0, 0, 0, 0, 0, 0, 0];
  const go = (face: number) => {
    if (face > 6) {
      out.push(c.slice());
      return;
    }
    for (let k = 0; k <= hand[face]!; k++) {
      c[face] = k;
      go(face + 1);
    }
  };
  go(1);
  return out;
}

const facesOf = (c: readonly number[]) => c.flatMap((n, f) => Array<number>(n).fill(f));

/**
 * The keep that is worth most with `left` rolls to go, as counts, or null
 * when scoring now is worth at least as much. Every hand is valued with
 * `value` for its best box.
 */
export function bestKeep(card: Card, dice: readonly number[], left: number, value: Value): number[] | null {
  if (left <= 0) return null;
  tables ??= build();
  const t = tables;
  // A hand's worth with no rolls left.
  let worth = t.hands.map((h) => {
    const d = facesOf(h);
    let top = -Infinity;
    for (let b = 0; b < BOXES; b++) top = Math.max(top, value(card, b, d));
    return top;
  });
  const now = worth;
  let keepWorth: Float64Array = new Float64Array(t.keeps.length);
  for (let r = 1; r <= left; r++) {
    keepWorth = new Float64Array(t.keeps.length);
    for (let i = 0; i < t.keeps.length; i++) {
      let e = 0;
      for (const { hand, p } of t.next[i]!) e += p * worth[hand]!;
      keepWorth[i] = e;
    }
    if (r === left) break;
    // Keeping all five and scoring is always a choice.
    worth = t.hands.map((h, i) => {
      let top = now[i]!;
      for (const k of keepsOf(h)) top = Math.max(top, keepWorth[t.keepAt.get(keyOf(k))!]!);
      return top;
    });
  }
  const hand = counts6(dice);
  let best: number[] | null = null;
  let top = now[t.handAt.get(keyOf(hand))!]!;
  for (const k of keepsOf(hand)) {
    const v = keepWorth[t.keepAt.get(keyOf(k))!]!;
    // Rolling must be clearly better than scoring now: a tie scores.
    if (k.reduce((a, b) => a + b, 0) < DICE && v > top + 1e-9) {
      top = v;
      best = k;
    }
  }
  return best;
}

/** The dice to hold for a keep, as a mask: the first dice that show each kept face. */
export function maskOf(dice: readonly number[], keep: readonly number[]): number {
  const want = keep.slice();
  let mask = 0;
  dice.forEach((d, i) => {
    if (want[d]! > 0) {
      want[d]!--;
      mask |= 1 << i;
    }
  });
  return mask;
}
