// Last Card's messages on its party channel, plus the check the server runs
// on them. The party protocol (src/party/protocol.ts) carries them and holds
// the version that must be bumped when they or the rules change.
//
// The hands and the deck are hidden information, so the server's state
// (`LastMatch`) never leaves the server. Each phone gets a `LastView` made for
// its seat: its own hand, the size of the other hand, the top card and the
// colour to match, the size of the draw pile, whose turn it is, every move as
// that phone may know it, and the last-card state. Never the other hand, the
// draw pile's order or the seed.

import { COLORS, DECK, type Color, type Move, type Seat, type View } from "./board.ts";

/** The online game as the server holds it. The seed orders the deck: never send it to a phone. */
export interface LastMatch {
  seed: number;
  /** Who plays first in this game. */
  first: Seat;
  moves: Move[];
  /** Games won by each seat since the party first opened Last Card. */
  wins: [number, number];
  /** Who asked for a rematch after this game. */
  rematch: [boolean, boolean];
}

/** The online game as one phone may see it. */
export interface LastView extends View {
  wins: [number, number];
  rematch: [boolean, boolean];
}

/** `at` is how many moves the game had when the phone sent it: a stale move is refused. */
export type LastClientMessage =
  | { t: "play"; card: number; color?: Color; call: boolean; at: number }
  | { t: "draw"; at: number }
  | { t: "keep"; at: number }
  | { t: "catch"; at: number }
  | { t: "rematch" };

export type LastServerMessage = { t: "state"; view: LastView };

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const isCard = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < DECK.length;
const isColor = (c: unknown): c is Color => COLORS.includes(c as Color);

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseLastMessage(raw: unknown): LastClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.t === "rematch") return { t: "rematch" };
  if (!isCount(m.at)) return null;
  switch (m.t) {
    case "play": {
      if (!isCard(m.card) || typeof m.call !== "boolean") return null;
      if (m.color !== undefined && !isColor(m.color)) return null;
      return { t: "play", card: m.card, ...(m.color ? { color: m.color } : {}), call: m.call, at: m.at };
    }
    case "draw":
    case "keep":
    case "catch":
      return { t: m.t, at: m.at };
    default:
      return null;
  }
}
