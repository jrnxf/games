// The party as plain data and pure transitions: two seats, their names, and
// the game both phones have open. The Durable Object only stores this record,
// wires sockets to these functions and broadcasts the result, so the whole
// flow is unit-testable without a server.

import type { HostReply, Hosts } from "./host.ts";
import type { ErrorCode, PartyStatus, PartyView, Seat } from "./protocol.ts";

export interface SeatRecord {
  /** Random per-device secret that lets a player take their seat back after a drop. */
  token: string;
  name: string;
}

export interface PartyRecord {
  code: string;
  status: PartyStatus;
  seats: [SeatRecord | null, SeatRecord | null];
  game: string | null;
  /** The open game's state, owned by its host. */
  state: unknown;
  /** Each game's state when it was last closed, by id, for the next start. Missing on parties made before it. */
  last?: Record<string, unknown>;
  pickedBy: Seat | null;
  leftBy: Seat | null;
}

export function createParty(code: string): PartyRecord {
  return {
    code,
    status: "waiting",
    seats: [null, null],
    game: null,
    state: null,
    last: {},
    pickedBy: null,
    leftBy: null,
  };
}

/** What phones see: no tokens, no game state. `connected` comes from the live sockets, not storage. */
export function partyView(party: PartyRecord, connected: [boolean, boolean]): PartyView {
  const player = (seat: Seat) => {
    const s = party.seats[seat];
    return s ? { name: s.name, connected: connected[seat] } : null;
  };
  return {
    code: party.code,
    status: party.status,
    players: [player(0), player(1)],
    game: party.game,
    pickedBy: party.pickedBy,
    leftBy: party.leftBy,
  };
}

/** The name a seat gets when its player gives none. */
export const seatName = (seat: Seat): string => `Player ${seat + 1}`;

/**
 * Seats a player: back in their own seat by token (under the name they give
 * now), else the first free one. While the party is waiting, a guest with no
 * live socket (`connected`) gives up the seat to a newcomer. An empty `name`
 * becomes the fallback for the seat it lands in.
 */
export function claimSeat(
  party: PartyRecord,
  token: string,
  name: string,
  connected: [boolean, boolean],
): Seat | ErrorCode {
  if (party.status === "ended") {
    // The player who stayed may have been offline when the other left: let them back in to hear who it was.
    const stayed = party.leftBy === null ? null : ((1 - party.leftBy) as Seat);
    return stayed !== null && party.seats[stayed]?.token === token ? stayed : "gone";
  }
  const take = (seat: Seat): Seat => {
    party.seats[seat] = { token, name: name || seatName(seat) };
    return seat;
  };
  for (const seat of [0, 1] as const) {
    if (party.seats[seat]?.token === token) return take(seat);
  }
  for (const seat of [0, 1] as const) {
    if (!party.seats[seat]) return take(seat);
  }
  return guestIsStale(party, connected) ? take(1) : "full";
}

/** True while the guest's seat is up for grabs: the party is waiting and no socket holds it. */
export function guestIsStale(party: PartyRecord, connected: [boolean, boolean]): boolean {
  return party.status === "waiting" && !!party.seats[1] && !connected[1];
}

/** A player leaves on purpose. A waiting guest just frees the seat; otherwise the party ends. */
export function leave(party: PartyRecord, seat: Seat): void {
  if (party.status === "ended") return;
  if (party.status === "waiting" && seat === 1) {
    party.seats[1] = null;
    return;
  }
  party.status = "ended";
  party.leftBy = seat;
  party.game = null;
  party.state = null;
}

/**
 * Opens `game` (a fresh one, started by `seat`) on both phones, or closes
 * the open one for the menu when `game` is null. The first game needs the
 * guest seated and connected (`connected`): until then the seat is up for
 * grabs, and a game would lock it. False when nothing changed.
 */
export function pick(
  party: PartyRecord,
  seat: Seat,
  game: string | null,
  hosts: Hosts,
  connected: [boolean, boolean],
): boolean {
  if (party.status === "ended" || game === party.game) return false;
  const host = game === null ? undefined : hosts[game];
  if (game !== null && (!host || !party.seats[0] || !party.seats[1] || guestIsStale(party, connected)))
    return false;
  // The closing game's state is kept for the next time it opens.
  if (party.game !== null) party.last = { ...party.last, [party.game]: party.state };
  if (game !== null && host) {
    party.state = host.start(seat, party.last?.[game] ?? null);
    party.status = "together";
  } else {
    party.state = null;
  }
  party.game = game;
  party.pickedBy = seat;
  return true;
}

/** Hands a game message to the open game's host. Null when it is not for the open game or does not parse. */
export function receive(
  party: PartyRecord,
  seat: Seat,
  game: string,
  raw: unknown,
  hosts: Hosts,
): HostReply<unknown, unknown> | null {
  const host = party.game === game ? hosts[game] : undefined;
  if (!host || party.status === "ended") return null;
  const msg = host.parse(raw);
  if (msg === null) return null;
  const reply = host.receive(party.state, seat, msg);
  if (reply.state !== undefined) party.state = reply.state;
  return reply;
}

/** The open game's state as `seat` needs it, or null when `game` is not open. */
export function sync(party: PartyRecord, seat: Seat, game: string, hosts: Hosts): unknown {
  const host = party.game === game ? hosts[game] : undefined;
  return host ? host.sync(party.state, seat) : null;
}
