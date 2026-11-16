import { describe, expect, it } from "vitest";
import {
  boardOf,
  mark,
  rematch,
  startUltimate,
  ultimateHost,
} from "../../src/games/ultimate-tic-tac-toe/core/host.ts";
import {
  parseUltimateMessage,
  type UltimateMatch,
} from "../../src/games/ultimate-tic-tac-toe/core/protocol.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";
import { DRAW, SENT_TO_FULL, SENT_TO_WON, WIN } from "./ultimate-tic-tac-toe-games.ts";

/** Plays `cells` through the host, each by the seat on turn, from a fresh match `first` opened. */
function play(cells: number[], first: 0 | 1 = 0): UltimateMatch {
  let m = startUltimate(first);
  for (const cell of cells) {
    const seat = boardOf(m)!.turn;
    m = ultimateHost.receive(m, seat, { t: "mark", cell, at: m.moves.length }).state!;
  }
  return m;
}

describe("marks", () => {
  it("starts with the player who opened the game, on an empty board", () => {
    expect(startUltimate(1)).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(startUltimate(1))!.turn).toBe(1);
  });

  it("takes a legal mark and tells both phones", () => {
    const m = startUltimate(0);
    const reply = ultimateHost.receive(m, 0, { t: "mark", cell: 41, at: 0 });
    expect(reply.state).toEqual({ ...m, moves: [41] });
    expect(reply.all).toEqual({ t: "state", match: reply.state });
    expect(reply.me).toBeUndefined();
    expect(boardOf(reply.state!)!.turn).toBe(1);
    expect(boardOf(reply.state!)!.target).toBe(5);
  });

  it("refuses a mark out of turn or from a stale board, and resyncs only that phone", () => {
    const m = play([41]);
    expect(mark(m, 0, 49, 1)).toBeNull();
    expect(ultimateHost.receive(m, 0, { t: "mark", cell: 49, at: 1 })).toEqual({
      me: { t: "state", match: m },
    });
    // The same mark sent twice: the second is stale.
    expect(ultimateHost.receive(m, 1, { t: "mark", cell: 49, at: 0 })).toEqual({
      me: { t: "state", match: m },
    });
    expect(mark(m, 1, 49, 1)?.moves).toEqual([41, 49]);
  });

  it("refuses a mark outside the board the player was sent to, or on a taken cell", () => {
    // 41 is spot 5 of board 4, so the second player must play in board 5 (cells 45 to 53).
    const m = play([41, 49]);
    // 49 is spot 4 of board 5: the first player must play in board 4, where 41 is taken.
    for (const cell of [0, 41, 49, 80]) {
      expect(ultimateHost.receive(m, 0, { t: "mark", cell, at: 2 })).toEqual({
        me: { t: "state", match: m },
      });
    }
    expect(mark(m, 0, 38, 2)?.moves).toEqual([41, 49, 38]);
  });

  it("lets a player sent to a won or a full board play in any open one, but not in that board", () => {
    const won = play(SENT_TO_WON);
    expect(boardOf(won)!.target).toBeNull();
    expect(mark(won, 0, 36, won.moves.length)).toBeNull();
    expect(mark(won, 0, 0, won.moves.length)?.moves.at(-1)).toBe(0);
    const full = play(SENT_TO_FULL);
    expect(boardOf(full)!.target).toBeNull();
    expect(mark(full, 0, 1, full.moves.length)?.moves.at(-1)).toBe(1);
  });

  it("counts a win, then refuses any mark after it", () => {
    const m = play(WIN);
    expect(boardOf(m)!.winner).toBe(0);
    expect(m.wins).toEqual([1, 0]);
    expect(play(WIN, 1).wins).toEqual([0, 1]);
    for (const seat of [0, 1] as const) {
      for (let cell = 0; cell < 81; cell++) {
        expect(ultimateHost.receive(m, seat, { t: "mark", cell, at: m.moves.length })).toEqual({
          me: { t: "state", match: m },
        });
      }
    }
  });

  it("counts no win for a draw", () => {
    const m = play(DRAW);
    expect(boardOf(m)!.draw).toBe(true);
    expect(m.wins).toEqual([0, 0]);
  });

  it("relays live aim to the other phone only, on turn and on a cell the player may mark", () => {
    const m = play([41]);
    expect(ultimateHost.receive(m, 1, { t: "aim", cell: 49 })).toEqual({
      others: { t: "aim", seat: 1, cell: 49 },
    });
    expect(ultimateHost.receive(m, 0, { t: "aim", cell: 49 })).toEqual({});
    // Outside the board the player was sent to.
    expect(ultimateHost.receive(m, 1, { t: "aim", cell: 0 })).toEqual({});
    for (const seat of [0, 1] as const)
      expect(ultimateHost.receive(play(WIN), seat, { t: "aim", cell: 1 })).toEqual({});
  });

  it("parses only whole cells on the board", () => {
    expect(parseUltimateMessage({ t: "mark", cell: 80, at: 0 })).toEqual({ t: "mark", cell: 80, at: 0 });
    expect(parseUltimateMessage({ t: "mark", cell: 81, at: 0 })).toBeNull();
    expect(parseUltimateMessage({ t: "mark", cell: -1, at: 0 })).toBeNull();
    expect(parseUltimateMessage({ t: "mark", cell: 1.5, at: 0 })).toBeNull();
    expect(parseUltimateMessage({ t: "mark", cell: 1 })).toBeNull();
    expect(parseUltimateMessage({ t: "aim", cell: 0 })).toEqual({ t: "aim", cell: 0 });
    expect(parseUltimateMessage({ t: "aim", cell: 81 })).toBeNull();
    expect(parseUltimateMessage({ t: "aim" })).toBeNull();
    expect(parseUltimateMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseUltimateMessage({ t: "move", cell: 0, at: 0 })).toBeNull();
    expect(parseUltimateMessage(null)).toBeNull();
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first and keeps the score", () => {
    const done = play(WIN);
    expect(rematch(startUltimate(0), 0)).toBeNull();
    const one = ultimateHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.moves).toEqual(done.moves);
    expect(one.all).toEqual({ t: "state", match: one.state });
    expect(ultimateHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = ultimateHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    expect(both.all).toEqual({ t: "state", match: both.state });
  });

  it("starts a rematch after a draw too, with the score unchanged", () => {
    let m = play(DRAW);
    for (const seat of [0, 1] as const) m = ultimateHost.receive(m, seat, { t: "rematch" }).state!;
    expect(m).toEqual({ first: 1, moves: [], wins: [0, 0], rematch: [false, false] });
  });
});

