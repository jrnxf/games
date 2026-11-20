import { describe, expect, it } from "vitest";
import {
  CAUGHT,
  COLORS,
  DECK,
  HAND,
  apply,
  canCatch,
  card,
  fits,
  nameOf,
  newGame,
  playable,
  replay,
  shuffled,
  topOf,
  viewOf,
  type Board,
  type Color,
  type Move,
  type Seat,
} from "../../src/games/last-card/core/board.ts";

/** The `n`th card in the deck (from 0) with this colour and face. */
const find = (color: Color | null, face: string | number, n = 0) =>
  DECK.map((c, i) => [c, i] as const).filter(([c]) => c.color === color && c.face === face)[n]![1];

/** A board set by hand: the hands, the top card and the draw pile (next card last). */
function rig(hands: [number[], number[]], top: number, pile: number[], turn: Seat = 0): Board {
  const b = newGame(1, 0);
  return {
    ...b,
    hands,
    discard: [top],
    pile,
    want: card(top).color,
    turn,
    drawn: null,
    open: null,
    called: [false, false],
    moves: [],
    log: [],
  };
}

/** Every card in a board: hands, draw pile and discard pile. */
const all = (b: Board) => [...b.hands[0], ...b.hands[1], ...b.pile, ...b.discard].sort((x, y) => x - y);

const W4 = find("wave", 4);
const S7 = find("sun", 7);
const L2 = find("leaf", 2);
const S4 = find("sun", 4);

describe("Last Card deck", () => {
  it("has 108 cards: per colour one 0, two of 1 to 9, two Skips, Reverses and Draw Twos, then 4 Wilds and 4 Wild Draw Fours", () => {
    expect(DECK).toHaveLength(108);
    for (const color of COLORS) {
      const of = DECK.filter((c) => c.color === color);
      expect(of).toHaveLength(25);
      expect(of.filter((c) => c.face === 0)).toHaveLength(1);
      for (let n = 1; n <= 9; n++) expect(of.filter((c) => c.face === n)).toHaveLength(2);
      for (const f of ["skip", "reverse", "draw2"]) expect(of.filter((c) => c.face === f)).toHaveLength(2);
    }
    expect(DECK.filter((c) => c.face === "wild" && c.color === null)).toHaveLength(4);
    expect(DECK.filter((c) => c.face === "wild4" && c.color === null)).toHaveLength(4);
  });

  it("names cards in words", () => {
    expect(nameOf(W4)).toBe("wave 4");
    expect(nameOf(find("flame", "skip"))).toBe("flame Skip");
    expect(nameOf(find(null, "wild4"))).toBe("Wild Draw Four");
  });
});

describe("Last Card deal", () => {
  it("deals seven each and turns one card up, and keeps all 108 cards", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b = newGame(seed, 0);
      expect(all(b)).toEqual(DECK.map((_, i) => i));
      expect(b.discard).toHaveLength(1);
      expect(card(topOf(b)).face).not.toBe("wild4");
      const drew = b.start.drew;
      expect(b.hands[0].length + b.hands[1].length).toBe(2 * HAND + drew);
    }
  });

  it("is the same game from the same seed, and another from another", () => {
    expect(newGame(7, 0)).toEqual(newGame(7, 0));
    expect(newGame(7, 0).hands).not.toEqual(newGame(8, 0).hands);
  });

  it("puts a Wild Draw Four start card back and turns another", () => {
    let seen = 0;
    // The deal takes the last 14 cards, so the card turned up is the 15th from the end.
    const up = 108 - 2 * HAND - 1;
    for (let seed = 1; seed <= 3000 && seen < 3; seed++) {
      const deck = shuffled(seed);
      if (card(deck[up]!).face !== "wild4" || card(deck[up - 1]!).face === "wild4") continue;
      const b = newGame(seed, 0);
      expect(topOf(b)).toBe(deck[up - 1]);
      // The Wild Draw Four went to the bottom of the draw pile.
      expect(b.pile[0]).toBe(deck[up]);
      seen++;
    }
    expect(seen).toBe(3);
  });

  it("acts on the first player for an action start card", () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 2000; seed++) {
      const first = (seed % 2) as Seat;
      const b = newGame(seed, first);
      const face = card(topOf(b)).face;
      if (face === "skip" || face === "reverse") {
        expect(b.turn).toBe(1 - first);
        expect(b.start).toMatchObject({ skipped: true, drew: 0 });
        expect(b.hands[first]).toHaveLength(HAND);
        found.add("skip");
      } else if (face === "draw2") {
        expect(b.turn).toBe(1 - first);
        expect(b.start).toMatchObject({ skipped: true, drew: 2 });
        expect(b.hands[first]).toHaveLength(HAND + 2);
        found.add("draw2");
      } else if (face === "wild") {
        // A Wild start card: any card goes.
        expect(b.turn).toBe(first);
        expect(b.want).toBeNull();
        expect(playable(b, first)).toEqual(b.hands[first]);
        found.add("wild");
      } else {
        expect(b.turn).toBe(first);
        expect(b.want).toBe(card(topOf(b)).color);
        found.add("number");
      }
    }
    expect([...found].sort()).toEqual(["draw2", "number", "skip", "wild"]);
  });
});

