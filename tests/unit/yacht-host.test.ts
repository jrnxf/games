import { describe, expect, it } from "vitest";
import { CHANCE, ROLL, YACHT, canScore, total, type Seat } from "../../src/games/yacht/core/board.ts";
import { faces } from "../../src/games/yacht/core/dice.ts";
import {
  gameOf,
  play,
  rematch,
  startYacht,
  viewOf,
  yachtHost,
  type YachtMatch,
} from "../../src/games/yacht/core/host.ts";
import { parseYachtMessage, type YachtServerMessage } from "../../src/games/yacht/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";

const SEED = [11, 22, 33, 44, 55, 66, 77, 88];

/** Sends `msg` from the seat on turn and returns the new match. */
function send(m: YachtMatch, msg: { t: "roll"; held: number } | { t: "score"; box: number }): YachtMatch {
  const seat = gameOf(m)!.turn;
  const reply = yachtHost.receive(m, seat, { ...msg, at: m.actions.length });
  if (!reply.state) throw new Error("refused");
  return reply.state;
}

/** Plays a whole match: one roll a turn, then the first box that may take it. */
function finish(m: YachtMatch): YachtMatch {
  while (!gameOf(m)!.over) {
    m = send(m, { t: "roll", held: 0 });
    const g = gameOf(m)!;
    const card = g.cards[g.turn];
    m = send(m, { t: "score", box: card.boxes.findIndex((_, i) => canScore(card, i, g.dice)) });
  }
  return m;
}

