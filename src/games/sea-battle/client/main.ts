// Sea Battle's entry: solo against the computer, pass-and-play on one phone,
// or online with a friend in a party. Each player first lays out a fleet (drag
// a ship, tap it to turn it, or take a random layout). Then a tap aims at a
// cell of the other's water and "Fire" shoots. The big grid is the other
// player's water as the viewer knows it, and the small one is the viewer's own
// fleet with the shots that fell there. On one phone a "Pass to" card covers
// the screen between turns, so nobody sees the other fleet. Offline, the game
// saves after every shot: a reload or a trip to the menu picks up where it
// left off, the computer's pending shot included. Online, the host on the
// server holds both fleets (core/host.ts). This phone has its own fleet and
// the marks of both players, and it draws what the host says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store as storage } from "../../../shell/storage.ts";
import { LEVELS, newSeed, rng, think, type Level } from "../core/ai.ts";
import {
  CELLS,
  FLEET,
  SIZE,
  canFireAt,
  cellsOf,
  clamped,
  fire,
  hits,
  newBoard,
  placed,
  randomFleet,
  replay,
  shipAt,
  turned,
  validFleet,
  type Board,
  type Fleet,
  type Mark,
  type Seat,
  type Ship,
} from "../core/board.ts";
import type { SeaClientMessage, SeaServerMessage, SeaView } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = storage("sea-battle.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Yellow", "Violet"] as const;
/** In solo the player is yellow and the computer violet. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before it fires. */
const THINK_MS = 700;
/** Pass & play: how long a shot's result stays up before the "Pass to" card. */
const PASS_MS = 1300;
/** A pointer that moves this far, in px, drags a ship. Less is a tap, which turns it. */
const DRAG_PX = 8;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
/** What this game calls a ship of each length. The two ships of 3 share a name. */
const SHIP_NAMES: Record<number, string> = { 5: "Flagship", 4: "Frigate", 3: "Cutter", 2: "Skiff" };
const COLUMNS = "ABCDEFGHIJ";
const HINT = "Drag a ship to move it. Tap it to turn it.";

interface Saved {
  names: [string, string];
  starter: Seat;
  /** Null until both fleets are placed: the save then only keeps the score and who starts. */
  fleets: [Fleet, Fleet] | null;
  shots: number[];
  wins: [number, number];
  /** Solo only: the computer's level and the seed its fleet and shots come from. */
  level?: Level;
  seed?: number;
  /** Solo only: the numbers behind each of the computer's shots, for the recap. */
  notes?: Note[];
}

/** One of the computer's shots, in numbers: `at` is how many shots were fired before it. */
interface Note {
  at: number;
  placements: number;
  ms: number;
}

/** One 10x10 grid on screen: whose water it is and what the viewer may see of it. */
interface Water {
  owner: Seat;
  /** Ships drawn whole: the viewer's own, or every ship once the game is over. */
  ships: Ship[];
  sunk: Ship[];
  marks: Mark[];
  /** The last cell fired at here, or -1. */
  last: number;
  /** That shot is new: it splashes. */
  fresh: boolean;
  aim: number | null;
  /** Open cells take a tap. */
  open: boolean;
}

