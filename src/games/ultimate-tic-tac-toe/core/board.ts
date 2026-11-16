// Ultimate Tic-Tac-Toe rules with no DOM: a 3x3 grid of small 3x3 boards. A
// mark sends the other player to the small board in the same place as the
// spot just played. When that board is won or full, they may play in any open
// board. Three small boards in a row win the game, and a small board that is
// full and not won counts for nobody. A game is its starting seat plus the
// list of cells played, so it saves and replays exactly.

export const BOARDS = 9;
export const SPOTS = 9;
export const CELLS = BOARDS * SPOTS;

export type Seat = 0 | 1;
export type Cell = Seat | null;

export interface Board {
  /** Nine cells per small board, small board 0 first. Boards and spots are both row-major, 0 at the top left. */
  cells: Cell[];
  /** The seat that won each small board. Null for a board still in play, and for a full board nobody won. */
  won: Cell[];
  starter: Seat;
  /** Cells played, in order. */
  moves: number[];
  turn: Seat;
  /** The small board the player on turn must play in. Null when they may play in any open board. */
  target: number | null;
  winner: Seat | null;
  /** The three small boards of the winning line, when there is one. */
  line: number[];
  draw: boolean;
}

/** The cell at `spot` of small board `board`. */
export const at = (board: number, spot: number) => board * SPOTS + spot;

export const boardOf = (cell: number) => Math.floor(cell / SPOTS);
export const spotOf = (cell: number) => cell % SPOTS;

export function newBoard(starter: Seat = 0): Board {
  return {
    cells: Array<Cell>(CELLS).fill(null),
    won: Array<Cell>(BOARDS).fill(null),
    starter,
    moves: [],
    turn: starter,
    target: null,
    winner: null,
    line: [],
    draw: false,
  };
}

export const isOver = (b: Board) => b.winner !== null || b.draw;

/** The eight lines of a 3x3 grid. They serve a small board's spots and the grid of small boards. */
export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

/** The first line of nine marks that `seat` holds, or an empty list. `from` is where the nine start in `marks`. */
export function lineOf(marks: readonly Cell[], seat: Seat, from = 0): number[] {
  for (const line of LINES) if (line.every((i) => marks[from + i] === seat)) return [...line];
  return [];
}

/** True when small board `board` has no empty spot. */
export function isFull(cells: readonly Cell[], board: number): boolean {
  for (let s = 0; s < SPOTS; s++) if (cells[at(board, s)] === null) return false;
  return true;
}

/** A small board is open while nobody won it and it has an empty spot. */
export const isOpen = (b: Board, board: number) => b.won[board] === null && !isFull(b.cells, board);

/** The small boards the player on turn may play in, in board order. Empty when the game is over. */
export function openBoards(b: Board): number[] {
  if (isOver(b)) return [];
  if (b.target !== null) return [b.target];
  const out: number[] = [];
  for (let i = 0; i < BOARDS; i++) if (isOpen(b, i)) out.push(i);
  return out;
}

export function canPlay(b: Board, cell: number): boolean {
  if (isOver(b) || !Number.isInteger(cell) || cell < 0 || cell >= CELLS || b.cells[cell] !== null)
    return false;
  const board = boardOf(cell);
  return b.target === null ? isOpen(b, board) : b.target === board;
}

/** The current player's legal moves, in cell order. Empty when the game is over. */
export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (const board of openBoards(b)) {
    for (let s = 0; s < SPOTS; s++) if (b.cells[at(board, s)] === null) out.push(at(board, s));
  }
  return out;
}

/** Small boards won by each seat. */
export function count(won: readonly Cell[]): [number, number] {
  const n: [number, number] = [0, 0];
  for (const w of won) if (w !== null) n[w]++;
  return n;
}

/** Plays the current player's mark on `cell`. Returns the new board, or null for an illegal move. */
export function play(b: Board, cell: number): Board | null {
  if (!canPlay(b, cell)) return null;
  const board = boardOf(cell);
  const cells = b.cells.slice();
  cells[cell] = b.turn;
  const won = b.won.slice();
  if (lineOf(cells, b.turn, at(board, 0)).length) won[board] = b.turn;
  const line = won[board] === null ? [] : lineOf(won, b.turn);
  const winner = line.length ? b.turn : null;
  const open = (i: number) => won[i] === null && !isFull(cells, i);
  const next = spotOf(cell);
  let anyOpen = false;
  for (let i = 0; i < BOARDS; i++) anyOpen ||= open(i);
  return {
    cells,
    won,
    starter: b.starter,
    moves: [...b.moves, cell],
    turn: winner === null ? ((1 - b.turn) as Seat) : b.turn,
    target: winner === null && open(next) ? next : null,
    winner,
    line,
    draw: winner === null && !anyOpen,
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
