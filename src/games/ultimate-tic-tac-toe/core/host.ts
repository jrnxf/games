// Ultimate Tic-Tac-Toe's server side, run by the party server. It holds the
// first player and the cells played, and checks every mark with the board
// rules: a mark must be on turn, aimed on the latest board (`at`) and in a
// small board the player may play in, or it is refused and the phone gets the
// true state back. Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { canPlay, isOver, play, replay, type Board, type Seat } from "./board.ts";
import {
  parseUltimateMessage,
  type UltimateClientMessage,
  type UltimateMatch,
  type UltimateServerMessage,
} from "./protocol.ts";

type Reply = HostReply<UltimateMatch, UltimateServerMessage>;

/** The board a match replays to. Null only for a corrupt match, which the host never stores. */
export const boardOf = (m: UltimateMatch): Board | null => replay(m.first, m.moves);

/** What the party keeps when it closes Ultimate Tic-Tac-Toe: the running score. */
export const carryUltimate = (m: UltimateMatch): { wins: [number, number] } => ({ wins: [...m.wins] });

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * A fresh match when `by` opens Ultimate Tic-Tac-Toe: they play first. The
 * score carries over from the last time this party played it (`carried`, from
 * `carryUltimate`), and starts at 0-0 when that is missing or corrupt.
 */
export function startUltimate(by: Seat, carried: unknown = null): UltimateMatch {
  const kept = (carried as { wins?: unknown } | null | undefined)?.wins;
  const wins: [number, number] =
    Array.isArray(kept) && kept.length === 2 && kept.every(isCount)
      ? [kept[0] as number, kept[1] as number]
      : [0, 0];
  return { first: by, moves: [], wins, rematch: [false, false] };
}

/** Makes `seat`'s mark on `cell` if it is their turn, the phone saw the latest board and the move is legal. */
export function mark(m: UltimateMatch, seat: Seat, cell: number, at: number): UltimateMatch | null {
  const board = boardOf(m);
  if (!board || board.turn !== seat || m.moves.length !== at) return null;
  const next = play(board, cell);
  if (!next) return null;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, moves: next.moves, wins };
}

/** A player asks for a rematch; a new game starts when both have, with the other player first. */
export function rematch(m: UltimateMatch, seat: Seat): UltimateMatch | null {
  const board = boardOf(m);
  if (!board || !isOver(board) || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { first: (1 - m.first) as Seat, moves: [], wins: m.wins, rematch: [false, false] };
}

function receive(m: UltimateMatch, seat: Seat, msg: UltimateClientMessage): Reply {
  switch (msg.t) {
    case "aim": {
      // Live aim is cosmetic: relay it to the other phone, never store it.
      const board = boardOf(m);
      if (!board || board.turn !== seat || !canPlay(board, msg.cell)) return {};
      return { others: { t: "aim", seat, cell: msg.cell } };
    }
    case "mark": {
      const next = mark(m, seat, msg.cell, msg.at);
      // A refused mark means this phone is out of date: send it the truth.
      if (!next) return { me: { t: "state", match: m } };
      return { state: next, all: { t: "state", match: next } };
    }
    case "rematch": {
      const next = rematch(m, seat);
      return next ? { state: next, all: { t: "state", match: next } } : {};
    }
  }
}

export const ultimateHost: GameHost<UltimateMatch, UltimateClientMessage, UltimateServerMessage> = {
  start: startUltimate,
  parse: parseUltimateMessage,
  receive,
  sync: (match) => ({ t: "state", match }),
  carry: carryUltimate,
};
