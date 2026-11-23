import { describe, expect, it } from "vitest";
import {
  ALL_HELD,
  BOXES,
  CHANCE,
  FOUR_KIND,
  FULL_HOUSE,
  LARGE_STRAIGHT,
  ONES,
  SIXES,
  SMALL_STRAIGHT,
  THREE_KIND,
  YACHT,
  act,
  bonus,
  boxScore,
  canRoll,
  canScore,
  newCard,
  newGame,
  replay,
  rollAction,
  scoreFor,
  total,
  type Card,
  type Game,
} from "../../src/games/yacht/core/board.ts";
import { chacha20, faces, isSeed, newSeed } from "../../src/games/yacht/core/dice.ts";

/** A roller that hands out the rolls in `list`, one a roll. */
const rolls = (list: number[][]) => (k: number) => list[k] ?? [];

/** A card with `boxes` filled as given and the rest open. */
function card(boxes: Record<number, number>, extra = 0): Card {
  const c = newCard();
  for (const [b, v] of Object.entries(boxes)) c.boxes[Number(b)] = v;
  c.extra = extra;
  return c;
}

/** The game after one roll of `dice` by the first player, with `cards` as they are. */
function rolled(dice: number[], cards?: [Card, Card]): Game {
  const g = act({ ...newGame(0), cards: cards ?? [newCard(), newCard()] }, rollAction(0), rolls([dice]))!;
  return g;
}

describe("boxes", () => {
  it("scores the upper boxes as the sum of that face", () => {
    const d = [1, 1, 3, 6, 6];
    expect([0, 1, 2, 3, 4, 5].map((b) => boxScore(b, d))).toEqual([2, 0, 3, 0, 0, 12]);
  });

  it("scores 3 and 4 of a kind as the sum of all dice", () => {
    expect(boxScore(THREE_KIND, [4, 4, 4, 2, 1])).toBe(15);
    expect(boxScore(THREE_KIND, [4, 4, 3, 2, 1])).toBe(0);
    expect(boxScore(FOUR_KIND, [5, 5, 5, 5, 2])).toBe(22);
    expect(boxScore(FOUR_KIND, [5, 5, 5, 2, 2])).toBe(0);
    // Five of a kind is also three and four of a kind.
    expect(boxScore(THREE_KIND, [6, 6, 6, 6, 6])).toBe(30);
    expect(boxScore(FOUR_KIND, [6, 6, 6, 6, 6])).toBe(30);
  });

  it("scores a full house 25, only for three and two", () => {
    expect(boxScore(FULL_HOUSE, [2, 2, 5, 5, 5])).toBe(25);
    expect(boxScore(FULL_HOUSE, [2, 2, 5, 5, 4])).toBe(0);
    // Five of a kind is no full house, except as a joker (below).
    expect(boxScore(FULL_HOUSE, [3, 3, 3, 3, 3])).toBe(0);
  });

  it("scores four in a row 30 and five in a row 40", () => {
    for (const d of [
      [1, 2, 3, 4, 6],
      [2, 3, 4, 5, 5],
      [6, 3, 5, 4, 1],
    ]) {
      expect(boxScore(SMALL_STRAIGHT, d)).toBe(30);
      expect(boxScore(LARGE_STRAIGHT, d)).toBe(0);
    }
    expect(boxScore(SMALL_STRAIGHT, [1, 2, 3, 5, 6])).toBe(0);
    expect(boxScore(LARGE_STRAIGHT, [5, 4, 3, 2, 1])).toBe(40);
    expect(boxScore(LARGE_STRAIGHT, [2, 3, 4, 5, 6])).toBe(40);
    expect(boxScore(SMALL_STRAIGHT, [2, 3, 4, 5, 6])).toBe(30);
  });

  it("scores a Yacht 50 and Chance the sum", () => {
    expect(boxScore(YACHT, [2, 2, 2, 2, 2])).toBe(50);
    expect(boxScore(YACHT, [2, 2, 2, 2, 1])).toBe(0);
    expect(boxScore(CHANCE, [1, 2, 3, 4, 6])).toBe(16);
  });

  it("refuses a filled box", () => {
    const c = card({ [CHANCE]: 20 });
    expect(canScore(c, CHANCE, [1, 2, 3, 4, 5])).toBe(false);
    expect(scoreFor(c, CHANCE, [1, 2, 3, 4, 5])).toBeNull();
    expect(scoreFor(c, LARGE_STRAIGHT, [1, 2, 3, 4, 5])).toBe(40);
  });
});

describe("the upper bonus", () => {
  it("adds 35 when Ones to Sixes reach 63", () => {
    const at = card({ 0: 3, 1: 6, 2: 9, 3: 12, 4: 15, 5: 18 });
    expect(bonus(at)).toBe(35);
    expect(total(at)).toBe(63 + 35);
    const under = card({ 0: 2, 1: 6, 2: 9, 3: 12, 4: 15, 5: 18 });
    expect(bonus(under)).toBe(0);
    expect(total(under)).toBe(62);
  });

  it("counts only the upper boxes toward it", () => {
    const c = card({ 5: 30, 4: 25, [CHANCE]: 30 });
    expect(bonus(c)).toBe(0);
    expect(total(c)).toBe(85);
  });
});

