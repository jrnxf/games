import { describe, expect, it } from "vitest";
import { parseGolfMessage } from "../../src/games/mini-golf/core/protocol.ts";
import { cleanName, isCode, normalizeCode, parseClientMessage } from "../../src/party/protocol.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("parseClientMessage", () => {
  it("reads every kind of party message", () => {
    expect(parseClientMessage(JSON.stringify({ t: "hello", v: 3, token: TOKEN, name: "Ana" }))).toEqual({
      t: "hello",
      v: 3,
      token: TOKEN,
      name: "Ana",
    });
    expect(parseClientMessage('{"t":"pick","game":"mini-golf"}')).toEqual({ t: "pick", game: "mini-golf" });
    expect(parseClientMessage('{"t":"pick","game":null}')).toEqual({ t: "pick", game: null });
    expect(parseClientMessage('{"t":"sync","game":"mini-golf"}')).toEqual({ t: "sync", game: "mini-golf" });
    expect(parseClientMessage('{"t":"game","game":"connect-four","m":{"t":"drop","col":3}}')).toEqual({
      t: "game",
      game: "connect-four",
      m: { t: "drop", col: 3 },
    });
    for (const t of ["leave", "ping"]) {
      expect(parseClientMessage(JSON.stringify({ t, extra: 1 }))).toEqual({ t });
    }
  });

  it("drops anything malformed", () => {
    const bad = [
      "not json",
      "null",
      '{"t":"nope"}',
      '{"t":"hello","v":3,"token":"short"}',
      '{"t":"pick","game":"Mini Golf"}',
      '{"t":"pick"}',
      '{"t":"sync","game":null}',
      '{"t":"game","game":"mini-golf","m":3}',
      '{"t":"game","game":"mini-golf"}',
      JSON.stringify({ t: "hello", v: 3, token: TOKEN, name: "x".repeat(600) }),
      42,
    ];
    for (const raw of bad) expect(parseClientMessage(raw), String(raw)).toBeNull();
  });
});

describe("parseGolfMessage", () => {
  it("reads every kind of golf message", () => {
    expect(parseGolfMessage({ t: "shot", shot: { vx: 10, vy: -300 }, at: 3 })).toEqual({
      t: "shot",
      shot: { vx: 10, vy: -300 },
      at: 3,
    });
    expect(parseGolfMessage({ t: "aim", aim: { angle: 1.5, power: 0.4 } })).toEqual({
      t: "aim",
      aim: { angle: 1.5, power: 0.4 },
    });
    expect(parseGolfMessage({ t: "aim", aim: null })).toEqual({ t: "aim", aim: null });
    for (const t of ["ready", "rematch"]) expect(parseGolfMessage({ t, extra: 1 })).toEqual({ t });
  });

  it("drops anything malformed", () => {
    const bad = [
      null,
      "shot",
      { t: "start" },
      { t: "shot", shot: { vx: 1e9, vy: 0 }, at: 0 },
      { t: "shot", shot: { vx: 0, vy: -300 }, at: "0" },
      { t: "aim", aim: { angle: 1, power: 3 } },
    ];
    for (const raw of bad) expect(parseGolfMessage(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe("names and codes", () => {
  it("cleans names to something short and printable", () => {
    expect(cleanName("  Ana  ", "P1")).toBe("Ana");
    expect(cleanName("a\u0000b\nc", "P1")).toBe("ab c");
    expect(cleanName("abcdefghijklmnopq", "P1")).toBe("abcdefghijkl");
    expect(cleanName("", "P1")).toBe("P1");
    expect(cleanName(7, "P1")).toBe("P1");
  });

  it("normalizes typed party codes", () => {
    expect(normalizeCode("bcd-fg")).toBe("BCDFG");
    expect(normalizeCode(" k7q xb ")).toBe("K7QXB");
    expect(isCode("BCDFG")).toBe(true);
    expect(isCode("ABCDE")).toBe(false);
    expect(isCode("BCDF")).toBe(false);
  });
});
