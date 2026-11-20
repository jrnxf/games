// Last Card's server side, run by the party server. It owns the seed, so it
// alone knows the deck. It holds the moves, and checks every one with the
// board rules: a move must be on turn (a catch may come at any time), aimed
// from the latest game (`at`) and allowed, or it is refused and the phone
// gets the true state back.
//
// The hands are hidden information, so the host never sends its state. Each
// phone gets `viewOf(match, seat)`: its own hand and the size of the other.
// That is why a change is answered with `me` and `others`, one view per
// phone, and never with `all`. Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { newSeed } from "./ai.ts";
import { apply, other, replay, viewOf as boardView, type Action, type Board, type Seat } from "./board.ts";
import {
  parseLastMessage,
  type LastClientMessage,
  type LastMatch,
  type LastServerMessage,
  type LastView,
} from "./protocol.ts";

type Reply = HostReply<LastMatch, LastServerMessage>;

/** The board a match replays to. Its moves were each checked as they came, so the replay holds. */
export const boardOf = (m: LastMatch): Board => replay(m.seed, m.first, m.moves)!;

/** All that `seat`'s phone may know of the match. */
export function viewOf(m: LastMatch, seat: Seat): LastView {
  return { ...boardView(boardOf(m), seat), wins: [...m.wins], rematch: [...m.rematch] };
}

/** What the party keeps when it closes Last Card: the running score. */
export const carryLast = (m: LastMatch): { wins: [number, number] } => ({ wins: [...m.wins] });

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * A fresh match when `by` opens Last Card: they play first. The score carries
 * over from the last time this party played it (`carried`, from `carryLast`),
 * and starts at 0-0 when that is missing or corrupt. `seed` is for tests.
 */
export function startLast(by: Seat, carried: unknown = null, seed = newSeed()): LastMatch {
  const kept = (carried as { wins?: unknown } | null | undefined)?.wins;
  const wins: [number, number] =
    Array.isArray(kept) && kept.length === 2 && kept.every(isCount)
      ? [kept[0] as number, kept[1] as number]
      : [0, 0];
  return { seed, first: by, moves: [], wins, rematch: [false, false] };
}

/** `seat`'s move, if it is allowed and the phone saw the latest game. */
export function move(m: LastMatch, seat: Seat, action: Action, at: number): LastMatch | null {
  if (m.moves.length !== at) return null;
  const next = apply(boardOf(m), { ...action, by: seat });
  if (!next) return null;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, moves: next.moves, wins };
}

/** A player asks for a rematch. A new deal starts when both have, with the other player first. */
export function rematch(m: LastMatch, seat: Seat, seed = newSeed()): LastMatch | null {
  if (!boardOf(m).over || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { seed, first: other(m.first), moves: [], wins: m.wins, rematch: [false, false] };
}

const state = (m: LastMatch, seat: Seat): LastServerMessage => ({ t: "state", view: viewOf(m, seat) });

/** A change, told to each phone with its own view. */
const changed = (next: LastMatch, seat: Seat): Reply => ({
  state: next,
  me: state(next, seat),
  others: state(next, other(seat)),
});

function receive(m: LastMatch, seat: Seat, msg: LastClientMessage): Reply {
  if (msg.t === "rematch") {
    const next = rematch(m, seat);
    return next ? changed(next, seat) : {};
  }
  const { at, ...action } = msg;
  const next = move(m, seat, action as Action, at);
  // A refused move means this phone is out of date: send it the truth.
  return next ? changed(next, seat) : { me: state(m, seat) };
}

export const lastCardHost: GameHost<LastMatch, LastClientMessage, LastServerMessage> = {
  start: startLast,
  parse: parseLastMessage,
  receive,
  sync: state,
  carry: carryLast,
};
