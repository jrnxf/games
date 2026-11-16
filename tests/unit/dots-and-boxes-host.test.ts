import { describe, expect, it } from "vitest";
import { boardOf, boxesHost, move, rematch, startBoxes } from "../../src/games/dots-and-boxes/core/host.ts";
import { parseBoxesMessage, type BoxesMatch } from "../../src/games/dots-and-boxes/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";
import { GIFT, SWEEP } from "./dots-and-boxes-games.ts";

/** Draws `lines` through the host, each by the seat on turn, from a fresh match `first` opened. */
function play(lines: number[], first: 0 | 1 = 0): BoxesMatch {
  let m = startBoxes(first);
  for (const line of lines) {
    const seat = boardOf(m)!.turn;
    m = boxesHost.receive(m, seat, { t: "move", line, at: m.moves.length }).state!;
  }
  return m;
}

describe("moves", () => {
  it("starts with the player who opened the game, on an empty board", () => {
    expect(startBoxes(1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(startBoxes(1))!.turn).toBe(1);
  });

  it("takes a free line and tells both phones", () => {
    const m = startBoxes(0);
    const reply = boxesHost.receive(m, 0, { t: "move", line: 7, at: 0 });
    expect(reply.state).toEqual({ ...m, moves: [7] });
    expect(reply.all).toEqual({ t: "state", match: reply.state });
    expect(reply.me).toBeUndefined();
    expect(boardOf(reply.state!)!.turn).toBe(1);
  });

  it("refuses a move out of turn or from a stale board, and resyncs only that phone", () => {
    const m = play([7]);
    expect(move(m, 0, 8, 1)).toBeNull();
    expect(boxesHost.receive(m, 0, { t: "move", line: 8, at: 1 })).toEqual({
      me: { t: "state", match: m },
    });
    // The same move sent twice: the second is stale.
    expect(boxesHost.receive(m, 1, { t: "move", line: 8, at: 0 })).toEqual({
      me: { t: "state", match: m },
    });
    expect(move(m, 1, 8, 1)?.moves).toEqual([7, 8]);
  });

  it("refuses a line that is already drawn", () => {
    const m = play([7]);
    expect(boxesHost.receive(m, 1, { t: "move", line: 7, at: 1 })).toEqual({ me: { t: "state", match: m } });
  });

  it("keeps the turn with the player who closed a box, and refuses the other one", () => {
    const m = play(GIFT);
    const board = boardOf(m)!;
    expect(board.again).toBe(true);
    expect(board.turn).toBe(1);
    expect(board.score).toEqual([0, 1]);
    expect(boxesHost.receive(m, 0, { t: "move", line: 20, at: m.moves.length })).toEqual({
      me: { t: "state", match: m },
    });
    expect(move(m, 1, 20, m.moves.length)?.moves).toEqual([...GIFT, 20]);
  });

  it("counts a win, then refuses any move after it", () => {
    const m = play(SWEEP);
    expect(boardOf(m)!.winner).toBe(1);
    expect(m.wins).toEqual([0, 1]);
    expect(play(SWEEP, 1).wins).toEqual([1, 0]);
    for (const seat of [0, 1] as const) {
      expect(boxesHost.receive(m, seat, { t: "move", line: 0, at: m.moves.length })).toEqual({
        me: { t: "state", match: m },
      });
    }
  });

  it("parses only whole lines on the board", () => {
    expect(parseBoxesMessage({ t: "move", line: 59, at: 0 })).toEqual({ t: "move", line: 59, at: 0 });
    expect(parseBoxesMessage({ t: "move", line: 60, at: 0 })).toBeNull();
    expect(parseBoxesMessage({ t: "move", line: -1, at: 0 })).toBeNull();
    expect(parseBoxesMessage({ t: "move", line: 1.5, at: 0 })).toBeNull();
    expect(parseBoxesMessage({ t: "move", line: 1 })).toBeNull();
    expect(parseBoxesMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseBoxesMessage({ t: "drop" })).toBeNull();
    expect(parseBoxesMessage(null)).toBeNull();
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first and keeps the score", () => {
    const done = play(SWEEP);
    expect(rematch(startBoxes(0), 0)).toBeNull();
    const one = boxesHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.moves).toEqual(done.moves);
    expect(one.all).toEqual({ t: "state", match: one.state });
    expect(boxesHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = boxesHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({ first: 1, moves: [], wins: [0, 1], rematch: [false, false] });
    expect(both.all).toEqual({ t: "state", match: both.state });
  });
});

describe("in a party", () => {
  const HOSTS = { "dots-and-boxes": boxesHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, "dots-and-boxes", HOSTS, LIVE);
    expect(sync(p, 0, "dots-and-boxes", HOSTS)).toEqual({ t: "state", match: startBoxes(1) });
  });

  it("syncs a phone that reconnects onto the same board", () => {
    const p = party();
    pick(p, 0, "dots-and-boxes", HOSTS, LIVE);
    for (const [seat, line] of [
      [0, 7],
      [1, 8],
    ] as const) {
      receive(
        p,
        seat,
        "dots-and-boxes",
        { t: "move", line, at: (p.state as BoxesMatch).moves.length },
        HOSTS,
      );
    }
    // A reload or a dropped socket asks again; the answer is the stored match.
    const again = sync(p, 1, "dots-and-boxes", HOSTS) as { t: "state"; match: BoxesMatch };
    expect(again.match.moves).toEqual([7, 8]);
    expect(boardOf(again.match)!.turn).toBe(0);
    expect(sync(p, 0, "dots-and-boxes", HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "dots-and-boxes", HOSTS, LIVE);
    for (const line of SWEEP) {
      const m = p.state as BoxesMatch;
      receive(p, boardOf(m)!.turn, "dots-and-boxes", { t: "move", line, at: m.moves.length }, HOSTS);
    }
    expect((p.state as BoxesMatch).wins).toEqual([0, 1]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "dots-and-boxes", HOSTS, LIVE);
    expect(p.state).toEqual({ first: 1, moves: [], wins: [0, 1], rematch: [false, false] });
    // Only the score is kept for next time, not the whole board.
    expect(p.last).toEqual({ "dots-and-boxes": { wins: [0, 1] } });
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
      expect(startBoxes(0, junk).wins).toEqual([0, 0]);
    }
    expect(startBoxes(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
