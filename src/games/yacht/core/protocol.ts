// Yacht's messages on its party channel, plus the check the server runs on
// them. The party protocol (src/party/protocol.ts) carries them and holds the
// version that must be bumped when they or the rules change.

import { ALL_HELD, BOXES, type Seat } from "./board.ts";

/**
 * The online game as both phones see it. The game is `first` plus `actions`,
 * replayed with `dice` as the rolls. The seed the host rolls with is never
 * part of it: a phone that saw the seed could work out every roll to come.
 */
export interface YachtView {
  /** Who rolls first in this game. */
  first: Seat;
  /** Rolls and boxes, in order (see board.ts). */
  actions: number[];
  /** The five dice after each roll of the game, in order. */
  dice: number[][];
  /** Games won by each seat since the party first opened Yacht. A tie counts for nobody. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type YachtClientMessage =
  /** Rolls, keeping the dice in `held`, on a game with `at` actions played. */
  | { t: "roll"; held: number; at: number }
  /** Scores `box` on a game with `at` actions played. */
  | { t: "score"; box: number; at: number }
  /** The dice the player on turn holds now, before they roll: shown live to the friend, never stored. */
  | { t: "hold"; held: number; at: number }
  | { t: "rematch" };

export type YachtServerMessage =
  | { t: "state"; match: YachtView }
  /** The friend's held dice, live. */
  | { t: "hold"; held: number; at: number };

const isHeld = (h: unknown): h is number =>
  Number.isInteger(h) && (h as number) >= 0 && (h as number) < ALL_HELD;
const isBox = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) < BOXES;
const isAt = (a: unknown): a is number => Number.isSafeInteger(a) && (a as number) >= 0;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseYachtMessage(raw: unknown): YachtClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "roll":
    case "hold":
      if (!isHeld(m.held) || !isAt(m.at)) return null;
      return { t: m.t, held: m.held, at: m.at };
    case "score":
      if (!isBox(m.box) || !isAt(m.at)) return null;
      return { t: "score", box: m.box, at: m.at };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