describe("extra Yachts and the joker", () => {
  it("lets a first Yacht go in any box, by its own rule", () => {
    const c = newCard();
    const d = [4, 4, 4, 4, 4];
    for (let b = 0; b < BOXES; b++) expect(canScore(c, b, d)).toBe(true);
    expect(scoreFor(c, FULL_HOUSE, d)).toBe(0);
    expect(scoreFor(c, YACHT, d)).toBe(50);
  });

  it("forces an extra Yacht into its own upper box while that is open", () => {
    const c = card({ [YACHT]: 50 });
    const d = [3, 3, 3, 3, 3];
    const legal = [...Array(BOXES).keys()].filter((b) => canScore(c, b, d));
    expect(legal).toEqual([2]);
    expect(scoreFor(c, 2, d)).toBe(15);
  });

  it("lets it go in any open lower box once its upper box is filled, at full value", () => {
    const c = card({ [YACHT]: 50, 2: 9, [FULL_HOUSE]: 25 });
    const d = [3, 3, 3, 3, 3];
    const legal = [...Array(BOXES).keys()].filter((b) => canScore(c, b, d));
    expect(legal).toEqual([THREE_KIND, FOUR_KIND, SMALL_STRAIGHT, LARGE_STRAIGHT, CHANCE]);
    expect(scoreFor(c, SMALL_STRAIGHT, d)).toBe(30);
    expect(scoreFor(c, LARGE_STRAIGHT, d)).toBe(40);
    expect(scoreFor(c, THREE_KIND, d)).toBe(15);
    expect(scoreFor(card({ [YACHT]: 50, 2: 9 }), FULL_HOUSE, d)).toBe(25);
  });

  it("scores it 0 in an open upper box once the lower boxes are full", () => {
    const c = card({ [YACHT]: 50, 2: 9, 6: 20, 7: 20, 8: 25, 9: 30, 10: 40, 12: 20 });
    const d = [3, 3, 3, 3, 3];
    const legal = [...Array(BOXES).keys()].filter((b) => canScore(c, b, d));
    expect(legal).toEqual([0, 1, 3, 4, 5]);
    expect(scoreFor(c, ONES, d)).toBe(0);
    expect(scoreFor(c, SIXES, d)).toBe(0);
  });

  it("gives 100 for each extra Yacht once the Yacht box holds 50", () => {
    let g = rolled([5, 5, 5, 5, 5], [card({ [YACHT]: 50 }), newCard()]);
    g = act(g, 4, rolls([]))!;
    expect(g.cards[0].boxes[4]).toBe(25);
    expect(g.cards[0].extra).toBe(1);
    expect(g.last).toEqual({ seat: 0, box: 4, points: 25, extra: true });
    expect(total(g.cards[0])).toBe(50 + 25 + 100);
  });

  it("gives no bonus when the Yacht box holds 0, but the joker still applies", () => {
    const c = card({ [YACHT]: 0, 1: 4 });
    const d = [2, 2, 2, 2, 2];
    expect(scoreFor(c, LARGE_STRAIGHT, d)).toBe(40);
    let g = rolled(d, [c, newCard()]);
    g = act(g, LARGE_STRAIGHT, rolls([]))!;
    expect(g.cards[0].extra).toBe(0);
    expect(g.last!.extra).toBe(false);
  });
});

