import { describe, expect, it } from "vitest";
import { choose } from "../../src/games/last-card/core/ai.ts";
import { DECK, other, playable, type Action, type Seat } from "../../src/games/last-card/core/board.ts";
import {
  boardOf,
  carryLast,
  lastCardHost,
  move,
  rematch,
  startLast,
  viewOf,
} from "../../src/games/last-card/core/host.ts";
import {
  parseLastMessage,
  type LastClientMessage,
  type LastMatch,
  type LastServerMessage,
  type LastView,
} from "../../src/games/last-card/core/protocol.ts";
import type { HostReply } from "../../src/party/host.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";

type Reply = HostReply<LastMatch, LastServerMessage>;

const viewIn = (msg: LastServerMessage | undefined): LastView => {
  if (msg?.t !== "state") throw new Error("not a state message");
  return msg.view;
};

/** The next move a phone would send: the computer's choice for the seat on turn, aimed from the latest game. */
function next(m: LastMatch): [Seat, LastClientMessage] {
  const b = boardOf(m);
  const seat = b.turn;
  const a = choose(viewOf(m, seat), "medium", 5);
  const at = m.moves.length;
  if (a.t === "play") return [seat, { ...a, call: a.call === true, at }];
  return [seat, { t: a.t, at }];
}

/** Plays `n` moves through the host and keeps every reply with the seat that sent it. */
function playOn(m: LastMatch, n: number): { m: LastMatch; replies: [Seat, Reply][] } {
  const replies: [Seat, Reply][] = [];
  for (let i = 0; i < n && !boardOf(m).over; i++) {
    const [seat, msg] = next(m);
    const reply = lastCardHost.receive(m, seat, msg);
    expect(reply.state, `move ${i}`).toBeDefined();
    replies.push([seat, reply]);
    m = reply.state!;
  }
  return { m, replies };
}

/** A whole game. */
const won = (seed = 3, first: Seat = 0) => playOn(startLast(first, null, seed), 2_000).m;

/** The card numbers a view shows, outside the cards played face up. */
function hiddenIn(v: LastView): number[] {
  return [
    ...v.hand,
    ...(v.drawn === null ? [] : [v.drawn]),
    ...v.log.flatMap((e) => (e.t === "draw" && e.card !== null ? [e.card] : [])),
  ];
}

/**
 * Throws if a message for `seat` holds anything it must not: the seed, the
 * moves list, or a card of the other hand that was never played.
 */
function noLeak(msg: unknown, m: LastMatch, seat: Seat) {
  const json = JSON.stringify(msg);
  expect(json).not.toContain('"seed"');
  const v = viewIn(msg as LastServerMessage);
  expect(v.seat).toBe(seat);
  expect(Array.isArray(v.moves)).toBe(false);
  const b = boardOf(m);
  if (!b.over) expect(v.foe).toBeNull();
  const theirs = new Set(b.hands[other(seat)]);
  for (const id of hiddenIn(v)) expect(theirs.has(id), `card ${id} of the other hand`).toBe(false);
  for (const e of v.log) if (e.t === "draw" && e.by !== seat) expect(e.card).toBeNull();
}

