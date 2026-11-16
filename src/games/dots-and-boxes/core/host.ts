// Dots and Boxes' server side, run by the party server. It holds the first
// player and the lines drawn, and checks every move with the board rules: a
// move must be on turn, picked on the latest board (`at`) and on a free line,
// or it is refused and the phone gets the true state back. An extra turn
// needs no message: the board rules keep the turn with the player who closed
// a box. Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { play, replay, type Board, type Seat } from "./board.ts";
import {
  parseBoxesMessage,
  type BoxesClientMessage,
  type BoxesMatch,
  type BoxesServerMessage,
} from "./protocol.ts";

type Reply = HostReply<BoxesMatch, BoxesServerMessage>;

/** The board a match replays to. Null only for a corrupt match, which the host never stores. */
export const boardOf = (m: BoxesMatch): Board | null => replay(m.first, m.moves);

/** What the party keeps when it closes Dots and Boxes: the running score. */
export const carryBoxes = (m: BoxesMatch): { wins: [number, number] } => ({ wins: [...m.wins] });

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * A fresh match when `by` opens Dots and Boxes: they play first. The score
 * carries over from the last time this party played it (`carried`, from
 * `carryBoxes`), and starts at 0-0 when that is missing or corrupt.
 */
export function startBoxes(by: Seat, carried: unknown = null): BoxesMatch {
  const kept = (carried as { wins?: unknown } | null | undefined)?.wins;
  const wins: [number, number] =
    Array.isArray(kept) && kept.length === 2 && kept.every(isCount)
      ? [kept[0] as number, kept[1] as number]
      : [0, 0];
  return { first: by, moves: [], wins, rematch: [false, false] };
}

/** Draws `line` for `seat` if it is their turn, the phone saw the latest board and the line is free. */
export function move(m: BoxesMatch, seat: Seat, line: number, at: number): BoxesMatch | null {
  const board = boardOf(m);
  if (!board || board.turn !== seat || m.moves.length !== at) return null;
  const next = play(board, line);
  if (!next) return null;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, moves: next.moves, wins };
}

/** A player asks for a rematch; a new game starts when both have, with the other player first. */
export function rematch(m: BoxesMatch, seat: Seat): BoxesMatch | null {
  const board = boardOf(m);
  if (!board || !board.over || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { first: (1 - m.first) as Seat, moves: [], wins: m.wins, rematch: [false, false] };
}

function receive(m: BoxesMatch, seat: Seat, msg: BoxesClientMessage): Reply {
  switch (msg.t) {
    case "move": {
      const next = move(m, seat, msg.line, msg.at);
      // A refused move means this phone is out of date: send it the truth.
      if (!next) return { me: { t: "state", match: m } };
      return { state: next, all: { t: "state", match: next } };
    }
    case "rematch": {
      const next = rematch(m, seat);
      return next ? { state: next, all: { t: "state", match: next } } : {};
    }
  }
}

export const boxesHost: GameHost<BoxesMatch, BoxesClientMessage, BoxesServerMessage> = {
  start: startBoxes,
  parse: parseBoxesMessage,
  receive,
  sync: (match) => ({ t: "state", match }),
  carry: carryBoxes,
};
