// Mini golf's server side, run by the party server. It replays every stroke
// with the shared physics, so it is the source of truth: a stroke must be on
// turn and aimed from the latest state (`at`), or it is refused and the phone
// gets the true state back. Plain data and pure functions, unit-tested.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { applyShot, createMatch, nextHole, rematch as rematchOf, type Seat } from "./match.ts";
import type { Shot } from "./physics.ts";
import {
  parseGolfMessage,
  type GolfClientMessage,
  type GolfServerMessage,
  type GolfState,
} from "./protocol.ts";

type Reply = HostReply<GolfState, GolfServerMessage>;

export function startGolf(): GolfState {
  // The player who made the party tees off first.
  return { match: createMatch(0), ready: [false, false], rematch: [false, false] };
}

/** Applies a stroke if it is this seat's turn and the phone saw the latest state. */
export function shoot(golf: GolfState, seat: Seat, shot: Shot, at: number): GolfState | null {
  if (golf.match.strokes !== at) return null;
  const out = applyShot(golf.match, seat, shot, { trace: false });
  return out ? { ...golf, match: out.state } : null;
}

/** A player taps on from the scorecard; the next hole starts when both have. */
export function ready(golf: GolfState, seat: Seat): GolfState | null {
  if (golf.match.phase !== "holeDone" || golf.ready[seat]) return null;
  const flags: [boolean, boolean] = [...golf.ready];
  flags[seat] = true;
  if (flags[0] && flags[1]) return { ...golf, match: nextHole(golf.match)!, ready: [false, false] };
  return { ...golf, ready: flags };
}

/** A player asks for a rematch; a new match starts when both have. */
export function rematch(golf: GolfState, seat: Seat): GolfState | null {
  if (golf.match.phase !== "gameDone" || golf.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...golf.rematch];
  flags[seat] = true;
  if (flags[0] && flags[1]) return { ...golf, match: rematchOf(golf.match), rematch: [false, false] };
  return { ...golf, rematch: flags };
}

function receive(golf: GolfState, seat: Seat, msg: GolfClientMessage): Reply {
  switch (msg.t) {
    case "aim":
      // Live aim is cosmetic: relay it to the other phone, never store it.
      if (golf.match.turn !== seat || golf.match.phase !== "aim") return {};
      return { others: { t: "aim", seat, aim: msg.aim } };
    case "shot": {
      const next = shoot(golf, seat, msg.shot, msg.at);
      // A refused stroke means this phone is out of date: send it the truth.
      if (!next) return { me: { t: "state", golf } };
      return { state: next, all: { t: "shot", seat, shot: msg.shot, golf: next } };
    }
    case "ready":
    case "rematch": {
      const next = msg.t === "ready" ? ready(golf, seat) : rematch(golf, seat);
      return next ? { state: next, all: { t: "state", golf: next } } : {};
    }
  }
}

export const golfHost: GameHost<GolfState, GolfClientMessage, GolfServerMessage> = {
  start: startGolf,
  parse: parseGolfMessage,
  receive,
  sync: (golf) => ({ t: "state", golf }),
};
