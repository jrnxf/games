import { describe, expect, it } from "vitest";
import { LEVELS, choose, readOther, type Level } from "../../src/games/last-card/core/ai.ts";
import {
  DECK,
  apply,
  card,
  newGame,
  playableIn,
  viewOf,
  type Board,
  type Seat,
  type View,
} from "../../src/games/last-card/core/board.ts";

/** Moves past this end a game in a draw: two hands that hold every card could pass for ever. */
const LIMIT = 1_000;

/** A whole game between two levels. Each seat has its own luck. Returns the final board. */
function game(seat0: Level, seat1: Level, seed: number, first: Seat): Board {
  let b = newGame(seed, first);
  const luck = [seed * 31 + 7, seed * 17 + 3];
  const levels = [seat0, seat1];
  for (let n = 0; n < LIMIT && !b.over; n++) {
    // A player who may catch the other does it on their own time, before the player on turn moves.
    const watcher = (1 - b.turn) as Seat;
    if (levels[watcher] === "hard" && b.open === b.turn) {
      b = apply(b, { ...choose(viewOf(b, watcher), "hard", luck[watcher]!), by: watcher })!;
      continue;
    }
    const seat = b.turn;
    const next = apply(b, { ...choose(viewOf(b, seat), levels[seat]!, luck[seat]!), by: seat });
    expect(next, `a legal move at ${n}`).not.toBeNull();
    b = next!;
  }
  return b;
}

/** How many of `games` seeded games `a` wins against `b`, with each seat and each first player in turn. */
function wins(a: Level, b: Level, games: number): number {
  let n = 0;
  for (let seed = 1; seed <= games; seed++) {
    const seat = (seed % 2) as Seat;
    const end = game(seat === 0 ? a : b, seat === 0 ? b : a, seed, ((seed >> 1) % 2) as Seat);
    if (end.winner === seat) n++;
  }
  return n;
}

/** A view set by hand around a game from `seed`. */
const viewWith = (seed: number, patch: Partial<View>): View => ({ ...viewOf(newGame(seed, 0), 0), ...patch });

/** The first card in the deck with this colour and face. */
const find = (color: string | null, face: string | number) =>
  DECK.findIndex((c) => c.color === color && c.face === face);

