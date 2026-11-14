import { describe, expect, it } from "vitest";
import { ready, rematch, shoot, startGolf, golfHost } from "../../src/games/mini-golf/core/host.ts";
import { holeOf } from "../../src/games/mini-golf/core/match.ts";
import type { GolfState } from "../../src/games/mini-golf/core/protocol.ts";
import { findShot } from "../../src/games/mini-golf/core/solver.ts";

const SHOT = { vx: 0, vy: -200 };

describe("strokes", () => {
  it("applies a stroke only on the right turn and the latest state", () => {
    const golf = startGolf();
    expect(golf.match.turn).toBe(0);
    expect(shoot(golf, 1, SHOT, 0)).toBeNull();
    expect(shoot(golf, 0, SHOT, 5)).toBeNull();
    const next = shoot(golf, 0, SHOT, 0)!;
    expect(next.match.strokes).toBe(1);
    expect(next.match.turn).toBe(1);
    // The same stroke sent twice is refused the second time.
    expect(shoot(next, 0, SHOT, 0)).toBeNull();
  });

  it("sends a stale or out-of-turn phone the true state, and only that phone", () => {
    const golf = startGolf();
    expect(golfHost.receive(golf, 1, { t: "shot", shot: SHOT, at: 0 })).toEqual({
      me: { t: "state", golf },
    });
    const reply = golfHost.receive(golf, 0, { t: "shot", shot: SHOT, at: 0 });
    expect(reply.state?.match.strokes).toBe(1);
    expect(reply.all).toEqual({ t: "shot", seat: 0, shot: SHOT, golf: reply.state });
    expect(reply.me).toBeUndefined();
  });

  it("relays live aim to the other phone only, on turn", () => {
    const golf = startGolf();
    const aim = { angle: 1, power: 0.5 };
    expect(golfHost.receive(golf, 0, { t: "aim", aim })).toEqual({ others: { t: "aim", seat: 0, aim } });
    expect(golfHost.receive(golf, 1, { t: "aim", aim })).toEqual({});
  });
});

describe("between holes", () => {
  function holeDone(): GolfState {
    let golf = startGolf();
    while (golf.match.phase === "aim") {
      const m = golf.match;
      golf = shoot(golf, m.turn, findShot(holeOf(m), m.balls[m.turn]).shot, m.strokes)!;
    }
    return golf;
  }

  it("waits for both players before the next hole", () => {
    const golf = holeDone();
    expect(golf.match.phase).toBe("holeDone");
    const one = ready(golf, 0)!;
    expect(one.ready).toEqual([true, false]);
    expect(ready(one, 0)).toBeNull();
    expect(one.match.holeIdx).toBe(0);
    const both = ready(one, 1)!;
    expect(both.match.holeIdx).toBe(1);
    expect(both.ready).toEqual([false, false]);
    expect(ready(startGolf(), 0)).toBeNull();
  });

  it("waits for both players before a rematch", () => {
    const done = holeDone();
    const golf: GolfState = { ...done, match: { ...done.match, phase: "gameDone", scores: [[2], [3]] } };
    const one = rematch(golf, 1)!;
    expect(one.match.phase).toBe("gameDone");
    expect(golfHost.receive(one, 1, { t: "rematch" })).toEqual({});
    const reply = golfHost.receive(one, 0, { t: "rematch" });
    expect(reply.state?.match).toMatchObject({ phase: "aim", holeIdx: 0 });
    expect(reply.all).toEqual({ t: "state", golf: reply.state });
  });
});
