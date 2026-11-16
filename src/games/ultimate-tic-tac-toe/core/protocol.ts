// Ultimate Tic-Tac-Toe's messages on its party channel, plus the check the
// server runs on them. The party protocol (src/party/protocol.ts) carries
// them and holds the version that must be bumped when they or the rules
// change.

import { CELLS, type Seat } from "./board.ts";

/** The online game: everything both phones see. The board is `first` plus `moves`, replayed. */
export interface UltimateMatch {
  /** Who makes the first mark of this game. */
  first: Seat;
  /** Cells played, in order. */
  moves: number[];
  /** Games won by each seat since the party first opened Ultimate Tic-Tac-Toe. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type UltimateClientMessage =
  /** The cell this phone aims at, shown dimmed on the other phone. */
  | { t: "aim"; cell: number }
  /** Makes a mark on `cell`, aimed on a board with `at` marks on it. */
  | { t: "mark"; cell: number; at: number }
  | { t: "rematch" };

export type UltimateServerMessage =
  { t: "state"; match: UltimateMatch } | { t: "aim"; seat: Seat; cell: number };

const isCell = (c: unknown): c is number =>
  Number.isInteger(c) && (c as number) >= 0 && (c as number) < CELLS;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseUltimateMessage(raw: unknown): UltimateClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "aim":
      return isCell(m.cell) ? { t: "aim", cell: m.cell } : null;
    case "mark":
      if (!isCell(m.cell) || !Number.isInteger(m.at)) return null;
      return { t: "mark", cell: m.cell, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
