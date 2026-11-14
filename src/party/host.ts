// The server side of an online game. The party server holds one game's state
// at a time and hands it each message a phone sends on that game's channel.
// A host is plain data and pure functions, so it runs in the Durable Object
// and in unit tests alike.
//
// A turn-based game needs little more than this. Connect Four's
// (src/games/connect-four/core/host.ts):
//   start: (by, carried) => ({ first: by, moves: [], wins: carried or 0-0, ... })
//   parse: an aim, a { t: "drop", col, at } with a whole-number column, or a rematch
//   receive: refuse a wrong turn or a stale `at` with { me: { t: "state", match } },
//            else push the column and answer { all: { t: "state", match } }
//   sync: (match) => ({ t: "state", match })
//   carry: (match) => ({ wins: match.wins })

import type { Seat } from "./protocol.ts";

/** What a host wants done after a message. Every field is optional. */
export interface HostReply<S, Out> {
  /** The new state, to store. Leave out when nothing changed. */
  state?: S;
  /** Sent to both phones. */
  all?: Out;
  /** Sent only to the other phone (live aim, say). */
  others?: Out;
  /** Sent only back to the phone that asked (a refusal with the true state, say). */
  me?: Out;
}

export interface GameHost<S = unknown, In = unknown, Out = unknown> {
  /**
   * A fresh game, when `by` opens this one. `carried` is what `carry` kept
   * the last time the party closed it, or null. It comes from storage, so
   * check it before use.
   */
  start(by: Seat, carried: unknown): S;
  /** Checks a message body from a phone. Null drops it. */
  parse(raw: unknown): In | null;
  /** Handles one checked message from `seat`. */
  receive(state: S, seat: Seat, msg: In): HostReply<S, Out>;
  /** What a phone needs to draw the game from scratch: sent when it opens the game and after every reconnect. */
  sync(state: S, seat: Seat): Out;
  /** What to keep when the party closes this game, for the next `start` (a running score, say). Leave out to keep nothing. */
  carry?(state: S): unknown;
}

/** The online games, by id. */
export type Hosts = Readonly<Record<string, GameHost>>;
