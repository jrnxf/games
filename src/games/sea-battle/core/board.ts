// Sea Battle rules with no DOM: each player hides a fleet of five ships (5, 4,
// 3, 3 and 2 cells) on their own 10x10 water. Ships lie in a row or a column,
// stay on the grid and never overlap, but they may touch. The players take
// turns firing one shot at the other's water: a hit or a miss, and a ship
// sinks when its last cell is hit. A hit gives no extra shot. The first player
// to sink the whole fleet wins, so there is no draw. A game is its starting
// seat, the two fleets and the list of cells fired at, so it saves and replays
// exactly.
//
// The fleets are hidden information. `Sight` is all a player may know of the
// other's water, and the computer and the online phones get nothing more.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
/** The length of each ship, in the order a fleet lists them. */
export const FLEET = [5, 4, 3, 3, 2] as const;
/** Ship cells in a fleet: the hits that win a game. */
export const DECKS = FLEET.reduce<number>((a, n) => a + n, 0);

export type Seat = 0 | 1;

export interface Ship {
  /** The ship's top or left end. */
  cell: number;
  len: number;
  /** True when the ship runs down a column, false along a row. */
  down: boolean;
}

/** One ship per length in `FLEET`, in that order. */
export type Fleet = Ship[];

export type Mark = "hit" | "miss" | null;

/** What a player knows of the other's water: the shots fired there and the ships they sank. */
export interface Sight {
  /** Row-major, row 0 at the top. A sunk ship's cells stay "hit". */
  marks: Mark[];
  /** The ships sunk so far, in the order they sank. Only a sunk ship shows where it lay. */
  sunk: Ship[];
}

/** One shot and what it did. */
export interface Shot {
  cell: number;
  hit: boolean;
  /** The ship this shot sank, or null. */
  sunk: Ship | null;
}

export interface Board {
  /** Each seat's own fleet. */
  fleets: [Fleet, Fleet];
  starter: Seat;
  /** Cells fired at, in order. The players alternate, so shot `i` is the starter's when `i` is even. */
  shots: number[];
  turn: Seat;
  /** `seen[seat]` is what `seat` knows of the other's water. */
  seen: [Sight, Sight];
  /** The last shot, by the player who is not on turn now. Null before the first shot. */
  last: Shot | null;
  /** One fleet is sunk. */
  over: boolean;
  /** The seat that sank the other's fleet. Null during play. */
  winner: Seat | null;
}

export const at = (row: number, col: number) => row * SIZE + col;

const other = (seat: Seat) => (1 - seat) as Seat;

const isCell = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < CELLS;

/** True when the whole ship lies on the grid. */
export function fits(ship: Ship): boolean {
  if (!isCell(ship.cell) || !Number.isInteger(ship.len) || ship.len < 1) return false;
  const start = ship.down ? Math.floor(ship.cell / SIZE) : ship.cell % SIZE;
  return start + ship.len <= SIZE;
}

/** The cells a ship covers, from its top or left end. The ship must fit. */
export function cellsOf(ship: Ship): number[] {
  const step = ship.down ? SIZE : 1;
  return Array.from({ length: ship.len }, (_, i) => ship.cell + i * step);
}

/** The index in `fleet` of the ship that covers `cell`, or -1 for open water. */
export function shipAt(fleet: Fleet, cell: number): number {
  return fleet.findIndex((ship) => cellsOf(ship).includes(cell));
}

/** True when `fleet` has every ship of `FLEET` in order, each on the grid, and no two overlap. */
export function validFleet(fleet: Fleet): boolean {
  if (fleet.length !== FLEET.length) return false;
  const taken = new Set<number>();
  for (let i = 0; i < FLEET.length; i++) {
    const ship = fleet[i]!;
    if (ship.len !== FLEET[i] || typeof ship.down !== "boolean" || !fits(ship)) return false;
    for (const cell of cellsOf(ship)) {
      if (taken.has(cell)) return false;
      taken.add(cell);
    }
  }
  return true;
}

/** A legal fleet laid out by `rand`, a source of numbers from 0 up to 1. Every legal layout can come up. */
export function randomFleet(rand: () => number): Fleet {
  const fleet: Fleet = [];
  const taken = new Set<number>();
  for (const len of FLEET) {
    for (;;) {
      const ship: Ship = { cell: Math.floor(rand() * CELLS), len, down: rand() < 0.5 };
      if (!fits(ship)) continue;
      const cells = cellsOf(ship);
      if (cells.some((cell) => taken.has(cell))) continue;
      for (const cell of cells) taken.add(cell);
      fleet.push(ship);
      break;
    }
  }
  return fleet;
}

const newSight = (): Sight => ({ marks: Array<Mark>(CELLS).fill(null), sunk: [] });

/** A game ready for its first shot. Both fleets must be valid. */
export function newBoard(starter: Seat, fleets: [Fleet, Fleet]): Board {
  return {
    fleets,
    starter,
    shots: [],
    turn: starter,
    seen: [newSight(), newSight()],
    last: null,
    over: false,
    winner: null,
  };
}

/** True when a player with this sight may fire at `cell`: on the grid and not fired at before. */
export const canFireAt = (sight: Sight, cell: number) => isCell(cell) && sight.marks[cell] === null;

export const canFire = (b: Board, cell: number) => !b.over && canFireAt(b.seen[b.turn], cell);

/** The lengths of the ships a player with this sight has not sunk yet, longest first. */
export function afloat(sight: Sight): number[] {
  const left: number[] = [...FLEET];
  for (const ship of sight.sunk) left.splice(left.indexOf(ship.len), 1);
  return left;
}

/** How many of `seat`'s shots hit. */
export const hits = (b: Board, seat: Seat) =>
  b.seen[seat].marks.reduce((n, m) => n + (m === "hit" ? 1 : 0), 0);

/** The current player fires at `cell`. Returns the new board, or null for an illegal shot. */
export function fire(b: Board, cell: number): Board | null {
  if (!canFire(b, cell)) return null;
  const me = b.turn;
  const fleet = b.fleets[other(me)];
  const marks = b.seen[me].marks.slice();
  let sunk = b.seen[me].sunk;
  const ship = fleet[shipAt(fleet, cell)] ?? null;
  marks[cell] = ship ? "hit" : "miss";
  const down = ship !== null && cellsOf(ship).every((c) => marks[c] === "hit");
  if (down) sunk = [...sunk, ship];
  const seen: [Sight, Sight] = [b.seen[0], b.seen[1]];
  seen[me] = { marks, sunk };
  const over = sunk.length === FLEET.length;
  return {
    fleets: b.fleets,
    starter: b.starter,
    shots: [...b.shots, cell],
    turn: over ? me : other(me),
    seen,
    last: { cell, hit: ship !== null, sunk: down ? ship : null },
    over,
    winner: over ? me : null,
  };
}

/** Rebuilds a game from its starter, fleets and shots. Returns null if a fleet or any shot is illegal. */
export function replay(starter: Seat, fleets: [Fleet, Fleet], shots: readonly number[]): Board | null {
  if (!validFleet(fleets[0]) || !validFleet(fleets[1])) return null;
  let b: Board | null = newBoard(starter, fleets);
  for (const cell of shots) {
    b = fire(b, cell);
    if (!b) return null;
  }
  return b;
}