describe("the host", () => {
  it("starts with the player who opened the game, with a fresh secret seed", () => {
    const m = startYacht(1);
    expect(m.first).toBe(1);
    expect(m.seed).toHaveLength(8);
    expect(startYacht(1).seed).not.toEqual(m.seed);
    expect(gameOf(m)!.turn).toBe(1);
  });

  it("rolls with its own seed and tells both phones the faces only", () => {
    const m = startYacht(0, null, SEED);
    const reply = yachtHost.receive(m, 0, { t: "roll", held: 0, at: 0 });
    expect(reply.state!.dice).toEqual([faces(SEED, 0)]);
    expect(reply.all).toEqual({ t: "state", match: viewOf(reply.state!) });
    expect(reply.me).toBeUndefined();
    expect(gameOf(reply.state!)!.dice).toEqual(faces(SEED, 0));
  });

  it("keeps held dice and rolls the rest", () => {
    let m = send(startYacht(0, null, SEED), { t: "roll", held: 0 });
    const first = m.dice[0]!;
    m = send(m, { t: "roll", held: 0b10101 });
    const fresh = faces(SEED, 1);
    expect(m.dice[1]).toEqual([first[0], fresh[1], first[2], fresh[3], first[4]]);
  });

  it("refuses an action out of turn or on a stale game, and resyncs only that phone", () => {
    const m = send(startYacht(0, null, SEED), { t: "roll", held: 0 });
    const truth = { me: { t: "state", match: viewOf(m) } };
    expect(play(m, 1, CHANCE, 1)).toBeNull();
    expect(yachtHost.receive(m, 1, { t: "score", box: CHANCE, at: 1 })).toEqual(truth);
    // The same roll sent twice: the second is stale.
    expect(yachtHost.receive(m, 0, { t: "roll", held: 0, at: 0 })).toEqual(truth);
    // A box that may not take the dice, and a first roll that holds dice.
    const scored = send(m, { t: "score", box: CHANCE });
    expect(yachtHost.receive(scored, 0, { t: "score", box: YACHT, at: 2 })).toEqual({
      me: { t: "state", match: viewOf(scored) },
    });
    expect(yachtHost.receive(scored, 1, { t: "roll", held: 3, at: 2 })).toEqual({
      me: { t: "state", match: viewOf(scored) },
    });
  });

  it("relays held dice live to the friend only, from the player on turn after a roll", () => {
    const m0 = startYacht(0, null, SEED);
    expect(yachtHost.receive(m0, 0, { t: "hold", held: 1, at: 0 })).toEqual({});
    const m = send(m0, { t: "roll", held: 0 });
    expect(yachtHost.receive(m, 0, { t: "hold", held: 5, at: 1 })).toEqual({
      others: { t: "hold", held: 5, at: 1 },
    });
    expect(yachtHost.receive(m, 1, { t: "hold", held: 5, at: 1 })).toEqual({});
    expect(yachtHost.receive(m, 0, { t: "hold", held: 5, at: 0 })).toEqual({});
  });

  it("counts the win, waits for both players to ask for a rematch, then swaps who starts", () => {
    const m = finish(startYacht(0, null, SEED));
    const g = gameOf(m)!;
    expect(g.over).toBe(true);
    const winner = total(g.cards[0]) > total(g.cards[1]) ? 0 : 1;
    expect(m.wins[winner]).toBe(1);
    expect(play(m, g.turn, ROLL, m.actions.length)).toBeNull();
    const asked = yachtHost.receive(m, 1, { t: "rematch" }).state!;
    expect(asked.rematch).toEqual([false, true]);
    expect(rematch(asked, 1)).toBeNull();
    const fresh = rematch(asked, 0, [9, 9, 9, 9, 9, 9, 9, 9])!;
    expect(fresh).toEqual({
      seed: [9, 9, 9, 9, 9, 9, 9, 9],
      first: 1,
      actions: [],
      dice: [],
      wins: m.wins,
      rematch: [false, false],
    });
    // The real host picks a new seed for the rematch.
    expect(yachtHost.receive(asked, 0, { t: "rematch" }).state!.seed).not.toEqual(SEED);
    // No rematch mid-game.
    expect(rematch(startYacht(0), 0)).toBeNull();
  });

  it("never sends the seed to a phone", () => {
    let m = startYacht(0, null, SEED);
    const sent: YachtServerMessage[] = [yachtHost.sync(m, 0), yachtHost.sync(m, 1)];
    const take = (seat: Seat, msg: Parameters<typeof yachtHost.receive>[2]) => {
      const r = yachtHost.receive(m, seat, msg);
      for (const out of [r.all, r.others, r.me]) if (out) sent.push(out);
      if (r.state) m = r.state;
    };
    while (!gameOf(m)!.over) {
      const g = gameOf(m)!;
      take(g.turn, { t: "roll", held: 0, at: m.actions.length });
      take(g.turn, { t: "hold", held: 3, at: m.actions.length });
      take((1 - g.turn) as Seat, { t: "score", box: 0, at: m.actions.length });
      const after = gameOf(m)!;
      const card = after.cards[after.turn];
      take(after.turn, {
        t: "score",
        box: card.boxes.findIndex((_, i) => canScore(card, i, after.dice)),
        at: m.actions.length,
      });
    }
    take(0, { t: "rematch" });
    take(1, { t: "rematch" });
    sent.push(yachtHost.sync(m, 0));
    expect(sent.length).toBeGreaterThan(50);
    for (const msg of sent) {
      expect(JSON.stringify(msg)).not.toContain("seed");
      if (msg.t === "state")
        expect(Object.keys(msg.match).sort()).toEqual(["actions", "dice", "first", "rematch", "wins"]);
    }
  });

  it("checks every message from a phone", () => {
    expect(parseYachtMessage({ t: "roll", held: 0, at: 0 })).toEqual({ t: "roll", held: 0, at: 0 });
    expect(parseYachtMessage({ t: "score", box: 12, at: 3 })).toEqual({ t: "score", box: 12, at: 3 });
    expect(parseYachtMessage({ t: "hold", held: 30, at: 3 })).toEqual({ t: "hold", held: 30, at: 3 });
    expect(parseYachtMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    for (const junk of [
      null,
      "roll",
      { t: "roll", held: 31, at: 0 },
      { t: "roll", held: -1, at: 0 },
      { t: "roll", held: 0 },
      { t: "score", box: 13, at: 0 },
      { t: "score", box: 1.5, at: 0 },
      { t: "score", box: 1, at: -1 },
      { t: "hold", held: "1", at: 0 },
      // A phone can't hand the host its own dice.
      { t: "dice", dice: [6, 6, 6, 6, 6] },
    ]) {
      expect(parseYachtMessage(junk)).toBeNull();
    }
  });
});

describe("in a party", () => {
  const HOSTS = { yacht: yachtHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it, and syncs the view without the seed", () => {
    const p = party();
    pick(p, 1, "yacht", HOSTS, LIVE);
    const m = p.state as YachtMatch;
    expect(m.first).toBe(1);
    expect(sync(p, 0, "yacht", HOSTS)).toEqual({ t: "state", match: viewOf(m) });
  });

  it("syncs a phone that reconnects onto the same dice", () => {
    const p = party();
    pick(p, 0, "yacht", HOSTS, LIVE);
    receive(p, 0, "yacht", { t: "roll", held: 0, at: 0 }, HOSTS);
    receive(p, 0, "yacht", { t: "roll", held: 1, at: 1 }, HOSTS);
    const again = sync(p, 1, "yacht", HOSTS) as { t: "state"; match: YachtMatch };
    expect(again.match.dice).toHaveLength(2);
    expect(gameOf(again.match)!.rolls).toBe(2);
    expect(sync(p, 0, "yacht", HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "yacht", HOSTS, LIVE);
    p.state = finish(p.state as YachtMatch);
    const wins = (p.state as YachtMatch).wins;
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "yacht", HOSTS, LIVE);
    const m = p.state as YachtMatch;
    expect(m.wins).toEqual(wins);
    expect(m.first).toBe(1);
    expect(m.actions).toEqual([]);
    // Only the score is kept for next time, not the seed or the game.
    expect(p.last).toEqual({ yacht: { wins } });
  });

  it("starts at 0-0 when the kept score is missing or corrupt", () => {
    for (const junk of [
      undefined,
      null,
      7,
      "x",
      {},
      { wins: 3 },
      { wins: [1] },
      { wins: [1, -1] },
      { wins: [0.5, 1] },
      { wins: ["1", 0] },
    ]) {
      expect(startYacht(0, junk).wins).toEqual([0, 0]);
    }
    expect(startYacht(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
