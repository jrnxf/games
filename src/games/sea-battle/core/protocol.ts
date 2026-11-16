// Sea Battle's messages on its party channel, plus the check the server runs
// on them. The party protocol (src/party/protocol.ts) carries them and holds
// the version that must be bumped when they or the rules change.
//
// The fleets are hidden information, so the server's state (`SeaMatch`) never
// leaves the server. Each phone gets a `SeaView` made for its seat: its own
// fleet, the marks both players have made, and the other fleet only once the
// game is over.

import { CELLS, validFleet, type Fleet, type Seat, type Shot, type Sight } from "./board.ts";

/** The online game as the server holds it. It has both fleets: never send it to a phone. */
export interface SeaMatch {
  /** Who fires first in this game. */
  first: Seat;
  /** Each seat's fleet, or null until that player is ready. */
  fleets: [Fleet | null, Fleet | null];
  /** Cells fired at, in order, turn about from `first`. */
  shots: number[];
  /** Games won by each seat since the party first opened Sea Battle. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

/** The online game as one phone may see it. */
export interface SeaView {
  first: Seat;
  /** Who has placed a fleet. The first shot waits for both. */
  placed: [boolean, boolean];
  /** This phone's own fleet, or null until it is placed. */
  fleet: Fleet | null;
  /** The other player's fleet. Null until the game is over. */
  foe: Fleet | null;
  /** `seen[seat]` is what `seat` knows of the other's water. Both phones see both. */
  seen: [Sight, Sight];
  /** How many shots have been fired: the `at` of the next one. */
  shots: number;
  turn: Seat;
  /** The last shot. Null before the first one. */
  last: Shot | null;
  over: boolean;
  winner: Seat | null;
  wins: [number, number];
  rematch: [boolean, boolean];
}

export type SeaClientMessage =
  /** This phone's fleet. It can't change once sent. */
  | { t: "place"; fleet: Fleet }
  /** The cell this phone aims at, shown dimmed on the other phone. */
  | { t: "aim"; cell: number }
  /** Fires at `cell`, aimed from a game with `at` shots fired. */
  | { t: "fire"; cell: number; at: number }
  | { t: "rematch" };

export type SeaServerMessage = { t: "state"; view: SeaView } | { t: "aim"; seat: Seat; cell: number };

const isCell = (c: unknown): c is number =>
  Number.isInteger(c) && (c as number) >= 0 && (c as number) < CELLS;

/** A legal fleet from a phone, with nothing but each ship's cell, length and direction kept. Null for anything else. */
function parseFleet(raw: unknown): Fleet | null {
  if (!Array.isArray(raw)) return null;
  const fleet: Fleet = [];
  for (const s of raw as unknown[]) {
    if (typeof s !== "object" || s === null) return null;
    const { cell, len, down } = s as Record<string, unknown>;
    if (!isCell(cell) || !Number.isInteger(len) || typeof down !== "boolean") return null;
    fleet.push({ cell, len: len as number, down });
  }
  return validFleet(fleet) ? fleet : null;
}

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseSeaMessage(raw: unknown): SeaClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "place": {
      const fleet = parseFleet(m.fleet);
      return fleet ? { t: "place", fleet } : null;
    }
    case "aim":
      return isCell(m.cell) ? { t: "aim", cell: m.cell } : null;
    case "fire":
      if (!isCell(m.cell) || !Number.isInteger(m.at)) return null;
      return { t: "fire", cell: m.cell, at: m.at as number };
    case "rematch":
      return { t: "rematch" };
    default:
      return null;
  }
}
