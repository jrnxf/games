// The server side of an online game. The party server holds one game's state
// at a time and hands it each message a phone sends on that game's channel.
// A host is plain data and pure functions, so it runs in the Durable Object
// and in unit tests alike.
//
// A turn-based game needs little more than this. Connect Four's
// (src/games/connect-four/core/host.ts):
//   start: (by) => ({ first: by, moves: [] })
//   parse: a { t: "drop", col, at } with a whole-number column
//   receive: refuse a wrong turn or a stale `at`, else push the column and
//            answer { all: { t: "state", match } }
//   sync: (match) => ({ t: "state", match })

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
   * A fresh game, when `by` opens this one. `last` is this game's state when
   * the party last closed it, or null, so a running score can carry over.
   */
  start(by: Seat, last: S | null): S;
  /** Checks a message body from a phone. Null drops it. */
  parse(raw: unknown): In | null;
  /** Handles one checked message from `seat`. */
  receive(state: S, seat: Seat, msg: In): HostReply<S, Out>;
  /** What a phone needs to draw the game from scratch: sent when it opens the game and after every reconnect. */
  sync(state: S, seat: Seat): Out;
}

/** The online games, by id. */
export type Hosts = Readonly<Record<string, GameHost>>;
