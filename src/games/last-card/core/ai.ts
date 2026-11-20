// The computer player, with no DOM. It takes a `View`, never a board: it
// knows its own hand, the top card, how many cards the other player holds and
// every card played so far, and nothing of the other hand or the draw pile.
//
// Easy plays a random card that fits, picks a random colour after a Wild, and
// sometimes forgets to call "Last card!". It never catches anyone. Medium
// plays the card of the colour it holds most, keeps its Wilds for when nothing
// else fits, and picks the colour it holds most. Hard counts cards: it notes
// the colours the other player drew on (they likely have none), plays its
// action cards to keep the turn when the other hand is small, and keeps its
// Wild Draw Fours for when they matter. It always calls, and it always
// catches a player who forgot to.
//
// All randomness comes from a seed kept with the game (not the deck's seed),
// and each move draws from its own stream: a move is a pure function of the
// view, the level and the seed, so a reload replays the computer's pending
// move.

import { rng } from "../../connect-four/core/ai.ts";
import {
  COLORS,
  card,
  isAction,
  isWild,
  other,
  penalty,
  playableIn,
  type Action,
  type Color,
  type View,
} from "./board.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

export const LEVELS: readonly Level[] = ["easy", "medium", "hard"];

/** How often Easy forgets to call "Last card!", and Medium. */
const FORGET: Record<Level, number> = { easy: 0.35, medium: 0.1, hard: 0 };

/** Every card of a colour in the deck: 1 zero, 18 numbers and 6 action cards. */
const PER_COLOR = 25;

/** The random stream for the move a view is waiting for. */
const streamFor = (v: View, seed: number) => rng(seed ^ Math.imul(v.moves + 1, 0x9e3779b1));

/** How many of each colour `cards` hold. Wilds count for none. */
function counts(cards: number[]): Record<Color, number> {
  const n: Record<Color, number> = { sun: 0, leaf: 0, wave: 0, flame: 0 };
  for (const id of cards) {
    const c = card(id).color;
    if (c) n[c] += 1;
  }
  return n;
}

/**
 * What the computer can tell of the other hand from the log: the colours the
 * other player drew on, with none played since, and the cards of each colour
 * not seen yet (not played, not in this hand).
 */
export function readOther(v: View): { short: Set<Color>; unseen: Record<Color, number> } {
  const foe = other(v.seat);
  const short = new Set<Color>();
  /** Cards the other player took since each colour was marked short. A few new cards may bring one. */
  const since = new Map<Color, number>();
  const played: number[] = [v.start.card];
  let want: Color | null = card(v.start.card).color;
  const gain = (n: number) => {
    for (const [c, k] of since) {
      if (k + n >= 3) {
        short.delete(c);
        since.delete(c);
      } else since.set(c, k + n);
    }
  };
  for (const e of v.log) {
    if (e.t === "play") {
      played.push(e.card);
      if (e.by === foe) {
        const c = card(e.card).color;
        if (c) {
          short.delete(c);
          since.delete(c);
        }
      } else if (e.drew) gain(e.drew);
      want = e.color ?? card(e.card).color;
    } else if (e.t === "draw" && e.by === foe) {
      gain(1);
      if (want) {
        short.add(want);
        since.set(want, 0);
      }
    } else if (e.t === "catch" && e.by !== foe) gain(e.drew);
  }
  const seen = counts([...played, ...v.hand]);
  const unseen = { ...seen };
  for (const c of COLORS) unseen[c] = Math.max(0, PER_COLOR - seen[c]);
  return { short, unseen };
}

