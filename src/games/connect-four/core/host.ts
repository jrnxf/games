// Connect Four's server side, run by the party server. It holds the first
// player and the columns played, and checks every drop with the board rules:
// a drop must be on turn, aimed from the latest board (`at`) and into a
// column with room, or it is refused and the phone gets the true state back.
// Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { drop as dropChip, isOver, replay, type Board, type Seat } from "./board.ts";
import {
  parseFourMessage,
  type FourClientMessage,
  type FourMatch,
  type FourServerMessage,
} from "./protocol.ts";

type Reply = HostReply<FourMatch, FourServerMessage>;

/** The board a match replays to. Null only for a corrupt match, which the host never stores. */
export const boardOf = (m: FourMatch): Board | null => replay(m.first, m.moves);

/**
 * A fresh match when `by` opens Connect Four: they drop first. The score
 * carries over from the last time this party played it (`last`), if it did.
 */
export function startFour(by: Seat, last: FourMatch | null = null): FourMatch {
  const wins: [number, number] = last ? [...last.wins] : [0, 0];
  return { first: by, moves: [], wins, rematch: [false, false] };
}

/** Drops `seat`'s chip in `col` if it is their turn, the phone saw the latest board and the column has room. */
export function drop(m: FourMatch, seat: Seat, col: number, at: number): FourMatch | null {
  const board = boardOf(m);
  if (!board || board.turn !== seat || m.moves.length !== at) return null;
  const next = dropChip(board, col);
  if (!next) return null;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, moves: next.moves, wins };
}

/** A player asks for a rematch; a new game starts when both have, with the other player first. */
export function rematch(m: FourMatch, seat: Seat): FourMatch | null {
  const board = boardOf(m);
  if (!board || !isOver(board) || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { first: (1 - m.first) as Seat, moves: [], wins: m.wins, rematch: [false, false] };
}

function receive(m: FourMatch, seat: Seat, msg: FourClientMessage): Reply {
  switch (msg.t) {
    case "aim": {
      // Live aim is cosmetic: relay it to the other phone, never store it.
      const board = boardOf(m);
      if (!board || isOver(board) || board.turn !== seat) return {};
      return { others: { t: "aim", seat, col: msg.col } };
    }
    case "drop": {
      const next = drop(m, seat, msg.col, msg.at);
      // A refused drop means this phone is out of date: send it the truth.
      if (!next) return { me: { t: "state", match: m } };
      return { state: next, all: { t: "state", match: next } };
    }
    case "rematch": {
      const next = rematch(m, seat);
      return next ? { state: next, all: { t: "state", match: next } } : {};
    }
  }
}

export const fourHost: GameHost<FourMatch, FourClientMessage, FourServerMessage> = {
  start: startFour,
  parse: parseFourMessage,
  receive,
  sync: (match) => ({ t: "state", match }),
};