describe("Last Card host", () => {
  it("starts with the player who opened the game, and the score carried over", () => {
    const m = startLast(1, { wins: [2, 3] }, 42);
    expect(m).toEqual({ seed: 42, first: 1, moves: [], wins: [2, 3], rematch: [false, false] });
    expect(startLast(0, { wins: [-1, "x"] }).wins).toEqual([0, 0]);
    expect(startLast(0, null).wins).toEqual([0, 0]);
    expect(carryLast(m)).toEqual({ wins: [2, 3] });
    const b = boardOf(m);
    expect(b.first).toBe(1);
  });

  it("gives each phone its own hand and the size of the other", () => {
    const m = startLast(0, null, 7);
    const b = boardOf(m);
    for (const seat of [0, 1] as const) {
      const v = viewIn(lastCardHost.sync(m, seat));
      expect(v.hand).toEqual(b.hands[seat]);
      expect(v.others).toBe(b.hands[other(seat)].length);
      expect(v.pile).toBe(b.pile.length);
      noLeak(lastCardHost.sync(m, seat), m, seat);
    }
  });

  it("answers a move with a view for each phone, never one for both", () => {
    const m = startLast(0, null, 7);
    const [seat, msg] = next(m);
    const reply = lastCardHost.receive(m, seat, msg);
    expect(reply.all).toBeUndefined();
    expect(viewIn(reply.me)).toEqual(viewOf(reply.state!, seat));
    expect(viewIn(reply.others)).toEqual(viewOf(reply.state!, other(seat)));
  });

  it("leaks no hidden card and no seed in any message of whole games", () => {
    for (let seed = 1; seed <= 12; seed++) {
      let m = startLast((seed % 2) as Seat, null, seed * 1000 + 17);
      const { replies, m: end } = playOn(m, 2_000);
      expect(boardOf(end).over).toBe(true);
      for (const [seat, reply] of replies) {
        m = reply.state!;
        noLeak(reply.me, m, seat);
        noLeak(reply.others, m, other(seat));
      }
    }
  });

  it("refuses a stale, an out-of-turn or an illegal move, and sends that phone the truth", () => {
    const m = startLast(0, null, 7);
    const b = boardOf(m);
    const seat = b.turn;
    const truth = { me: { t: "state", view: viewOf(m, seat) } };
    // Stale: aimed from another game.
    expect(lastCardHost.receive(m, seat, { t: "draw", at: 3 })).toEqual(truth);
    // Out of turn.
    expect(lastCardHost.receive(m, other(seat), { t: "draw", at: 0 })).toEqual({
      me: { t: "state", view: viewOf(m, other(seat)) },
    });
    // A card not held.
    const notHeld = DECK.findIndex((_, id) => !b.hands[seat].includes(id) && id !== b.discard[0]);
    expect(lastCardHost.receive(m, seat, { t: "play", card: notHeld, call: false, at: 0 })).toEqual(truth);
    // A keep with nothing drawn, and a catch with nobody to catch.
    expect(lastCardHost.receive(m, seat, { t: "keep", at: 0 })).toEqual(truth);
    expect(lastCardHost.receive(m, seat, { t: "catch", at: 0 })).toEqual(truth);
    noLeak(truth.me, m, seat);
  });

  it("counts a move once: the same message sent twice is refused the second time", () => {
    const m = startLast(0, null, 7);
    const [seat, msg] = next(m);
    const once = lastCardHost.receive(m, seat, msg).state!;
    expect(once.moves).toHaveLength(1);
    const twice = lastCardHost.receive(once, seat, msg);
    expect(twice.state).toBeUndefined();
  });

  it("takes a catch out of turn", () => {
    // Find a game where a player goes down to one card without a call.
    for (let seed = 1; seed <= 200; seed++) {
      let m = startLast(0, null, seed);
      for (let i = 0; i < 300 && !boardOf(m).over; i++) {
        const b = boardOf(m);
        if (b.open !== null) {
          const catcher = other(b.open);
          const reply = lastCardHost.receive(m, catcher, { t: "catch", at: m.moves.length });
          expect(reply.state).toBeDefined();
          expect(boardOf(reply.state!).hands[b.open]).toHaveLength(3);
          noLeak(reply.me, reply.state!, catcher);
          noLeak(reply.others, reply.state!, b.open);
          return;
        }
        const seat = b.turn;
        const [id] = playable(b, seat);
        // Never call: the first play down to one card leaves the player open.
        const action: Action =
          id === undefined
            ? { t: b.drawn !== null ? "keep" : "draw" }
            : { t: "play", card: id, ...(DECK[id]!.color ? {} : { color: "sun" as const }) };
        m = move(m, seat, action, m.moves.length)!;
      }
    }
    throw new Error("no open player found");
  });

  it("adds a win to the score of the winner", () => {
    const end = won();
    const b = boardOf(end);
    expect(b.over).toBe(true);
    const w: [number, number] = [0, 0];
    w[b.winner!] = 1;
    expect(end.wins).toEqual(w);
    expect(viewOf(end, 0).foe).toEqual(b.hands[1]);
  });
});

