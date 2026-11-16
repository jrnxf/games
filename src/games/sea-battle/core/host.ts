// Sea Battle's server side, run by the party server. It holds both fleets and
// the cells fired at, and checks every shot with the board rules: a shot must
// be on turn, aimed from the latest game (`at`) and at a cell not fired at
// before, or it is refused and the phone gets the true state back.
//
// The fleets are hidden information, so the host never sends its state. Each
// phone gets `viewOf(match, seat)`: its own fleet, the marks of both players
// and the ships sunk so far. The other fleet is in a view only once the game
// is over. That is why a change is answered with `me` and `others`, one view
// per phone, and never with `all`. Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { fire as fireAt, newBoard, replay, type Board, type Fleet, type Seat } from "./board.ts";
import {
  parseSeaMessage,
  type SeaClientMessage,
  type SeaMatch,
  type SeaServerMessage,
  type SeaView,
} from "./protocol.ts";

type Reply = HostReply<SeaMatch, SeaServerMessage>;

const other = (seat: Seat) => (1 - seat) as Seat;

/** The board a match replays to. Null until both fleets are placed. */
export function boardOf(m: SeaMatch): Board | null {
  const [a, b] = m.fleets;
  return a && b ? replay(m.first, [a, b], m.shots) : null;
}

/** All that `seat`'s phone may know of the match. The other fleet is in it only when the game is over. */
export function viewOf(m: SeaMatch, seat: Seat): SeaView {
  // Before both fleets are placed the game is an empty board: no fleet is read from it.
  const board = boardOf(m) ?? newBoard(m.first, [[], []]);
  return {
    first: m.first,
    placed: [m.fleets[0] !== null, m.fleets[1] !== null],
    fleet: m.fleets[seat],
    foe: board.over ? m.fleets[other(seat)] : null,
    seen: board.seen,
    shots: m.shots.length,
    turn: board.turn,
    last: board.last,
    over: board.over,
    winner: board.winner,
    wins: m.wins,
    rematch: m.rematch,
  };
}

/** What the party keeps when it closes Sea Battle: the running score. */
export const carrySea = (m: SeaMatch): { wins: [number, number] } => ({ wins: [...m.wins] });

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * A fresh match when `by` opens Sea Battle: they fire first, once both fleets
 * are placed. The score carries over from the last time this party played it
 * (`carried`, from `carrySea`), and starts at 0-0 when that is missing or
 * corrupt.
 */
export function startSea(by: Seat, carried: unknown = null): SeaMatch {
  const kept = (carried as { wins?: unknown } | null | undefined)?.wins;
  const wins: [number, number] =
    Array.isArray(kept) && kept.length === 2 && kept.every(isCount)
      ? [kept[0] as number, kept[1] as number]
      : [0, 0];
  return { first: by, fleets: [null, null], shots: [], wins, rematch: [false, false] };
}

/** Sets `seat`'s fleet, once per game. The fleet must be legal: the parser checks it. */
export function place(m: SeaMatch, seat: Seat, fleet: Fleet): SeaMatch | null {
  if (m.fleets[seat]) return null;
  const fleets: [Fleet | null, Fleet | null] = [...m.fleets];
  fleets[seat] = fleet;
  return { ...m, fleets };
}

/** Fires at `cell` for `seat` if both fleets are placed, it is their turn, the phone saw the latest game and the cell is open. */
export function fire(m: SeaMatch, seat: Seat, cell: number, at: number): SeaMatch | null {
  const board = boardOf(m);
  if (!board || board.turn !== seat || m.shots.length !== at) return null;
  const next = fireAt(board, cell);
  if (!next) return null;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, shots: next.shots, wins };
}

/** A player asks for a rematch; a new game with no fleets starts when both have, with the other player first. */
export function rematch(m: SeaMatch, seat: Seat): SeaMatch | null {
  const board = boardOf(m);
  if (!board || !board.over || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { first: other(m.first), fleets: [null, null], shots: [], wins: m.wins, rematch: [false, false] };
}

const state = (m: SeaMatch, seat: Seat): SeaServerMessage => ({ t: "state", view: viewOf(m, seat) });

/** A change, told to each phone with its own view. */
const changed = (next: SeaMatch, seat: Seat): Reply => ({
  state: next,
  me: state(next, seat),
  others: state(next, other(seat)),
});

function receive(m: SeaMatch, seat: Seat, msg: SeaClientMessage): Reply {
  switch (msg.t) {
    case "aim": {
      // Live aim is cosmetic: relay it to the other phone, never store it.
      const board = boardOf(m);
      if (!board || board.over || board.turn !== seat) return {};
      return { others: { t: "aim", seat, cell: msg.cell } };
    }
    case "place": {
      const next = place(m, seat, msg.fleet);
      // A second fleet means this phone is out of date: send it the truth.
      return next ? changed(next, seat) : { me: state(m, seat) };
    }
    case "fire": {
      const next = fire(m, seat, msg.cell, msg.at);
      // A refused shot means this phone is out of date: send it the truth.
      return next ? changed(next, seat) : { me: state(m, seat) };
    }
    case "rematch": {
      const next = rematch(m, seat);
      return next ? changed(next, seat) : {};
    }
  }
}

export const seaHost: GameHost<SeaMatch, SeaClientMessage, SeaServerMessage> = {
  start: startSea,
  parse: parseSeaMessage,
  receive,
  sync: state,
  carry: carrySea,
};
