import { describe, expect, it } from "vitest";
import { at, cellsOf, type Fleet } from "../../src/games/sea-battle/core/board.ts";
import {
  boardOf,
  fire,
  place,
  rematch,
  seaHost,
  startSea,
  viewOf,
} from "../../src/games/sea-battle/core/host.ts";
import {
  parseSeaMessage,
  type SeaMatch,
  type SeaServerMessage,
  type SeaView,
} from "../../src/games/sea-battle/core/protocol.ts";
import type { HostReply } from "../../src/party/host.ts";
import { claimSeat, createParty, pick, receive, sync } from "../../src/party/party.ts";
import { COLUMNS, ROWS, decks, rout } from "./sea-battle-games.ts";

type Reply = HostReply<SeaMatch, SeaServerMessage>;
type Seat = 0 | 1;

const other = (seat: Seat) => (1 - seat) as Seat;

/** The view inside a state message. */
const viewIn = (msg: SeaServerMessage | undefined): SeaView => {
  if (msg?.t !== "state") throw new Error("not a state message");
  return msg.view;
};

/** Both fleets placed through the host: `first` holds ROWS, the other player COLUMNS. */
function placedMatch(first: Seat = 0): SeaMatch {
  let m = startSea(first);
  m = seaHost.receive(m, first, { t: "place", fleet: ROWS }).state!;
  return seaHost.receive(m, other(first), { t: "place", fleet: COLUMNS }).state!;
}

/** Fires `cells` through the host, each by the seat on turn, and keeps every reply with the seat that sent it. */
function shoot(m: SeaMatch, cells: number[]): { m: SeaMatch; replies: [Seat, Reply][] } {
  const replies: [Seat, Reply][] = [];
  for (const cell of cells) {
    const seat = boardOf(m)!.turn;
    const reply = seaHost.receive(m, seat, { t: "fire", cell, at: m.shots.length });
    replies.push([seat, reply]);
    m = reply.state!;
  }
  return { m, replies };
}

/** A whole game: `first` sinks COLUMNS in 17 shots while the other player misses. */
const won = (first: Seat = 0) => shoot(placedMatch(first), rout(COLUMNS)).m;

/** True when `json` holds a ship of `fleet` that `sunk` does not list. */
const shows = (json: string, fleet: Fleet, sunk: Fleet = []) =>
  fleet.some((ship) => !sunk.includes(ship) && json.includes(JSON.stringify(ship)));