describe("Last Card rematch", () => {
  it("waits for both players, then deals again with the other player first and the score kept", () => {
    const done = won();
    expect(rematch(startLast(0, null, 3), 0)).toBeNull();
    const one = lastCardHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.all).toBeUndefined();
    expect(viewIn(one.me)).toEqual(viewOf(one.state!, 1));
    expect(lastCardHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = lastCardHost.receive(one.state!, 0, { t: "rematch" }).state!;
    expect(both.first).toBe(1);
    expect(both.moves).toEqual([]);
    expect(both.wins).toEqual(done.wins);
    expect(both.rematch).toEqual([false, false]);
    expect(both.seed).not.toBe(done.seed);
  });
});

describe("Last Card messages", () => {
  it("parses good messages and drops bad ones", () => {
    expect(parseLastMessage({ t: "play", card: 5, call: true, at: 2 })).toEqual({
      t: "play",
      card: 5,
      call: true,
      at: 2,
    });
    expect(parseLastMessage({ t: "play", card: 104, color: "wave", call: false, at: 0, x: 1 })).toEqual({
      t: "play",
      card: 104,
      color: "wave",
      call: false,
      at: 0,
    });
    expect(parseLastMessage({ t: "draw", at: 0 })).toEqual({ t: "draw", at: 0 });
    expect(parseLastMessage({ t: "keep", at: 9 })).toEqual({ t: "keep", at: 9 });
    expect(parseLastMessage({ t: "catch", at: 1 })).toEqual({ t: "catch", at: 1 });
    expect(parseLastMessage({ t: "rematch" })).toEqual({ t: "rematch" });
    for (const bad of [
      null,
      "draw",
      { t: "draw" },
      { t: "draw", at: -1 },
      { t: "draw", at: 1.5 },
      { t: "play", card: 108, call: true, at: 0 },
      { t: "play", card: 3, at: 0 },
      { t: "play", card: 3, call: true, color: "red", at: 0 },
      { t: "peek", at: 0 },
    ])
      expect(parseLastMessage(bad)).toBeNull();
  });
});

describe("Last Card in a party", () => {
  const HOSTS = { "last-card": lastCardHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it, and keeps each hand hidden on a sync and a refusal", () => {
    const p = party();
    pick(p, 1, "last-card", HOSTS, LIVE);
    const m = p.state as LastMatch;
    expect(m.first).toBe(1);
    for (const seat of [0, 1] as const) noLeak(sync(p, seat, "last-card", HOSTS), m, seat);
    const refused = receive(p, 0, "last-card", { t: "draw", at: 0 }, HOSTS)!;
    expect(refused.state).toBeUndefined();
    noLeak(refused.me, m, 0);
    const turn = boardOf(m).turn;
    const reply = receive(p, turn, "last-card", { t: "draw", at: 0 }, HOSTS)!;
    noLeak(reply.me, p.state as LastMatch, turn);
    noLeak(reply.others, p.state as LastMatch, other(turn));
  });

  it("keeps the score when the party comes back to Last Card", () => {
    const p = party();
    pick(p, 0, "last-card", HOSTS, LIVE);
    p.state = { ...(p.state as LastMatch), wins: [4, 1] };
    pick(p, 0, null, HOSTS, LIVE);
    pick(p, 1, "last-card", HOSTS, LIVE);
    expect((p.state as LastMatch).wins).toEqual([4, 1]);
  });
});