describe("Last Card computer", () => {
  it("only makes legal moves, at every level, to the end of the game", () => {
    for (const level of LEVELS)
      for (let seed = 1; seed <= 20; seed++) {
        const end = game(level, level, seed, (seed % 2) as Seat);
        expect(end.over, `${level} ${seed}`).toBe(true);
      }
  });

  it("is a pure function of the view, the level and the seed", () => {
    const b = newGame(42, 0);
    for (const level of LEVELS)
      expect(choose(viewOf(b, 0), level, 9)).toEqual(choose(viewOf(b, 0), level, 9));
  });

  it("draws when nothing fits, and plays when something does", () => {
    const top = find("wave", 4);
    const v = viewWith(1, { top, want: "wave", hand: [find("sun", 7), find("leaf", 2)], turn: 0 });
    for (const level of LEVELS) expect(choose(v, level, 1)).toEqual({ t: "draw" });
    const w = { ...v, hand: [find("sun", 7), find("wave", 9)] };
    for (const level of LEVELS)
      expect(choose(w, level, 1)).toMatchObject({ t: "play", card: find("wave", 9) });
  });

  it("plays or keeps a card it just drew, and nothing else", () => {
    const drawn = find("wave", 9);
    const v = viewWith(1, {
      top: find("wave", 4),
      want: "wave",
      hand: [find("wave", 1), drawn],
      drawn,
      drawing: true,
      turn: 0,
    });
    for (const level of LEVELS) expect(choose(v, level, 2)).toMatchObject({ t: "play", card: drawn });
  });

  it("names a colour after a Wild", () => {
    const wild = find(null, "wild");
    const v = viewWith(3, {
      top: find("wave", 4),
      want: "wave",
      hand: [wild, find("leaf", 1), find("leaf", 2), find("sun", 3)],
      turn: 0,
    });
    for (const level of LEVELS) {
      const a = choose(v, level, 5);
      expect(a).toMatchObject({ t: "play", card: wild });
      if (a.t === "play") expect(a.color).toBeDefined();
      // Medium and Hard name the colour they hold most.
      if (level !== "easy" && a.t === "play") expect(a.color).toBe("leaf");
    }
  });

  it("Medium and Hard keep a Wild while another card fits", () => {
    const v = viewWith(3, {
      top: find("wave", 4),
      want: "wave",
      hand: [find(null, "wild"), find("wave", 2), find("sun", 3)],
      turn: 0,
    });
    for (const level of ["medium", "hard"] as const)
      expect(choose(v, level, 5)).toMatchObject({ t: "play", card: find("wave", 2) });
  });

  it("Hard plays a Draw Two when the other hand is small", () => {
    const draw2 = find("wave", "draw2");
    const v = viewWith(4, {
      top: find("wave", 4),
      want: "wave",
      hand: [find("wave", 2), draw2, find("wave", 7), find("sun", 1)],
      others: 2,
      turn: 0,
    });
    expect(choose(v, "hard", 1)).toMatchObject({ t: "play", card: draw2 });
  });

  it("Hard keeps its Wild Draw Four while the other hand is big", () => {
    const four = find(null, "wild4");
    const v = viewWith(4, {
      top: find("wave", 4),
      want: "wave",
      hand: [four, find("wave", 2), find("sun", 1)],
      others: 6,
      turn: 0,
    });
    expect(choose(v, "hard", 1)).toMatchObject({ t: "play", card: find("wave", 2) });
    expect(choose({ ...v, others: 1 }, "hard", 1)).toMatchObject({ t: "play", card: four });
  });

  it("Hard always calls Last card, and Easy sometimes forgets", () => {
    let forgot = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const v = viewWith(seed, {
        top: find("wave", 4),
        want: "wave",
        hand: [find("wave", 2), find("sun", 1)],
        turn: 0,
      });
      expect(choose(v, "hard", seed)).toMatchObject({ t: "play", call: true });
      const easy = choose(v, "easy", seed);
      if (easy.t === "play" && !easy.call) forgot++;
    }
    expect(forgot).toBeGreaterThan(20);
    expect(forgot).toBeLessThan(120);
  });

  it("only Hard catches a player who did not call", () => {
    const v = viewWith(5, { open: 1, turn: 0 });
    expect(choose(v, "hard", 1)).toEqual({ t: "catch" });
    expect(choose(v, "medium", 1).t).not.toBe("catch");
    expect(choose(v, "easy", 1).t).not.toBe("catch");
  });

  it("Hard reads the colours the other player drew on", () => {
    const b = newGame(8, 1);
    // The other player draws on the start card's colour: they seem to lack it.
    const want = b.want;
    const v = viewOf(apply(b, { t: "draw", by: 1 })!, 0);
    if (want && v.log[0]?.t === "draw") expect(readOther(v).short.has(want)).toBe(true);
    // Its own hand and the cards played are counted out of what is unseen.
    const unseen = readOther(viewOf(b, 0)).unseen;
    const total = Object.values(unseen).reduce((a, n) => a + n, 0);
    const known = [...b.hands[0], b.discard[0]!].filter((id) => card(id).color).length;
    expect(total).toBe(100 - known);
  });

  it("never plays a card the view says does not fit", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let b = newGame(seed, 0);
      for (let n = 0; n < 40 && !b.over; n++) {
        const v = viewOf(b, b.turn);
        const a = choose(v, "medium", seed);
        if (a.t === "play") expect(playableIn(v)).toContain(a.card);
        b = apply(b, { ...a, by: b.turn })!;
      }
    }
  });

  it("Hard beats Easy over many seeded games by a clear margin", () => {
    const games = 400;
    const won = wins("hard", "easy", games);
    // Logged for the docs: the margin is in docs/decisions.md.
    console.log(`Hard won ${won} of ${games} games against Easy`);
    expect(won / games).toBeGreaterThan(0.7);
  });

  it("Hard beats Medium more often than not", () => {
    const games = 400;
    const won = wins("hard", "medium", games);
    console.log(`Hard won ${won} of ${games} games against Medium`);
    expect(won / games).toBeGreaterThan(0.5);
  });
});
