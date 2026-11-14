// Connect Four rules with no DOM: a 7x6 board, chips fall to the lowest free
// row, and four in a row in any direction wins. A game is its starting seat
// plus the list of columns played, so it saves and replays exactly.

export const COLS = 7;
export const ROWS = 6;

export type Seat = 0 | 1;
export type Cell = Seat | null;

export interface Board {
  /** Row-major, row 0 at the top. */
  cells: Cell[];
  starter: Seat;
  /** Columns played, in order. */
  moves: number[];
  turn: Seat;
  winner: Seat | null;
  /** Cell indexes of the winning line, when there is one. */
  line: number[];
  draw: boolean;
}

export const at = (row: number, col: number) => row * COLS + col;

export function newBoard(starter: Seat = 0): Board {
  return {
    cells: Array<Cell>(ROWS * COLS).fill(null),
    starter,
    moves: [],
    turn: starter,
    winner: null,
    line: [],
    draw: false,
  };
}

export const isOver = (b: Board) => b.winner !== null || b.draw;

/** The row a chip dropped in `col` lands on, or -1 when the column is full. */
export function landingRow(b: Board, col: number): number {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return -1;
  for (let r = ROWS - 1; r >= 0; r--) if (b.cells[at(r, col)] === null) return r;
  return -1;
}

export const canDrop = (b: Board, col: number) => !isOver(b) && landingRow(b, col) >= 0;

/** Drops the current player's chip in `col`. Returns the new board, or null for an illegal move. */
export function drop(b: Board, col: number): Board | null {
  if (!canDrop(b, col)) return null;
  const row = landingRow(b, col);
  const cells = b.cells.slice();
  cells[at(row, col)] = b.turn;
  const line = lineThrough(cells, row, col);
  const moves = [...b.moves, col];
  const winner = line.length ? b.turn : null;
  return {
    cells,
    starter: b.starter,
    moves,
    turn: winner === null ? ((1 - b.turn) as Seat) : b.turn,
    winner,
    line,
    draw: winner === null && moves.length === ROWS * COLS,
  };
}

/** Rebuilds a game from its starter and moves. Returns null if any move is illegal. */
export function replay(starter: Seat, moves: readonly number[]): Board | null {
  let b: Board | null = newBoard(starter);
  for (const col of moves) {
    b = drop(b, col);
    if (!b) return null;
  }
  return b;
}

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

/** The cells of a run of four or more through (row, col), longest direction first found. */
function lineThrough(cells: readonly Cell[], row: number, col: number): number[] {
  const me = cells[at(row, col)];
  for (const [dr, dc] of DIRS) {
    const line = [at(row, col)];
    for (const s of [1, -1]) {
      let r = row + dr * s;
      let c = col + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && cells[at(r, c)] === me) {
        line.push(at(r, c));
        r += dr * s;
        c += dc * s;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return [];
}
