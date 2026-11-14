// Connect Four's entry: pass-and-play on one phone, or solo against the
// computer. A chip hovers over the aimed column; left and right move it and
// Drop lets it fall. Tapping a column aims there, and tapping the aimed column
// again drops. The game saves after every move, so a reload or a trip to the
// menu picks up where it left off, the computer's pending move included.

import "./styles.css";
import screens from "./screens.html?raw";

import { $, show } from "../../../shell/dom.ts";
import type { Session } from "../../../shell/session.ts";
import { store } from "../../../shell/storage.ts";
import { LEVELS, computerMove, newSeed, type Level } from "../core/ai.ts";
import {
  COLS,
  ROWS,
  canDrop,
  drop,
  isOver,
  landingRow,
  newBoard,
  replay,
  type Board,
  type Seat,
} from "../core/board.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = store("connect-four.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const BOARD_PAD = 10;
/** In solo the player is red and the computer yellow. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it moves, then how long its chip takes to slide over. */
const THINK_MS = 500;
const SLIDE_MS = 180;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

interface Saved {
  names: [string, string];
  starter: Seat;
  moves: number[];
  wins: [number, number];
  /** Solo only: the computer's level and the seed its moves come from. */
  level?: Level;
  seed?: number;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let board: Board = newBoard();
let seed = 0;
let col = 3;
/** True while a chip is falling: input waits for it to land. */
let busy = false;
/** True on the computer's turn: input waits until its chip has landed. */
let thinking = false;
let thinkTimer = 0;

/** No taps or keys from the player right now. */
const locked = () => busy || thinking || isOver(board);

const boardEl = $("c4-board");
const cells: HTMLElement[] = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement("div");
    el.className = "c4-cell";
    el.setAttribute("role", "gridcell");
    el.addEventListener("click", () => {
      if (locked()) return;
      if (c === col) void play();
      else aim(c);
    });
    boardEl.append(el);
    cells.push(el);
  }
}

// ---------- saving ----------

function cleanName(raw: string, fallback: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 12) || fallback;
}

/** Solo and pass & play keep separate saves, so neither overwrites the other. */
const saveKey = () => (solo ? "solo" : "game");

function persist() {
  const saved: Saved = { names, starter: board.starter, moves: board.moves, wins };
  if (solo) Object.assign(saved, { level, seed });
  save(saveKey(), JSON.stringify(saved));
}

/** The saved game, if it is intact. */
function savedGame(): (Saved & { board: Board; seed: number }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.moves) || !Array.isArray(s.wins)) return null;
  if (s.starter !== 0 && s.starter !== 1) return null;
  if (solo && (!s.level || !Object.hasOwn(LEVELS, s.level) || !Number.isInteger(s.seed))) return null;
  const b = replay(s.starter, s.moves);
  if (!b) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  return {
    names: [n(0), n(1)],
    starter: s.starter,
    moves: s.moves,
    wins: [w(0), w(1)],
    level: s.level,
    seed: s.seed ?? 0,
    board: b,
  };
}

// ---------- drawing ----------

function cellSize(): number {
  return cells[0]!.getBoundingClientRect().width;
}

function disc(seat: Seat, win = false): string {
  return `<div class="c4-disc s${seat}${win ? " win" : ""}"></div>`;
}

function drawBoard() {
  const line = new Set(board.line);
  board.cells.forEach((seat, i) => {
    cells[i]!.innerHTML = seat === null ? "" : disc(seat, line.has(i));
  });
}

function aim(c: number) {
  col = Math.max(0, Math.min(COLS - 1, c));
  const over = isOver(board);
  const x = `translateX(${col * cellSize()}px)`;
  $("c4-hover").style.transform = x;
  $("c4-col").style.transform = x;
  $("c4-col").style.opacity = over ? "0" : "1";
  $<HTMLButtonElement>("c4-left").disabled = over || thinking || col === 0;
  $<HTMLButtonElement>("c4-right").disabled = over || thinking || col === COLS - 1;
  $<HTMLButtonElement>("c4-drop").disabled = thinking || !canDrop(board, col);
}

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  if (board.winner === seat) return "Winner";
  if (board.draw) return "Draw";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  return !isOver(board) && board.turn === seat ? "Your turn" : "";
}

function drawPlayers() {
  const over = isOver(board);
  for (const seat of [0, 1] as const) {
    const el = $(`c4-pl-${seat}`);
    el.classList.toggle("on", board.winner === seat || (!over && board.turn === seat));
    el.querySelector(".c4-name")!.textContent = names[seat];
    el.querySelector(".c4-sub")!.textContent = status(seat);
    el.querySelector(".c4-wins")!.textContent = wins[0] + wins[1] > 0 ? String(wins[seat]) : "";
  }
  const drop = $("c4-drop");
  drop.style.setProperty("--c", `var(--p${board.turn + 1})`);
  drop.style.setProperty("--cd", `var(--p${board.turn + 1}-dark)`);
  drop.setAttribute("aria-label", `Drop ${names[board.turn]}'s chip`);
  $("c4-hover-disc").className = `c4-disc s${board.turn}`;
  $("c4-hover").style.visibility = over ? "hidden" : "";
  $("c4-controls").hidden = over || thinking;
  $("c4-wait").hidden = !thinking;
  $("c4-result").hidden = !over;
  if (over) $("c4-result-title").textContent = board.draw ? "It's a draw" : `${names[board.winner!]} wins!`;
}

function draw() {
  drawBoard();
  drawPlayers();
  aim(col);
}

// ---------- playing ----------