/** A ship under the player's finger on the placement screen. */
interface Drag {
  ship: number;
  /** Which cell of the ship the finger holds, from its top or left end. */
  grab: number;
  x: number;
  y: number;
  moved: boolean;
  /** Where the ship would land. */
  ghost: Ship;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
/** Who fires first in the game being set up or played. */
let starter: Seat = 0;
let board: Board = newBoard(0, [randomFleet(Math.random), randomFleet(Math.random)]);
let seed = 0;
let thinkTimer = 0;
let passTimer = 0;
/** Solo: the numbers behind each of the computer's shots this game. */
let notes: Note[] = [];
/** The player whose eyes the screen is for: the big grid is the other's water. */
let view: Seat = 0;
/** The cell the viewer aims at, until "Fire". */
let aim: number | null = null;
/** How many shots the game had when the last one was fired on screen: that shot splashes. */
let fresh = -1;
/** Pass & play: a shot's result is up, and the "Pass to" card comes next. */
let resting = false;
/** What "I'm ready" on the "Pass to" card does. */
let ready: (() => void) | null = null;

/** Placement: the seat that lays out a fleet now, its layout so far, and the fleets that are done. */
let placing: Seat = 0;
let draft: Fleet = board.fleets[0];
let done: [Fleet | null, Fleet | null] = [null, null];
/** The ship "Turn ship" turns: the last one touched. */
let picked = 0;
let drag: Drag | null = null;

/** Online: the party's channel for this game, and this phone's seat (yellow is 0, violet 1). */
let channel: Channel<SeaServerMessage, SeaClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last view the host sent. */
let latest: SeaView | null = null;
/** Online: the fleet this phone sent for this game, until the host's view holds it. */
let mine: Fleet | null = null;
/**
 * Online: the cells fired at, as far as this phone saw them. The host sends
 * each shot once, so a shot fired while this phone was away is -1.
 */
let known: number[] = [];
/** Online: the shot count a shot this phone sent was aimed from, until the host answers it. */
let pending: number | null = null;
/** Online: the cell of this phone's water the friend aims at, shown dimmed. */
let foeAim: number | null = null;
/** Online: whether the last game drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

const other = (seat: Seat) => (1 - seat) as Seat;
/** Solo, on the computer's turn. */
const thinking = () => solo && !board.over && board.turn === COMPUTER;
/** Online, once both fleets are placed: the shots can start. */
const begun = () => latest !== null && latest.placed[0] && latest.placed[1];
/** Online, while the friend places a fleet or is on turn, or the host has not answered yet. */
const waiting = () =>
  channel !== null && (!begun() || pending !== null || (!board.over && board.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;
/** The viewer may aim and fire. */
const canAim = () =>
  !board.over && board.turn === view && !resting && !thinking() && !waiting() && !offline();

/** Who fired shot `i`: the players alternate from the starter. */
const shooter = (i: number) => (i % 2 === 0 ? board.starter : other(board.starter));
const shotsBy = (seat: Seat) => board.shots.filter((_, i) => shooter(i) === seat).length;
/** Who fired the last shot. A hit gives no extra shot, so it is the player not on turn, or the winner. */
const lastShooter = () => (board.over ? board.winner! : other(board.turn));

/** The last cell `seat` fired at, or -1. */
function lastCellBy(seat: Seat): number {
  for (let i = board.shots.length - 1; i >= 0; i--) if (shooter(i) === seat) return board.shots[i]!;
  return -1;
}

/** Fills a grid with its 100 cells. */
function makeSea(id: string, tag: "button" | "div", tap?: (cell: number) => void): HTMLElement[] {
  const sea = $(id);
  return Array.from({ length: CELLS }, (_, cell) => {
    const el = document.createElement(tag);
    if (el instanceof HTMLButtonElement) el.type = "button";
    if (tap) el.addEventListener("click", () => tap(cell));
    sea.append(el);
    return el;
  });
}

const seaEl = $("sb-sea");
const ownEl = $("sb-own");
const yardEl = $("sb-yard");
const seaCells = makeSea("sb-sea", "button", takeAim);
const ownCells = makeSea("sb-own", "div");
const yardCells = makeSea("sb-yard", "div");

/** Each player card shows its fleet as five small bars. */
for (const seat of [0, 1] as const) {
  $(`sb-pl-${seat}`).querySelector(".sb-fleet")!.innerHTML = FLEET.map(
    (len) => `<i style="--len:${len}"></i>`,
  ).join("");
}

// ---------- saving ----------

function cleanName(raw: string, fallback: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 12) || fallback;
}

/** Solo and pass & play keep separate saves, so neither overwrites the other. */
const saveKey = () => (solo ? "solo" : "game");

/** Saves the game, or with `playing` false only the score and who starts the game being set up. */
function persist(playing = true) {
  const saved: Saved = {
    names,
    starter,
    fleets: playing ? board.fleets : null,
    shots: playing ? board.shots : [],
    wins,
  };
  if (solo) Object.assign(saved, { level, seed, notes });
  save(saveKey(), JSON.stringify(saved));
}

/** The saved game, if it is intact. `board` is null when its fleets were not placed yet. */
function savedGame(): (Saved & { board: Board | null; seed: number; notes: Note[] }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.shots) || !Array.isArray(s.wins)) return null;
  if (s.starter !== 0 && s.starter !== 1) return null;
  if (solo && (!s.level || !LEVELS.includes(s.level) || !Number.isInteger(s.seed))) return null;
  let b: Board | null = null;
  if (s.fleets !== null) {
    try {
      // A fleet that is not a list of ships throws: the save is no good.
      b = replay(s.starter, s.fleets, s.shots);
    } catch {
      b = null;
    }
    if (!b) return null;
  }
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  // Notes are for show: a bad one is dropped, never the game.
  const fine = (n: Note) =>
    Number.isInteger(n?.at) &&
    n.at >= 0 &&
    n.at < s.shots.length &&
    Number.isFinite(n.placements) &&
    Number.isFinite(n.ms);
  return {
    names: [n(0), n(1)],
    starter: s.starter,
    fleets: b ? b.fleets : null,
    shots: b ? b.shots : [],
    wins: [w(0), w(1)],
    level: s.level,
    seed: s.seed ?? 0,
    notes: Array.isArray(s.notes) ? s.notes.filter(fine) : [],
    board: b,
  };
}

