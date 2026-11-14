import { describe, expect, it } from "vitest";
import { boardOf, drop, fourHost, rematch, startFour } from "../../src/games/connect-four/core/host.ts";
import { parseFourMessage, type FourMatch } from "../../src/games/connect-four/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";

/** Plays `cols` in turn through the host, from a fresh match `first` opened. */
function play(cols: number[], first: 0 | 1 = 0): FourMatch {
  let m = startFour(first);
  for (const col of cols) {
    const seat = boardOf(m)!.turn;
    m = fourHost.receive(m, seat, { t: "drop", col, at: m.moves.length }).state!;
  }
  return m;
}

/** Red wins down column 0 while yellow stacks column 1. */
const RED_WINS = [0, 1, 0, 1, 0, 1, 0];
describe("drops", () => {
  it("starts with the player who opened the game, on an empty board", () => {
    expect(startFour(1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(startFour(1))!.turn).toBe(1);
  });

  it("takes a legal drop and tells both phones", () => {
    const m = startFour(0);
    const reply = fourHost.receive(m, 0, { t: "drop", col: 3, at: 0 });
    expect(reply.state).toEqual({ ...m, moves: [3] });
    expect(reply.all).toEqual({ t: "state", match: reply.state });
    expect(reply.me).toBeUndefined();
    expect(boardOf(reply.state!)!.turn).toBe(1);
  });

  it("refuses a drop out of turn or from a stale board, and resyncs only that phone", () => {
    const m = play([3]);
    expect(drop(m, 0, 2, 1)).toBeNull();
    expect(fourHost.receive(m, 0, { t: "drop", col: 2, at: 1 })).toEqual({ me: { t: "state", match: m } });
    // The same drop sent twice: the second is stale.
    expect(fourHost.receive(m, 1, { t: "drop", col: 2, at: 0 })).toEqual({ me: { t: "state", match: m } });
  });

  it("refuses a drop in a full column", () => {
    const m = play([0, 0, 0, 0, 0, 0]);
    expect(boardOf(m)!.turn).toBe(0);
    expect(fourHost.receive(m, 0, { t: "drop", col: 0, at: 6 })).toEqual({ me: { t: "state", match: m } });
    expect(drop(m, 0, 1, 6)?.moves).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("counts a win, then refuses any drop after it", () => {
    const m = play(RED_WINS);
    const board = boardOf(m)!;
    expect(board.winner).toBe(0);
    expect(m.wins).toEqual([1, 0]);
    expect(fourHost.receive(m, 1, { t: "drop", col: 2, at: m.moves.length })).toEqual({
      me: { t: "state", match: m },
    });
  });

  it("ends in a draw on a full board with no line, and counts no win", () => {
    // Columns in pairs of three, swapped every other pair, so no line of four forms.
    const cols = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2];
    const rest = [4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6];
    const m = play([...cols, ...rest]);
    const board = boardOf(m)!;
    expect(board.winner).toBeNull();
    expect(board.draw).toBe(true);
    expect(m.wins).toEqual([0, 0]);
    expect(fourHost.receive(m, 0, { t: "drop", col: 0, at: 42 }).me).toEqual({ t: "state", match: m });
  });

  it("relays live aim to the other phone only, on turn", () => {
    const m = startFour(0);
    expect(fourHost.receive(m, 0, { t: "aim", col: 5 })).toEqual({ others: { t: "aim", seat: 0, col: 5 } });
    expect(fourHost.receive(m, 1, { t: "aim", col: 5 })).toEqual({});
    expect(fourHost.receive(play(RED_WINS), 1, { t: "aim", col: 5 })).toEqual({});
  });

  it("parses only whole columns on the board", () => {
    expect(parseFourMessage({ t: "drop", col: 6, at: 0 })).toEqual({ t: "drop", col: 6, at: 0 });
    expect(parseFourMessage({ t: "drop", col: 7, at: 0 })).toBeNull();
    expect(parseFourMessage({ t: "drop", col: 1.5, at: 0 })).toBeNull();
    expect(parseFourMessage({ t: "drop", col: 1 })).toBeNull();
    expect(parseFourMessage({ t: "aim", col: -1 })).toBeNull();
    expect(parseFourMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseFourMessage({ t: "move" })).toBeNull();
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first and keeps the score", () => {
    const done = play(RED_WINS);
    expect(rematch(startFour(0), 0)).toBeNull();
    const one = fourHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.moves).toEqual(done.moves);
    expect(one.all).toEqual({ t: "state", match: one.state });
    expect(fourHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = fourHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    expect(both.all).toEqual({ t: "state", match: both.state });
  });
});

describe("in a party", () => {
  const HOSTS = { "connect-four": fourHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, "connect-four", HOSTS, LIVE);
    expect(sync(p, 0, "connect-four", HOSTS)).toEqual({ t: "state", match: startFour(1) });
  });

  it("syncs a phone that reconnects onto the same board", () => {
    const p = party();
    pick(p, 0, "connect-four", HOSTS, LIVE);
    for (const [seat, col] of [
      [0, 3],
      [1, 4],
      [0, 3],
    ] as const) {
      receive(p, seat, "connect-four", { t: "drop", col, at: (p.state as FourMatch).moves.length }, HOSTS);
    }
    // A reload or a dropped socket asks again; the answer is the stored match.
    const again = sync(p, 1, "connect-four", HOSTS) as { t: "state"; match: FourMatch };
    expect(again.match.moves).toEqual([3, 4, 3]);
    expect(boardOf(again.match)!.turn).toBe(1);
    expect(sync(p, 0, "connect-four", HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "connect-four", HOSTS, LIVE);
    for (const col of RED_WINS) {
      const m = p.state as FourMatch;
      receive(p, boardOf(m)!.turn, "connect-four", { t: "drop", col, at: m.moves.length }, HOSTS);
    }
    expect((p.state as FourMatch).wins).toEqual([1, 0]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "connect-four", HOSTS, LIVE);
    expect(p.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    // Only the score is kept for next time, not the whole board.
    expect(p.last).toEqual({ "connect-four": { wins: [1, 0] } });
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
      expect(startFour(0, junk).wins).toEqual([0, 0]);
    }
    expect(startFour(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
