// Mancala's entry: pass-and-play on one phone, solo against the computer, or
// online with a friend in a party. A tap on a pit sows its seeds one hole at
// a time, round to the mover's store. The move counts and saves at once; the
// seeds then fall one by one so the eye can follow them. Offline, a reload or
// a trip to the menu picks up where the game left off, the computer's pending
// move included. Online, the host on the server holds the game (core/host.ts)
// and this phone draws what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store as storage } from "../../../shell/storage.ts";
import { LEVELS, newSeed, think, type Level } from "../core/ai.ts";
import {
  HOLES,
  PITS,
  canPlay,
  hole,
  legalMoves,
  newBoard,
  opposite,
  owner,
  play,
  replay,
  score,
  sowing,
  store,
  type Board,
  type Seat,
} from "../core/board.ts";
import type { MancalaClientMessage, MancalaMatch, MancalaServerMessage } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = storage("mancala.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Amber", "Teal"] as const;
/** In solo the player is amber and the computer teal. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it sows, and before each further move of an extra turn. */
const THINK_MS = 500;
const AGAIN_MS = 300;
/** The sowing: one seed every SOW_MS, then a beat before a capture or the end-of-game sweep, and one after the move. */
const SOW_MS = 100;
const TAKE_MS = 320;
const REST_MS = 220;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

/** One of the computer's moves, in numbers: `at` is how many moves were played before it. */
interface Note {
  at: number;
  positions: number;
  ms: number;
  /** How many moves ahead the computer read. */
  depth: number;
}