// ---------- drawing ----------

/** Draws one grid: hulls, hits and misses, the last shot and the aim. */
function paint(sea: HTMLElement, cells: HTMLElement[], w: Water) {
  const hull = new Map<number, string>();
  const lay = (ship: Ship, state: string) =>
    cellsOf(ship).forEach((cell, i, all) =>
      hull.set(
        cell,
        ` ship${ship.down ? " down" : ""}${i === 0 ? " a" : ""}${i === all.length - 1 ? " z" : ""}${state}`,
      ),
    );
  for (const ship of w.ships) lay(ship, "");
  // A ship sinks on its last hit, so the new shot lies on the ship it sank.
  for (const ship of w.sunk) lay(ship, w.fresh && cellsOf(ship).includes(w.last) ? " sunk sinking" : " sunk");
  sea.classList.toggle("s0", w.owner === 0);
  sea.classList.toggle("s1", w.owner === 1);
  cells.forEach((el, cell) => {
    const mark = w.marks[cell];
    let cls = "sb-cell" + (hull.get(cell) ?? "");
    if (mark) cls += ` ${mark}`;
    if (cell === w.last) cls += w.fresh ? " last fresh" : " last";
    if (cell === w.aim) cls += " aim";
    if (w.open && !mark) cls += " can";
    // An unchanged cell keeps its class, so its splash plays once.
    if (el.className !== cls) el.className = cls;
  });
}

/** How the screen tells `seat` about the last shot, or null before the first. */
function told(seat: Seat): string | null {
  const shot = board.last;
  if (!shot) return null;
  const by = lastShooter();
  if (by === seat)
    return shot.sunk ? `You sank a ${SHIP_NAMES[shot.sunk.len]}!` : shot.hit ? "Hit!" : "Miss.";
  const who = names[by];
  if (shot.sunk) return `${who} sank your ${SHIP_NAMES[shot.sunk.len]}`;
  const ship = board.fleets[seat][shipAt(board.fleets[seat], shot.cell)];
  return ship ? `${who} hit your ${SHIP_NAMES[ship.len]}` : `${who} missed`;
}

