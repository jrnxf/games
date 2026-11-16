// Ultimate Tic-Tac-Toe's entry: pass-and-play on one phone, solo against the
// computer, or online with a friend in a party. The small boards the player
// on turn may play in are lit. A tap on a spot aims at it, and "Place" (or a
// second tap on the same spot) makes the mark. Offline, the game saves after
// every move, so a reload or a trip to the menu picks up where it left off,
// the computer's pending move included. Online, the host on the server holds
// the game (core/host.ts) and this phone draws what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store } from "../../../shell/storage.ts";
import { LEVELS, newSeed, think, type Level } from "../core/ai.ts";
import {
  BOARDS,
  SPOTS,
  at,
  boardOf,
  canPlay,
  count,
  isFull,
  isOver,
  legalMoves,
  newBoard,
  openBoards,
  play,
  replay,
  spotOf,
  type Board,
  type Seat,
} from "../core/board.ts";
import type { UltimateClientMessage, UltimateMatch, UltimateServerMessage } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = store("ultimate-tic-tac-toe.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const MARKS = ["X", "O"] as const;
/** In solo the player is X and the computer O. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it moves. */
const THINK_MS = 500;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
/** Where a small board (or a spot in one) is, in words. */
const PLACES = [
  "top left",
  "top",
  "top right",
  "left",
  "middle",
  "right",
  "bottom left",
  "bottom",
  "bottom right",
] as const;
/** Each player's mark on a 24x24 view box. `pathLength` lets a new mark draw itself in. */
const SHAPES = [
  `<path d="M6 6 18 18M18 6 6 18" pathLength="1"/>`,
  `<circle cx="12" cy="12" r="6.5" pathLength="1"/>`,
] as const;

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

/** One of the computer's moves, in numbers: `at` is how many marks were played before it. */
interface Note {
  at: number;
  playouts: number;
  ms: number;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let board: Board = newBoard();
let seed = 0;
/** The spot the player on turn aims at, until "Place" makes the mark. */
let aim: number | null = null;
let thinkTimer = 0;
/** Solo: the numbers behind each of the computer's moves this game. */
let notes: Note[] = [];

/** Online: the party's channel for this game, and this phone's seat (X is 0, O is 1). */
let channel: Channel<UltimateServerMessage, UltimateClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. */
let latest: UltimateMatch | null = null;
/** Online: the move count a mark this phone sent was aimed from, until the host answers it. */
let pending: number | null = null;
/** Online: the spot the friend aims at, shown dimmed while they are on turn. */
let foeAim: number | null = null;
/** Online: whether the last board drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

const other = (seat: Seat) => (1 - seat) as Seat;
/** Solo, on the computer's turn: input waits for its mark. */
const thinking = () => solo && !isOver(board) && board.turn === COMPUTER;
/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!isOver(board) && board.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;
/** No taps from the player right now. */
const locked = () => isOver(board) || thinking() || waiting() || offline();

const mark = (seat: Seat, cls = "") =>
  `<svg class="ut-mark s${seat}${cls}" viewBox="0 0 24 24" aria-hidden="true">${SHAPES[seat]}</svg>`;

const boardEl = $("ut-board");
const smalls: HTMLElement[] = [];
/** The big mark over a small board that somebody won. */
const bigs: HTMLElement[] = [];
const cells: HTMLButtonElement[] = [];
/** What each small board and each cell shows now, so a redraw touches only what changed. */
const drawnSmall: string[] = [];
const drawn: string[] = [];
for (let b = 0; b < BOARDS; b++) {
  const small = document.createElement("div");
  small.className = "ut-small";
  small.setAttribute("role", "group");
  for (let s = 0; s < SPOTS; s++) {
    const el = document.createElement("button");
    el.className = "ut-cell";
    el.type = "button";
    el.addEventListener("click", () => aimAt(at(b, s)));
    small.append(el);
    cells.push(el);
    drawn.push("");
  }
  const big = document.createElement("div");
  big.className = "ut-big";
  small.append(big);
  boardEl.append(small);
  smalls.push(small);
  bigs.push(big);
  drawnSmall.push("");
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
    Number.isFinite(n.playouts) &&
    Number.isFinite(n.ms);
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

/** Draws the board. Coming from `from`, the new mark draws itself in, and so does a small board it won. */
function drawBoard(from: Board | null = null) {
  const open = new Set(locked() ? [] : openBoards(board));
  const last = board.moves.at(-1) ?? -1;
  // Online, the friend's aim shows while this phone waits for their mark.
  const theirs = waiting() && !isOver(board) ? foeAim : null;
  boardEl.dataset.turn = String(board.turn);
  boardEl.classList.toggle("over", isOver(board));
  smalls.forEach((el, b) => {
    const w = board.won[b] ?? null;
    let cls = "ut-small";
    if (w !== null) cls += ` won s${w}`;
    else if (isFull(board.cells, b)) cls += " dead";
    if (open.has(b)) cls += " open";
    if (board.line.includes(b)) cls += " line";
    const fresh = from !== null && from.won[b] !== w;
    const key = cls + (fresh ? " fresh" : "");
    if (drawnSmall[b] === key) return;
    drawnSmall[b] = key;
    el.className = cls;
    bigs[b]!.innerHTML = w === null ? "" : mark(w, fresh ? " fresh" : "");
    const what =
      w !== null ? `won by ${MARKS[w]}` : cls.includes("dead") ? "full" : open.has(b) ? "open" : "";
    el.setAttribute("aria-label", `${PLACES[b]} board${what && `: ${what}`}`);
  });
  cells.forEach((el, i) => {
    const seat = board.cells[i] ?? null;
    const can = open.has(boardOf(i)) && seat === null;
    let html = "";
    if (seat !== null) html = mark(seat, from && from.cells[i] === null ? " fresh" : "");
    else if (i === aim) html = mark(board.turn, " ghost");
    else if (i === theirs) html = mark(board.turn, " ghost theirs");
    const key = `${html}${can ? "c" : ""}${i === last ? "l" : ""}`;
    if (drawn[i] === key) return;
    drawn[i] = key;
    el.innerHTML = html;
    el.classList.toggle("can", can);
    el.classList.toggle("last", i === last);
    el.classList.toggle("aim", i === aim && seat === null);
    const what =
      seat !== null
        ? MARKS[seat]
        : i === aim
          ? "your aim"
          : i === theirs
            ? `${names[board.turn]}'s aim`
            : can
              ? "you can play here"
              : "empty";
    el.setAttribute("aria-label", `${PLACES[boardOf(i)]} board, ${PLACES[spotOf(i)]} spot: ${what}`);
  });
}

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  if (board.winner === seat) return "Winner";
  if (board.draw) return "Draw";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  const on = !isOver(board) && board.turn === seat;
  if (!channel) return on ? "Your turn" : "";
  // Online, this phone's card says which mark is yours.
  if (seat !== me) return on && latest ? "Their turn" : "";
  return on && latest ? "Your turn" : "You";
}

function drawPlayers() {
  const over = isOver(board);
  const boards = count(board.won);
  for (const seat of [0, 1] as const) {
    const el = $(`ut-pl-${seat}`);
    el.classList.toggle("on", over ? board.winner === seat : board.turn === seat);
    el.querySelector(".ut-name")!.textContent = names[seat];
    el.querySelector(".ut-sub")!.textContent = status(seat);
    el.querySelector(".ut-count")!.textContent = String(boards[seat]);
  }
  $("ut-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="ut-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="ut-mini s1"></i>`
      : "";
  const wait = thinking() || waiting();
  $("ut-act").hidden = over;
  $("ut-status").classList.toggle("go", !wait && !over);
  $("ut-dots").hidden = !wait;
  $<HTMLButtonElement>("ut-place").disabled = aim === null || locked();
  // A hidden line keeps its words, so it never flashes as it goes.
  if (!over) {
    // After the first mark, a free choice of board is news: the last mark sent the player to a closed board.
    const free = board.target === null && board.moves.length > 0 ? " · any board" : "";
    $("ut-status-text").textContent =
      channel && !latest
        ? "Connecting"
        : thinking()
          ? "Computer is thinking"
          : wait
            ? `Waiting for ${names[other(me)]}`
            : (solo || channel ? "Your turn" : `${names[board.turn]}'s turn`) + free;
  }
  $("ut-result").hidden = !over;
  if (over) drawResult();
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

/** The end of a game: who won and why, the computer's numbers in solo, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner;
  $("ut-result-title").textContent =
    w === null ? "It's a draw" : channel && w === me ? "You win!" : `${names[w]} wins!`;
  const boards = count(board.won);
  $("ut-why").textContent =
    w === null
      ? `No board left to play, and no three in a row: ${boards[0]} to ${boards[1]}.`
      : "Three small boards in a row.";
  const again = $<HTMLButtonElement>("ut-again");
  const note = $("ut-note");
  const friend = names[other(me)];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  // Online the line keeps its place, so the board does not jump when the friend asks.
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : "\u00a0";
  const rows: [string, string][] = [];
  if (solo && notes.length > 0) {
    rows.push(["Games played out", fmt(notes.reduce((a, x) => a + x.playouts, 0))]);
    rows.push(["Marks", String(board.moves.length)]);
    rows.push(["Time thinking", fmtMs(notes.reduce((a, x) => a + x.ms, 0))]);
  }
  $("ut-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function draw(from: Board | null = null) {
  drawBoard(from);
  drawPlayers();
}

// ---------- playing ----------

/**
 * Plays the current player's mark on `cell`. Offline, the move counts and
 * saves at once. Online, the host counts it: the mark shows here as it is
 * sent, and stays until the host answers.
 */
function place(cell: number) {
  const before = board;
  const next = play(board, cell);
  if (!next) return;
  if (channel) {
    // Online, only once the host can hear it.
    if (!channel.send({ t: "mark", cell, at: board.moves.length })) return;
    pending = board.moves.length;
  }
  board = next;
  aim = null;
  if (!channel) {
    if (board.winner !== null) wins[board.winner] += 1;
    persist();
  }
  if ("vibrate" in navigator) navigator.vibrate(isOver(board) ? [20, 40, 20, 40, 60] : 12);
  takeTurn(before);
}

/** The player taps a spot: the first tap aims at it, and a second tap on it makes the mark. */
function aimAt(cell: number) {
  if (locked() || !canPlay(board, cell)) return;
  if (aim === cell) return place(cell);
  aim = cell;
  // Online, the friend sees the aim dimmed.
  channel?.send({ t: "aim", cell });
  draw();
}

/**
 * Draws the board and, on the computer's turn, waits a moment and plays its
 * mark. The pick comes from the board and the game's seed, so a reload
 * mid-wait plays the same spot unless the clock cuts the search short.
 */
function takeTurn(from: Board | null = null) {
  clearTimeout(thinkTimer);
  draw(from);
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(() => {
    if (board !== before || !$("ut-game").classList.contains("on")) return;
    const t = think(board, level, seed);
    // Kept for the recap.
    const n = board.moves.length;
    notes = [...notes.filter((x) => x.at !== n), { at: n, playouts: t.playouts, ms: t.ms }];
    place(t.cell);
  }, THINK_MS);
}

function startGame(next: Board) {
  board = next;
  aim = null;
  show("ut-game");
  takeTurn();
}

/** A fresh game with the same players. Whoever went second last time starts. */
function rematch() {
  seed = newSeed();
  notes = [];
  startGame(newBoard(other(board.starter)));
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
  return saved.moves.length === 0 ? saved.starter : other(saved.starter);
}

function goHome() {
  clearTimeout(thinkTimer);
  const saved = ourGame();
  const first = nextStarter(saved);
  $("ut-resume").hidden = !saved || isOver(saved.board) || saved.moves.length === 0;
  $("ut-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Your mark sends the other player to the small board in the same place. " +
    "Win three small boards in a row.";
  const marks = [MARKS[0], solo ? `${MARKS[1]} · ${LEVEL_LABELS[level]}` : MARKS[1]];
  for (const seat of [0, 1] as const) {
    $(`ut-name-${seat}`).textContent = names[seat];
    $(`ut-sub-${seat}`).textContent = marks[seat] + (seat === first ? " · goes first" : "");
  }
  show("ut-home");
}

$("ut-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  notes = [];
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("ut-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board);
});

// ---------- online ----------

/**
 * Catches the board up with the host's latest match. The friend's new mark
 * draws itself in as it would on one phone; anything else (a rematch, a
 * reconnect, a refused mark) redraws the board at once.
 */
function settle() {
  const m = latest;
  if (!channel || !m) return;
  const target = replay(m.first, m.moves);
  if (!target) return;
  wins = [...m.wins];
  const before = board;
  const n = board.moves.length;
  const same = board.starter === target.starter && board.moves.every((c, i) => target.moves[i] === c);
  if (target.moves.length !== n || !same) {
    board = target;
    aim = null;
    foeAim = null;
  }
  if (pending !== null) {
    // The mark this phone sent never counted (a drop in the connection, say).
    if (target.moves.length <= pending) toast("Connection hiccup · place that one again");
    pending = null;
  }
  // One more mark on the same game is the friend's move: it draws itself in.
  const moved = same && target.moves.length === n + 1;
  draw(moved ? before : null);
  if (moved && "vibrate" in navigator && isOver(board)) navigator.vibrate([20, 40, 20, 40, 60]);
  const mine = !isOver(board) && board.turn === me;
  if (mine && !wasMine) yourTurn();
  wasMine = mine;
}

function yourTurn() {
  toast(board.target === null && board.moves.length > 0 ? "Your turn · any board" : "Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("ut-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("ut-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: UltimateServerMessage) {
  if (msg.t === "aim") {
    // The friend's aim: cosmetic, and only while they are on turn.
    if (msg.seat === me || board.turn !== msg.seat || !canPlay(board, msg.cell)) return;
    foeAim = msg.cell;
    return draw();
  }
  latest = msg.match;
  settle();
}

/** The connection or the players changed. */
function onChange() {
  const ch = channel;
  if (!ch) return;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.update();
  draw();
}

function openOnline(ch: Channel<UltimateServerMessage, UltimateClientMessage>) {
  channel = ch;
  me = ch.me;
  latest = null;
  pending = null;
  foeAim = null;
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

$("ut-place").addEventListener("click", () => {
  if (aim !== null && !locked()) place(aim);
});
$("ut-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("ut-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __ultimate: unknown }).__ultimate = {
  state: () => ({
    moves: board.moves,
    starter: board.starter,
    turn: board.turn,
    target: board.target,
    open: openBoards(board),
    legal: legalMoves(board),
    won: board.won,
    line: board.line,
    over: isOver(board),
    winner: board.winner,
    draw: board.draw,
    boards: count(board.won),
    aim,
    thinking: thinking(),
    wins,
    seed,
    level: solo ? level : null,
    me: channel ? me : null,
    locked: locked(),
    rematch: latest?.rematch ?? null,
    foeAim,
    pending,
    notes,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    // Straight into the party's game, on this phone's seat.
    solo = false;
    if (!channel) openOnline(session.channel as Channel<UltimateServerMessage, UltimateClientMessage>);
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
  clearTimeout(thinkTimer);
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  foeAim = null;
  clearTimeout(toastTimer);
  $("ut-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
