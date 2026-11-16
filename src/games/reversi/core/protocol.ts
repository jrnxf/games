// Reversi's messages on its party channel, plus the check the server runs on
// them. The party protocol (src/party/protocol.ts) carries them and holds the
// version that must be bumped when they or the rules change.

import { CELLS, type Seat } from "./board.ts";

/** The online game: everything both phones see. The board is `first` plus `moves`, replayed. */
export interface ReversiMatch {
  /** Who plays the first disc of this game. */
  first: Seat;
  /** Cells played, in order. A pass is never stored: the rules imply it. */
  moves: number[];
  /** Games won by each seat since the party first opened Reversi. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type ReversiClientMessage =
  /** Plays a disc on `cell`, picked on a board with `at` moves on it. */
  { t: "move"; cell: number; at: number } | { t: "rematch" };

export type ReversiServerMessage = { t: "state"; match: ReversiMatch };

const isCell = (c: unknown): c is number =>
  Number.isInteger(c) && (c as number) >= 0 && (c as number) < CELLS;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseReversiMessage(raw: unknown): ReversiClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "move":
      if (!isCell(m.cell) || !Number.isInteger(m.at)) return null;
      return { t: "move", cell: m.cell, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
