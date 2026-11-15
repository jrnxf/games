// Connect Four's entry: pass-and-play on one phone, solo against the
// computer, or online with a friend in a party. A chip hovers over the aimed
// column; left and right move it and Drop lets it fall. Tapping a column aims
// there, and tapping the aimed column again drops. Offline, the game saves
// after every move, so a reload or a trip to the menu picks up where it left
// off, the computer's pending move included. Online, the host on the server
// holds the game (core/host.ts) and this phone draws what it says. In solo,
// a line under the board says when the computer has a forced win, and the
// result recaps its game.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store } from "../../../shell/storage.ts";
import { LEVELS, newSeed, think, type Level } from "../core/ai.ts";
import {
  COLS,
  ROWS,
  at,
  canDrop,
  drop,
  isOver,
  landingRow,
  newBoard,
  replay,
  type Board,
  type Seat,
} from "../core/board.ts";
import type { FourClientMessage, FourMatch, FourServerMessage } from "../core/protocol.ts";

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
  /** Solo only: the numbers behind each of the computer's moves, for the recap. */
  notes?: Note[];
}

/** One of the computer's moves, in numbers: `at` is how many chips were down before it. */
interface Note {
  at: number;
  positions: number;
  ms: number;
  win: number | null;
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
/** Bumped by every new game, so a chip still falling from the last one is not put on this board. */
let gameId = 0;
/** True on the computer's turn: input waits until its chip has landed. */
let thinking = false;
let thinkTimer = 0;
/** Solo: the numbers behind each of the computer's moves this game, and the timer of a replay of the ending. */
let notes: Note[] = [];
let replayTimer = 0;

/** Online: the party's channel for this game, and this phone's seat (red is 0, yellow 1). */
let channel: Channel<FourServerMessage, FourClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. The board catches up with it once any falling chip lands. */
let latest: FourMatch | null = null;
/** Online: the move count a drop this phone sent was aimed from, until the host answers it. */
let pending: number | null = null;
/** Online: whether the last board drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!isOver(board) && board.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** No taps or keys from the player right now. */
const locked = () => busy || thinking || isOver(board) || waiting() || offline();

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
      else steer(c);
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
  // Online, the game lives on the server.
  if (channel) return;
  const saved: Saved = { names, starter: board.starter, moves: board.moves, wins };
  if (solo) Object.assign(saved, { level, seed, notes });
  save(saveKey(), JSON.stringify(saved));
}

/** The saved game, if it is intact. */
function savedGame(): (Saved & { board: Board; seed: number; notes: Note[] }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.moves) || !Array.isArray(s.wins)) return null;
  if (s.starter !== 0 && s.starter !== 1) return null;
  if (solo && (!s.level || !Object.hasOwn(LEVELS, s.level) || !Number.isInteger(s.seed))) return null;
  const b = replay(s.starter, s.moves);
  if (!b) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  // Notes are for show: a bad one is dropped, never the game.
  const fine = (n: Note) =>
    Number.isInteger(n?.at) &&
    n.at >= 0 &&
    n.at < s.moves.length &&
    Number.isFinite(n.positions) &&
    Number.isFinite(n.ms) &&
    (n.win === null || Number.isInteger(n.win));
  return {
    names: [n(0), n(1)],
    starter: s.starter,
    moves: s.moves,
    wins: [w(0), w(1)],
    level: s.level,
    seed: s.seed ?? 0,
    notes: Array.isArray(s.notes) ? s.notes.filter(fine) : [],
    board: b,
  };
}

// ---------- drawing ----------

function cellSize(): number {
  return cells[0]!.getBoundingClientRect().width;
}

function disc(seat: Seat, win = false, n = 0, fresh = false): string {
  const cls = `c4-disc s${seat}${win ? " win" : ""}${fresh ? " fresh" : ""}`;
  return `<div class="${cls}"${n ? ` data-n="${n}"` : ""}></div>`;
}