describe("placement", () => {
  it("starts with the player who opened the game and no fleets", () => {
    const m = startSea(1);
    expect(m).toEqual({ first: 1, fleets: [null, null], shots: [], wins: [0, 0], rematch: [false, false] });
    expect(boardOf(m)).toBeNull();
    for (const seat of [0, 1] as const) {
      const view = viewOf(m, seat);
      expect(view).toMatchObject({
        first: 1,
        placed: [false, false],
        fleet: null,
        foe: null,
        shots: 0,
        turn: 1,
      });
      expect(view).toMatchObject({ last: null, over: false, winner: null });
    }
  });

  it("takes one fleet from each player and tells the other phone only that it is placed", () => {
    const m = startSea(0);
    const reply = seaHost.receive(m, 1, { t: "place", fleet: COLUMNS });
    expect(reply.state).toEqual({ ...m, fleets: [null, COLUMNS] });
    expect(reply.all).toBeUndefined();
    expect(viewIn(reply.me)).toMatchObject({ placed: [false, true], fleet: COLUMNS, foe: null });
    expect(viewIn(reply.others)).toMatchObject({ placed: [false, true], fleet: null, foe: null });
    expect(shows(JSON.stringify(reply.others), COLUMNS)).toBe(false);
  });

  it("refuses a second fleet from the same player, and resyncs only that phone", () => {
    const m = place(startSea(0), 0, ROWS)!;
    expect(place(m, 0, COLUMNS)).toBeNull();
    expect(seaHost.receive(m, 0, { t: "place", fleet: COLUMNS })).toEqual({
      me: { t: "state", view: viewOf(m, 0) },
    });
    expect(viewOf(m, 0).fleet).toEqual(ROWS);
  });

  it("refuses a shot and drops an aim until both fleets are placed", () => {
    const m = place(startSea(0), 0, ROWS)!;
    expect(fire(m, 0, 0, 0)).toBeNull();
    expect(seaHost.receive(m, 0, { t: "fire", cell: 0, at: 0 })).toEqual({
      me: { t: "state", view: viewOf(m, 0) },
    });
    expect(seaHost.receive(m, 0, { t: "aim", cell: 0 })).toEqual({});
    expect(rematch(m, 0)).toBeNull();
  });

  it("parses only a legal fleet, and keeps nothing else a phone sends with it", () => {
    expect(parseSeaMessage({ t: "place", fleet: ROWS })).toEqual({ t: "place", fleet: ROWS });
    const padded = ROWS.map((ship) => ({ ...ship, extra: "x" }));
    expect(parseSeaMessage({ t: "place", fleet: padded, more: 1 })).toEqual({ t: "place", fleet: ROWS });
    // Two ships on the same cells, a ship off the grid, a wrong length, a missing ship, and junk.
    const overlap = ROWS.map((ship, i) => (i === 1 ? { ...ship, cell: at(0, 0) } : ship));
    const off = ROWS.map((ship, i) => (i === 0 ? { ...ship, cell: at(0, 6) } : ship));
    const long = ROWS.map((ship, i) => (i === 4 ? { ...ship, len: 3 } : ship));
    for (const fleet of [overlap, off, long, ROWS.slice(1), [...ROWS, ROWS[0]], [], null, "x", [null], [7]]) {
      expect(parseSeaMessage({ t: "place", fleet })).toBeNull();
    }
    expect(parseSeaMessage({ t: "place", fleet: ROWS.map((ship) => ({ ...ship, down: 0 })) })).toBeNull();
    expect(parseSeaMessage({ t: "place", fleet: ROWS.map((ship) => ({ ...ship, cell: 1.5 })) })).toBeNull();
    expect(parseSeaMessage({ t: "place" })).toBeNull();
  });

  it("fits the largest fleet message in the party's message limit", () => {
    const wide: Fleet = COLUMNS.map((ship, i) => ({ ...ship, cell: at(5, 9 - i) }));
    expect(parseSeaMessage({ t: "place", fleet: wide })).not.toBeNull();
    const raw = JSON.stringify({ t: "game", game: "sea-battle", m: { t: "place", fleet: wide } });
    expect(raw.length).toBeLessThan(512);
  });
});

