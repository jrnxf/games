// Yacht's server side, run by the party server. The host owns the dice: it
// makes the game's secret seed, rolls with it, and sends the phones only the
// faces that came up. A phone can't choose its dice, and it can't see the
// seed, so it can't work out the rolls to come. Every action must be on turn
// and made on the latest game (`at`), or it is refused and the phone gets the
// true state back. A hold is shown live to the friend and never stored.

import type { GameHost, HostReply } from "../../../party/host.ts";
import { act, replay, ROLL, type Game, type Seat } from "./board.ts";
import { faces, isSeed, newSeed, type Seed } from "./dice.ts";
import {
  parseYachtMessage,
  type YachtClientMessage,
  type YachtServerMessage,
  type YachtView,
} from "./protocol.ts";

/** The host's whole state: what the phones see, plus the seed they never do. */
export interface YachtMatch extends YachtView {
  seed: Seed;
}

type Reply = HostReply<YachtMatch, YachtServerMessage>;

/** Replays the rolls a game already made: the dice list, not the seed. */
export const rollsOf =
  (dice: readonly (readonly number[])[]) =>
  (k: number): readonly number[] =>
    dice[k] ?? [];

/** The game a match or a view replays to. Null only for a corrupt one, which the host never stores. */
export const gameOf = (m: YachtView): Game | null => replay(m.first, m.actions, rollsOf(m.dice));

/** What a phone may see of a match: all of it but the seed. */
export const viewOf = (m: YachtMatch): YachtView => ({
  first: m.first,
  actions: m.actions,
  dice: m.dice,
  wins: m.wins,
  rematch: m.rematch,
});

/** What the party keeps when it closes Yacht: the running score. */
export const carryYacht = (m: YachtMatch): { wins: [number, number] } => ({ wins: [...m.wins] });

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * A fresh match when `by` opens Yacht: they roll first. The score carries
 * over from the last time this party played it (`carried`, from
 * `carryYacht`), and starts at 0-0 when that is missing or corrupt. `seed`
 * is for tests: a real match always gets a fresh one.
 */
export function startYacht(by: Seat, carried: unknown = null, seed: Seed = newSeed()): YachtMatch {
  const kept = (carried as { wins?: unknown } | null | undefined)?.wins;
  const wins: [number, number] =
    Array.isArray(kept) && kept.length === 2 && kept.every(isCount)
      ? [kept[0] as number, kept[1] as number]
      : [0, 0];
  return {
    seed: isSeed(seed) ? seed : newSeed(),
    first: by,
    actions: [],
    dice: [],
    wins,
    rematch: [false, false],
  };
}

/** Plays `action` for `seat` if it is their turn and the phone saw the latest game. */
export function play(m: YachtMatch, seat: Seat, action: number, at: number): YachtMatch | null {
  const game = gameOf(m);
  if (!game || game.over || game.turn !== seat || m.actions.length !== at) return null;
  const next = act(game, action, (k) => faces(m.seed, k));
  if (!next) return null;
  const dice = action >= ROLL ? [...m.dice, next.dice] : m.dice;
  const wins: [number, number] = [...m.wins];
  if (next.winner !== null) wins[next.winner] += 1;
  return { ...m, actions: next.actions, dice, wins };
}

/** A player asks for a rematch. A new game starts when both have, with the other player first and a new seed. */
export function rematch(m: YachtMatch, seat: Seat, seed: Seed = newSeed()): YachtMatch | null {
  const game = gameOf(m);
  if (!game || !game.over || m.rematch[seat]) return null;
  const flags: [boolean, boolean] = [...m.rematch];
  flags[seat] = true;
  if (!flags[0] || !flags[1]) return { ...m, rematch: flags };
  return { seed, first: (1 - m.first) as Seat, actions: [], dice: [], wins: m.wins, rematch: [false, false] };
}

const changed = (m: YachtMatch): Reply => ({ state: m, all: { t: "state", match: viewOf(m) } });

function receive(m: YachtMatch, seat: Seat, msg: YachtClientMessage): Reply {
  switch (msg.t) {
    case "roll":
    case "score": {
      const action = msg.t === "roll" ? ROLL + msg.held : msg.box;
      const next = play(m, seat, action, msg.at);
      // A refused action means this phone is out of date: send it the truth.
      return next ? changed(next) : { me: { t: "state", match: viewOf(m) } };
    }
    case "hold": {
      // Only the player on turn holds dice, only after a roll, and only on the latest game.
      const game = gameOf(m);
      if (!game || game.over || game.turn !== seat || game.rolls === 0 || msg.at !== m.actions.length)
        return {};
      return { others: { t: "hold", held: msg.held, at: msg.at } };
    }
    case "rematch": {
      const next = rematch(m, seat);
      return next ? changed(next) : {};
    }
  }
}

export const yachtHost: GameHost<YachtMatch, YachtClientMessage, YachtServerMessage> = {
  start: (by, carried) => startYacht(by, carried),
  parse: parseYachtMessage,
  receive,
  sync: (match) => ({ t: "state", match: viewOf(match) }),
  carry: carryYacht,
};
