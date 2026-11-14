// Mini golf's messages on its party channel, plus the check the server runs
// on them. The party protocol (src/party/protocol.ts) carries them and holds
// the version that must be bumped when they, the physics or the holes change.

import type { MatchState, Seat } from "./match.ts";
import { isValidShot, type Shot } from "./physics.ts";

export interface Aim {
  angle: number;
  power: number;
}

/** The online round: everything both phones see. */
export interface GolfState {
  match: MatchState;
  /** Who has tapped on from the scorecard after a hole. */
  ready: [boolean, boolean];
  /** Who asked for a rematch after the last hole. */
  rematch: [boolean, boolean];
}

export type GolfClientMessage =
  { t: "aim"; aim: Aim | null } | { t: "shot"; shot: Shot; at: number } | { t: "ready" } | { t: "rematch" };

export type GolfServerMessage =
  | { t: "state"; golf: GolfState }
  | { t: "shot"; seat: Seat; shot: Shot; golf: GolfState }
  | { t: "aim"; seat: Seat; aim: Aim | null };

function isAim(a: unknown): a is Aim {
  if (typeof a !== "object" || a === null) return false;
  const { angle, power } = a as Record<string, unknown>;
  return (
    typeof angle === "number" &&
    typeof power === "number" &&
    Number.isFinite(angle) &&
    power >= 0 &&
    power <= 1
  );
}

/** Parses a message body from a phone. Returns null for anything malformed. */
export function parseGolfMessage(raw: unknown): GolfClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "aim":
      if (m.aim !== null && !isAim(m.aim)) return null;
      return { t: "aim", aim: m.aim === null ? null : { angle: m.aim.angle, power: m.aim.power } };
    case "shot":
      if (!isValidShot(m.shot) || !Number.isInteger(m.at)) return null;
      return { t: "shot", shot: { vx: m.shot.vx, vy: m.shot.vy }, at: m.at as number };
    case "ready":
    case "rematch":
      return { t: m.t };
    default:
      return null;
  }
}