describe("Last Card rules", () => {
  it("matches by colour, by number or symbol, or with a Wild", () => {
    expect(fits(find("wave", 9), W4, "wave")).toBe(true);
    expect(fits(S4, W4, "wave")).toBe(true);
    expect(fits(S7, W4, "wave")).toBe(false);
    expect(fits(find(null, "wild"), W4, "wave")).toBe(true);
    expect(fits(find(null, "wild4"), W4, "wave")).toBe(true);
    expect(fits(find("sun", "skip"), find("wave", "skip"), "wave")).toBe(true);
    expect(fits(find("sun", "draw2"), find("wave", "skip"), "wave")).toBe(false);
    // On a Wild, only the colour named counts.
    expect(fits(S7, find(null, "wild"), "leaf")).toBe(false);
    expect(fits(L2, find(null, "wild"), "leaf")).toBe(true);
  });

  it("refuses a card that does not fit, a card not held, and a move out of turn", () => {
    const b = rig([[S7, L2, W4], [S4]], find("wave", 9), [find("flame", 1)]);
    expect(apply(b, { t: "play", by: 0, card: S7 })).toBeNull();
    expect(apply(b, { t: "play", by: 0, card: S4 })).toBeNull();
    expect(apply(b, { t: "play", by: 1, card: S4 })).toBeNull();
    expect(apply(b, { t: "draw", by: 1 })).toBeNull();
    expect(apply(b, { t: "keep", by: 0 })).toBeNull();
  });

  it("a number card passes the turn and sets the colour", () => {
    const b = apply(
      rig(
        [
          [S7, L2, find("wave", 9)],
          [S4, L2 + 1],
        ],
        W4,
        [find("flame", 1)],
      ),
      {
        t: "play",
        by: 0,
        card: find("wave", 9),
      },
    )!;
    expect(b.turn).toBe(1);
    expect(b.want).toBe("wave");
    expect(topOf(b)).toBe(find("wave", 9));
    expect(b.hands[0]).toEqual([S7, L2]);
  });

  it("Skip and Reverse give the same player another turn", () => {
    for (const face of ["skip", "reverse"]) {
      const id = find("wave", face);
      const b = apply(
        rig(
          [
            [id, S7, L2],
            [S4, L2 + 1],
          ],
          W4,
          [],
        ),
        { t: "play", by: 0, card: id },
      )!;
      expect(b.turn).toBe(0);
      expect(b.hands[1]).toHaveLength(2);
    }
  });

  it("Draw Two makes the other player draw two and lose the turn", () => {
    const id = find("wave", "draw2");
    const pile = [find("flame", 1), find("flame", 2), find("flame", 3)];
    const b = apply(rig([[id, S7, L2], [S4]], W4, pile), { t: "play", by: 0, card: id })!;
    expect(b.turn).toBe(0);
    expect(b.hands[1]).toEqual([S4, find("flame", 3), find("flame", 2)]);
    expect(b.log.at(-1)).toMatchObject({ t: "play", drew: 2 });
    // No stacking: the other's own Draw Two never answers it.
    expect(apply(b, { t: "play", by: 1, card: S4 })).toBeNull();
  });

  it("a Wild needs a colour, and the colour it names is the one to match", () => {
    const id = find(null, "wild");
    const b0 = rig([[id, S7, L2], [S4]], W4, []);
    expect(apply(b0, { t: "play", by: 0, card: id })).toBeNull();
    const b = apply(b0, { t: "play", by: 0, card: id, color: "leaf" })!;
    expect(b.want).toBe("leaf");
    expect(b.turn).toBe(1);
    expect(playable(b, 1)).toEqual([]);
  });

  it("Wild Draw Four makes the other draw four and lose the turn, and may be played at any time", () => {
    const id = find(null, "wild4");
    const pile = [1, 2, 3, 4, 5].map((n) => find("flame", n));
    // The player holds a wave card: there is no challenge rule, so the Wild Draw Four still goes.
    const b = apply(rig([[id, find("wave", 1), L2], [S4]], W4, pile), {
      t: "play",
      by: 0,
      card: id,
      color: "sun",
    })!;
    expect(b.hands[1]).toHaveLength(5);
    expect(b.turn).toBe(0);
    expect(b.want).toBe("sun");
  });

  it("a draw that fits may be played or kept, and one that doesn't ends the turn", () => {
    const fit = find("wave", 9);
    const b = apply(rig([[S7, L2], [S4]], W4, [fit]), { t: "draw", by: 0 })!;
    expect(b.drawn).toBe(fit);
    expect(b.turn).toBe(0);
    // Only the drawn card may go now.
    expect(playable(b, 0)).toEqual([fit]);
    expect(apply(b, { t: "draw", by: 0 })).toBeNull();
    expect(apply(b, { t: "play", by: 0, card: fit })!.turn).toBe(1);
    const kept = apply(b, { t: "keep", by: 0 })!;
    expect(kept.turn).toBe(1);
    expect(kept.hands[0]).toContain(fit);
    const miss = apply(rig([[S7, L2], [S4]], W4, [find("flame", 1)]), { t: "draw", by: 0 })!;
    expect(miss.turn).toBe(1);
    expect(miss.drawn).toBeNull();
  });

  it("a player may draw even when a card fits", () => {
    const b = apply(rig([[find("wave", 1), L2], [S4]], W4, [S7]), { t: "draw", by: 0 })!;
    expect(b.hands[0]).toContain(S7);
  });

  it("shuffles the discard pile, all but its top card, back in when the draw pile runs out", () => {
    const under = [1, 2, 3].map((n) => find("flame", n));
    const b0 = { ...rig([[S7, L2], [S4]], W4, []), discard: [...under, W4] };
    const b = apply(b0, { t: "draw", by: 0 })!;
    expect(b.shuffles).toBe(1);
    expect(b.discard).toEqual([W4]);
    expect(b.pile).toHaveLength(2);
    expect(b.hands[0]).toHaveLength(3);
    expect(under).toContain(b.hands[0][2]);
    // The same seed reshuffles the same way.
    expect(apply(b0, { t: "draw", by: 0 })).toEqual(b);
  });

  it("a draw with no cards left anywhere ends the turn", () => {
    const b = apply(rig([[S7, L2], [S4]], W4, []), { t: "draw", by: 0 })!;
    expect(b.turn).toBe(1);
    expect(b.hands[0]).toHaveLength(2);
  });

  it("the first to empty their hand wins", () => {
    const b = apply(rig([[find("wave", 9)], [S4]], W4, []), { t: "play", by: 0, card: find("wave", 9) })!;
    expect(b.over).toBe(true);
    expect(b.winner).toBe(0);
    expect(apply(b, { t: "draw", by: 1 })).toBeNull();
  });

  it("an action card as the last card wins at once", () => {
    const id = find("wave", "draw2");
    const b = apply(rig([[id], [S4]], W4, [S7, L2]), { t: "play", by: 0, card: id })!;
    expect(b.winner).toBe(0);
    expect(b.hands[1]).toEqual([S4]);
  });
});