/** The colour to name after a Wild, from the cards left in hand once `id` is played. */
function colorFor(v: View, id: number, level: Level, r: () => number): Color {
  if (level === "easy") return COLORS[Math.floor(r() * COLORS.length)]!;
  const rest = counts(v.hand.filter((x) => x !== id));
  const read = level === "hard" ? readOther(v) : null;
  let best: Color = COLORS[0];
  let top = -Infinity;
  for (const c of COLORS) {
    // The colour it holds most. Hard also likes a colour the other player seems short of.
    const score = rest[c] * 10 + (read?.short.has(c) ? 6 : 0) - (read ? read.unseen[c] * 0.1 : 0) + r();
    if (score > top) {
      top = score;
      best = c;
    }
  }
  return best;
}

/** A play of `id`, with a colour for a Wild and a call when it leaves one card. */
function play(v: View, id: number, level: Level, r: () => number): Action {
  const action: Action = { t: "play", card: id };
  if (isWild(id)) action.color = colorFor(v, id, level, r);
  if (v.hand.length === 2 && r() >= FORGET[level]) action.call = true;
  return action;
}

/** Medium's choice: the colour it holds most, a number before an action card, and a Wild only when nothing else fits. */
function mediumScore(v: View, id: number): number {
  if (isWild(id)) return -100 - penalty(id);
  const held = counts(v.hand);
  const c = card(id).color!;
  return held[c] * 3 + (card(id).color === v.want ? 2 : 0) + (isAction(id) ? -1 : 0);
}

/** Hard's choice, from what it can read of the other hand. */
function hardScore(v: View, id: number, others: number[], read: ReturnType<typeof readOther>): number {
  const left = v.hand.filter((x) => x !== id);
  const held = counts(left);
  const small = v.others <= 2;
  const f = card(id).face;
  let score = 0;
  if (isWild(id)) {
    // A Wild fits anything: keep it for last unless nothing else fits.
    score -= others.length > 0 ? 30 : 0;
    if (f === "wild4") score += small ? 40 : others.length > 0 ? -20 : 0;
    // Play to the colour it holds most.
    const best = Math.max(...COLORS.map((c) => held[c] + (read.short.has(c) ? 1 : 0)));
    score += best * 2;
  } else {
    const c = card(id).color!;
    // After this card the colour to match is its colour: good if the hand has more of it, and better if the other player lacks it.
    score += held[c] * 2;
    if (read.short.has(c)) score += 5;
    // An action card gives another turn: worth more when the other hand is small, and most for a Draw Two.
    if (isAction(id)) score += small ? 12 + penalty(id) * 3 : 2;
    // A card whose colour the hand lacks sends the game away from it: shed it while it fits.
    if (held[c] === 0) score += 1;
  }
  // Leave a card that can follow: an action card keeps the turn, so the next card must fit too.
  if (left.length === 1 && isWild(left[0]!)) score += 6;
  return score;
}

/**
 * The computer's move: catch, play, draw or keep. `seed` is the game's luck
 * for the computer, kept with the game. Call it only on the computer's turn,
 * or when it may catch.
 */
export function choose(v: View, level: Level, seed: number): Action {
  const r = streamFor(v, seed);
  if (level === "hard" && v.open === other(v.seat) && !v.over) return { t: "catch" };
  const can = playableIn(v);
  if (v.drawing) {
    const id = v.drawn;
    if (id === null || can.length === 0) return { t: "keep" };
    // Hard keeps a drawn Wild Draw Four for when it matters.
    if (level === "hard" && card(id).face === "wild4" && v.others > 2 && v.hand.length > 2)
      return { t: "keep" };
    return play(v, id, level, r);
  }
  if (can.length === 0) return { t: "draw" };
  if (level === "easy") return play(v, can[Math.floor(r() * can.length)]!, level, r);
  const plain = can.filter((id) => !isWild(id));
  const read = level === "hard" ? readOther(v) : null;
  let best = can[0]!;
  let top = -Infinity;
  for (const id of can) {
    const score = (read ? hardScore(v, id, plain, read) : mediumScore(v, id)) + r() * 0.5;
    if (score > top) {
      top = score;
      best = id;
    }
  }
  return play(v, best, level, r);
}