describe("shots", () => {
  it("fires a shot and sends each phone its own view", () => {
    const m = placedMatch();
    const reply = seaHost.receive(m, 0, { t: "fire", cell: at(0, 9), at: 0 });
    expect(reply.state).toEqual({ ...m, shots: [at(0, 9)] });
    expect(reply.all).toBeUndefined();
    const mine = viewIn(reply.me);
    const theirs = viewIn(reply.others);
    expect(mine).toEqual(viewOf(reply.state!, 0));
    expect(theirs).toEqual(viewOf(reply.state!, 1));
    expect(mine.last).toEqual({ cell: at(0, 9), hit: true, sunk: null });
    expect(mine.seen[0].marks[at(0, 9)]).toBe("hit");
    expect(mine).toMatchObject({ shots: 1, turn: 1, fleet: ROWS, foe: null });
    expect(theirs).toMatchObject({ shots: 1, turn: 1, fleet: COLUMNS, foe: null });
    expect(theirs.seen).toEqual(mine.seen);
  });

  it("gives no extra shot for a hit", () => {
    const { m } = shoot(placedMatch(), [at(0, 9)]);
    expect(boardOf(m)!.turn).toBe(1);
    expect(fire(m, 0, at(1, 9), 1)).toBeNull();
  });

  it("refuses a shot out of turn or from a stale game, and resyncs only that phone", () => {
    const { m } = shoot(placedMatch(), [at(9, 0)]);
    expect(fire(m, 0, at(9, 1), 1)).toBeNull();
    expect(seaHost.receive(m, 0, { t: "fire", cell: at(9, 1), at: 1 })).toEqual({
      me: { t: "state", view: viewOf(m, 0) },
    });
    // The same shot sent twice: the second is stale.
    expect(seaHost.receive(m, 1, { t: "fire", cell: at(9, 1), at: 0 })).toEqual({
      me: { t: "state", view: viewOf(m, 1) },
    });
    expect(fire(m, 1, at(9, 1), 1)?.shots).toEqual([at(9, 0), at(9, 1)]);
  });

  it("refuses a cell the player fired at before, but not one the other player fired at", () => {
    const { m } = shoot(placedMatch(), [at(9, 0), at(9, 0)]);
    expect(seaHost.receive(m, 0, { t: "fire", cell: at(9, 0), at: 2 })).toEqual({
      me: { t: "state", view: viewOf(m, 0) },
    });
    expect(fire(m, 0, at(9, 1), 2)).not.toBeNull();
  });

  it("names a ship when its last cell is hit", () => {
    const skiff = COLUMNS[4]!;
    const [bow, stern] = cellsOf(skiff) as [number, number];
    const { m, replies } = shoot(placedMatch(), [bow, at(9, 0), stern]);
    const view = viewIn(replies[2]![1].others);
    expect(view.last).toEqual({ cell: stern, hit: true, sunk: skiff });
    expect(view.seen[0].sunk).toEqual([skiff]);
    expect(viewOf(m, 0).over).toBe(false);
  });

  it("counts a win, shows both fleets, then refuses any shot after it", () => {
    const m = won();
    expect(boardOf(m)!.winner).toBe(0);
    expect(m.wins).toEqual([1, 0]);
    expect(viewOf(m, 0)).toMatchObject({ over: true, winner: 0, turn: 0, fleet: ROWS, foe: COLUMNS });
    expect(viewOf(m, 1)).toMatchObject({ over: true, winner: 0, turn: 0, fleet: COLUMNS, foe: ROWS });
    // The same game with the other starter is the same game with the seats swapped.
    expect(won(1).wins).toEqual([0, 1]);
    for (const seat of [0, 1] as const) {
      expect(seaHost.receive(m, seat, { t: "fire", cell: at(5, 5), at: m.shots.length })).toEqual({
        me: { t: "state", view: viewOf(m, seat) },
      });
      expect(seaHost.receive(m, seat, { t: "aim", cell: at(5, 5) })).toEqual({});
    }
  });

  it("relays live aim to the other phone only, on turn", () => {
    const m = placedMatch();
    expect(seaHost.receive(m, 0, { t: "aim", cell: 42 })).toEqual({
      others: { t: "aim", seat: 0, cell: 42 },
    });
    expect(seaHost.receive(m, 1, { t: "aim", cell: 42 })).toEqual({});
  });

  it("parses only whole cells on the grid", () => {
    expect(parseSeaMessage({ t: "fire", cell: 99, at: 0 })).toEqual({ t: "fire", cell: 99, at: 0 });
    expect(parseSeaMessage({ t: "fire", cell: 100, at: 0 })).toBeNull();
    expect(parseSeaMessage({ t: "fire", cell: -1, at: 0 })).toBeNull();
    expect(parseSeaMessage({ t: "fire", cell: 1.5, at: 0 })).toBeNull();
    expect(parseSeaMessage({ t: "fire", cell: 1 })).toBeNull();
    expect(parseSeaMessage({ t: "aim", cell: 0 })).toEqual({ t: "aim", cell: 0 });
    expect(parseSeaMessage({ t: "aim", cell: 100 })).toBeNull();
    expect(parseSeaMessage({ t: "rematch", extra: 1 })).toEqual({ t: "rematch" });
    expect(parseSeaMessage({ t: "drop" })).toBeNull();
    expect(parseSeaMessage(null)).toBeNull();
  });
});

