// Connect Four's messages on its party channel, plus the check the server
// runs on them. The party protocol (src/party/protocol.ts) carries them and
// holds the version that must be bumped when they or the rules change.

import { COLS, type Seat } from "./board.ts";

/** The online game: everything both phones see. The board is `first` plus `moves`, replayed. */
export interface FourMatch {
  /** Who drops the first chip of this game. */
  first: Seat;
  /** Columns played, in order. */
  moves: number[];
  /** Games won by each seat since the party first opened Connect Four. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type FourClientMessage =
  /** The column this phone aims at, shown dimmed on the other phone. */
  | { t: "aim"; col: number }
  /** Drops a chip in `col`, aimed from a board with `at` moves on it. */
  | { t: "drop"; col: number; at: number }
  | { t: "rematch" };

export type FourServerMessage = { t: "state"; match: FourMatch } | { t: "aim"; seat: Seat; col: number };

const isCol = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < COLS;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseFourMessage(raw: unknown): FourClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "aim":
      return isCol(m.col) ? { t: "aim", col: m.col } : null;
    case "drop":
      if (!isCol(m.col) || !Number.isInteger(m.at)) return null;
      return { t: "drop", col: m.col, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