/** One step of a move on screen: the seeds in each hole, and the holes that flash. */
interface Frame {
  holes: number[];
  hot: number[];
  kind: "lift" | "drop" | "take" | "sweep";
  /** How long the frame before this one stays up. */
  wait: number;
  /** Seeds each store won at once in this frame. */
  gain: [number, number];
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
/** The seeds drawn in each hole. It trails `board` while a move's seeds fall. */
let shown: number[] = board.holes;
/** True while a move's seeds fall. */
let busy = false;
let sowTimer = 0;

/** Online: the party's channel for this game, and this phone's seat (amber is 0, teal 1). */
let channel: Channel<MancalaServerMessage, MancalaClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. */
let latest: MancalaMatch | null = null;
/** Online: the move count a move this phone sent was picked from, until the host answers it. */
let pending: number | null = null;
/** Online: how many moves the host's last message had. */
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
const locked = () => board.over || busy || thinking() || waiting() || offline();

/**
 * The seat whose pits run down the left side, with its store at the bottom.
 * Online, that is this phone's player, so both friends see their own store
 * nearest to them.
 */
const near = (): Seat => (channel ? me : 0);

const boardEl = $("mc-board");

const holes: HTMLElement[] = [];
for (let h = 0; h < HOLES; h++) {
  const pit = h !== store(owner(h));
  const el = document.createElement(pit ? "button" : "div");
  if (pit) {
    (el as HTMLButtonElement).type = "button";
    el.addEventListener("click", () => {
      if (owner(h) === board.turn) move(h - hole(owner(h), 0));
    });
  }
  el.innerHTML =
    `<b class="mc-n"></b><span class="mc-seeds" aria-hidden="true"></span>` +
    (pit ? "" : `<span class="mc-gain" aria-hidden="true"></span>`);
  boardEl.append(el);
  holes.push(el);
}

/** Puts each hole in its place: the near seat's pits down the left, the other's up the right. */
function layout() {
  holes.forEach((el, h) => {
    const seat = owner(h);
    const close = seat === near();
    if (h === store(seat)) {
      el.style.gridRow = close ? "8" : "1";
      return;
    }
    const pit = h - hole(seat, 0);
    el.style.gridColumn = close ? "1" : "2";
    el.style.gridRow = String(close ? 2 + pit : 1 + PITS - pit);
  });
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

/** The hole the last move was sown from, or -1 before the first move. */
function lastFrom(): number {
  const before = replay(board.starter, board.moves.slice(0, -1));
  return board.moves.length === 0 || !before ? -1 : hole(before.turn, board.moves.at(-1)!);
}

/**
 * Draws the seeds in `shown`. With a `frame`, its holes flash, new seeds pop
 * in and the stores show what they won.
 */
function drawBoard(frame: Frame | null = null) {
  const open = !locked();
  const from = lastFrom();
  holes.forEach((el, h) => {
    const seat = owner(h);
    const pit = h !== store(seat);
    const n = shown[h]!;
    const hot = frame?.hot.includes(h) ?? false;
    el.className = `mc-hole ${pit ? "mc-pit" : "mc-store"} s${seat}${seat === near() ? "" : " far"}`;
    if (pit && open && seat === board.turn && n > 0) el.classList.add("can");
    if (h === from) el.classList.add("from");
    if (hot) {
      // The same hole may flash twice in a row: start its animation over.
      void el.offsetWidth;
      el.classList.add(frame!.kind);
    }
    el.querySelector(".mc-n")!.textContent = String(n);
    const seeds = el.querySelector(".mc-seeds")!;
    for (const old of seeds.querySelectorAll(".new")) old.classList.remove("new");
    while (seeds.childElementCount > n) seeds.lastElementChild!.remove();
    while (seeds.childElementCount < n) {
      const s = document.createElement("i");
      if (hot) s.className = "new";
      seeds.append(s);
    }
    const what = pit ? `${names[seat]}'s pit ${h - hole(seat, 0) + 1}` : `${names[seat]}'s store`;
    el.setAttribute("aria-label", `${what}: ${n} ${n === 1 ? "seed" : "seeds"}`);
    const won = pit ? 0 : (frame?.gain[seat] ?? 0);
    if (won > 0) {
      const gain = el.querySelector(".mc-gain")!;
      gain.textContent = `+${won}`;
      gain.classList.remove("on");
      void (gain as HTMLElement).offsetWidth;
      gain.classList.add("on");
    }
  });
}

/** How this phone talks about `seat`: "You" for its own player in solo and online. */
const you = (seat: Seat) => (solo ? seat !== COMPUTER : channel !== null && seat === me);

/** After a last seed in the mover's store: who plays again. */
const againText = () =>
  you(board.turn) ? "Extra turn · go again" : `Extra turn · ${names[board.turn]} goes again`;

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
    const el = $(`mc-pl-${seat}`);
    // Each card sits over its player's side of the board.
    el.style.order = seat === near() ? "0" : "1";
    el.classList.toggle("right", seat !== near());
    el.querySelector(".mc-count")!.textContent = String(shown[store(seat)]);
    // While seeds fall, the cards and the bar keep the turn the move was made on.
    if (busy) continue;
    el.classList.toggle("on", board.over ? board.winner === seat : board.turn === seat);
    el.querySelector(".mc-name")!.textContent = names[seat];
    el.querySelector(".mc-sub")!.textContent = status(seat);
  }
  const bar = $("mc-status");
  const wait = !busy && (thinking() || waiting());
  bar.classList.toggle("go", !wait && !busy && !board.over);
  $("mc-dots").hidden = !wait;
  if (busy) return;
  $("mc-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="mc-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="mc-mini s1"></i>`
      : "";
  bar.hidden = board.over;
  // A hidden bar keeps its words, so it never flashes "Connecting" as it goes.
  if (!board.over) {
    $("mc-status-text").textContent =
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
  $("mc-result").hidden = !board.over;
  if (board.over) drawResult();
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

/** The end of a game: who won and why, the computer's numbers in solo, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner;
  $("mc-result-title").textContent =
    w === null ? "It's a draw!" : channel && w === me ? "You win!" : `${names[w]} wins!`;
  $("mc-why").textContent =
    w === null
      ? `${score(board, 0)} seeds each.`
      : `Most seeds: ${score(board, w)} to ${score(board, other(w))}.`;
  const again = $<HTMLButtonElement>("mc-again");
  const note = $("mc-note");
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
    rows.push(["Deepest look", `${fmt(Math.max(...notes.map((x) => x.depth)))} moves`]);
    rows.push(["Time thinking", fmtMs(notes.reduce((a, x) => a + x.ms, 0))]);
  }
  $("mc-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/** Draws the game as it stands, with nothing moving. */
function draw() {
  stopSowing();
  drawBoard();
  drawPlayers();
}

// ---------- sowing ----------

/** Ends a move's animation where it is; the next draw shows the true board. */
function stopSowing() {
  clearTimeout(sowTimer);
  busy = false;
  shown = board.holes;
}

/** The steps that take `before` to `after` by the mover's `pit`: a lift, one seed a hole, a capture, the last sweep. */
function framesOf(before: Board, pit: number, after: Board): Frame[] {
  const mover = before.turn;
  const from = hole(mover, pit);
  const path = sowing(before, pit);
  let seeds = before.holes.slice();
  seeds[from] = 0;
  const out: Frame[] = [{ holes: seeds, hot: [from], kind: "lift", wait: 0, gain: [0, 0] }];
  for (const h of path) {
    seeds = seeds.slice();
    seeds[h]!++;
    out.push({ holes: seeds, hot: [h], kind: "drop", wait: SOW_MS, gain: [0, 0] });
  }
  if (after.captured > 0) {
    const last = path.at(-1)!;
    seeds = seeds.slice();
    seeds[last] = 0;
    seeds[opposite(last)] = 0;
    seeds[store(mover)]! += after.captured;
    const gain: [number, number] = [0, 0];
    gain[mover] = after.captured;
    out.push({ holes: seeds, hot: [last, opposite(last), store(mover)], kind: "take", wait: TAKE_MS, gain });
  }
  if (after.swept[0] + after.swept[1] > 0) {
    const hot = seeds.flatMap((n, h) => (n > 0 && h !== store(owner(h)) ? [h, store(owner(h))] : []));
    out.push({ holes: after.holes, hot, kind: "sweep", wait: TAKE_MS, gain: after.swept });
  }
  return out;
}

/**
 * Shows the move that took `before` to the board, seed by seed, then calls
 * `then`. With reduced motion the seeds land at once.
 */
function sow(before: Board, pit: number, then: () => void) {
  stopSowing();
  const frames = stillMotion.matches ? [] : framesOf(before, pit, board);
  const after = board;
  busy = frames.length > 0;
  let i = 0;
  const step = () => {
    // A new game or a resync took over.
    if (board !== after) return;
    const frame = frames[i++];
    if (!frame) {
      draw();
      then();
      return;
    }
    shown = frame.holes;
    drawBoard(frame);
    drawPlayers();
    sowTimer = window.setTimeout(step, frames[i]?.wait ?? REST_MS);
  };
  step();
}

// ---------- playing ----------

/** Sows `pit` for the current player: the move counts and saves at once, then its seeds fall. */
function place(pit: number, then: () => void): boolean {
  const before = board;
  const next = play(board, pit);
  if (!next) return false;
  board = next;
  if (!channel) {
    if (board.winner !== null) wins[board.winner] += 1;
    persist();
  }
  sow(before, pit, then);
  if ("vibrate" in navigator)
    navigator.vibrate(board.over ? [20, 40, 20, 40, 60] : board.again ? [12, 30, 12] : 12);
  return true;
}

/** The player taps a pit. Online, the host hears of it as the seeds start to fall. */
function move(pit: number) {
  if (locked() || !canPlay(board, pit)) return;
  if (channel) {
    // Online, only once the host can hear it. The move stays until the host answers.
    if (!channel.send({ t: "move", pit, at: board.moves.length })) return;
    pending = board.moves.length;
    place(pit, () => {});
    return;
  }
  place(pit, takeTurn);
}

/**
 * On the computer's turn, waits a moment and sows its pit. The pick comes
 * from the board and the game's seed alone, so a reload mid-wait sows the
 * same pit.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(
    () => {
      if (board !== before || !$("mc-game").classList.contains("on")) return;
      const t = think(board, level, seed);
      // Kept for the recap.
      const at = board.moves.length;
      notes = [...notes.filter((x) => x.at !== at), { at, positions: t.positions, ms: t.ms, depth: t.depth }];
      place(t.pit, takeTurn);
    },
    board.again ? AGAIN_MS : THINK_MS,
  );
}

function startGame(next: Board) {
  board = next;
  layout();
  show("mc-game");
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
  stopSowing();
  const saved = ourGame();
  const first = nextStarter(saved);
  $("mc-resume").hidden = !saved || saved.board.over || saved.moves.length === 0;
  $("mc-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Tap one of your pits to sow its seeds, one a hole, round to your store. " +
    "End in your store to go again. End in an empty pit of yours to capture the seeds opposite. " +
    "Most seeds wins.";
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`mc-name-${seat}`).textContent = names[seat];
    $(`mc-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · goes first" : "");
  }
  show("mc-home");
}