describe("hidden fleets", () => {
  it("never puts a ship that is afloat in a message to the other phone, through a whole game", () => {
    const fleets: [Fleet, Fleet] = [ROWS, COLUMNS];
    let m = startSea(0);
    /** Checks every message of a reply from `seat`, then the sync of each phone. */
    const check = (seat: Seat, reply: Reply) => {
      if (reply.state) m = reply.state;
      const board = boardOf(m);
      // A state never goes to both phones as one message: each view is made for one seat.
      expect(reply.all).toBeUndefined();
      const sent: [Seat, SeaServerMessage | undefined][] = [
        [seat, reply.me],
        [other(seat), reply.others],
        [0, seaHost.sync(m, 0)],
        [1, seaHost.sync(m, 1)],
      ];
      for (const [to, msg] of sent) {
        if (!msg) continue;
        const sunk = board ? board.seen[to].sunk : [];
        if (!board?.over) expect(shows(JSON.stringify(msg), fleets[other(to)], sunk)).toBe(false);
        if (msg.t === "state") expect(msg.view.foe).toEqual(board?.over ? fleets[other(to)] : null);
      }
    };
    check(0, seaHost.receive(m, 0, { t: "place", fleet: ROWS }));
    check(1, seaHost.receive(m, 1, { t: "place", fleet: COLUMNS }));
    // Seat 1 hits one cell of each of seat 0's ships and never sinks one, as seat 0 sinks ship after ship.
    const probes = ROWS.map((ship) => ship.cell);
    const shots = rout(COLUMNS).map((cell, i) => (i % 2 === 1 && i < 10 ? probes[(i - 1) / 2]! : cell));
    let sunk = 0;
    for (const cell of shots) {
      const seat = boardOf(m)!.turn;
      check(seat, seaHost.receive(m, seat, { t: "aim", cell }));
      check(seat, seaHost.receive(m, seat, { t: "fire", cell, at: m.shots.length }));
      // A refused shot resyncs the phone: that answer must not leak either.
      check(seat, seaHost.receive(m, seat, { t: "fire", cell, at: 0 }));
      sunk = Math.max(sunk, boardOf(m)!.seen[0].sunk.length);
    }
    expect(boardOf(m)!.over).toBe(true);
    expect(sunk).toBe(5);
    expect(boardOf(m)!.seen[1].sunk).toEqual([]);
    expect(decks(ROWS).filter((cell) => boardOf(m)!.seen[1].marks[cell] === "hit")).toHaveLength(5);
  });

  it("sends the same view whatever the other fleet is, while the shots have the same results", () => {
    // Two games that differ only in seat 1's fleet. Every shot at seat 1's water misses in both.
    const moved: Fleet = COLUMNS.map((ship) => ({ ...ship, cell: ship.cell + at(5, 0) }));
    const open = [at(9, 0), at(9, 2), at(9, 4), at(9, 6), at(9, 8)];
    const games = [COLUMNS, moved].map((fleet) => {
      let m = startSea(0);
      m = place(m, 1, fleet)!;
      const waiting = viewOf(m, 0);
      m = place(m, 0, ROWS)!;
      const { m: end, replies } = shoot(
        m,
        open.flatMap((cell) => [cell, cell]),
      );
      const told = replies.map(([seat, reply]) => (seat === 0 ? reply.me : reply.others));
      return { waiting, told, synced: seaHost.sync(end, 0) };
    });
    expect(games[0]!.told).toHaveLength(10);
    expect(games[0]).toEqual(games[1]);
  });

  it("keeps the fleets hidden in a party, on a sync and on a refused shot", () => {
    const HOSTS = { "sea-battle": seaHost };
    const LIVE: [boolean, boolean] = [true, true];
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    pick(p, 0, "sea-battle", HOSTS, LIVE);
    receive(p, 0, "sea-battle", { t: "place", fleet: ROWS }, HOSTS);
    const reply = receive(p, 1, "sea-battle", { t: "place", fleet: COLUMNS }, HOSTS)!;
    expect(shows(JSON.stringify(reply.others), COLUMNS)).toBe(false);
    expect(shows(JSON.stringify(reply.me), ROWS)).toBe(false);
    expect(shows(JSON.stringify(sync(p, 0, "sea-battle", HOSTS)), COLUMNS)).toBe(false);
    expect(shows(JSON.stringify(sync(p, 1, "sea-battle", HOSTS)), ROWS)).toBe(false);
    const refused = receive(p, 1, "sea-battle", { t: "fire", cell: 0, at: 0 }, HOSTS)!;
    expect(refused.state).toBeUndefined();
    expect(shows(JSON.stringify(refused), ROWS)).toBe(false);
    // Each phone still gets its own fleet back.
    expect(viewIn(sync(p, 0, "sea-battle", HOSTS) as SeaServerMessage).fleet).toEqual(ROWS);
    expect(viewIn(sync(p, 1, "sea-battle", HOSTS) as SeaServerMessage).fleet).toEqual(COLUMNS);
  });
});