describe("Last Card call and catch", () => {
  const twoLeft = () =>
    rig(
      [
        [find("wave", 9), S7],
        [S4, L2, find("leaf", 5)],
      ],
      W4,
      [1, 2, 3].map((n) => find("flame", n)),
    );

  it("a call as the second-last card goes down keeps the player safe", () => {
    const b = apply(twoLeft(), { t: "play", by: 0, card: find("wave", 9), call: true })!;
    expect(b.called).toEqual([true, false]);
    expect(b.open).toBeNull();
    expect(canCatch(b, 1)).toBe(false);
    expect(apply(b, { t: "catch", by: 1 })).toBeNull();
  });

  it("no call lets the other player catch: the player draws two", () => {
    const b = apply(twoLeft(), { t: "play", by: 0, card: find("wave", 9) })!;
    expect(b.open).toBe(0);
    expect(canCatch(b, 1)).toBe(true);
    expect(canCatch(b, 0)).toBe(false);
    const caught = apply(b, { t: "catch", by: 1 })!;
    expect(caught.hands[0]).toHaveLength(1 + CAUGHT);
    expect(caught.open).toBeNull();
    // A catch is not a turn: the catcher still plays.
    expect(caught.turn).toBe(1);
    expect(caught.log.at(-1)).toEqual({ t: "catch", by: 1, drew: 2 });
  });

  it("the chance to catch ends when the catcher makes a move", () => {
    const b = apply(twoLeft(), { t: "play", by: 0, card: find("wave", 9) })!;
    const moved = apply(b, { t: "draw", by: 1 })!;
    expect(moved.open).toBeNull();
    expect(apply(moved, { t: "catch", by: 1 })).toBeNull();
  });

  it("a catch may come out of turn, after a Skip as the second-last card", () => {
    const skip = find("wave", "skip");
    const b = apply(
      rig(
        [
          [skip, S7],
          [S4, L2],
        ],
        W4,
        [find("flame", 1), find("flame", 2)],
      ),
      {
        t: "play",
        by: 0,
        card: skip,
      },
    )!;
    expect(b.turn).toBe(0);
    expect(apply(b, { t: "catch", by: 1 })!.hands[0]).toHaveLength(3);
  });

  it("a call with more than two cards means nothing", () => {
    const b = apply(rig([[find("wave", 9), S7, L2], [S4]], W4, []), {
      t: "play",
      by: 0,
      card: find("wave", 9),
      call: true,
    })!;
    expect(b.called).toEqual([false, false]);
  });
});

