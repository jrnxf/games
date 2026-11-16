import { describe, expect, it } from "vitest";
import {
  CELLS,
  DECKS,
  FLEET,
  afloat,
  at,
  canFire,
  canFireAt,
  cellsOf,
  fire,
  fits,
  hits,
  newBoard,
  randomFleet,
  replay,
  shipAt,
  validFleet,
  type Board,
  type Fleet,
  type Seat,
} from "../../src/games/sea-battle/core/board.ts";
import { rng } from "../../src/games/connect-four/core/ai.ts";
import { COLUMNS, ROWS, decks, rout } from "./sea-battle-games.ts";

/** Seat 0 hides `ROWS` and seat 1 hides `COLUMNS`. */
const game = (shots: number[], starter: Seat = 0): Board => {
  const b = replay(starter, [ROWS, COLUMNS], shots);
  if (!b) throw new Error(`illegal shots ${shots.join(",")}`);
  return b;
};

const moved = (fleet: Fleet, i: number, ship: Partial<Fleet[number]>): Fleet =>
  fleet.map((s, k) => (k === i ? { ...s, ...ship } : s));

describe("sea battle fleet", () => {
  it("has ships of 5, 4, 3, 3 and 2 cells: 17 in all", () => {
    expect(FLEET).toEqual([5, 4, 3, 3, 2]);
    expect(DECKS).toBe(17);
    expect(CELLS).toBe(100);
  });

  it("lists a ship's cells from its left end along a row, or its top end down a column", () => {
    expect(cellsOf({ cell: at(2, 3), len: 4, down: false })).toEqual([23, 24, 25, 26]);
    expect(cellsOf({ cell: at(2, 3), len: 3, down: true })).toEqual([23, 33, 43]);
  });

  it("keeps a ship on the grid: no wrap past the right edge, no run past the bottom", () => {
    expect(fits({ cell: at(0, 5), len: 5, down: false })).toBe(true);
    expect(fits({ cell: at(0, 6), len: 5, down: false })).toBe(false);
    expect(fits({ cell: at(5, 9), len: 5, down: true })).toBe(true);
    expect(fits({ cell: at(6, 9), len: 5, down: true })).toBe(false);
    expect(fits({ cell: at(9, 9), len: 2, down: false })).toBe(false);
    expect(fits({ cell: -1, len: 2, down: false })).toBe(false);
    expect(fits({ cell: CELLS, len: 2, down: true })).toBe(false);
    expect(fits({ cell: 1.5, len: 2, down: false })).toBe(false);
    expect(fits({ cell: 0, len: 0, down: false })).toBe(false);
  });

  it("finds the ship on a cell, and open water", () => {
    expect(shipAt(ROWS, at(0, 4))).toBe(0);
    expect(shipAt(ROWS, at(0, 5))).toBe(-1);
    expect(shipAt(ROWS, at(8, 1))).toBe(4);
    expect(shipAt(COLUMNS, at(3, 7))).toBe(1);
    expect(shipAt(COLUMNS, at(4, 7))).toBe(-1);
  });

  it("accepts a legal fleet, ships that touch included", () => {
    expect(validFleet(ROWS)).toBe(true);
    expect(validFleet(COLUMNS)).toBe(true);
    // The 4 lies right under the 5.
    expect(validFleet(moved(ROWS, 1, { cell: at(1, 0) }))).toBe(true);
  });

  it("refuses ships that overlap, leave the grid, or are the wrong fleet", () => {
    // The 4 crosses the 5.
    expect(validFleet(moved(ROWS, 1, { cell: at(0, 2), down: true }))).toBe(false);
    expect(validFleet(moved(ROWS, 0, { cell: at(0, 6) }))).toBe(false);
    expect(validFleet(moved(ROWS, 4, { cell: at(9, 5), down: true }))).toBe(false);
    expect(validFleet(ROWS.slice(0, 4))).toBe(false);
    expect(validFleet([...ROWS, { cell: at(9, 0), len: 2, down: false }])).toBe(false);
    expect(validFleet(moved(ROWS, 4, { len: 3 }))).toBe(false);
    // The right ships in the wrong order.
    expect(validFleet([ROWS[1]!, ROWS[0]!, ROWS[2]!, ROWS[3]!, ROWS[4]!])).toBe(false);
    expect(validFleet(moved(ROWS, 2, { cell: 40.5 }))).toBe(false);
    expect(validFleet(moved(ROWS, 2, { down: 1 as unknown as boolean }))).toBe(false);
  });

  it("lays out a legal random fleet for every seed, the same one for the same seed", () => {
    const seen = new Set<string>();
    let down = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const fleet = randomFleet(rng(seed));
      expect(validFleet(fleet)).toBe(true);
      expect(new Set(decks(fleet)).size).toBe(DECKS);
      expect(randomFleet(rng(seed))).toEqual(fleet);
      seen.add(JSON.stringify(fleet));
      down += fleet.filter((ship) => ship.down).length;
    }
    expect(seen.size).toBeGreaterThan(295);
    // Rows and columns come up about as often as each other.
    expect(down).toBeGreaterThan(600);
    expect(down).toBeLessThan(900);
  });

  it("reaches every cell of the grid with random fleets", () => {
    const used = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) for (const cell of decks(randomFleet(rng(seed)))) used.add(cell);
    expect(used.size).toBe(CELLS);
  });
});