/** Draws `b` on the board. Chips from number `numbered` on show their number, and the newest drops in. */
function drawBoard(b = board, numbered = 0) {
  const line = new Set(b.line);
  const chip = Array<number>(ROWS * COLS).fill(0);
  const height = Array<number>(COLS).fill(0);
  b.moves.forEach((c, i) => (chip[at(ROWS - 1 - height[c]!++, c)] = i + 1));
  b.cells.forEach((seat, i) => {
    const n = numbered && chip[i]! >= numbered ? chip[i]! : 0;
    cells[i]!.innerHTML = seat === null ? "" : disc(seat, line.has(i), n, n > 0 && n === b.moves.length);
  });
}

function aim(c: number) {
  col = Math.max(0, Math.min(COLS - 1, c));
  const over = isOver(board);
  const frozen = thinking || offline();
  const x = `translateX(${col * cellSize()}px)`;
  $("c4-hover").style.transform = x;
  $("c4-col").style.transform = x;
  $("c4-col").style.opacity = over ? "0" : waiting() ? "0.5" : "1";
  $<HTMLButtonElement>("c4-left").disabled = over || frozen || col === 0;
  $<HTMLButtonElement>("c4-right").disabled = over || frozen || col === COLS - 1;
  $<HTMLButtonElement>("c4-drop").disabled = frozen || !canDrop(board, col);
}

/** The player moves the chip. Online, the friend sees it move. */
function steer(c: number) {
  if (locked()) return;
  const was = col;
  aim(c);
  if (channel && col !== was) channel.send({ t: "aim", col });
}

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  if (board.winner === seat) return "Winner";
  if (board.draw) return "Draw";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  const on = !isOver(board) && board.turn === seat;
  if (!channel) return on ? "Your turn" : "";
  // Online, this phone's card says which colour is yours.
  if (seat !== me) return on && latest ? "Their turn" : "";
  return on && latest ? "Your turn" : "You";
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
  const wait = waiting();
  $("c4-hover-disc").className = `c4-disc s${board.turn}`;
  $("c4-hover").style.visibility = over || (channel && !latest) ? "hidden" : "";
  // Online, the friend's chip shows dimmed where they aim.
  $("c4-hover").classList.toggle("ghost", wait);
  $("c4-controls").hidden = over || thinking || wait;
  $("c4-wait").hidden = !thinking && !wait;
  // A hidden bar keeps its words, so it never flashes "Connecting" as it goes.
  if (thinking || wait) {
    const waitFor = thinking ? COMPUTER : ((1 - me) as Seat);
    $("c4-wait").style.setProperty("--c", `var(--p${waitFor + 1})`);
    $("c4-wait-text").textContent = thinking
      ? "Computer is thinking"
      : latest
        ? `Waiting for ${names[waitFor]}`
        : "Connecting";
  }
  const game = $("c4-game");
  game.classList.toggle("c4-solo", solo);
  game.classList.toggle("c4-over", over);
  $("c4-result").hidden = !over;
  if (over) drawResult();
  drawLost();
}

/** The end of a game: who won, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner;
  $("c4-result-title").textContent =
    w === null ? "It's a draw" : channel && w === me ? "You win!" : `${names[w]} wins!`;
  const again = $<HTMLButtonElement>("c4-again");
  const note = $("c4-note");
  const friend = names[(1 - me) as Seat];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  // Online the line keeps its place, so the board does not jump when the friend asks.
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : "\u00a0";
  if (solo) drawRecap();
}

function draw() {
  drawBoard();
  drawPlayers();
  aim(col);
}

// ---------- playing ----------

/** Drops the current player's chip in `col`: animates it, then commits the move. */
async function play() {
  if (busy || thinking || !canDrop(board, col)) return;
  const ch = channel;
  const sent = latest;
  if (ch) {
    // Online, only on this phone's turn, and only once the host can hear it.
    if (waiting() || !ch.send({ t: "drop", col, at: board.moves.length })) return;
    pending = board.moves.length;
  }
  if (!(await fall(col)) || ch !== channel) return;
  // Online, the chip stays where it landed until the host answers. If it
  // already has, catch up with that answer now.
  if (ch) return void (latest !== sent ? settle() : draw());
  if (board.winner !== null) wins[board.winner] += 1;
  persist();
  takeTurn();
}