describe("rematch", () => {
  it("waits for both players, then swaps who goes first, keeps the score and asks for new fleets", () => {
    const done = won();
    expect(rematch(placedMatch(), 0)).toBeNull();
    const one = seaHost.receive(done, 1, { t: "rematch" });
    expect(one.state?.rematch).toEqual([false, true]);
    expect(one.state?.shots).toEqual(done.shots);
    expect(one.all).toBeUndefined();
    expect(viewIn(one.me)).toEqual(viewOf(one.state!, 1));
    expect(viewIn(one.others)).toEqual(viewOf(one.state!, 0));
    expect(seaHost.receive(one.state!, 1, { t: "rematch" })).toEqual({});
    const both = seaHost.receive(one.state!, 0, { t: "rematch" });
    expect(both.state).toEqual({
      first: 1,
      fleets: [null, null],
      shots: [],
      wins: [1, 0],
      rematch: [false, false],
    });
    expect(viewIn(both.me)).toMatchObject({
      first: 1,
      placed: [false, false],
      fleet: null,
      foe: null,
      shots: 0,
    });
    expect(viewIn(both.others)).toEqual(viewIn(both.me));
  });
});

describe("in a party", () => {
  const HOSTS = { "sea-battle": seaHost };
  const LIVE: [boolean, boolean] = [true, true];

  function party() {
    const p = createParty("BCDFG");
    claimSeat(p, "a".repeat(32), "Ana", LIVE);
    claimSeat(p, "b".repeat(32), "Kai", LIVE);
    return p;
  }

  it("starts with the player who picked it", () => {
    const p = party();
    pick(p, 1, "sea-battle", HOSTS, LIVE);
    expect(sync(p, 0, "sea-battle", HOSTS)).toEqual({ t: "state", view: viewOf(startSea(1), 0) });
  });

  it("syncs a phone that reconnects onto the same game, with its own fleet", () => {
    const p = party();
    pick(p, 0, "sea-battle", HOSTS, LIVE);
    receive(p, 0, "sea-battle", { t: "place", fleet: ROWS }, HOSTS);
    // A reload while the other player still places: this phone's fleet is kept.
    expect(viewIn(sync(p, 0, "sea-battle", HOSTS) as SeaServerMessage)).toMatchObject({
      placed: [true, false],
      fleet: ROWS,
    });
    receive(p, 1, "sea-battle", { t: "place", fleet: COLUMNS }, HOSTS);
    receive(p, 0, "sea-battle", { t: "fire", cell: at(0, 9), at: 0 }, HOSTS);
    const again = viewIn(sync(p, 1, "sea-battle", HOSTS) as SeaServerMessage);
    expect(again).toMatchObject({ shots: 1, turn: 1, fleet: COLUMNS, foe: null });
    expect(again.seen[0].marks[at(0, 9)]).toBe("hit");
  });

  it("keeps the running score across a trip to the menu", () => {
    const p = party();
    pick(p, 0, "sea-battle", HOSTS, LIVE);
    receive(p, 0, "sea-battle", { t: "place", fleet: ROWS }, HOSTS);
    receive(p, 1, "sea-battle", { t: "place", fleet: COLUMNS }, HOSTS);
    for (const cell of rout(COLUMNS)) {
      const m = p.state as SeaMatch;
      receive(p, boardOf(m)!.turn, "sea-battle", { t: "fire", cell, at: m.shots.length }, HOSTS);
    }
    expect((p.state as SeaMatch).wins).toEqual([1, 0]);
    pick(p, 1, null, HOSTS, LIVE);
    pick(p, 1, "sea-battle", HOSTS, LIVE);
    expect(p.state).toEqual({
      first: 1,
      fleets: [null, null],
      shots: [],
      wins: [1, 0],
      rematch: [false, false],
    });
    // Only the score is kept for next time, not the fleets.
    expect(p.last).toEqual({ "sea-battle": { wins: [1, 0] } });
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
      expect(startSea(0, junk).wins).toEqual([0, 0]);
    }
    expect(startSea(0, { wins: [2, 3] }).wins).toEqual([2, 3]);
  });
});