$("mc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  notes = [];
  startGame(newBoard(nextStarter(saved)));
  persist();
});

$("mc-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board);
});

// ---------- online ----------

/**
 * Catches the board up with the host's latest match. The friend's move is
 * sown as it would be on one phone; anything else (a rematch, a reconnect, a
 * refused move) redraws the board at once.
 */
function settle() {
  const m = latest;
  if (!channel || !m) return;
  const target = replay(m.first, m.moves);
  if (!target) return;
  wins = [...m.wins];
  const before = board;
  const sameStart = (n: number) =>
    target.starter === before.starter && target.moves.slice(0, n).every((pit, i) => before.moves[i] === pit);
  // In an extra turn this phone may sow a second pit before the host has
  // answered the first. The answer then holds some of its moves, not all yet:
  // the board stays, and the next answer settles it.
  const behind =
    pending !== null &&
    target.moves.length > heard &&
    target.moves.length < before.moves.length &&
    sameStart(target.moves.length);
  heard = target.moves.length;
  if (behind) return;
  if (pending !== null) {
    // The move this phone sent never counted (a drop in the connection, say).
    if (target.moves.length <= pending) toast("Connection hiccup · play that one again");
    pending = null;
  }
  const alert = () => {
    const mine = !board.over && board.turn === me;
    if (mine && !wasMine) yourTurn();
    wasMine = mine;
  };
  // The host's echo of this phone's own move, or a rematch asked for: any falling seeds keep falling.
  if (target.moves.length === before.moves.length && sameStart(before.moves.length)) {
    if (!busy) draw();
    alert();
    return;
  }
  board = target;
  if (target.moves.length === before.moves.length + 1 && sameStart(before.moves.length)) {
    sow(before, target.moves.at(-1)!, alert);
    return;
  }
  draw();
  alert();
}

function yourTurn() {
  toast("Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("mc-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("mc-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: MancalaServerMessage) {
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
  // A move's seeds keep falling: its last frame draws the new names.
  if (!busy) draw();
}

function openOnline(ch: Channel<MancalaServerMessage, MancalaClientMessage>) {
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
  // A full board, waiting, until the host sends the game.
  startGame(newBoard());
  ch.listen({ message: onMessage, change: onChange });
}

$("mc-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("mc-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __mancala: unknown }).__mancala = {
  state: () => ({
    moves: board.moves,
    starter: board.starter,
    turn: board.turn,
    again: board.again,
    over: board.over,
    winner: board.winner,
    draw: board.draw,
    holes: board.holes,
    shown,
    score: [score(board, 0), score(board, 1)],
    legal: legalMoves(board),
    thinking: thinking(),
    busy,
    wins,
    seed,
    level: solo ? level : null,
    me: channel ? me : null,
    near: near(),
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
    if (!channel) openOnline(session.channel as Channel<MancalaServerMessage, MancalaClientMessage>);
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
  // Only the computer's wait and the falling seeds run in the background; the game is saved after every move.
  clearTimeout(thinkTimer);
  stopSowing();
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("mc-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
