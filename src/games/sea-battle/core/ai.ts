// The computer player, with no DOM. It takes a `Sight`, never a board: it
// knows the shots it fired and the ships it sank, and nothing else of the
// other fleet. Easy fires at random. Medium hunts on every second cell, and
// once a shot hits it fires at the cells next to the hit until the ship sinks.
// Hard counts, for each open cell, the ways the ships still afloat can lie
// across it given every mark so far (a density map), and fires where the count
// is highest. A way that runs through a hit on a ship not yet sunk counts for
// far more, so the same map hunts and finishes ships. All randomness comes
// from a seed stored with the game, so a shot is a pure function of the sight,
// the level and the seed: a reload replays the same game and the computer's
// pending shot.

import { CELLS, SIZE, afloat, cellsOf, type Sight } from "./board.ts";
import { rng } from "../../connect-four/core/ai.ts";

export { newSeed, rng } from "../../connect-four/core/ai.ts";

export type Level = "easy" | "medium" | "hard";

export const LEVELS: readonly Level[] = ["easy", "medium", "hard"];

/**
 * How much more a way to lay a ship counts for each open hit it runs through.
 * It is high enough that one way through a hit outweighs every way through
 * open water alone, so Hard always finishes a ship it has found.
 */
const THROUGH_HIT = 1_000;

/** One shot of the computer's, with the reasoning behind it. */
export interface Thought {
  cell: number;
  /** How many ways to lay a ship Hard counted. Zero on the other levels. */
  placements: number;
  /** How long the choice took, in milliseconds. */
  ms: number;
  /** The shot follows a hit on a ship that is not sunk yet. */
  chasing: boolean;
}

/** The cell the computer fires at with this sight. At least one cell must be open. */
export function computerMove(sight: Sight, level: Level, seed: number): number {
  return think(sight, level, seed).cell;
}

/** The computer's shot with this sight, with how it chose and how long it took. At least one cell must be open. */
export function think(sight: Sight, level: Level, seed: number): Thought {
  const open = openCells(sight);
  if (open.length === 0) throw new Error("no open cell");
  // Each shot gets its own stream, so the answer depends only on the sight.
  const rand = rng(seed ^ Math.imul(CELLS - open.length + 1, 0x9e3779b1));
  const pick = (cells: number[]) => cells[Math.floor(rand() * cells.length)]!;
  const t0 = performance.now();
  const chasing = openHits(sight).length > 0;
  let cell: number;
  let placements = 0;
  if (level === "easy") cell = pick(open);
  else if (level === "medium") cell = pick(chase(sight) ?? hunt(open));
  else {
    const map = density(sight);
    placements = map.placements;
    cell = pick(best(open, (c) => map.counts[c]!));
  }
  return { cell, placements, ms: performance.now() - t0, chasing };
}

/** The cells not fired at yet. */
const openCells = (sight: Sight) => sight.marks.flatMap((mark, cell) => (mark === null ? [cell] : []));

/** The hits on ships that are not sunk yet. */
export function openHits(sight: Sight): number[] {
  const sunk = new Set(sight.sunk.flatMap(cellsOf));
  return sight.marks.flatMap((mark, cell) => (mark === "hit" && !sunk.has(cell) ? [cell] : []));
}

/** Every cell of `cells` with the highest score. */
function best(cells: number[], score: (cell: number) => number): number[] {
  let top = -Infinity;
  let found: number[] = [];
  for (const cell of cells) {
    const n = score(cell);
    if (n > top) {
      top = n;
      found = [cell];
    } else if (n === top) found.push(cell);
  }
  return found;
}

// ---------- Medium: hunt, then target ----------

/** The open cells of one colour of a checkerboard: every ship covers one. All open cells once that colour is used up. */
function hunt(open: number[]): number[] {
  const dark = open.filter((cell) => (Math.floor(cell / SIZE) + (cell % SIZE)) % 2 === 0);
  return dark.length > 0 ? dark : open;
}

/** The step to each cell next to `cell` on the grid: up, down, left and right. */
function steps(cell: number): number[] {
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const out: number[] = [];
  if (row > 0) out.push(-SIZE);
  if (row < SIZE - 1) out.push(SIZE);
  if (col > 0) out.push(-1);
  if (col < SIZE - 1) out.push(1);
  return out;
}

/**
 * The open cells next to a hit on a ship not yet sunk, or null with no such
 * hit. Two hits side by side show how the ship lies, so the cells that extend
 * their line come first.
 */
function chase(sight: Sight): number[] | null {
  const hot = new Set(openHits(sight));
  const counts = new Map<number, number>();
  for (const hit of hot) {
    const around = steps(hit);
    for (const step of around) {
      const cell = hit + step;
      if (sight.marks[cell] !== null) continue;
      const inLine = around.includes(-step) && hot.has(hit - step);
      counts.set(cell, Math.max(counts.get(cell) ?? 0, inLine ? 2 : 1));
    }
  }
  if (counts.size === 0) return null;
  return best([...counts.keys()], (cell) => counts.get(cell)!);
}

// ---------- Hard: the density map ----------

/**
 * For each cell, the weighted count of ways a ship still afloat can cover it.
 * A ship can't lie on a miss or on a sunk ship, and it can't lie on hits
 * alone, because it would have sunk. Cells fired at count zero.
 */
export function density(sight: Sight): { counts: number[]; placements: number } {
  const counts = Array<number>(CELLS).fill(0);
  const hot = new Set(openHits(sight));
  // A miss or a sunk ship: no ship afloat lies here.
  const shut = sight.marks.map((mark, cell) => mark !== null && !hot.has(cell));
  let placements = 0;
  for (const len of afloat(sight)) {
    for (const step of [1, SIZE]) {
      for (let cell = 0; cell < CELLS; cell++) {
        const start = step === 1 ? cell % SIZE : Math.floor(cell / SIZE);
        if (start + len > SIZE) continue;
        let through = 0;
        let free = true;
        for (let i = 0; i < len && free; i++) {
          const c = cell + i * step;
          if (shut[c]) free = false;
          else if (hot.has(c)) through++;
        }
        if (!free || through === len) continue;
        placements++;
        const weight = THROUGH_HIT ** through;
        for (let i = 0; i < len; i++) {
          const c = cell + i * step;
          if (!hot.has(c)) counts[c]! += weight;
        }
      }
    }
  }
  return { counts, placements };
}
