// Connect Four's entry: pass-and-play on one phone. A chip hovers over the
// aimed column; left and right move it and Drop lets it fall. Tapping a column
// aims there, and tapping the aimed column again drops. The game saves after
// every move, so a reload or a trip to the menu picks up where it left off.

import "./styles.css";
import screens from "./screens.html?raw";

import { $, show } from "../../../shell/dom.ts";
import { store } from "../../../shell/storage.ts";
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

const { load, save, loadJson } = store("connect-four.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const BOARD_PAD = 10;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

interface Saved {
  names: [string, string];
  starter: Seat;
  moves: number[];
  wins: [number, number];
}

let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let board: Board = newBoard();
let col = 3;
/** True while a chip is falling: input waits for it to land. */
let busy = false;

const boardEl = $("c4-board");
const cells: HTMLElement[] = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement("div");
    el.className = "c4-cell";
    el.setAttribute("role", "gridcell");
    el.addEventListener("click", () => {
      if (busy || isOver(board)) return;
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

function persist() {
  const saved: Saved = { names, starter: board.starter, moves: board.moves, wins };
  save("game", JSON.stringify(saved));
}

/** The saved game, if it is intact. */
function savedGame(): (Saved & { board: Board }) | null {
  const s = loadJson<Saved>("game");
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.moves) || !Array.isArray(s.wins)) return null;
  if (s.starter !== 0 && s.starter !== 1) return null;
  const b = replay(s.starter, s.moves);
  if (!b) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  return { names: [n(0), n(1)], starter: s.starter, moves: s.moves, wins: [w(0), w(1)], board: b };
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
  $<HTMLButtonElement>("c4-left").disabled = over || col === 0;
  $<HTMLButtonElement>("c4-right").disabled = over || col === COLS - 1;
  $<HTMLButtonElement>("c4-drop").disabled = !canDrop(board, col);
}

function drawPlayers() {
  const over = isOver(board);
  for (const seat of [0, 1] as const) {
    const el = $(`c4-pl-${seat}`);
    const sub =
      board.winner === seat
        ? "Winner"
        : board.draw
          ? "Draw"
          : !over && board.turn === seat
            ? "Your turn"
            : "";
    el.classList.toggle("on", board.winner === seat || (!over && board.turn === seat));
    el.querySelector(".c4-name")!.textContent = names[seat];
    el.querySelector(".c4-sub")!.textContent = sub;
    el.querySelector(".c4-wins")!.textContent = wins[0] + wins[1] > 0 ? String(wins[seat]) : "";
  }
  const drop = $("c4-drop");
  drop.style.setProperty("--c", `var(--p${board.turn + 1})`);
  drop.style.setProperty("--cd", `var(--p${board.turn + 1}-dark)`);
  drop.setAttribute("aria-label", `Drop ${names[board.turn]}'s chip`);
  $("c4-hover-disc").className = `c4-disc s${board.turn}`;
  $("c4-hover").style.visibility = over ? "hidden" : "";
  $("c4-controls").hidden = over;
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
  if (busy || !canDrop(board, col)) return;
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
  draw();
}

function startGame(next: Board) {
  board = next;
  col = 3;
  busy = false;
  show("c4-game");
  // The board has a size only once its screen is showing.
  draw();
}

/** A fresh game with the same players. Whoever went second last time starts. */
function rematch() {
  startGame(newBoard((1 - board.starter) as Seat));
  persist();
}

function goHome() {
  const saved = savedGame();
  $("c4-resume").hidden = !saved || isOver(saved.board) || saved.moves.length === 0;
  $<HTMLInputElement>("c4-name-0").value = saved?.names[0] ?? load("names")?.split("\n")[0] ?? "";
  $<HTMLInputElement>("c4-name-1").value = saved?.names[1] ?? load("names")?.split("\n")[1] ?? "";
  show("c4-home");
}

$("c4-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const a = cleanName($<HTMLInputElement>("c4-name-0").value, DEFAULT_NAMES[0]);
  let b = cleanName($<HTMLInputElement>("c4-name-1").value, DEFAULT_NAMES[1]);
  if (b.toLowerCase() === a.toLowerCase()) b = `${b} 2`;
  // Same two players keep their running score; new names start from zero.
  const saved = savedGame();
  const same = saved && saved.names[0] === a && saved.names[1] === b;
  wins = same ? saved.wins : [0, 0];
  names = [a, b];
  save("names", `${a}\n${b}`);
  startGame(newBoard(same ? ((1 - saved.starter) as Seat) : 0));
  persist();
});

$("c4-resume").addEventListener("click", () => {
  const saved = savedGame();
  if (!saved) return goHome();
  names = saved.names;
  wins = saved.wins;
  startGame(saved.board);
});

$("c4-leave").addEventListener("click", goHome);
$("c4-again").addEventListener("click", rematch);
$("c4-left").addEventListener("click", () => !busy && aim(col - 1));
$("c4-right").addEventListener("click", () => !busy && aim(col + 1));
$("c4-drop").addEventListener("click", () => void play());

addEventListener("resize", () => {
  if ($("c4-game").classList.contains("on")) aim(col);
});

addEventListener("keydown", (e) => {
  if (!$("c4-game").classList.contains("on") || busy || isOver(board)) return;
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
    turn: board.turn,
    winner: board.winner,
    draw: board.draw,
    col,
    busy,
    wins,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string): void {
  goHome();
}

export function close(): void {
  // Nothing runs in the background; the game is saved after every move.
}
