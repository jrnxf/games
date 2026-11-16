import { describe, expect, it } from "vitest";
import { boardOf, move, rematch, reversiHost, startReversi } from "../../src/games/reversi/core/host.ts";
import { parseReversiMessage, type ReversiMatch } from "../../src/games/reversi/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";

/** Plays `cells` through the host, each by the seat on turn, from a fresh match `first` opened. */
function play(cells: number[], first: 0 | 1 = 0): ReversiMatch {
  let m = startReversi(first);
  for (const cell of cells) {
    const seat = boardOf(m)!.turn;
    m = reversiHost.receive(m, seat, { t: "move", cell, at: m.moves.length }).state!;
  }
  return m;
}

// Legal games from the opening, as in reversi.test.ts.
/** The eighth disc leaves the first player with no move. */
const PASS = [37, 45, 19, 38, 39, 31, 53, 47];
/** The first player takes every disc in nine moves. */
const WIPEOUT = [26, 34, 45, 19, 10, 17, 33, 25, 24];
const DRAW = [
  19, 20, 13, 12, 21, 34, 44, 26, 4, 22, 31, 3, 14, 6, 17, 30, 2, 42, 43, 52, 53, 54, 39, 11, 50, 49, 62, 18,
  46, 38, 10, 25, 51, 29, 56, 16, 23, 57, 24, 59, 8, 37, 60, 9, 1, 15, 5, 47, 45, 61, 7, 0, 58, 32, 63, 55,
  41, 48, 40, 33,
];

describe("moves", () => {
  it("starts with the player who opened the game, on the opening board", () => {
    expect(startReversi(1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(startReversi(1))!.turn).toBe(1);
  });

  it("takes a legal move and tells both phones", () => {
    const m = startReversi(0);
    const reply = reversiHost.receive(m, 0, { t: "move", cell: 19, at: 0 });
    expect(reply.state).toEqual({ ...m, moves: [19] });
    expect(reply.all).toEqual({ t: "state", match: reply.state });
    expect(reply.me).toBeUndefined();
    expect(boardOf(reply.state!)!.turn).toBe(1);
  });

  it("refuses a move out of turn or from a stale board, and resyncs only that phone", () => {
    const m = play([19]);
    expect(move(m, 0, 18, 1)).toBeNull();
    expect(reversiHost.receive(m, 0, { t: "move", cell: 18, at: 1 })).toEqual({
      me: { t: "state", match: m },
    });
    // The same move sent twice: the second is stale.
    expect(reversiHost.receive(m, 1, { t: "move", cell: 18, at: 0 })).toEqual({
      me: { t: "state", match: m },
    });
    expect(move(m, 1, 18, 1)?.moves).toEqual([19, 18]);
  });

  it("refuses a move that outflanks nothing, or on a taken cell", () => {
    const m = startReversi(0);
    for (const cell of [0, 27, 18]) {
      expect(reversiHost.receive(m, 0, { t: "move", cell, at: 0 })).toEqual({ me: { t: "state", match: m } });
    }
  });

  it("keeps the turn with the mover after a pass, and refuses the player who has no move", () => {
    const m = play(PASS);
    const board = boardOf(m)!;
    expect(board.passed).toBe(true);
    expect(board.turn).toBe(1);
    expect(reversiHost.receive(m, 0, { t: "move", cell: 0, at: m.moves.length }).me).toEqual({
      t: "state",
      match: m,
    });
  });

  it("counts a win, then refuses any move after it", () => {
    const m = play(WIPEOUT);
    expect(boardOf(m)!.winner).toBe(0);
    expect(m.wins).toEqual([1, 0]);
    expect(play(WIPEOUT, 1).wins).toEqual([0, 1]);
    for (const seat of [0, 1] as const) {
      expect(reversiHost.receive(m, seat, { t: "move", cell: 0, at: m.moves.length })).toEqual({
        me: { t: "state", match: m },
      });
    }
  });

  it("counts no win for a draw", () => {
    const m = play(DRAW);
    expect(boardOf(m)!.draw).toBe(true);
    expect(m.wins).toEqual([0, 0]);
  });

  it("parses only whole cells on the board", () => {
    expect(parseReversiMessage({ t: "move", cell: 63, at: 0 })).toEqual({ t: "move", cell: 63, at: 0 });
    expect(parseReversiMessage({ t: "move", cell: 64, at: 0 })).toBeNull();
    expect(parseReversiMessage({ t: "move", cell: -1, at: 0 })).toBeNull();
    expect(parseReversiMessage({ t: "move", cell: 1.5, at: 0 })).toBeNull();
    expect(parseReversiMessage({ t: "move", cell: 1 })).toBeNull();
    expect(parseReversiMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseReversiMessage({ t: "drop" })).toBeNull();
    expect(parseReversiMessage(null)).toBeNull();
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first and keeps the score", () => {
    const done = play(WIPEOUT);
    expect(rematch(startReversi(0), 0)).toBeNull();
    const one = reversiHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.moves).toEqual(done.moves);
    expect(one.all).toEqual({ t: "state", match: one.state });
    expect(reversiHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = reversiHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    expect(both.all).toEqual({ t: "state", match: both.state });
  });
});

describe("in a party", () => {
  const HOSTS = { reversi: reversiHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, "reversi", HOSTS, LIVE);
    expect(sync(p, 0, "reversi", HOSTS)).toEqual({ t: "state", match: startReversi(1) });
  });

  it("syncs a phone that reconnects onto the same board", () => {
    const p = party();
    pick(p, 0, "reversi", HOSTS, LIVE);
    for (const [seat, cell] of [
      [0, 19],
      [1, 18],
    ] as const) {
      receive(p, seat, "reversi", { t: "move", cell, at: (p.state as ReversiMatch).moves.length }, HOSTS);
    }
    // A reload or a dropped socket asks again; the answer is the stored match.
    const again = sync(p, 1, "reversi", HOSTS) as { t: "state"; match: ReversiMatch };
    expect(again.match.moves).toEqual([19, 18]);
    expect(boardOf(again.match)!.turn).toBe(0);
    expect(sync(p, 0, "reversi", HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "reversi", HOSTS, LIVE);
    for (const cell of WIPEOUT) {
      const m = p.state as ReversiMatch;
      receive(p, boardOf(m)!.turn, "reversi", { t: "move", cell, at: m.moves.length }, HOSTS);
    }
    expect((p.state as ReversiMatch).wins).toEqual([1, 0]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "reversi", HOSTS, LIVE);
    expect(p.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    // Only the score is kept for next time, not the whole board.
    expect(p.last).toEqual({ reversi: { wins: [1, 0] } });
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
      expect(startReversi(0, junk).wins).toEqual([0, 0]);
    }
    expect(startReversi(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