describe("turns", () => {
  it("needs a roll before a box, and allows three rolls a turn", () => {
    const g0 = newGame(1);
    expect(g0.turn).toBe(1);
    expect(act(g0, CHANCE, rolls([]))).toBeNull();
    const list = [
      [1, 2, 3, 4, 5],
      [6, 6, 6, 6, 6],
      [2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3],
    ];
    let g = act(g0, rollAction(0), rolls(list))!;
    expect(g.dice).toEqual([1, 2, 3, 4, 5]);
    // Holding dice 0 and 4 keeps the 1 and the 5.
    g = act(g, rollAction(0b10001), rolls(list))!;
    expect(g.dice).toEqual([1, 6, 6, 6, 5]);
    g = act(g, rollAction(0), rolls(list))!;
    expect(g.rolls).toBe(3);
    expect(canRoll(g)).toBe(false);
    expect(act(g, rollAction(0), rolls(list))).toBeNull();
    g = act(g, CHANCE, rolls(list))!;
    expect(g.turn).toBe(0);
    expect(g.rolls).toBe(0);
    expect(g.rolled).toBe(3);
    expect(g.cards[1].boxes[CHANCE]).toBe(10);
  });

  it("refuses a first roll that holds dice, and a roll that holds them all", () => {
    const list = [[1, 2, 3, 4, 5]];
    expect(act(newGame(0), rollAction(1), rolls(list))).toBeNull();
    const g = act(newGame(0), rollAction(0), rolls(list))!;
    expect(act(g, rollAction(ALL_HELD), rolls(list))).toBeNull();
    expect(act(g, 13, rolls(list))).toBeNull();
    expect(act(g, -1, rolls(list))).toBeNull();
    expect(act(g, 1.5, rolls(list))).toBeNull();
  });

  it("ends after 13 boxes each, and the higher total wins", () => {
    const seed = [1, 2, 3, 4, 5, 6, 7, 8];
    const roll = (k: number) => faces(seed, k);
    let g = newGame(0);
    for (let turn = 0; turn < 26; turn++) {
      g = act(g, rollAction(0), roll)!;
      const box = g.cards[g.turn].boxes.findIndex(
        (b, i) => b === null && canScore(g.cards[g.turn], i, g.dice),
      );
      g = act(g, box, roll)!;
    }
    expect(g.over).toBe(true);
    expect(g.actions).toHaveLength(52);
    const [a, b] = [total(g.cards[0]), total(g.cards[1])];
    expect(g.winner).toBe(a === b ? null : a > b ? 0 : 1);
    expect(g.draw).toBe(a === b);
    expect(act(g, rollAction(0), roll)).toBeNull();
    // The same seed and actions replay the same game.
    expect(replay(0, g.actions, roll)).toEqual(g);
  });

  it("counts a tie as a draw", () => {
    // Both players roll the same dice and fill the same boxes in turn.
    const d = [1, 2, 3, 4, 5];
    let g = newGame(0);
    for (let turn = 0; turn < 26; turn++) {
      g = act(g, rollAction(0), () => d)!;
      g = act(g, Math.floor(turn / 2), () => d)!;
    }
    expect(g.over).toBe(true);
    expect(g.draw).toBe(true);
    expect(g.winner).toBeNull();
  });

  it("ends a solo game after 13 boxes on one card, with no winner", () => {
    const seed = [8, 7, 6, 5, 4, 3, 2, 1];
    const roll = (k: number) => faces(seed, k);
    let g = newGame(1, 1);
    expect(g.first).toBe(0);
    for (let turn = 0; turn < 13; turn++) {
      expect(g.turn).toBe(0);
      expect(g.over).toBe(false);
      g = act(g, rollAction(0), roll)!;
      g = act(
        g,
        g.cards[0].boxes.findIndex((b, i) => b === null && canScore(g.cards[0], i, g.dice)),
        roll,
      )!;
    }
    expect(g.over).toBe(true);
    expect(g.actions).toHaveLength(26);
    expect(g.cards[0].boxes.every((b) => b !== null)).toBe(true);
    expect(g.cards[1].boxes.every((b) => b === null)).toBe(true);
    expect(g.winner).toBeNull();
    expect(g.draw).toBe(false);
    expect(act(g, rollAction(0), roll)).toBeNull();
    expect(replay(0, g.actions, roll, 1)).toEqual(g);
  });

  it("returns null when an action in the list is illegal", () => {
    expect(replay(0, [CHANCE], rolls([]))).toBeNull();
    expect(replay(0, [rollAction(0)], rolls([[0, 1, 2, 3, 4]]))).toBeNull();
    expect(replay(0, [rollAction(0)], rolls([]))).toBeNull();
  });
});

describe("dice", () => {
  it("matches the ChaCha20 block test vector", () => {
    // RFC 8439, section 2.3.2.
    const key = [
      0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, 0x13121110, 0x17161514, 0x1b1a1918, 0x1f1e1d1c,
    ];
    const out = chacha20(key, 1, [0x09000000, 0x4a000000, 0x00000000]);
    expect([...out.slice(0, 4)]).toEqual([0xe4e7f110, 0x15593bd1, 0x1fdd0f50, 0xc47120a3]);
    expect(out[15]).toBe(0x4e3c50a2);
  });

  it("rolls the same faces for the same seed and roll, and fair ones overall", () => {
    const seed = newSeed();
    expect(isSeed(seed)).toBe(true);
    expect(faces(seed, 7)).toEqual(faces(seed, 7));
    const tally = [0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < 6000; k++) for (const f of faces(seed, k)) tally[f]!++;
    for (let f = 1; f <= 6; f++) expect(Math.abs(tally[f]! - 5000)).toBeLessThan(300);
    expect(tally[0]).toBe(0);
  });

  it("checks a seed's shape", () => {
    expect(isSeed([1, 2, 3, 4, 5, 6, 7, 8])).toBe(true);
    for (const junk of [null, 5, [1, 2, 3], [1, 2, 3, 4, 5, 6, 7, -1], [1, 2, 3, 4, 5, 6, 7, 2 ** 32], "x"]) {
      expect(isSeed(junk)).toBe(false);
    }
  });
});
