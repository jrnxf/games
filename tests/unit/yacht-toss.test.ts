import { describe, expect, it } from "vitest";
import { simulate, toss } from "../../src/games/yacht/client/toss.ts";

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe("yacht toss", () => {
  it("bounces down to rest on the felt", () => {
    const frames = simulate(-400, -260, 32, 240, 1800);
    const hits = frames.filter((f, i) => i > 0 && f.h === 0 && frames[i - 1]!.h > 0).length;
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(frames.at(-1)!.h).toBe(0);
    expect(frames.every((f) => f.h >= 0)).toBe(true);
  });

  it("ends every toss flat in its own slot, with whole turns of spin", () => {
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const k = toss(i % 5, rand);
      const rest = k.at(k.dur);
      expect(rest.x).toBeCloseTo(0, 6);
      expect(rest.y).toBeCloseTo(0, 6);
      expect(rest.h).toBe(0);
      expect(rest.yaw).toBeCloseTo(0, 6);
      expect(rest.spin % 360).toBeCloseTo(0, 6);
      // Thrown in from the bottom right.
      const from = k.at(0);
      expect(from.x).toBeGreaterThan(0);
      expect(from.y).toBeGreaterThan(0);
      expect(Math.hypot(from.x, from.y)).toBeLessThan(160);
    }
  });

  it("is about as quick as a tap: every die rests within half a second", () => {
    const rand = seeded(11);
    const ends = Array.from({ length: 200 }, (_, i) => {
      const k = toss(i % 5, rand);
      return k.delay + k.dur;
    });
    expect(Math.max(...ends)).toBeLessThan(520);
    expect(Math.min(...ends)).toBeGreaterThan(250);
  });
});
