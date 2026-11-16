// Mancala's messages on its party channel, plus the check the server runs on
// them. The party protocol (src/party/protocol.ts) carries them and holds the
// version that must be bumped when they or the rules change.

import { PITS, type Seat } from "./board.ts";

/** The online game: everything both phones see. The board is `first` plus `moves`, replayed. */
export interface MancalaMatch {
  /** Who sows first in this game. */
  first: Seat;
  /** Pits played, in order, each counted from its mover's left. An extra turn is never stored: the rules imply it. */
  moves: number[];
  /** Games won by each seat since the party first opened Mancala. A draw counts for nobody. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

export type MancalaClientMessage =
  /** Sows the mover's `pit`, picked on a board with `at` moves played. */
  { t: "move"; pit: number; at: number } | { t: "rematch" };

export type MancalaServerMessage = { t: "state"; match: MancalaMatch };

const isPit = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 0 && (p as number) < PITS;

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseMancalaMessage(raw: unknown): MancalaClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "move":
      if (!isPit(m.pit) || !Number.isInteger(m.at)) return null;
      return { t: "move", pit: m.pit, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