describe("in a party", () => {
  const HOSTS = { "ultimate-tic-tac-toe": ultimateHost };
  const ID = "ultimate-tic-tac-toe";
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, ID, HOSTS, LIVE);
    expect(sync(p, 0, ID, HOSTS)).toEqual({ t: "state", match: startUltimate(1) });
  });

  it("syncs a phone that reconnects onto the same board", () => {
    const p = party();
    pick(p, 0, ID, HOSTS, LIVE);
    for (const [seat, cell] of [
      [0, 41],
      [1, 49],
    ] as const) {
      receive(p, seat, ID, { t: "mark", cell, at: (p.state as UltimateMatch).moves.length }, HOSTS);
    }
    // A reload or a dropped socket asks again; the answer is the stored match.
    const again = sync(p, 1, ID, HOSTS) as { t: "state"; match: UltimateMatch };
    expect(again.match.moves).toEqual([41, 49]);
    expect(boardOf(again.match)!.turn).toBe(0);
    expect(sync(p, 0, ID, HOSTS)).toEqual(again);
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, ID, HOSTS, LIVE);
    for (const cell of WIN) {
      const m = p.state as UltimateMatch;
      receive(p, boardOf(m)!.turn, ID, { t: "mark", cell, at: m.moves.length }, HOSTS);
    }
    expect((p.state as UltimateMatch).wins).toEqual([1, 0]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, ID, HOSTS, LIVE);
    expect(p.state).toEqual({ first: 1, moves: [], wins: [1, 0], rematch: [false, false] });
    // Only the score is kept for next time, not the whole board.
    expect(p.last).toEqual({ [ID]: { wins: [1, 0] } });
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
      expect(startUltimate(0, junk).wins).toEqual([0, 0]);
    }
    expect(startUltimate(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