describe("Last Card replay and views", () => {
  /** A short game of first-fit plays and draws. */
  function moves(seed: number, n: number): Move[] {
    let b = newGame(seed, 0);
    const out: Move[] = [];
    for (let i = 0; i < n && !b.over; i++) {
      const seat = b.turn;
      const [id] = playable(b, seat);
      const m: Move =
        id === undefined
          ? b.drawn !== null
            ? { t: "keep", by: seat }
            : { t: "draw", by: seat }
          : { t: "play", by: seat, card: id, ...(card(id).color ? {} : { color: "sun" as const }) };
      b = apply(b, m)!;
      out.push(m);
    }
    return out;
  }

  it("replays the same board from a seed and the moves", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = moves(seed, 60);
      let b = newGame(seed, 0);
      for (const m of list) b = apply(b, m)!;
      expect(replay(seed, 0, list)).toEqual(b);
      expect(b.moves).toEqual(list);
    }
  });

  it("refuses a replay with a move that is not allowed", () => {
    expect(replay(1, 0, [{ t: "keep", by: 0 }])).toBeNull();
  });

  it("a view holds the player's own hand and the size of the other, never the other hand, the deck or the seed", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const b = replay(seed, 0, moves(seed, 30))!;
      if (b.over) continue;
      for (const seat of [0, 1] as const) {
        const v = viewOf(b, seat);
        expect(v.hand).toEqual(b.hands[seat]);
        expect(v.others).toBe(b.hands[1 - seat]!.length);
        expect(v.pile).toBe(b.pile.length);
        expect(v.foe).toBeNull();
        expect(Object.keys(v).sort()).toEqual(VIEW_KEYS);
        // The other player's draws keep their card hidden.
        for (const e of v.log) if (e.t === "draw" && e.by !== seat) expect(e.card).toBeNull();
        // Every card the view names is in this hand, or was played face up.
        const named = [
          ...v.hand,
          v.top,
          v.start.card,
          ...(v.drawn === null ? [] : [v.drawn]),
          ...v.log.flatMap((e) =>
            e.t === "play" || e.t === "draw" ? (e.card === null ? [] : [e.card]) : [],
          ),
        ];
        const theirs = new Set(b.hands[1 - seat]);
        const played = new Set(v.log.flatMap((e) => (e.t === "play" ? [e.card] : [])));
        for (const id of named) if (theirs.has(id)) expect(played.has(id)).toBe(true);
      }
    }
  });

  it("a view shows the other hand once the game is over", () => {
    const b = apply(rig([[find("wave", 9)], [S4, L2]], W4, []), { t: "play", by: 0, card: find("wave", 9) })!;
    expect(viewOf(b, 0).foe).toEqual([S4, L2]);
    expect(viewOf(b, 1).foe).toEqual([]);
  });

  it("a drawn card shows only on its player's view", () => {
    const fit = find("wave", 9);
    const b = apply(rig([[S7, L2], [S4]], W4, [fit]), { t: "draw", by: 0 })!;
    expect(viewOf(b, 0)).toMatchObject({ drawn: fit, drawing: true });
    expect(viewOf(b, 1)).toMatchObject({ drawn: null, drawing: true });
    expect(viewOf(b, 1).log.at(-1)).toEqual({ t: "draw", by: 0, card: null, fits: true });
  });
});

const VIEW_KEYS = [
  "called",
  "drawing",
  "drawn",
  "first",
  "foe",
  "hand",
  "log",
  "moves",
  "open",
  "others",
  "over",
  "pile",
  "seat",
  "start",
  "top",
  "turn",
  "want",
  "winner",
];

describe("Last Card views keep their shape", () => {
  it("lists every key a view has", () => {
    expect(Object.keys(viewOf(newGame(3, 0), 0)).sort()).toEqual(VIEW_KEYS);
  });
});
