// Dots and Boxes' entry: pass-and-play on one phone, solo against the
// computer, or online with a friend in a party. A tap between two dots draws
// the line there; a line that closes a box colours it and gives another turn.
// Offline, the game saves after every line, so a reload or a trip to the menu
// picks up where it left off, the computer's pending line included. Online,
// the host on the server holds the game (core/host.ts) and this phone draws
// what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store } from "../../../shell/storage.ts";
import { LEVELS, newSeed, think, type Level } from "../core/ai.ts";
import {
  BOXES,
  LINES,
  SIZE,
  canPlay,
  legalMoves,
  lineAt,
  newBoard,
  play,
  replay,
  type Board,
  type Seat,
} from "../core/board.ts";
import type { BoxesClientMessage, BoxesMatch, BoxesServerMessage } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = store("dots-and-boxes.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Orange", "Blue"] as const;
/** In solo the player is orange and the computer blue. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it draws, and before each further line of an extra turn. */
const THINK_MS = 500;
const AGAIN_MS = 260;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

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

/** One of the computer's moves, in numbers: `at` is how many lines were drawn before it. */
interface Note {
  at: number;
  positions: number;
  ms: number;
  /** True when the computer read this move to the end of the game. */
  exact: boolean;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let board: Board = newBoard();
let seed = 0;
let thinkTimer = 0;
/** Solo: the numbers behind each of the computer's moves this game. */
let notes: Note[] = [];

/** Online: the party's channel for this game, and this phone's seat (orange is 0, blue 1). */
let channel: Channel<BoxesServerMessage, BoxesClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. */
let latest: BoxesMatch | null = null;
/** Online: the line count a move this phone sent was picked from, until the host answers it. */
let pending: number | null = null;
/** Online: how many lines the host's last message had. */
let heard = 0;
/** Online: whether the last board drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

const other = (seat: Seat) => (1 - seat) as Seat;
/** Solo, on the computer's turn. */
const thinking = () => solo && !board.over && board.turn === COMPUTER;
/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!board.over && board.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** No taps from the player right now. */
const locked = () => board.over || thinking() || waiting() || offline();

const boardEl = $("db-board");

/** Places `el` at the dot `row`, `col`. */
function sit(el: HTMLElement, row: number, col: number) {
  el.style.setProperty("--row", String(row));
  el.style.setProperty("--col", String(col));
}

const boxes: HTMLElement[] = [];
for (let i = 0; i < BOXES; i++) {
  const el = document.createElement("div");
  el.className = "db-box";
  sit(el, Math.floor(i / SIZE), i % SIZE);
  boardEl.append(el);
  boxes.push(el);
}
const lines: HTMLButtonElement[] = [];
for (let i = 0; i < LINES; i++) {
  const el = document.createElement("button");
  const where = lineAt(i);
  el.className = `db-line ${where.across ? "across" : "down"}`;
  el.type = "button";
  el.innerHTML = `<i class="db-ink"></i>`;
  sit(el, where.row, where.col);
  el.addEventListener("click", () => move(i));
  boardEl.append(el);
  lines.push(el);
}
for (let i = 0; i < (SIZE + 1) * (SIZE + 1); i++) {
  const el = document.createElement("i");
  el.className = "db-dot";
  sit(el, Math.floor(i / (SIZE + 1)), i % (SIZE + 1));
  boardEl.append(el);
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
    typeof n.exact === "boolean";
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

/** A box shows its owner's initial. */
const initial = (seat: Seat) => [...names[seat]][0]?.toUpperCase() ?? "";

/**
 * Draws the board. Coming from `from`, the new lines are drawn in and the
 * boxes they closed pop. With no `from`, nothing moves.
 */
function drawBoard(from: Board | null = null) {
  const open = !locked();
  const last = board.moves.at(-1) ?? -1;
  lines.forEach((el, i) => {
    const seat = board.lines[i] ?? null;
    const free = seat === null;
    const where = lineAt(i);
    // A line still being drawn in keeps going through a redraw.
    const fresh = from ? from.lines[i] === null : el.classList.contains("fresh");
    el.className = `db-line ${where.across ? "across" : "down"}`;
    if (!free) el.classList.add(`s${seat}`);
    if (i === last) el.classList.add("last");
    if (!free && fresh) el.classList.add("fresh");
    if (free && open) el.classList.add("can");
    const what = free ? "free" : `drawn by ${names[seat]}`;
    el.setAttribute(
      "aria-label",
      `${where.across ? "Across" : "Down"} from dot ${where.row + 1}, ${where.col + 1}: ${what}`,
    );
  });
  boxes.forEach((el, i) => {
    const seat = board.boxes[i] ?? null;
    const fresh = from ? from.boxes[i] === null : el.classList.contains("fresh");
    el.className = "db-box";
    if (seat !== null) el.classList.add(`s${seat}`);
    if (seat !== null && fresh) el.classList.add("fresh");
    el.textContent = seat === null ? "" : initial(seat);
  });
}

/** How this phone talks about `seat`: "You" for its own player in solo and online. */
const you = (seat: Seat) => (solo ? seat !== COMPUTER : channel !== null && seat === me);

/** After a closed box: who plays again. */
const againText = () =>
  you(board.turn) ? "Box closed · go again" : `Box closed · ${names[board.turn]} goes again`;

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  if (board.over && board.winner === seat) return "Winner";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  const on = !board.over && board.turn === seat;
  if (!channel) return on ? "Your turn" : "";
  // Online, this phone's card says which colour is yours.
  if (seat !== me) return on && latest ? "Their turn" : "";
  return on && latest ? "Your turn" : "You";
}

function drawPlayers() {
  for (const seat of [0, 1] as const) {
    const el = $(`db-pl-${seat}`);
    el.classList.toggle("on", board.over ? board.winner === seat : board.turn === seat);
    el.querySelector(".db-name")!.textContent = names[seat];
    el.querySelector(".db-sub")!.textContent = status(seat);
    el.querySelector(".db-count")!.textContent = String(board.score[seat]);
  }
  $("db-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="db-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="db-mini s1"></i>`
      : "";
  const wait = thinking() || waiting();
  const bar = $("db-status");
  bar.hidden = board.over;
  bar.classList.toggle("go", !wait && !board.over);
  $("db-dots").hidden = !wait;
  // A hidden bar keeps its words, so it never flashes "Connecting" as it goes.
  if (!board.over) {
    $("db-status-text").textContent =
      channel && !latest
        ? "Connecting"
        : board.again
          ? againText()
          : thinking()
            ? "Computer is thinking"
            : wait
              ? `Waiting for ${names[other(me)]}`
              : solo || channel
                ? "Your turn"
                : `${names[board.turn]}'s turn`;
  }
  $("db-result").hidden = !board.over;
  if (board.over) drawResult();
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

/** The end of a game: who won and why, the computer's numbers in solo, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner ?? 0;
  $("db-result-title").textContent = channel && w === me ? "You win!" : `${names[w]} wins!`;
  $("db-why").textContent = `Most boxes: ${board.score[w]} to ${board.score[other(w)]}.`;
  const again = $<HTMLButtonElement>("db-again");
  const note = $("db-note");
  const friend = names[other(me)];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  // Online the line keeps its place, so the board does not jump when the friend asks.
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : " ";
  const rows: [string, string][] = [];
  if (solo && notes.length > 0) {
    rows.push(["Positions checked", fmt(notes.reduce((a, x) => a + x.positions, 0))]);
    rows.push(["Lines read to the end", fmt(notes.filter((x) => x.exact).length)]);
    rows.push(["Time thinking", fmtMs(notes.reduce((a, x) => a + x.ms, 0))]);
  }
  $("db-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/** Draws the game. Coming from `from`, the lines drawn since then are drawn in. */
function draw(from: Board | null = null) {
  drawBoard(from);
  drawPlayers();
}

// ---------- playing ----------

/** Draws `line` for the current player: the move counts and saves at once. */
function place(line: number): boolean {
  const before = board;
  const next = play(board, line);
  if (!next) return false;
  board = next;
  if (!channel) {
    if (board.winner !== null) wins[board.winner] += 1;
    persist();
  }
  draw(before);
  if ("vibrate" in navigator)
    navigator.vibrate(board.over ? [20, 40, 20, 40, 60] : board.again ? [12, 30, 12] : 12);
  return true;
}

/** The player taps a line. Online, the host hears of it as the line is drawn. */
function move(line: number) {
  if (locked() || !canPlay(board, line)) return;
  if (channel) {
    // Online, only once the host can hear it. The line stays until the host answers.
    if (!channel.send({ t: "move", line, at: board.moves.length })) return;
    pending = board.moves.length;
    place(line);
    return;
  }
  place(line);
  takeTurn();
}

/**
 * On the computer's turn, waits a moment and draws its line. The pick comes
 * from the board and the game's seed alone, so a reload mid-wait draws the
 * same line.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(
    () => {
      if (board !== before || !$("db-game").classList.contains("on")) return;
      const t = think(board, level, seed);
      // Kept for the recap.
      const at = board.moves.length;
      notes = [...notes.filter((x) => x.at !== at), { at, positions: t.positions, ms: t.ms, exact: t.exact }];
      if (place(t.line)) takeTurn();
    },
    board.again ? AGAIN_MS : THINK_MS,
  );
}

function startGame(next: Board) {
  board = next;
  show("db-game");
  draw();
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
  $("db-resume").hidden = !saved || saved.board.over || saved.moves.length === 0;
  $("db-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Draw a line between two dots. Close a box to keep it and go again. Most boxes wins.";
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`db-name-${seat}`).textContent = names[seat];
    $(`db-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · goes first" : "");
  }
  show("db-home");
}

$("db-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  notes = [];
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("db-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board);
});

// ---------- online ----------

/**
 * Catches the board up with the host's latest match. The friend's new lines
 * are drawn in as they would be on one phone; anything else (a rematch, a
 * reconnect, a refused move) redraws the board at once.
 */
function settle() {
  const m = latest;
  if (!channel || !m) return;
  const target = replay(m.first, m.moves);
  if (!target) return;
  wins = [...m.wins];
  const before = board;
  // In an extra turn this phone may draw a second line before the host has
  // answered the first. The answer then holds some of its lines, not all yet:
  // the board stays, and the next answer settles it.
  const behind =
    pending !== null &&
    target.starter === before.starter &&
    target.moves.length > heard &&
    target.moves.length < before.moves.length &&
    target.moves.every((line, i) => before.moves[i] === line);
  heard = target.moves.length;
  if (behind) return;
  const grew =
    target.starter === before.starter &&
    target.moves.length > before.moves.length &&
    before.moves.every((line, i) => target.moves[i] === line);
  board = target;
  if (pending !== null) {
    // The move this phone sent never counted (a drop in the connection, say).
    if (target.moves.length <= pending) toast("Connection hiccup · play that one again");
    pending = null;
  }
  draw(grew ? before : null);
  const mine = !board.over && board.turn === me;
  if (mine && !wasMine) yourTurn();
  wasMine = mine;
}

function yourTurn() {
  toast("Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("db-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("db-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: BoxesServerMessage) {
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

function openOnline(ch: Channel<BoxesServerMessage, BoxesClientMessage>) {
  channel = ch;
  me = ch.me;
  latest = null;
  pending = null;
  heard = 0;
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

$("db-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("db-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __boxes: unknown }).__boxes = {
  state: () => ({
    moves: board.moves,
    starter: board.starter,
    turn: board.turn,
    again: board.again,
    over: board.over,
    winner: board.winner,
    score: board.score,
    legal: legalMoves(board),
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
    if (!channel) openOnline(session.channel as Channel<BoxesServerMessage, BoxesClientMessage>);
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
  // Only the computer's wait runs in the background; the game is saved after every line.
  clearTimeout(thinkTimer);
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("db-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
