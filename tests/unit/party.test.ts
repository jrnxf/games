import { describe, expect, it } from "vitest";
import { golfHost } from "../../src/games/mini-golf/core/host.ts";
import type { GolfState } from "../../src/games/mini-golf/core/protocol.ts";
import type { GameHost } from "../../src/party/host.ts";
import {
  claimSeat,
  createParty,
  leave,
  partyView,
  pick,
  receive,
  sync,
  type PartyRecord,
} from "../../src/party/party.ts";

const HOST = "a".repeat(32);
const GUEST = "b".repeat(32);
const STRANGER = "c".repeat(32);
const LIVE: [boolean, boolean] = [true, true];

/** A tiny turn-taking game: each message adds to a counter, on turn only. */
const counter: GameHost<{ n: number }, { t: "add" }, { n: number }> = {
  start: () => ({ n: 0 }),
  parse: (raw) => ((raw as { t?: unknown }).t === "add" ? { t: "add" } : null),
  receive: (state, seat) =>
    state.n % 2 === seat ? { state: { n: state.n + 1 }, all: { n: state.n + 1 } } : {},
  sync: (state) => ({ n: state.n }),
};
const HOSTS = { "mini-golf": golfHost, counter } as const;

function seated(): PartyRecord {
  const party = createParty("BCDFG");
  claimSeat(party, HOST, "Ana", LIVE);
  claimSeat(party, GUEST, "Kai", LIVE);
  return party;
}

describe("seats", () => {
  it("seats the maker first, then the friend, then refuses a third", () => {
    const party = createParty("BCDFG");
    expect(claimSeat(party, HOST, "Ana", LIVE)).toBe(0);
    expect(claimSeat(party, GUEST, "Kai", LIVE)).toBe(1);
    expect(claimSeat(party, STRANGER, "Zed", LIVE)).toBe("full");
  });

  it("gives a player their own seat back by token, under their new name", () => {
    const party = seated();
    expect(claimSeat(party, GUEST, "Kai B", LIVE)).toBe(1);
    expect(party.seats[1]?.name).toBe("Kai B");
    expect(claimSeat(party, HOST, "Ana", LIVE)).toBe(0);
  });

  it("hides tokens and game state, and reports who is connected", () => {
    const party = seated();
    pick(party, 0, "mini-golf", HOSTS, LIVE);
    const view = partyView(party, [true, false]);
    expect(view.players).toEqual([
      { name: "Ana", connected: true },
      { name: "Kai", connected: false },
    ]);
    expect(view.game).toBe("mini-golf");
    expect(JSON.stringify(view)).not.toContain(HOST);
    expect(view).not.toHaveProperty("state");
  });

  it("gives a dropped guest's seat to a new phone while waiting", () => {
    const party = seated();
    expect(claimSeat(party, STRANGER, "Zed", [true, false])).toBe(1);
    expect(party.seats[1]?.name).toBe("Zed");
    expect(claimSeat(party, GUEST, "Kai", LIVE)).toBe("full");
  });

  it("names a player with no name after the seat they take, also when they take it back", () => {
    const party = createParty("BCDFG");
    expect(claimSeat(party, HOST, "", LIVE)).toBe(0);
    expect(party.seats[0]?.name).toBe("Player 1");
    expect(claimSeat(party, GUEST, "", LIVE)).toBe(1);
    expect(party.seats[1]?.name).toBe("Player 2");
    // The maker comes back with an empty name while the guest is seated.
    expect(claimSeat(party, HOST, "", LIVE)).toBe(0);
    expect(party.seats[0]?.name).toBe("Player 1");
    expect(claimSeat(party, HOST, "Ana", LIVE)).toBe(0);
    expect(party.seats[0]?.name).toBe("Ana");
  });

  it("never gives away the maker's seat", () => {
    const party = seated();
    expect(claimSeat(party, STRANGER, "Zed", [false, true])).toBe("full");
    expect(party.seats[0]?.name).toBe("Ana");
  });

  it("keeps a dropped guest's seat once they have played together", () => {
    const party = seated();
    pick(party, 0, "mini-golf", HOSTS, LIVE);
    pick(party, 1, null, HOSTS, LIVE);
    expect(party.status).toBe("together");
    expect(claimSeat(party, STRANGER, "Zed", [true, false])).toBe("full");
    expect(claimSeat(party, GUEST, "Kai", [true, false])).toBe(1);
  });
});