/** Animates the current player's chip into `col`, then commits the move. */
async function play() {
  if (busy || thinking || !canDrop(board, col)) return;
  busy = true;
  const row = landingRow(board, col);
  const size = cellSize();
  const x = BOARD_PAD + col * size;
  const end = BOARD_PAD + row * size;
  const start = -size * 1.1;
  const chip = document.createElement("div");
  chip.className = "c4-falling";
  chip.innerHTML = disc(board.turn);
  boardEl.append(chip);
  $("c4-hover").style.visibility = "hidden";
  const to = (y: number) => `translate(${x}px, ${y}px)`;
  // Falls faster the further it goes, then a small bounce on landing.
  const ms = reducedMotion.matches ? 1 : (180 + Math.sqrt((end - start) / size) * 90) * 1.3;
  await chip.animate(
    [
      { transform: to(start), easing: "cubic-bezier(0.5, 0, 1, 1)" },
      { transform: to(end), offset: 0.78, easing: "ease-out" },
      { transform: to(end - size * 0.12), offset: 0.89, easing: "ease-in" },
      { transform: to(end) },
    ],
    { duration: ms, fill: "forwards" },
  ).finished;
  chip.remove();

  board = drop(board, col)!;
  if (board.winner !== null) wins[board.winner] += 1;
  persist();
  if ("vibrate" in navigator) navigator.vibrate(board.winner !== null ? [20, 40, 20, 40, 60] : 12);
  busy = false;
  takeTurn();
}

/**
 * Draws the board and, on the computer's turn, waits a moment, slides its
 * chip over the column it picked and drops it. The pick comes from the board
 * and the game's seed alone, so a reload mid-wait plays the same column.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  thinking = solo && !isOver(board) && board.turn === COMPUTER;
  draw();
  if (!thinking) return;
  const before = board;
  const still = () => board === before && $("c4-game").classList.contains("on");
  thinkTimer = window.setTimeout(() => {
    if (!still()) return;
    aim(computerMove(board, level, seed));
    thinkTimer = window.setTimeout(() => {
      if (!still()) return;
      thinking = false;
      void play();
    }, SLIDE_MS);
  }, THINK_MS);
}

function stopThinking() {
  clearTimeout(thinkTimer);
  thinking = false;
}

function startGame(next: Board) {
  board = next;
  col = 3;
  busy = false;
  show("c4-game");
  // The board has a size only once its screen is showing.
  takeTurn();
}

/** A fresh game with the same players. Whoever went second last time starts. */
function rematch() {
  seed = newSeed();
  startGame(newBoard((1 - board.starter) as Seat));
  persist();
}

/** The saved game, if it is between the session's players (in solo, at the session's level). */
function ourGame() {
  const saved = savedGame();
  if (!saved || saved.names[0] !== names[0] || saved.names[1] !== names[1]) return null;
  return !solo || saved.level === level ? saved : null;
}

/** Who starts a new game: the other player after a game, the same one if nobody moved. */
function nextStarter(saved: ReturnType<typeof ourGame>): Seat {
  if (!saved) return 0;
  return saved.moves.length === 0 ? saved.starter : ((1 - saved.starter) as Seat);
}

function goHome() {
  stopThinking();
  const saved = ourGame();
  const first = nextStarter(saved);
  $("c4-resume").hidden = !saved || isOver(saved.board) || saved.moves.length === 0;
  $("c4-lead").textContent = solo
    ? "You against the computer. Take turns dropping chips. Four in a row wins."
    : "One phone, two players. Take turns dropping chips. Four in a row wins.";
  const colours = ["Red", solo ? `Yellow · ${LEVEL_LABELS[level]}` : "Yellow"];
  for (const seat of [0, 1] as const) {
    $(`c4-name-${seat}`).textContent = names[seat];
    $(`c4-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · goes first" : "");
  }
  show("c4-home");
}

$("c4-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("c4-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  startGame(saved.board);
});

$("c4-leave").addEventListener("click", goHome);
$("c4-again").addEventListener("click", rematch);
$("c4-left").addEventListener("click", () => !locked() && aim(col - 1));
$("c4-right").addEventListener("click", () => !locked() && aim(col + 1));
$("c4-drop").addEventListener("click", () => void play());

addEventListener("resize", () => {
  if ($("c4-game").classList.contains("on")) aim(col);
});

addEventListener("keydown", (e) => {
  if (!$("c4-game").classList.contains("on") || locked()) return;
  if (e.key === "ArrowLeft") aim(col - 1);
  else if (e.key === "ArrowRight") aim(col + 1);
  else if (e.key === "ArrowDown" || e.key === " " || e.key === "Enter") {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    void play();
  }
});

// For the end-to-end test.
(window as unknown as { __connectFour: unknown }).__connectFour = {
  state: () => ({
    moves: board.moves,
    starter: board.starter,
    turn: board.turn,
    winner: board.winner,
    draw: board.draw,
    col,
    busy,
    thinking,
    wins,
    seed,
    level: solo ? level : null,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: Session): void {
  // The shell opens only the modes info.ts lists: solo and pass & play.
  solo = session.mode === "solo";
  if (session.mode === "solo") {
    names = [cleanName(session.names[0], DEFAULT_NAMES[0]), COMPUTER_NAME];
    level = session.difficulty;
  } else if (session.mode === "pass-and-play") {
    names = [cleanName(session.names[0], DEFAULT_NAMES[0]), cleanName(session.names[1], DEFAULT_NAMES[1])];
  }
  goHome();
}

export function close(): void {
  // Only the computer's wait runs in the background; the game is saved after every move.
  stopThinking();
}