/** A player card's second line: the result, whose turn it is, or the computer's level. */
function status(seat: Seat): string {
  if (board.over && board.winner === seat) return "Winner";
  if (solo && seat === COMPUTER) return LEVEL_LABELS[level];
  const on = !board.over && board.turn === seat;
  if (!channel) return on ? "Your turn" : "";
  // Online, this phone's card says which colour is yours.
  if (!begun()) return seat === me ? "You" : latest && !latest.placed[seat] ? "Placing fleet" : "";
  if (seat !== me) return on ? "Their turn" : "";
  return on ? "Your turn" : "You";
}

function drawPlayers() {
  for (const seat of [0, 1] as const) {
    const el = $(`sb-pl-${seat}`);
    el.classList.toggle("on", board.over ? board.winner === seat : board.turn === seat);
    el.querySelector(".sb-name")!.textContent = names[seat];
    el.querySelector(".sb-sub")!.textContent = status(seat);
    // The bars of the ships this player lost go dark, a ship of each length at a time.
    const lost = board.seen[other(seat)].sunk.map((ship) => ship.len);
    const fleet = el.querySelector(".sb-fleet")!;
    FLEET.forEach((len, i) => {
      const at = lost.indexOf(len);
      if (at >= 0) lost.splice(at, 1);
      fleet.children[i]!.classList.toggle("lost", at >= 0);
    });
    const left = FLEET.length - board.seen[other(seat)].sunk.length;
    fleet.setAttribute("aria-label", `${left} ${left === 1 ? "ship" : "ships"} afloat`);
  }
  $("sb-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="sb-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="sb-mini s1"></i>`
      : "";
}

/** Whose turn it is and what the last shot did: one line beside the viewer's fleet. */
function drawStatus() {
  const last = told(view);
  const bar = $("sb-status");
  const wait = thinking() || waiting();
  bar.classList.toggle("go", canAim());
  $("sb-dots").hidden = !wait;
  $("sb-status-text").textContent =
    channel && !latest
      ? "Connecting"
      : channel && !begun()
        ? `Waiting for ${names[other(me)]}'s fleet`
        : wait
          ? (last ?? `${names[other(view)]} fires first`)
          : resting
            ? (last ?? "")
            : last
              ? `${last} · your turn`
              : "Your turn · tap a cell to aim";
  $<HTMLButtonElement>("sb-fire").disabled = !canAim() || aim === null;
  $("sb-own-title").textContent = solo || channel ? "Your fleet" : `${names[view]}'s fleet`;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtMs = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;

/** The end of a game: who won and why, in solo both players' game in numbers, and online, who wants a rematch. */
function drawResult() {
  const w = board.winner!;
  $("sb-result-title").textContent = channel && w === me ? "You win!" : `${names[w]} wins!`;
  $("sb-why").textContent = `Sank all five ships in ${shotsBy(w)} shots.`;
  const again = $<HTMLButtonElement>("sb-again");
  const note = $("sb-note");
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
  if (solo) {
    rows.push(["Your hits", `${hits(board, other(COMPUTER))} of ${fmt(shotsBy(other(COMPUTER)))}`]);
    rows.push([`${COMPUTER_NAME}'s hits`, `${hits(board, COMPUTER)} of ${fmt(shotsBy(COMPUTER))}`]);
    rows.push(["Time thinking", fmtMs(notes.reduce((a, x) => a + x.ms, 0))]);
  }
  $("sb-stats").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/** Draws the game as the viewer sees it. */
function draw() {
  const foe = other(view);
  const isNew = fresh === board.shots.length;
  paint(seaEl, seaCells, {
    owner: foe,
    // Once the game is over nothing is secret: the ships still afloat show too.
    ships: board.over ? board.fleets[foe] : [],
    sunk: board.seen[view].sunk,
    marks: board.seen[view].marks,
    last: lastCellBy(view),
    fresh: isNew && lastShooter() === view,
    aim: canAim() ? aim : null,
    open: canAim(),
  });
  paint(ownEl, ownCells, {
    owner: view,
    ships: board.fleets[view],
    sunk: board.seen[foe].sunk,
    marks: board.seen[foe].marks,
    last: lastCellBy(foe),
    fresh: isNew && lastShooter() === foe,
    // Online, the cell the friend aims at shows dimmed until they fire.
    aim: channel && !board.over && board.turn === foe ? foeAim : null,
    open: false,
  });
  seaEl.setAttribute("aria-label", `${names[foe]}'s water`);
  seaCells.forEach((el, cell) => {
    const where = `${COLUMNS[cell % SIZE]}${Math.floor(cell / SIZE) + 1}`;
    el.setAttribute("aria-label", `${where}: ${board.seen[view].marks[cell] ?? "open water"}`);
  });
  ownEl.setAttribute("aria-label", `${names[view]}'s fleet`);
  drawPlayers();
  drawStatus();
  $("sb-deck").hidden = board.over;
  $("sb-result").hidden = !board.over;
  if (board.over) drawResult();
}

// ---------- playing ----------

/** The viewer taps a cell of the other's water: the aim moves there. */
function takeAim(cell: number) {
  if (!canAim() || !canFireAt(board.seen[view], cell)) return;
  aim = cell;
  draw();
  // Online, the friend sees the aim. It is for show: a lost one does no harm.
  channel?.send({ t: "aim", cell });
}

/** The player on turn fires at `cell`: the shot counts and saves at once. */
function shoot(cell: number): boolean {
  const next = fire(board, cell);
  if (!next) return false;
  board = next;
  aim = null;
  fresh = board.shots.length;
  if (board.winner !== null) wins[board.winner] += 1;
  persist();
  if ("vibrate" in navigator)
    navigator.vibrate(
      board.over ? [20, 40, 20, 40, 60] : board.last?.sunk ? [20, 30, 40] : board.last?.hit ? 25 : 8,
    );
  return true;
}

/** "Fire": the viewer shoots where they aim. On one phone, the "Pass to" card follows the result. */
function fireAim() {
  if (!canAim() || aim === null) return;
  if (channel) {
    // Online, only the host knows what the shot hits. The aim stays until it answers.
    if (!channel.send({ t: "fire", cell: aim, at: board.shots.length })) return;
    pending = board.shots.length;
    draw();
    return;
  }
  if (!shoot(aim)) return;
  resting = !solo && !board.over;
  draw();
  if (solo) takeTurn();
  else if (resting) passTimer = window.setTimeout(passOn, PASS_MS);
}

/**
 * On the computer's turn, waits a moment and fires. The shot comes from what
 * the computer has seen and the game's seed alone, so a reload mid-wait fires
 * at the same cell.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(() => {
    if (board !== before || !$("sb-game").classList.contains("on")) return;
    const t = think(board.seen[COMPUTER], level, seed);
    // Kept for the recap.
    const at = board.shots.length;
    notes = [...notes.filter((x) => x.at !== at), { at, placements: t.placements, ms: t.ms }];
    shoot(t.cell);
    draw();
  }, THINK_MS);
}

/** Covers the screen until `seat` has the phone, then runs `then`. */
function handOff(seat: Seat, sub: string, then: () => void) {
  $("sb-pass-flag").className = `sb-mini s${seat}`;
  $("sb-pass-title").textContent = `Pass to ${names[seat]}`;
  $("sb-pass-sub").textContent = sub;
  ready = then;
  show("sb-pass");
}

/** Pass & play: the phone goes to the player on turn, who then sees their own fleet. */
function passOn() {
  clearTimeout(passTimer);
  const next = board.turn;
  const last = told(next);
  handOff(next, last ? `${last}.` : "You fire first.", () => {
    view = next;
    resting = false;
    show("sb-game");
    draw();
  });
}

/** Shows the game. On one phone a game in play first goes behind the "Pass to" card. */
function startGame(next: Board, resumed = false) {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  board = next;
  starter = board.starter;
  aim = null;
  fresh = -1;
  resting = false;
  view = solo ? other(COMPUTER) : board.turn;
  if (!solo && resumed && !board.over) return passOn();
  show("sb-game");
  draw();
  takeTurn();
}

// ---------- placing ----------

function drawPlace() {
  const hull = new Map<number, string>();
  draft.forEach((ship, i) =>
    cellsOf(ship).forEach((cell, k, all) =>
      hull.set(
        cell,
        ` ship${ship.down ? " down" : ""}${k === 0 ? " a" : ""}${k === all.length - 1 ? " z" : ""}` +
          (i === picked ? " picked" : "") +
          (drag?.moved && drag.ship === i ? " lifted" : ""),
      ),
    ),
  );
  const ghost = drag?.moved ? cellsOf(drag.ghost) : [];
  const bad = drag?.moved && !placed(draft, drag.ship, drag.ghost);
  yardCells.forEach((el, cell) => {
    let cls = "sb-cell" + (hull.get(cell) ?? "");
    if (ghost.includes(cell)) cls += bad ? " ghost bad" : " ghost";
    if (el.className !== cls) el.className = cls;
  });
}

/** The cell under a pointer, or the nearest one when it is off the grid. */
function cellUnder(e: PointerEvent): { row: number; col: number } {
  const box = yardEl.getBoundingClientRect();
  const index = (at: number, from: number, size: number) =>
    Math.max(0, Math.min(SIZE - 1, Math.floor(((at - from) / size) * SIZE)));
  return { row: index(e.clientY, box.top, box.height), col: index(e.clientX, box.left, box.width) };
}

yardEl.addEventListener("pointerdown", (e) => {
  const { row, col } = cellUnder(e);
  const cell = row * SIZE + col;
  const ship = shipAt(draft, cell);
  if (ship < 0 || drag) return;
  picked = ship;
  drag = {
    ship,
    grab: cellsOf(draft[ship]!).indexOf(cell),
    x: e.clientX,
    y: e.clientY,
    moved: false,
    ghost: draft[ship]!,
  };
  yardEl.setPointerCapture(e.pointerId);
  $("sb-hint").textContent = HINT;
  drawPlace();
});

yardEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
  drag.moved = true;
  const { row, col } = cellUnder(e);
  const { len, down } = draft[drag.ship]!;
  // The ship follows the finger by the cell it was picked up at.
  drag.ghost = clamped(row - (down ? drag.grab : 0), col - (down ? 0 : drag.grab), len, down);
  drawPlace();
});

yardEl.addEventListener("pointerup", () => {
  if (!drag) return;
  const { ship, moved, ghost } = drag;
  drag = null;
  if (!moved) return turnShip(ship);
  const next = placed(draft, ship, ghost);
  if (next) draft = next;
  else $("sb-hint").textContent = "Ships can't overlap.";
  drawPlace();
});

yardEl.addEventListener("pointercancel", () => {
  drag = null;
  drawPlace();
});

/** Turns a ship from a row to a column or back, into the nearest free place. */
function turnShip(ship: number) {
  picked = ship;
  const next = turned(draft, ship);
  if (next) draft = next;
  $("sb-hint").textContent = next ? HINT : "No room to turn that ship.";
  drawPlace();
}

/** `seat` lays out a fleet, from a random layout. */
function placeFor(seat: Seat) {
  placing = seat;
  draft = randomFleet(Math.random);
  picked = 0;
  drag = null;
  yardEl.className = `sb-sea yard s${seat}`;
  yardEl.setAttribute("aria-label", `${names[seat]}'s water`);
  $("sb-place-flag").className = `sb-mini s${seat}`;
  $("sb-place-title").textContent = solo || channel ? "Place your fleet" : `${names[seat]}, place your fleet`;
  $("sb-hint").textContent = HINT;
  // On one phone the player who fires second places first, so the game starts in the starter's hands.
  $("sb-done").textContent = !channel && (solo || seat === starter) ? "Start the battle" : "Ready";
  show("sb-place");
  drawPlace();
}

/** A new game: first the fleets. The save keeps the score and who starts. */
function setUp(first: Seat) {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  starter = first;
  seed = newSeed();
  notes = [];
  done = [null, null];
  persist(false);
  placeFor(solo ? other(COMPUTER) : other(starter));
}

$("sb-random").addEventListener("click", () => {
  draft = randomFleet(Math.random);
  $("sb-hint").textContent = HINT;
  drawPlace();
});

$("sb-turn").addEventListener("click", () => turnShip(picked));

$("sb-done").addEventListener("click", () => {
  if (!validFleet(draft)) return;
  if (channel) {
    // Online, only once the host can hear it. The game waits for the friend's fleet.
    if (!latest || !channel.send({ t: "place", fleet: draft })) return;
    mine = draft;
    board = boardFrom(latest);
    show("sb-game");
    draw();
    return;
  }
  done[placing] = draft;
  // The computer's fleet comes from the game's seed.
  if (solo) done[COMPUTER] = randomFleet(rng(seed));
  const [a, b] = done;
  if (!a || !b) return handOff(other(placing), "Place your fleet.", () => placeFor(other(placing)));
  startGame(newBoard(starter, [a, b]));
  persist();
});

$("sb-ready").addEventListener("click", () => {
  const go = ready;
  ready = null;
  go?.();
});

/** A fresh game with the same players. Whoever fired second last time starts. */
function rematch() {
  setUp(other(board.starter));
}

/** The saved game, if it is between the session's players (in solo, at the session's level). */
function ourGame() {
  const saved = savedGame();
  if (!saved || saved.names[0] !== names[0] || saved.names[1] !== names[1]) return null;
  return !solo || saved.level === level ? saved : null;
}

/** Who starts a new game: the other player after a game, the same one if nobody fired. */
function nextStarter(saved: ReturnType<typeof ourGame>): Seat {
  if (!saved) return 0;
  return saved.shots.length === 0 ? saved.starter : other(saved.starter);
}

function goHome() {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  ready = null;
  const saved = ourGame();
  const first = nextStarter(saved);
  $("sb-resume").hidden = !saved || !saved.board || saved.board.over;
  $("sb-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Hide your five ships on your water. Then take turns: tap a cell of the other water to aim, and fire. " +
    "Hit every cell of a ship to sink it. Sink all five to win.";
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`sb-name-${seat}`).textContent = names[seat];
    $(`sb-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · fires first" : "");
  }
  show("sb-home");
}

$("sb-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  setUp(nextStarter(saved));
});

$("sb-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved || !saved.board) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  notes = saved.notes;
  startGame(saved.board, true);
});

// ---------- online ----------

/**
 * The game as this phone may know it, in the shape the offline game has. The
 * other fleet is empty until the game is over: the host does not send it.
 */
function boardFrom(v: SeaView): Board {
  const fleets: [Fleet, Fleet] = [[], []];
  fleets[me] = v.fleet ?? mine ?? [];
  fleets[other(me)] = v.foe ?? [];
  return {
    fleets,
    starter: v.first,
    shots: known,
    turn: v.turn,
    seen: v.seen,
    last: v.last,
    over: v.over,
    winner: v.winner,
  };
}

/**
 * Catches the screen up with the host's latest view: the placement screen
 * until this phone's fleet is sent, then the game. `prev` is the view before
 * it.
 */
function settle(prev: SeaView | null) {
  const v = latest;
  if (!channel || !v) return;
  // A rematch gives the other player the first shot: a new game, with no fleets yet.
  if (prev && (prev.first !== v.first || (prev.over && !v.over))) {
    mine = null;
    known = [];
  }
  wins = [...v.wins];
  const before = known.length;
  if (v.shots === before + 1 && v.last) known = [...known, v.last.cell];
  else if (v.shots !== before) {
    // This phone missed some shots (a reload, a reconnect): only the last one's cell is in the view.
    known = Array<number>(v.shots).fill(-1);
    if (v.last) known[v.shots - 1] = v.last.cell;
  }
  if (v.shots !== before) {
    aim = null;
    foeAim = null;
    // One new shot splashes. A game caught up with stands still.
    fresh = v.shots === before + 1 ? v.shots : -1;
    if (fresh > 0 && "vibrate" in navigator)
      navigator.vibrate(v.over ? [20, 40, 20, 40, 60] : v.last?.sunk ? [20, 30, 40] : v.last?.hit ? 25 : 8);
  }
  if (pending !== null) {
    // The shot this phone sent never counted (a drop in the connection, say).
    if (v.shots <= pending) toast("Connection hiccup · fire again");
    pending = null;
  }
  board = boardFrom(v);
  if (!v.fleet && !mine) {
    wasMine = false;
    // A layout in the making stays as it is.
    if (!$("sb-place").classList.contains("on")) placeFor(me);
    return;
  }
  // The host has not heard this phone's fleet (a drop in the connection, say): send it again.
  if (!v.fleet && mine) channel.send({ t: "place", fleet: mine });
  show("sb-game");
  draw();
  const myTurn = begun() && !board.over && board.turn === me;
  if (myTurn && !wasMine) yourTurn();
  wasMine = myTurn;
}

function yourTurn() {
  toast("Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("sb-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

/** The banner sits over the board and over the placement grid: both show the same words. */
function setBanner(text: string | null, ok = false) {
  for (const el of document.querySelectorAll<HTMLElement>(".sb-banner")) {
    el.hidden = !text;
    el.textContent = text ?? "";
    el.classList.toggle("ok", ok);
  }
}

function onMessage(msg: SeaServerMessage) {
  if (msg.t === "aim") {
    // Live aim is for show: the friend's ring on this phone's water.
    if (msg.seat === me) return;
    foeAim = msg.cell;
    if ($("sb-game").classList.contains("on")) draw();
    return;
  }
  const prev = latest;
  latest = msg.view;
  settle(prev);
}

/** The connection or the players changed. */
function onChange() {
  const ch = channel;
  if (!ch) return;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.update();
  if ($("sb-game").classList.contains("on")) draw();
}

function openOnline(ch: Channel<SeaServerMessage, SeaClientMessage>) {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  channel = ch;
  me = ch.me;
  view = me;
  latest = null;
  mine = null;
  known = [];
  pending = null;
  foeAim = null;
  wasMine = false;
  wins = [0, 0];
  aim = null;
  fresh = -1;
  resting = false;
  ready = null;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.stop();
  banner = new ConnectionBanner(ch, setBanner);
  // Empty water, waiting, until the host sends the game.
  board = newBoard(0, [[], []]);
  show("sb-game");
  draw();
  ch.listen({ message: onMessage, change: onChange });
}

$("sb-fire").addEventListener("click", fireAim);
$("sb-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("sb-place-back").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("sb-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __sea: unknown }).__sea = {
  state: () => ({
    screen: document.querySelector("[data-screen].on")?.id ?? null,
    placing,
    draft,
    picked,
    shots: board.shots,
    starter: board.starter,
    turn: board.turn,
    over: board.over,
    winner: board.winner,
    last: board.last,
    // Offline, both fleets live on this phone. Online, the other one is empty until the game is over.
    fleets: board.fleets,
    seen: board.seen,
    view,
    aim,
    resting,
    thinking: thinking(),
    canAim: canAim(),
    wins,
    seed,
    level: solo ? level : null,
    notes,
    me: channel ? me : null,
    placed: latest?.placed ?? null,
    rematch: latest?.rematch ?? null,
    foeAim,
    pending,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    // Straight into the party's game, on this phone's seat.
    solo = false;
    if (!channel) openOnline(session.channel as Channel<SeaServerMessage, SeaClientMessage>);
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
  // Only the computer's wait and the "Pass to" card's wait run in the background; the game is saved after every shot.
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  ready = null;
  drag = null;
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("sb-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
