// Reversi's entry: pass-and-play on one phone, solo against the computer, or
// online with a friend in a party. Faint dots mark the cells the player on
// turn may play; a tap on one lands a disc there, and the discs it outflanks
// turn over one after another. Offline, the game saves after every move, so a
// reload or a trip to the menu picks up where it left off, the computer's
// pending move included. Online, the host on the server holds the game
// (core/host.ts) and this phone draws what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store } from "../../../shell/storage.ts";
import { LEVELS, newSeed, think, type Level } from "../core/ai.ts";
import {
  CELLS,
  SIZE,
  canPlay,
  count,
  legalMoves,
  newBoard,
  play,
  replay,
  type Board,
  type Seat,
} from "../core/board.ts";
import type { ReversiClientMessage, ReversiMatch, ReversiServerMessage } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = store("reversi.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Dark", "Light"] as const;
/** In solo the player is dark and the computer light. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it moves. */
const THINK_MS = 500;
/** A new disc lands, then each outflanked disc turns over a step after the one before it. */
const LAND_MS = 80;
const STEP_MS = 45;
const FLIP_MS = 320;
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

/** One of the computer's moves, in numbers: `at` is how many discs were played before it. */
interface Note {
  at: number;
  positions: number;
  ms: number;
  depth: number;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let board: Board = newBoard();
let seed = 0;
/** True while discs are turning over: input waits for them. */
let busy = false;
/** Bumped by every new game, so discs still turning from the last one do not hold this board up. */
let gameId = 0;
let thinkTimer = 0;
/** Solo: the numbers behind each of the computer's moves this game. */
let notes: Note[] = [];

/** Online: the party's channel for this game, and this phone's seat (dark is 0, light 1). */
let channel: Channel<ReversiServerMessage, ReversiClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. The board catches up with it once the discs stop turning. */
let latest: ReversiMatch | null = null;
/** Online: the move count a move this phone sent was picked from, until the host answers it. */
let pending: number | null = null;
/** Online: whether the last board drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

const other = (seat: Seat) => (1 - seat) as Seat;
/** Solo, on the computer's turn: input waits until its discs have turned. */
const thinking = () => solo && !board.over && board.turn === COMPUTER;
/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!board.over && board.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** No taps from the player right now. */
const locked = () => busy || board.over || thinking() || waiting() || offline();

const boardEl = $("rv-board");
const cells: HTMLButtonElement[] = [];
/** What each cell shows now, so a redraw touches only the cells that changed. */
const drawn: string[] = [];
for (let i = 0; i < CELLS; i++) {
  const el = document.createElement("button");
  el.className = "rv-cell";
  el.type = "button";
  el.setAttribute("role", "gridcell");
  el.addEventListener("click", () => void move(i));
  boardEl.append(el);
  cells.push(el);
  drawn.push("");
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
    Number.isFinite(n.depth);
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

/** How many cells apart two cells are, counting a diagonal step as one. */
function steps(a: number, b: number): number {
  const rows = Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
  return Math.max(rows, Math.abs((a % SIZE) - (b % SIZE)));
}

/** Draws the board. Coming from `from`, the new disc lands and the discs it outflanked turn over. */
function drawBoard(from: Board | null = null) {
  const dots = new Set(locked() ? [] : legalMoves(board));
  const last = board.moves.at(-1) ?? -1;
  cells.forEach((el, i) => {
    const seat = board.cells[i] ?? null;
    let html = "";
    if (seat !== null) {
      let cls = `rv-disc s${seat}`;
      let style = "";
      if (i === last) cls += " last";
      if (from && from.cells[i] === null) cls += " fresh";
      else if (from && from.cells[i] !== seat) {
        cls += " flip";
        style = ` style="--delay: ${LAND_MS + (steps(i, last) - 1) * STEP_MS}ms"`;
      }
      html = `<div class="${cls}"${style}></div>`;
    } else if (dots.has(i)) html = `<i class="rv-dot s${board.turn}"></i>`;
    if (drawn[i] === html) return;
    drawn[i] = html;
    el.innerHTML = html;
    el.classList.toggle("can", dots.has(i));
    const what = seat !== null ? COLOURS[seat].toLowerCase() : dots.has(i) ? "you can play here" : "empty";
    el.setAttribute("aria-label", `Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}: ${what}`);
  });
}

/** How this phone talks about `seat`: "You" for its own player in solo and online. */
const you = (seat: Seat) => (solo ? seat !== COMPUTER : channel !== null && seat === me);

/** After a pass: who could not move, and who plays again. */
function passText(): string {
  const stuck = other(board.turn);
  const again = you(board.turn) ? "go again" : `${names[board.turn]} goes again`;
  return `${you(stuck) ? "You" : names[stuck]} can't move · ${again}`;
}

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  const over = board.over && !busy;
  if (over && board.winner === seat) return "Winner";
  if (over && board.draw) return "Draw";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  const on = !board.over && board.turn === seat;
  if (!channel) return on ? "Your turn" : "";
  // Online, this phone's card says which colour is yours.
  if (seat !== me) return on && latest ? "Their turn" : "";
  return on && latest ? "Your turn" : "You";
}

function drawPlayers() {
  // The result waits for the last discs to turn.
  const over = board.over && !busy;
  const discs = count(board.cells);
  for (const seat of [0, 1] as const) {
    const el = $(`rv-pl-${seat}`);
    el.classList.toggle("on", over ? board.winner === seat : board.turn === seat);
    el.querySelector(".rv-name")!.textContent = names[seat];
    el.querySelector(".rv-sub")!.textContent = status(seat);
    el.querySelector(".rv-count")!.textContent = String(discs[seat]);
  }
  $("rv-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="rv-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="rv-mini s1"></i>`
      : "";
  const wait = thinking() || waiting();
  const bar = $("rv-status");
  bar.hidden = over;
  bar.classList.toggle("go", !wait && !board.over);
  $("rv-dots").hidden = !wait;
  // A hidden bar keeps its words, so it never flashes "Connecting" as it goes.
  if (!board.over) {
    $("rv-status-text").textContent =
      channel && !latest
        ? "Connecting"
        : board.passed
          ? passText()
          : thinking()
            ? "Computer is thinking"
            : wait
              ? `Waiting for ${names[other(me)]}`
              : solo || channel
                ? "Your turn"
                : `${names[board.turn]}'s turn`;
  }
  $("rv-result").hidden = !over;
  if (over) drawResult();
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

/** The end of a game: who won and why, the computer's numbers in solo, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner;
  $("rv-result-title").textContent =
    w === null ? "It's a draw" : channel && w === me ? "You win!" : `${names[w]} wins!`;
  const discs = count(board.cells);
  const [hi, lo] = [Math.max(...discs), Math.min(...discs)];
  const early = hi + lo < CELLS ? "Nobody can move: " : "";
  $("rv-why").textContent =
    w === null ? `${early}${hi} discs each.` : `${early || "Most discs: "}${hi} to ${lo}.`;
  const again = $<HTMLButtonElement>("rv-again");
  const note = $("rv-note");
  const friend = names[other(me)];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  // Online the line keeps its place, so the board does not jump when the friend asks.
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : " ";
  const rows: [string, string][] = [];
  if (solo && notes.length > 0) {
    rows.push(["Positions checked", fmt(notes.reduce((a, x) => a + x.positions, 0))]);
    rows.push(["Deepest look", `${Math.max(...notes.map((x) => x.depth))} moves ahead`]);
    rows.push(["Time thinking", fmtMs(notes.reduce((a, x) => a + x.ms, 0))]);
  }
  $("rv-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function draw() {
  // Discs that are turning redraw when they stop.
  if (!busy) drawBoard();
  drawPlayers();
}

// ---------- playing ----------

/**
 * Plays the current player's disc on `cell`: the move counts and saves at
 * once, then the discs turn over. False when a new game started meanwhile.
 */
async function place(cell: number): Promise<boolean> {
  const before = board;
  const next = play(board, cell);
  if (!next) return false;
  const id = gameId;
  busy = true;
  board = next;
  if (!channel) {
    if (board.winner !== null) wins[board.winner] += 1;
    persist();
  }
  drawBoard(before);
  drawPlayers();
  if (board.passed) toast(passText());
  if ("vibrate" in navigator) navigator.vibrate(board.over ? [20, 40, 20, 40, 60] : 12);
  let far = 1;
  board.cells.forEach((seat, i) => {
    if (before.cells[i] !== null && before.cells[i] !== seat) far = Math.max(far, steps(i, cell));
  });
  const ms = reducedMotion.matches ? 0 : LAND_MS + (far - 1) * STEP_MS + FLIP_MS;
  await new Promise((done) => setTimeout(done, ms));
  if (id !== gameId) return false;
  busy = false;
  return true;
}

/** The player taps a cell. Online, the host hears of it as the disc lands. */
async function move(cell: number) {
  if (locked() || !canPlay(board, cell)) return;
  const ch = channel;
  const sent = latest;
  if (ch) {
    // Online, only once the host can hear it.
    if (!ch.send({ t: "move", cell, at: board.moves.length })) return;
    pending = board.moves.length;
  }
  if (!(await place(cell)) || ch !== channel) return;
  // Online, the disc stays where it landed until the host answers. If it
  // already has, catch up with that answer now.
  if (ch) return void (latest !== sent ? settle() : draw());
  takeTurn();
}

/**
 * Draws the board and, on the computer's turn, waits a moment and plays its
 * disc. The pick comes from the board and the game's seed alone, so a reload
 * mid-wait plays the same cell.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  draw();
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(() => {
    if (board !== before || !$("rv-game").classList.contains("on")) return;
    const t = think(board, level, seed);
    // Kept for the recap.
    const at = board.moves.length;
    notes = [...notes.filter((x) => x.at !== at), { at, positions: t.positions, ms: t.ms, depth: t.depth }];
    void place(t.cell).then((ok) => ok && takeTurn());
  }, THINK_MS);
}

function startGame(next: Board) {
  gameId++;
  board = next;
  busy = false;
  show("rv-game");
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
  $("rv-resume").hidden = !saved || saved.board.over || saved.moves.length === 0;
  $("rv-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Trap discs between two of yours to turn them over. Most discs wins.";
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`rv-name-${seat}`).textContent = names[seat];
    $(`rv-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · goes first" : "");
  }
  show("rv-home");
}

$("rv-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  notes = [];
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("rv-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board);
});

// ---------- online ----------

/**
 * Catches the board up with the host's latest match. The friend's new disc
 * lands and turns discs over as it would on one phone; anything else (a
 * rematch, a reconnect, a refused move) redraws the board at once.
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
    if (!(await place(target.moves[n]!)) || ch !== channel) return;
    return settle();
  }
  if (target.moves.length !== n || !same(board)) board = target;
  if (pending !== null) {
    // The move this phone sent never counted (a drop in the connection, say).
    if (target.moves.length <= pending) toast("Connection hiccup · play that one again");
    pending = null;
  }
  draw();
  const mine = !board.over && board.turn === me;
  if (mine && !wasMine) yourTurn();
  wasMine = mine;
}

function yourTurn() {
  // After a pass, the alert already says who goes again.
  if (!board.passed) toast("Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("rv-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("rv-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: ReversiServerMessage) {
  latest = msg.match;
  void settle();
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

function openOnline(ch: Channel<ReversiServerMessage, ReversiClientMessage>) {
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
  // The opening board, waiting, until the host sends the game.
  startGame(newBoard());
  ch.listen({ message: onMessage, change: onChange });
}

$("rv-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("rv-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __reversi: unknown }).__reversi = {
  state: () => ({
    moves: board.moves,
    starter: board.starter,
    turn: board.turn,
    passed: board.passed,
    over: board.over,
    winner: board.winner,
    draw: board.draw,
    discs: count(board.cells),
    legal: legalMoves(board),
    busy,
    thinking: thinking(),
    wins,
    seed,
    level: solo ? level : null,
    me: channel ? me : null,
    locked: locked(),
    rematch: latest?.rematch ?? null,
    notes,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    // Straight into the party's game, on this phone's seat.
    solo = false;
    if (!channel) openOnline(session.channel as Channel<ReversiServerMessage, ReversiClientMessage>);
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
  // Online, the game stays on the server; discs still turning are dropped with it.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("rv-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
