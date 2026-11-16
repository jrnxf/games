// Reversi rules with no DOM: an 8x8 board, a move must outflank at least one
// of the other player's discs, and every outflanked disc flips. A player with
// no legal move passes, and the game ends when neither player can move. A game
// is its starting seat plus the list of cells played, so it saves and replays
// exactly. A pass is never stored: the rules imply it.

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

export type Seat = 0 | 1;
export type Cell = Seat | null;

export interface Board {
  /** Row-major, row 0 at the top. */
  cells: Cell[];
  starter: Seat;
  /** Cells played, in order. */
  moves: number[];
  turn: Seat;
  /** True when the last move left the other player with no move, so the mover plays again. */
  passed: boolean;
  /** Neither player can move. */
  over: boolean;
  /** The seat with the most discs when the game is over. Null during play, and for a draw. */
  winner: Seat | null;
  draw: boolean;
}

export const at = (row: number, col: number) => row * SIZE + col;

const other = (seat: Seat) => (1 - seat) as Seat;

/** The starter holds the same two centre cells in every game, so the first move is always the same shape. */
export function newBoard(starter: Seat = 0): Board {
  const cells = Array<Cell>(CELLS).fill(null);
  cells[at(3, 4)] = cells[at(4, 3)] = starter;
  cells[at(3, 3)] = cells[at(4, 4)] = other(starter);
  return { cells, starter, moves: [], turn: starter, passed: false, over: false, winner: null, draw: false };
}

const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

/** The cells that flip when `seat` plays on `cell`. Empty when the move is illegal. */
export function flips(cells: readonly Cell[], cell: number, seat: Seat): number[] {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || cells[cell] !== null) return [];
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const run: number[] = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[at(r, c)] === other(seat)) {
      run.push(at(r, c));
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[at(r, c)] === seat) out.push(...run);
  }
  return out;
}

/** Every cell `seat` may play on, in board order. */
export function movesFor(cells: readonly Cell[], seat: Seat): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (flips(cells, i, seat).length) out.push(i);
  return out;
}

/** The current player's legal moves. Empty when the game is over. */
export const legalMoves = (b: Board) => (b.over ? [] : movesFor(b.cells, b.turn));

export const canPlay = (b: Board, cell: number) => !b.over && flips(b.cells, cell, b.turn).length > 0;

/** Discs on the board for each seat. */
export function count(cells: readonly Cell[]): [number, number] {
  const n: [number, number] = [0, 0];
  for (const c of cells) if (c !== null) n[c]++;
  return n;
}

/** Plays the current player's disc on `cell`. Returns the new board, or null for an illegal move. */
export function play(b: Board, cell: number): Board | null {
  if (b.over) return null;
  const flipped = flips(b.cells, cell, b.turn);
  if (!flipped.length) return null;
  const cells = b.cells.slice();
  cells[cell] = b.turn;
  for (const i of flipped) cells[i] = b.turn;
  const next = other(b.turn);
  const passed = movesFor(cells, next).length === 0;
  const over = passed && movesFor(cells, b.turn).length === 0;
  const [mine, theirs] = [count(cells)[b.turn], count(cells)[next]];
  return {
    cells,
    starter: b.starter,
    moves: [...b.moves, cell],
    turn: passed ? b.turn : next,
    passed: passed && !over,
    over,
    winner: !over || mine === theirs ? null : mine > theirs ? b.turn : next,
    draw: over && mine === theirs,
  };
}

/** Rebuilds a game from its starter and moves. Returns null if any move is illegal. */
export function replay(starter: Seat, moves: readonly number[]): Board | null {
  let b: Board | null = newBoard(starter);
  for (const cell of moves) {
    b = play(b, cell);
    if (!b) return null;
  }
  return b;
}
