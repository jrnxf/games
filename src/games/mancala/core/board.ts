// Mancala rules with no DOM, the common Kalah game: six pits a side with four
// seeds each, and a store at each player's right hand. A turn lifts every
// seed from one of the mover's pits and sows them anticlockwise, one a hole,
// past the mover's own store and never into the other one. A last seed in the
// mover's store gives another turn. A last seed in an empty pit of the mover
// captures it and the seeds opposite. When one side is empty, the seeds left
// on the other side go to that side's owner, and the most seeds wins. A game
// is its starting seat plus the list of pits played, so it saves and replays
// exactly.

/** Pits per side. */
export const PITS = 6;
/** Seeds in each pit at the start. */
export const SEEDS = 4;
/** Holes around the board: each side's pits, then its store. */
export const HOLES = (PITS + 1) * 2;
/** Every seed in the game. */
export const TOTAL = PITS * SEEDS * 2;

export type Seat = 0 | 1;

export interface Board {
  /**
   * Seeds in each hole, in sowing order: seat 0's pits from its left to its
   * right, seat 0's store, then seat 1's pits and store the same way (see
   * `hole` and `store`).
   */
  holes: number[];
  starter: Seat;
  /** Pits played, in order, each counted 0 to 5 from its mover's left. */
  moves: number[];
  turn: Seat;
  /** True when the last seed fell in the mover's store, so the mover plays again. */
  again: boolean;
  /** Seeds the last move captured, its own last seed included. 0 for none. */
  captured: number;
  /** Seeds the end of the game swept from each side's pits to its store. */
  swept: [number, number];
  /** One side's pits are empty. */
  over: boolean;
  /** The seat with the most seeds when the game is over. Null during play and for a draw. */
  winner: Seat | null;
  /** The game is over at 24 seeds each. */
  draw: boolean;
}

/** The hole of `seat`'s pit `pit`, counted 0 to 5 from that player's left. */
export const hole = (seat: Seat, pit: number) => seat * (PITS + 1) + pit;

/** The hole of `seat`'s store. */
export const store = (seat: Seat) => seat * (PITS + 1) + PITS;

/** The pit across the board from the pit at `h`. */
export const opposite = (h: number) => 2 * PITS - h;

/** Who owns the pit or store at `h`. */
export const owner = (h: number) => (h <= PITS ? 0 : 1) as Seat;

const other = (seat: Seat) => (1 - seat) as Seat;

export function newBoard(starter: Seat = 0): Board {
  const holes = Array<number>(HOLES).fill(SEEDS);
  holes[store(0)] = 0;
  holes[store(1)] = 0;
  return {
    holes,
    starter,
    moves: [],
    turn: starter,
    again: false,
    captured: 0,
    swept: [0, 0],
    over: false,
    winner: null,
    draw: false,
  };
}

/** Seeds in `seat`'s store. */
export const score = (b: Board, seat: Seat) => b.holes[store(seat)]!;

/** Seeds in `seat`'s six pits. */
export function inPits(holes: readonly number[], seat: Seat): number {
  let n = 0;
  for (let pit = 0; pit < PITS; pit++) n += holes[hole(seat, pit)]!;
  return n;
}

export const canPlay = (b: Board, pit: number) =>
  !b.over && Number.isInteger(pit) && pit >= 0 && pit < PITS && b.holes[hole(b.turn, pit)]! > 0;

/** The pits the player on turn may play: the ones with seeds. Empty when the game is over. */
export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let pit = 0; pit < PITS; pit++) if (canPlay(b, pit)) out.push(pit);
  return out;
}

/**
 * The hole each seed from the mover's `pit` falls in, in order. It skips the
 * other player's store. Empty for an illegal move.
 */
export function sowing(b: Board, pit: number): number[] {
  if (!canPlay(b, pit)) return [];
  const skip = store(other(b.turn));
  const path: number[] = [];
  let h = hole(b.turn, pit);
  for (let n = b.holes[h]!; n > 0; n--) {
    h = (h + 1) % HOLES;
    if (h === skip) h = (h + 1) % HOLES;
    path.push(h);
  }
  return path;
}

/** Plays the current player's `pit`. Returns the new board, or null for an illegal move. */
export function play(b: Board, pit: number): Board | null {
  const path = sowing(b, pit);
  if (path.length === 0) return null;
  const me = b.turn;
  const holes = b.holes.slice();
  holes[hole(me, pit)] = 0;
  for (const h of path) holes[h]!++;
  const last = path[path.length - 1]!;
  let captured = 0;
  // A capture needs seeds across the board: a lone seed opposite an empty pit stays.
  if (last !== store(me) && owner(last) === me && holes[last] === 1 && holes[opposite(last)]! > 0) {
    captured = 1 + holes[opposite(last)]!;
    holes[last] = 0;
    holes[opposite(last)] = 0;
    holes[store(me)]! += captured;
  }
  const swept: [number, number] = [0, 0];
  const over = inPits(holes, 0) === 0 || inPits(holes, 1) === 0;
  if (over) {
    for (const seat of [0, 1] as const) {
      swept[seat] = inPits(holes, seat);
      for (let i = 0; i < PITS; i++) holes[hole(seat, i)] = 0;
      holes[store(seat)]! += swept[seat];
    }
  }
  const again = last === store(me);
  const mine = holes[store(me)]!;
  const theirs = holes[store(other(me))]!;
  return {
    holes,
    starter: b.starter,
    moves: [...b.moves, pit],
    turn: again ? me : other(me),
    again: again && !over,
    captured,
    swept,
    over,
    winner: !over || mine === theirs ? null : mine > theirs ? me : other(me),
    draw: over && mine === theirs,
  };
}

/** Rebuilds a game from its starter and moves. Returns null if any move is illegal. */
export function replay(starter: Seat, moves: readonly number[]): Board | null {
  let b: Board | null = newBoard(starter);
  for (const pit of moves) {
    b = play(b, pit);
    if (!b) return null;
  }
  return b;
}
