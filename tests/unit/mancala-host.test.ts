import { describe, expect, it } from "vitest";
import { boardOf, mancalaHost, move, rematch, startMancala } from "../../src/games/mancala/core/host.ts";
import { parseMancalaMessage, type MancalaMatch } from "../../src/games/mancala/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";
import { DRAW, QUICK } from "./mancala-games.ts";

/** Sows `pits` through the host, each by the seat on turn, from a fresh match `first` opened. */
function play(pits: number[], first: 0 | 1 = 0): MancalaMatch {
  let m = startMancala(first);
  for (const pit of pits) {
    const seat = boardOf(m)!.turn;
    m = mancalaHost.receive(m, seat, { t: "move", pit, at: m.moves.length }).state!;
  }
  return m;
}

describe("moves", () => {
  it("starts with the player who opened the game, on a full board", () => {
    expect(startMancala(1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(startMancala(1))!.turn).toBe(1);
  });

  it("sows a pit and tells both phones", () => {
    const m = startMancala(0);
    const reply = mancalaHost.receive(m, 0, { t: "move", pit: 0, at: 0 });
    expect(reply.state).toEqual({ ...m, moves: [0] });
    expect(reply.all).toEqual({ t: "state", match: reply.state });
    expect(reply.me).toBeUndefined();
    expect(boardOf(reply.state!)!.turn).toBe(1);
  });

  it("refuses a move out of turn or from a stale board, and resyncs only that phone", () => {
    const m = play([0]);
    expect(move(m, 0, 1, 1)).toBeNull();
    expect(mancalaHost.receive(m, 0, { t: "move", pit: 1, at: 1 })).toEqual({
      me: { t: "state", match: m },
    });
    // The same move sent twice: the second is stale.
    expect(mancalaHost.receive(m, 1, { t: "move", pit: 1, at: 0 })).toEqual({
      me: { t: "state", match: m },
    });
    expect(move(m, 1, 1, 1)?.moves).toEqual([0, 1]);
  });

  it("refuses an empty pit", () => {
    // Seat 0 sows pit 2 into its store and goes again: pit 2 is now empty.
    const m = play([2]);
    expect(mancalaHost.receive(m, 0, { t: "move", pit: 2, at: 1 })).toEqual({ me: { t: "state", match: m } });
  });

  it("keeps the turn with the player whose last seed fell in their store, and refuses the other one", () => {
    const m = play([2]);
    const board = boardOf(m)!;
    expect(board.again).toBe(true);
    expect(board.turn).toBe(0);
    expect(mancalaHost.receive(m, 1, { t: "move", pit: 0, at: 1 })).toEqual({
      me: { t: "state", match: m },
    });
    expect(move(m, 0, 5, 1)?.moves).toEqual([2, 5]);
  });

  it("counts a win, then refuses any move after it", () => {
    const m = play(QUICK);
    expect(boardOf(m)!.winner).toBe(0);
    expect(m.wins).toEqual([1, 0]);
    // The same pits with the other starter play the same game with the seats swapped.
    expect(play(QUICK, 1).wins).toEqual([0, 1]);
    for (const seat of [0, 1] as const) {
      for (let pit = 0; pit < 6; pit++) {
        expect(mancalaHost.receive(m, seat, { t: "move", pit, at: m.moves.length })).toEqual({
          me: { t: "state", match: m },
        });
      }
    }
  });

  it("counts a draw for nobody", () => {
    const m = play(DRAW);
    expect(boardOf(m)!.draw).toBe(true);
    expect(m.wins).toEqual([0, 0]);
  });

  it("parses only whole pits on a side", () => {
    expect(parseMancalaMessage({ t: "move", pit: 5, at: 0 })).toEqual({ t: "move", pit: 5, at: 0 });
    expect(parseMancalaMessage({ t: "move", pit: 6, at: 0 })).toBeNull();
    expect(parseMancalaMessage({ t: "move", pit: -1, at: 0 })).toBeNull();
    expect(parseMancalaMessage({ t: "move", pit: 1.5, at: 0 })).toBeNull();
    expect(parseMancalaMessage({ t: "move", pit: 1 })).toBeNull();
    expect(parseMancalaMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseMancalaMessage({ t: "drop" })).toBeNull();
    expect(parseMancalaMessage(null)).toBeNull();
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first and keeps the score", () => {
    const done = play(QUICK);
    expect(rematch(startMancala(0), 0)).toBeNull();
    const one = mancalaHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.moves).toEqual(done.moves);
    expect(one.all).toEqual({ t: "state", match: one.state });
    expect(mancalaHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = mancalaHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    expect(both.all).toEqual({ t: "state", match: both.state });
  });

  it("is on offer after a draw too", () => {
    const done = play(DRAW);
    const one = rematch(done, 0)!;
    expect(rematch(one, 1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
  });
});

describe("in a party", () => {
  const HOSTS = { mancala: mancalaHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, "mancala", HOSTS, LIVE);
    expect(sync(p, 0, "mancala", HOSTS)).toEqual({ t: "state", match: startMancala(1) });
  });

  it("syncs a phone that reconnects onto the same board", () => {
    const p = party();
    pick(p, 0, "mancala", HOSTS, LIVE);
    for (const [seat, pit] of [
      [0, 0],
      [1, 1],
    ] as const) {
      receive(p, seat, "mancala", { t: "move", pit, at: (p.state as MancalaMatch).moves.length }, HOSTS);
    }
    // A reload or a dropped socket asks again; the answer is the stored match.
    const again = sync(p, 1, "mancala", HOSTS) as { t: "state"; match: MancalaMatch };
    expect(again.match.moves).toEqual([0, 1]);
    expect(boardOf(again.match)!.turn).toBe(0);
    expect(sync(p, 0, "mancala", HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "mancala", HOSTS, LIVE);
    for (const pit of QUICK) {
      const m = p.state as MancalaMatch;
      receive(p, boardOf(m)!.turn, "mancala", { t: "move", pit, at: m.moves.length }, HOSTS);
    }
    expect((p.state as MancalaMatch).wins).toEqual([1, 0]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "mancala", HOSTS, LIVE);
    expect(p.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    // Only the score is kept for next time, not the whole board.
    expect(p.last).toEqual({ mancala: { wins: [1, 0] } });
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
      expect(startMancala(0, junk).wins).toEqual([0, 0]);
    }
    expect(startMancala(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
