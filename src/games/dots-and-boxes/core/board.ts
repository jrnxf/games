// Dots and Boxes rules with no DOM: a 5x5 grid of boxes on 6x6 dots. A turn
// draws one line between two neighbouring dots. A line that closes a box
// scores it and gives the mover another turn. The game ends when every line
// is drawn, and the most boxes wins. A game is its starting seat plus the
// list of lines drawn, so it saves and replays exactly.

/** Boxes per side. */
export const SIZE = 5;
export const BOXES = SIZE * SIZE;
/** Horizontal lines: one row above each row of boxes, and one below the last. */
const ACROSS = (SIZE + 1) * SIZE;
/** All lines: the horizontal ones first, then the vertical ones. */
export const LINES = ACROSS * 2;

export type Seat = 0 | 1;

export interface Board {
  /** Who drew each line, or null. Horizontal lines first (see `across`), then vertical (see `down`). */
  lines: (Seat | null)[];
  /** Who closed each box, or null. Row-major, row 0 at the top. */
  boxes: (Seat | null)[];
  starter: Seat;
  /** Lines drawn, in order. */
  moves: number[];
  turn: Seat;
  /** True when the last line closed a box, so the mover plays again. */
  again: boolean;
  /** Boxes closed by each seat. */
  score: [number, number];
  /** Every line is drawn. */
  over: boolean;
  /** The seat with the most boxes when the game is over. Null during play. 25 boxes can't split evenly, so there is no draw. */
  winner: Seat | null;
}

/** The box at `row`, `col`. */
export const at = (row: number, col: number) => row * SIZE + col;

/** The horizontal line from dot (`row`, `col`) to the dot on its right. Rows 0 to 5, columns 0 to 4. */
export const across = (row: number, col: number) => row * SIZE + col;

/** The vertical line from dot (`row`, `col`) to the dot below it. Rows 0 to 4, columns 0 to 5. */
export const down = (row: number, col: number) => ACROSS + row * (SIZE + 1) + col;

/** Where a line sits: its dot (`row`, `col`), and whether it runs right (`across`) or down from there. */
export function lineAt(line: number): { across: boolean; row: number; col: number } {
  if (line < ACROSS) return { across: true, row: Math.floor(line / SIZE), col: line % SIZE };
  const i = line - ACROSS;
  return { across: false, row: Math.floor(i / (SIZE + 1)), col: i % (SIZE + 1) };
}

/** The four lines around each box: top, bottom, left, right. */
export const BOX_LINES: readonly (readonly [number, number, number, number])[] = Array.from(
  { length: BOXES },
  (_, box) => {
    const row = Math.floor(box / SIZE);
    const col = box % SIZE;
    return [across(row, col), across(row + 1, col), down(row, col), down(row, col + 1)] as const;
  },
);

/** The one or two boxes each line touches. A line on the rim touches one. */
export const LINE_BOXES: readonly (readonly number[])[] = Array.from({ length: LINES }, (_, line) =>
  BOX_LINES.flatMap((sides, box) => (sides.includes(line) ? [box] : [])),
);

const other = (seat: Seat) => (1 - seat) as Seat;

export function newBoard(starter: Seat = 0): Board {
  return {
    lines: Array<Seat | null>(LINES).fill(null),
    boxes: Array<Seat | null>(BOXES).fill(null),
    starter,
    moves: [],
    turn: starter,
    again: false,
    score: [0, 0],
    over: false,
    winner: null,
  };
}

/** How many of a box's four lines are drawn. */
export function sides(lines: readonly (Seat | null)[], box: number): number {
  let n = 0;
  for (const line of BOX_LINES[box]!) if (lines[line] !== null) n++;
  return n;
}

/** The boxes that drawing `line` would close: none, one or two. */
export const closes = (lines: readonly (Seat | null)[], line: number): number[] =>
  LINE_BOXES[line]!.filter((box) => sides(lines, box) === 3);

export const canPlay = (b: Board, line: number) =>
  !b.over && Number.isInteger(line) && line >= 0 && line < LINES && b.lines[line] === null;

/** Every line not drawn yet, in line order. Empty when the game is over. */
export function legalMoves(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < LINES; i++) if (b.lines[i] === null) out.push(i);
  return out;
}

/** Draws `line` for the current player. Returns the new board, or null for an illegal move. */
export function play(b: Board, line: number): Board | null {
  if (!canPlay(b, line)) return null;
  const closed = closes(b.lines, line);
  const lines = b.lines.slice();
  lines[line] = b.turn;
  const boxes = b.boxes.slice();
  for (const box of closed) boxes[box] = b.turn;
  const score: [number, number] = [...b.score];
  score[b.turn] += closed.length;
  const moves = [...b.moves, line];
  const over = moves.length === LINES;
  const again = closed.length > 0;
  return {
    lines,
    boxes,
    starter: b.starter,
    moves,
    turn: again ? b.turn : other(b.turn),
    again: again && !over,
    score,
    over,
    winner: !over ? null : score[0] > score[1] ? 0 : 1,
  };
}

/** Rebuilds a game from its starter and moves. Returns null if any move is illegal. */
export function replay(starter: Seat, moves: readonly number[]): Board | null {
  let b: Board | null = newBoard(starter);
  for (const line of moves) {
    b = play(b, line);
    if (!b) return null;
  }
  return b;
}
