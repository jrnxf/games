// The phone's party client against a fake WebSocket: what it sends, when it
// gives up and when it keeps trying.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_GONE,
  type ClientMessage,
  type PartyView,
  type ServerMessage,
} from "../../src/party/protocol.ts";
import { PartyClient } from "../../src/shell/party.ts";

class FakeSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
  }

  // ---------- the server's side ----------

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  drop(code: number) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const latest = () => FakeSocket.all.at(-1)!;

function view(game: string | null, guestConnected = true): PartyView {
  return {
    code: "BCDFG",
    status: game ? "together" : "waiting",
    players: [
      { name: "Ana", connected: true },
      { name: "Kai", connected: guestConnected },
    ],
    game,
    pickedBy: game ? 0 : null,
    leftBy: null,
  };
}

/** A client seated in seat 0 of a party with `game` open. */
function seated(game: string | null = "mini-golf") {
  const onChange = vi.fn();
  const client = new PartyClient("BCDFG", "Ana", onChange);
  client.start();
  latest().open();
  latest().receive({ t: "welcome", seat: 0, party: view(game) });
  return { client, onChange, ws: latest() };
}

/** Drops the socket, then lets the retry open a new one. */
async function reconnect() {
  latest().drop(1006);
  await vi.runOnlyPendingTimersAsync();
  return latest();
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  const events = { addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "example.com" });
  vi.stubGlobal("document", { ...events, visibilityState: "visible" });
  vi.stubGlobal("window", { ...events, setTimeout, setInterval, clearTimeout, clearInterval });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("party client", () => {
  it("does not connect until started, so the caller holds it before its first change", () => {
    const onChange = vi.fn();
    const client = new PartyClient("BCDFG", "Ana", onChange);
    expect(FakeSocket.all).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    client.start();
    expect(FakeSocket.all).toHaveLength(1);
    expect(onChange).toHaveBeenCalled();
  });

  it("reconnects after a plain 1000 close, and stops only on the server's own codes", async () => {
    const { client } = seated();
    const next = await reconnect();
    expect(next).not.toBe(FakeSocket.all[0]);
    next.drop(1000);
    expect(client.status).toBe("reconnecting");
    await vi.runOnlyPendingTimersAsync();
    latest().receive({ t: "error", code: "gone" });
    latest().drop(CLOSE_GONE);
    expect(client.status).toBe("closed");
    expect(client.error).toBe("gone");
  });

  it("sends a leave asked for while disconnected once the socket is back", async () => {
    const { client, onChange } = seated();
    latest().drop(1006);
    onChange.mockClear();
    client.leave();
    await vi.runOnlyPendingTimersAsync();
    const next = latest();
    next.open();
    expect(next.sent.some((m) => m.t === "leave")).toBe(false);
    next.receive({ t: "welcome", seat: 0, party: view("mini-golf") });
    expect(next.sent.at(-1)).toEqual({ t: "leave" });
    expect(next.readyState).toBe(FakeSocket.CLOSED);
    // The shell let go of it: no more changes reach it.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls off a waiting leave when the phone joins that party again", async () => {
    const { client } = seated();
    latest().drop(1006);
    client.leave();
    const again = new PartyClient("BCDFG", "Ana", () => {});
    again.start();
    const sockets = FakeSocket.all.length;
    await vi.runOnlyPendingTimersAsync();
    // Only the new client's socket: the leaver stopped retrying.
    expect(FakeSocket.all).toHaveLength(sockets);
  });

  it("goes back to the menu at once while disconnected, and tells the party once back", async () => {
    const { client, ws } = seated("mini-golf");
    ws.drop(1006);
    expect(client.pick(null)).toBe(true);
    expect(client.game).toBeNull();
    const next = (await vi.runOnlyPendingTimersAsync(), latest());
    next.open();
    // The welcome still has the game open: this phone stays on the menu.
    next.receive({ t: "welcome", seat: 0, party: view("mini-golf") });
    expect(client.game).toBeNull();
    expect(next.sent.at(-1)).toEqual({ t: "pick", game: null });
    next.receive({ t: "party", party: view(null) });
    expect(client.game).toBeNull();
    // From here it follows the party again.
    next.receive({ t: "party", party: view("mini-golf") });
    expect(client.game).toBe("mini-golf");
  });

  it("follows a new game the friend picked while this phone was away from the one it left", async () => {
    const { client, ws } = seated("mini-golf");
    ws.drop(1006);
    client.pick(null);
    await vi.runOnlyPendingTimersAsync();
    const next = latest();
    next.open();
    next.receive({ t: "welcome", seat: 0, party: view("connect-four") });
    expect(client.game).toBe("connect-four");
    expect(next.sent.some((m) => m.t === "pick")).toBe(false);
  });

  it("does not count a guest who dropped before the first game as a friend", () => {
    const { client, ws } = seated(null);
    expect(client.friend?.name).toBe("Kai");
    ws.receive({ t: "party", party: view(null, false) });
    expect(client.friend).toBeNull();
  });
});
