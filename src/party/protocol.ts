// Messages between a phone and its party server, plus the small helpers both
// sides use to check them. Everything is JSON over one WebSocket per phone.
// A game's own messages ride inside { t: "game" } and are checked by that
// game's host (see host.ts).

/** Bump whenever this protocol, any game's messages, golf's physics or holes change, so a stale phone is refused instead of desyncing. */
export const PROTOCOL = 5;

/** Party codes avoid vowels (no accidental words) and look-alikes like 0/O and 1/I. */
export const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
export const CODE_LENGTH = 5;
export const NAME_MAX = 12;

/** 0 made the party, 1 joined it. */
export type Seat = 0 | 1;

export interface PlayerView {
  name: string;
  connected: boolean;
}

/**
 * "waiting" until the two players first open a game together: until then a
 * guest seat with no live phone can go to the next phone with the link.
 * "together" once they have, and "ended" after either one leaves.
 */
export type PartyStatus = "waiting" | "together" | "ended";

export interface PartyView {
  code: string;
  status: PartyStatus;
  players: [PlayerView | null, PlayerView | null];
  /** The game both phones have open, or null at the menu. */
  game: string | null;
  /** Who last opened or closed a game. */
  pickedBy: Seat | null;
  /** Set when a player left the party for good. */
  leftBy: Seat | null;
}

export type ClientMessage =
  | { t: "hello"; v: number; token: string; name: string }
  /** Opens a game on both phones, or null for the menu. */
  | { t: "pick"; game: string | null }
  /** Asks for the open game's state; the answer is a game message. */
  | { t: "sync"; game: string }
  | { t: "game"; game: string; m: unknown }
  | { t: "leave" }
  | { t: "ping" };

export type ErrorCode = "full" | "gone" | "bad" | "replaced" | "version";

export type ServerMessage =
  | { t: "welcome"; seat: Seat; party: PartyView }
  | { t: "party"; party: PartyView }
  | { t: "game"; game: string; m: unknown }
  | { t: "error"; code: ErrorCode }
  | { t: "pong" };

/** WebSocket close codes the server uses on purpose. */
export const CLOSE_REPLACED = 4001;
export const CLOSE_GONE = 4004;
export const CLOSE_FULL = 4009;

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LENGTH);
}

export function isCode(input: string): boolean {
  return input.length === CODE_LENGTH && normalizeCode(input) === input;
}

export function cleanName(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  // Drop control characters and collapse spaces; names are shown, never stored past the party.
  const name = input
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return Array.from(name).slice(0, NAME_MAX).join("") || fallback;
}

const isGameId = (g: unknown): g is string => typeof g === "string" && /^[a-z0-9-]{1,32}$/.test(g);

/** Parses a message from a phone. Returns null for anything malformed. A game message's body is left to its host. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  switch (m.t) {
    case "hello":
      if (typeof m.v !== "number" || typeof m.token !== "string" || !/^[a-f0-9]{32}$/.test(m.token))
        return null;
      return { t: "hello", v: m.v, token: m.token, name: typeof m.name === "string" ? m.name : "" };
    case "pick":
      if (m.game !== null && !isGameId(m.game)) return null;
      return { t: "pick", game: m.game };
    case "sync":
      return isGameId(m.game) ? { t: "sync", game: m.game } : null;
    case "game":
      if (!isGameId(m.game) || typeof m.m !== "object" || m.m === null) return null;
      return { t: "game", game: m.game, m: m.m };
    case "leave":
    case "ping":
      return { t: m.t };
    default:
      return null;
  }
}
