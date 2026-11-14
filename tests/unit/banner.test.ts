import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACK_ONLINE_MS, ConnectionBanner } from "../../src/shell/banner.ts";
import type { PlayerView, Seat } from "../../src/party/protocol.ts";

function setup() {
  const ch = {
    me: 0 as Seat,
    connected: true,
    players: [
      { name: "Ana", connected: true },
      { name: "Kai", connected: true },
    ] as [PlayerView, PlayerView],
  };
  const shown: (string | null)[] = [];
  const banner = new ConnectionBanner(ch, (text) => shown.push(text));
  return { ch, banner, last: () => shown.at(-1) ?? null };
}

describe("connection banner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("puts this phone's link first, then the friend's", () => {
    const { ch, banner, last } = setup();
    expect(last()).toBeNull();
    ch.players[1] = { name: "Kai", connected: false };
    banner.update();
    expect(last()).toBe("Kai dropped out · waiting...");
    ch.connected = false;
    banner.update();
    expect(last()).toBe("Connection lost · reconnecting...");
  });

  it("says Back online when the link returns, and keeps it up through the sync that follows", () => {
    const { ch, banner, last } = setup();
    ch.connected = false;
    banner.update();
    ch.connected = true;
    banner.update();
    expect(last()).toBe("Back online");
    banner.update();
    expect(last()).toBe("Back online");
    vi.advanceTimersByTime(BACK_ONLINE_MS);
    expect(last()).toBeNull();
  });

  it("drops a pending Back online when the game closes", () => {
    const { ch, banner, last } = setup();
    ch.connected = false;
    banner.update();
    ch.connected = true;
    banner.update();
    banner.stop();
    expect(last()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
