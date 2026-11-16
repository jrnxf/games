// Dots and Boxes' messages on its party channel, plus the check the server
// runs on them. The party protocol (src/party/protocol.ts) carries them and
// holds the version that must be bumped when they or the rules change.

import { LINES, type Seat } from "./board.ts";

/** The online game: everything both phones see. The board is `first` plus `moves`, replayed. */
export interface BoxesMatch {
  /** Who draws the first line of this game. */
  first: Seat;
  /** Lines drawn, in order. An extra turn is never stored: the rules imply it. */
  moves: number[];
  /** Games won by each seat since the party first opened Dots and Boxes. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type BoxesClientMessage =
  /** Draws `line`, picked on a board with `at` lines on it. */
  { t: "move"; line: number; at: number } | { t: "rematch" };

export type BoxesServerMessage = { t: "state"; match: BoxesMatch };

const isLine = (l: unknown): l is number =>
  Number.isInteger(l) && (l as number) >= 0 && (l as number) < LINES;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseBoxesMessage(raw: unknown): BoxesClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "move":
      if (!isLine(m.line) || !Number.isInteger(m.at)) return null;
      return { t: "move", line: m.line, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