// ---------- the computer's thinking ----------

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) =>
  ms < 0.01 ? "<0.01 ms" : `${ms < 0.1 ? ms.toFixed(2) : ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Once the computer has a forced win, the line under the board says so on the
 * player's turn. It never guesses at the player's move: it is true whatever they play.
 */
function drawLost() {
  const last =
    solo && !isOver(board) && board.turn !== COMPUTER
      ? notes.find((x) => x.at === board.moves.length - 1)
      : null;
  const win = last?.win ?? null;
  const el = $("c4-lost");
  // Hidden, it keeps its room, so the board never moves.
  const show = win !== null && win >= 3;
  el.style.visibility = show ? "" : "hidden";
  el.textContent = show ? `I can win in ${plural((win! - 1) / 2, "more move")}, whatever you play.` : "";
}

/** The recap under the result: the computer's game in numbers. */
function drawRecap() {
  const ended = notes.filter((x) => x.at < board.moves.length);
  $("c4-recap").hidden = ended.length === 0;
  if (ended.length === 0) return;
  const total = ended.reduce((a, x) => a + x.positions, 0);
  const ms = ended.reduce((a, x) => a + x.ms, 0);
  const longest = ended.reduce((a, x) => (x.ms > a.ms ? x : a));
  // The first move of the run of forced wins that ended the game.
  let saw = ended.length;
  if (board.winner === COMPUTER) while (saw > 0 && ended[saw - 1]!.win !== null) saw--;
  const early = saw < ended.length ? board.moves.length - (ended[saw]!.at + 1) : 0;
  const rows: [string, string][] = [["Positions checked", fmt(total)]];
  if (early > 0) rows.push(["Saw its win coming", `${plural(early, "chip")} early`]);
  rows.push(["Longest think", `chip ${longest.at + 1} · ${fmtMs(longest.ms)}`]);
  rows.push(["Time thinking, whole game", fmtMs(ms)]);
  $("c4-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  const peak = Math.max(...ended.map((x) => x.positions), 1);
  $("c4-spark").innerHTML = ended
    .map((x, i) => {
      const cls = x.positions === peak ? "peak" : i >= saw ? "saw" : "";
      return `<i class="${cls}" style="--h: ${Math.max(6, (x.positions / peak) * 100)}%"></i>`;
    })
    .join("");
  $("c4-spark-label").textContent = `its ${plural(ended.length, "move")}`;
  $("c4-saw-key").hidden = early === 0;
  const watch = $("c4-watch");
  watch.hidden = early === 0;
  watch.dataset.from = String(early > 0 ? ended[saw]!.at : 0);
}

/** Hides the recap and replays the real last chips, from the move where the computer saw its win. */
function watchEnding(from: number) {
  clearTimeout(replayTimer);
  const final = board;
  const sheet = $("c4-result");
  sheet.classList.add("away");
  let k = from;
  drawBoard(replay(final.starter, final.moves.slice(0, k))!, from + 1);
  const wait = (ms: number) => (reducedMotion.matches ? 0 : ms);
  const step = () => {
    if (board !== final) return;
    k++;
    const done = k === final.moves.length;
    drawBoard(replay(final.starter, final.moves.slice(0, k))!, from + 1);
    toast(
      k === from + 1 ? `Chip ${k}: it sees a forced win` : done ? `Chip ${k}: four in a row` : `Chip ${k}`,
      COMPUTER,
    );
    replayTimer = window.setTimeout(
      done ? () => sheet.classList.remove("away") : step,
      wait(done ? 1600 : k === from + 1 ? 1100 : 550),
    );
  };
  replayTimer = window.setTimeout(step, wait(500));
}

function stopReplay() {
  clearTimeout(replayTimer);
  $("c4-result").classList.remove("away");
}

/** Animates the current player's chip falling into column `c`, then puts it on the board. False when a new game started meanwhile. */
async function fall(c: number): Promise<boolean> {
  const id = gameId;
  busy = true;
  const row = landingRow(board, c);
  const size = cellSize();
  const x = BOARD_PAD + c * size;
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
  if (id !== gameId) return false;

  board = drop(board, c)!;
  if ("vibrate" in navigator) navigator.vibrate(board.winner !== null ? [20, 40, 20, 40, 60] : 12);
  busy = false;
  return true;
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
    const t = think(board, level, seed);
    // Kept for the recap and the line under the board.
    const at = board.moves.length;
    notes = [...notes.filter((x) => x.at !== at), { at, positions: t.positions, ms: t.ms, win: t.win }];
    aim(t.col);
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
  gameId++;
  stopReplay();
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
  notes = [];
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
  notes = [];
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("c4-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board);
});

// ---------- online ----------

/**
 * Catches the board up with the host's latest match. The friend's new chip
 * falls as it would on one phone; anything else (a rematch, a reconnect, a
 * refused drop) redraws the board at once.
 */
async function settle() {
  const m = latest;
  const ch = channel;
  if (!ch || !m || busy) return;
  const target = replay(m.first, m.moves);
  if (!target) return;
  wins = [...m.wins];
  const n = board.moves.length;
  const same = (b: Board) => b.starter === target.starter && b.moves.every((c, i) => target.moves[i] === c);
  if (target.moves.length === n + 1 && same(board)) {
    const c = target.moves[n]!;
    col = c;
    if (!(await fall(c)) || ch !== channel) return;
    return settle();
  }
  if (target.moves.length !== n || !same(board)) {
    if (target.moves.length === 0) col = 3;
    board = target;
  }
  if (pending !== null) {
    // The drop this phone sent never counted (a drop in the connection, say).
    if (target.moves.length <= pending) toast("Connection hiccup · drop that one again", me);
    pending = null;
  }
  draw();
  const mine = !isOver(board) && board.turn === me;
  if (mine && !wasMine) yourTurn();
  wasMine = mine;
}

function yourTurn() {
  toast("Your turn", me);
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string, seat: Seat) {
  const el = $("c4-toast");
  el.textContent = text;
  el.style.setProperty("--c", `var(--p${seat + 1})`);
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("c4-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: FourServerMessage) {
  if (msg.t === "state") {
    latest = msg.match;
    void settle();
  } else if (msg.seat !== me && !busy && !isOver(board) && board.turn === msg.seat) {
    aim(msg.col);
  }
}

/** The connection or the players changed. */
function onChange() {
  const ch = channel;
  if (!ch) return;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.update();
  // A falling chip redraws when it lands.
  if (!busy) draw();
}

function openOnline(ch: Channel<FourServerMessage, FourClientMessage>) {
  channel = ch;
  me = ch.me;
  latest = null;
  pending = null;
  wasMine = false;
  wins = [0, 0];
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.stop();
  banner = new ConnectionBanner(ch, setBanner);
  // An empty board, waiting, until the host sends the game.
  startGame(newBoard());
  ch.listen({ message: onMessage, change: onChange });
}

$("c4-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("c4-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));
$("c4-left").addEventListener("click", () => steer(col - 1));
$("c4-right").addEventListener("click", () => steer(col + 1));
$("c4-drop").addEventListener("click", () => void play());
$("c4-watch").addEventListener("click", (e) =>
  watchEnding(Number((e.currentTarget as HTMLElement).dataset.from)),
);

addEventListener("resize", () => {
  if ($("c4-game").classList.contains("on")) aim(col);
});

addEventListener("keydown", (e) => {
  if (!$("c4-game").classList.contains("on") || locked()) return;
  if (e.key === "ArrowLeft") steer(col - 1);
  else if (e.key === "ArrowRight") steer(col + 1);
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
    me: channel ? me : null,
    locked: locked(),
    rematch: latest?.rematch ?? null,
    ghost: $("c4-hover").classList.contains("ghost"),
    notes,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    // Straight into the party's game, on this phone's seat.
    solo = false;
    if (!channel) openOnline(session.channel as Channel<FourServerMessage, FourClientMessage>);
    return;
  }
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
  stopReplay();
  // Online, the game stays on the server; a chip still falling is dropped with it.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("c4-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