describe("sea battle board", () => {
  it("starts with open water, nothing known, and the starter to fire", () => {
    const b = newBoard(0, [ROWS, COLUMNS]);
    expect(b.turn).toBe(0);
    expect(b.shots).toEqual([]);
    expect(b.last).toBeNull();
    expect(b.over).toBe(false);
    expect(b.winner).toBeNull();
    for (const seat of [0, 1] as const) {
      expect(b.seen[seat].marks).toHaveLength(CELLS);
      expect(b.seen[seat].marks.every((m) => m === null)).toBe(true);
      expect(b.seen[seat].sunk).toEqual([]);
      expect(afloat(b.seen[seat])).toEqual([5, 4, 3, 3, 2]);
    }
    expect(newBoard(1, [ROWS, COLUMNS]).turn).toBe(1);
  });

  it("marks a miss on the shooter's sight and passes the turn", () => {
    const b = game([at(0, 0)]);
    expect(b.last).toEqual({ cell: 0, hit: false, sunk: null });
    expect(b.seen[0].marks[0]).toBe("miss");
    expect(b.seen[1].marks[0]).toBeNull();
    expect(b.turn).toBe(1);
    expect(b.shots).toEqual([0]);
  });

  it("marks a hit, and a hit gives no extra shot", () => {
    const b = game([at(0, 9)]);
    expect(b.last).toEqual({ cell: 9, hit: true, sunk: null });
    expect(b.seen[0].marks[9]).toBe("hit");
    expect(hits(b, 0)).toBe(1);
    expect(hits(b, 1)).toBe(0);
    expect(b.turn).toBe(1);
  });

  it("fires each player's shots at the other's water", () => {
    // Cell 0 is water for seat 1's fleet and a ship of seat 0's.
    const b = game([at(0, 0), at(0, 0)]);
    expect(b.seen[0].marks[0]).toBe("miss");
    expect(b.seen[1].marks[0]).toBe("hit");
    expect(b.turn).toBe(0);
  });

  it("sinks a ship when its last cell is hit, and shows where it lay", () => {
    // Seat 0 hits the two cells of the 2 in column 1. Seat 1 misses in between.
    const first = game([at(0, 1), at(9, 0)]);
    expect(first.seen[0].sunk).toEqual([]);
    const b = game([at(0, 1), at(9, 0), at(1, 1)]);
    expect(b.last).toEqual({ cell: 11, hit: true, sunk: COLUMNS[4] });
    expect(b.seen[0].sunk).toEqual([COLUMNS[4]]);
    expect(b.seen[0].marks[1]).toBe("hit");
    expect(b.seen[0].marks[11]).toBe("hit");
    expect(afloat(b.seen[0])).toEqual([5, 4, 3, 3]);
    expect(afloat(b.seen[1])).toEqual([5, 4, 3, 3, 2]);
    expect(b.over).toBe(false);
  });

  it("keeps the other 3 afloat when one 3 sinks", () => {
    const three = cellsOf(COLUMNS[2]!);
    const b = game([three[0]!, at(9, 0), three[1]!, at(9, 1), three[2]!]);
    expect(b.last?.sunk).toEqual(COLUMNS[2]);
    expect(afloat(b.seen[0])).toEqual([5, 4, 3, 2]);
  });

  it("refuses a shot off the grid or at a cell already fired at", () => {
    const b = game([at(0, 0), at(5, 5)]);
    expect(canFire(b, at(0, 0))).toBe(false);
    expect(fire(b, at(0, 0))).toBeNull();
    // The other player's shot at (5,5) does not take that cell from this one.
    expect(canFire(b, at(5, 5))).toBe(true);
    for (const cell of [-1, CELLS, 2.5, NaN]) {
      expect(canFire(b, cell)).toBe(false);
      expect(fire(b, cell)).toBeNull();
    }
    expect(canFireAt(b.seen[0], at(0, 0))).toBe(false);
    expect(canFireAt(b.seen[1], at(0, 0))).toBe(true);
  });

  it("does not change the board it is given", () => {
    const b = game([at(0, 9)]);
    const copy = JSON.parse(JSON.stringify(b)) as Board;
    fire(b, at(0, 0));
    expect(b).toEqual(copy);
  });

  it("ends when the last ship sinks: the shooter wins and keeps the turn", () => {
    const shots = rout(COLUMNS);
    expect(shots).toHaveLength(DECKS * 2 - 1);
    const before = game(shots.slice(0, -1));
    expect(before.over).toBe(false);
    expect(afloat(before.seen[0])).toEqual([2]);
    const b = game(shots);
    expect(b.over).toBe(true);
    expect(b.winner).toBe(0);
    expect(b.turn).toBe(0);
    expect(b.last?.sunk).toEqual(COLUMNS[4]);
    expect(b.seen[0].sunk).toEqual(COLUMNS);
    expect(afloat(b.seen[0])).toEqual([]);
    expect(hits(b, 0)).toBe(DECKS);
    expect(hits(b, 1)).toBe(0);
    expect(canFire(b, at(9, 9))).toBe(false);
    expect(fire(b, at(9, 9))).toBeNull();
  });

  it("lets the second player win too", () => {
    // Seat 1 starts and sinks seat 0's rows. Seat 0 answers along rows 9 and 7, open water for the columns below row 4.
    const b = replay(1, [ROWS, COLUMNS], rout(ROWS));
    expect(b?.over).toBe(true);
    expect(b?.winner).toBe(1);
    expect(b?.seen[1].sunk).toEqual(ROWS);
    expect(hits(b!, 0)).toBe(0);
  });

  it("replays a game to the same board, and refuses an illegal one", () => {
    const shots = rout(COLUMNS).slice(0, 12);
    let b = newBoard(0, [ROWS, COLUMNS]);
    for (const cell of shots) b = fire(b, cell)!;
    expect(replay(0, [ROWS, COLUMNS], shots)).toEqual(b);
    expect(replay(0, [ROWS, COLUMNS], [at(0, 0), at(1, 1), at(0, 0)])).toBeNull();
    expect(replay(0, [ROWS, COLUMNS], [...rout(COLUMNS), at(9, 9)])).toBeNull();
    expect(replay(0, [ROWS.slice(0, 4), COLUMNS], [])).toBeNull();
    expect(
      replay(0, [ROWS, [...COLUMNS.slice(0, 4), { cell: at(0, 9), len: 2, down: true }]], []),
    ).toBeNull();
  });

  it("keeps a sight free of the ships still afloat", () => {
    // Three hits on the 5 and a sunk 2: the sight names the 2 and nothing else.
    const five = cellsOf(COLUMNS[0]!);
    const b = game([
      five[0]!,
      at(9, 0),
      five[1]!,
      at(9, 1),
      five[2]!,
      at(9, 2),
      at(0, 1),
      at(9, 3),
      at(1, 1),
    ]);
    const sight = b.seen[0];
    expect(Object.keys(sight).sort()).toEqual(["marks", "sunk"]);
    expect(sight.sunk).toEqual([COLUMNS[4]]);
    expect(sight.marks.filter((m) => m === "hit")).toHaveLength(5);
    expect(sight.marks.filter((m) => m === "miss")).toHaveLength(0);
    // The same shots at another fleet with the same hits give the same sight.
    const twin: Fleet = [
      COLUMNS[0]!,
      { cell: at(9, 2), len: 4, down: false },
      { cell: at(7, 2), len: 3, down: false },
      { cell: at(5, 2), len: 3, down: false },
      COLUMNS[4]!,
    ];
    expect(validFleet(twin)).toBe(true);
    expect(replay(0, [ROWS, twin], b.shots)?.seen[0]).toEqual(sight);
  });

  it("plays random games to the end in at most 199 shots, with one winner", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed);
      let b = newBoard((seed % 2) as Seat, [randomFleet(rand), randomFleet(rand)]);
      while (!b.over) {
        const open = b.seen[b.turn].marks.flatMap((m, cell) => (m === null ? [cell] : []));
        b = fire(b, open[Math.floor(rand() * open.length)]!)!;
      }
      expect(b.shots.length).toBeLessThanOrEqual(CELLS * 2 - 1);
      expect(hits(b, b.winner!)).toBe(DECKS);
      expect(hits(b, (1 - b.winner!) as Seat)).toBeLessThan(DECKS);
      expect(replay(b.starter, b.fleets, b.shots)).toEqual(b);
    }
  });
});