describe("leaving", () => {
  it("frees the seat when a waiting guest leaves", () => {
    const party = seated();
    leave(party, 1);
    expect(party.status).toBe("waiting");
    expect(party.seats[1]).toBeNull();
    expect(claimSeat(party, STRANGER, "Zed", LIVE)).toBe(1);
  });

  it("ends the party when the maker leaves", () => {
    const party = createParty("BCDFG");
    claimSeat(party, HOST, "Ana", LIVE);
    leave(party, 0);
    expect(party.status).toBe("ended");
    expect(party.leftBy).toBe(0);
    expect(claimSeat(party, HOST, "Ana", LIVE)).toBe("gone");
  });

  it("ends the party and its game when either player leaves after playing", () => {
    const party = seated();
    pick(party, 0, "mini-golf", HOSTS, LIVE);
    leave(party, 1);
    expect(party).toMatchObject({ status: "ended", leftBy: 1, game: null, state: null });
    // The maker, offline when it happened, gets back in only to hear who left.
    expect(claimSeat(party, HOST, "Ana", LIVE)).toBe(0);
    expect(claimSeat(party, GUEST, "Kai", LIVE)).toBe("gone");
    expect(claimSeat(party, STRANGER, "Zed", LIVE)).toBe("gone");
    expect(pick(party, 0, "mini-golf", HOSTS, LIVE)).toBe(false);
    expect(receive(party, 0, "mini-golf", { t: "ready" }, HOSTS)).toBeNull();
  });
});

describe("picking a game", () => {
  it("needs both players and a game the server knows", () => {
    const party = createParty("BCDFG");
    claimSeat(party, HOST, "Ana", LIVE);
    expect(pick(party, 0, "mini-golf", HOSTS, LIVE)).toBe(false);
    claimSeat(party, GUEST, "Kai", LIVE);
    expect(pick(party, 1, "chess", HOSTS, LIVE)).toBe(false);
    expect(pick(party, 1, "mini-golf", HOSTS, LIVE)).toBe(true);
    expect(party).toMatchObject({ status: "together", game: "mini-golf", pickedBy: 1 });
    expect((party.state as GolfState).match.holeIdx).toBe(0);
  });

  it("won't start the first game while the guest's seat is up for grabs", () => {
    // The guest joined and closed the tab, or the maker opened the invite in a second browser.
    const party = seated();
    const away: [boolean, boolean] = [true, false];
    expect(pick(party, 0, "mini-golf", HOSTS, away)).toBe(false);
    expect(party).toMatchObject({ status: "waiting", game: null });
    // So the real friend can still take the seat.
    expect(claimSeat(party, STRANGER, "Zed", away)).toBe(1);
    expect(pick(party, 0, "mini-golf", HOSTS, LIVE)).toBe(true);
    // Once together, the seat is theirs: a game may start while they are away.
    pick(party, 0, null, HOSTS, LIVE);
    expect(pick(party, 0, "counter", HOSTS, away)).toBe(true);
  });

  it("goes back to the menu, and a new pick starts the game fresh", () => {
    const party = seated();
    pick(party, 0, "counter", HOSTS, LIVE);
    receive(party, 0, "counter", { t: "add" }, HOSTS);
    expect(party.state).toEqual({ n: 1 });
    expect(pick(party, 0, "counter", HOSTS, LIVE)).toBe(false);
    expect(pick(party, 1, null, HOSTS, LIVE)).toBe(true);
    expect(party).toMatchObject({ game: null, state: null, pickedBy: 1 });
    expect(pick(party, 1, null, HOSTS, LIVE)).toBe(false);
    pick(party, 1, "counter", HOSTS, LIVE);
    expect(party.state).toEqual({ n: 0 });
  });
});

describe("game messages", () => {
  it("hands messages to the open game's host and keeps its state", () => {
    const party = seated();
    pick(party, 0, "counter", HOSTS, LIVE);
    expect(receive(party, 0, "counter", { t: "add" }, HOSTS)).toEqual({ state: { n: 1 }, all: { n: 1 } });
    // Off turn: the host answers with nothing and the state stays.
    expect(receive(party, 0, "counter", { t: "add" }, HOSTS)).toEqual({});
    expect(party.state).toEqual({ n: 1 });
    expect(sync(party, 1, "counter", HOSTS)).toEqual({ n: 1 });
  });

  it("drops messages for a game that isn't open, or that its host can't parse", () => {
    const party = seated();
    expect(receive(party, 0, "counter", { t: "add" }, HOSTS)).toBeNull();
    pick(party, 0, "counter", HOSTS, LIVE);
    expect(receive(party, 0, "mini-golf", { t: "ready" }, HOSTS)).toBeNull();
    expect(receive(party, 0, "counter", { t: "nope" }, HOSTS)).toBeNull();
    expect(sync(party, 0, "mini-golf", HOSTS)).toBeNull();
  });
});
