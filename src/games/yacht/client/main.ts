// Yacht's entry: pass-and-play on one phone, solo against the computer, or
// online with a friend in a party. The player on turn rolls up to three
// times, tapping dice to hold them between rolls, then taps a row of the
// scorecard to aim and taps it again (or presses Score) to fill it. Each
// action counts and saves at once; the dice then tumble for a moment, a
// picture of a roll already made. Offline, a game is its seed plus its
// actions, so a reload or a trip to the menu picks up where it left off, the
// computer's pending action included. Online, the host on the server rolls
// the dice (core/host.ts) and this phone draws what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store as storage } from "../../../shell/storage.ts";
import { think, type Level } from "../core/ai.ts";
import {
  ALL_HELD,
  BONUS_AT,
  BOXES,
  BOX_NAMES,
  DICE,
  ROLL,
  ROLLS,
  SIXES,
  YACHT,
  act,
  bonus,
  canPick,
  canRoll,
  canScore,
  heldOf,
  isUpper,
  newGame,
  replay,
  rollAction,
  scoreFor,
  total,
  upperSum,
  type Game,
  type Roller,
  type Seat,
} from "../core/board.ts";
import { faces, isSeed, newSeed, type Seed } from "../core/dice.ts";
import { rollsOf } from "../core/host.ts";
import type { YachtClientMessage, YachtServerMessage, YachtView } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = storage("yacht.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Amber", "Sky"] as const;
/** In solo the player is amber and the computer sky. */
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** The computer's pace: a beat before each roll, its holds shown before it rolls, its box shown before it scores. */
const ROLL_MS = 650;
const HOLD_MS = 650;
const AIM_MS = 800;
/** How long the dice tumble after a roll. */
const TUMBLE_MS = 450;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
/** The card's short labels, where the full box name would not fit. */
const SHORT: readonly string[] = [
  "Ones",
  "Twos",
  "Threes",
  "Fours",
  "Fives",
  "Sixes",
  "3 of a kind",
  "4 of a kind",
  "Full house",
  "Sm. straight",
  "Lg. straight",
  "Yacht",
  "Chance",
];
/** Which of a die's 3x3 cells hold a pip, for each face. */
const PIPS: readonly (readonly number[])[] = [
  [],
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
];
const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

interface Saved {
  names: [string, string];
  first: Seat;
  actions: number[];
  wins: [number, number];
  /** The secret the dice come from (secret only online, where the host keeps it). */
  seed: number[];
  /** The dice held now, before the next roll. */
  held: number;
  /** Solo only: the computer's level. */
  level?: Level;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
let seed: Seed = newSeed();
let game: Game = newGame();
/** The dice the player on turn holds for the next roll, as a mask. */
let held = 0;
/** The box the player on turn aimed at, waiting for a second tap. */
let aim: number | null = null;
/** True while the dice tumble. */
let busy = false;
let tumbleTimer = 0;
let thinkTimer = 0;

/** Online: the party's channel for this game, and this phone's seat (amber is 0, sky 1). */
let channel: Channel<YachtServerMessage, YachtClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last match the host sent. */
let latest: YachtView | null = null;
/** Online: the action count an action this phone sent was made on, until the host answers it. */
let pending: number | null = null;
/** Online: whether the last game drawn was this phone's turn, for the your-turn alert. */
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

const other = (seat: Seat) => (1 - seat) as Seat;
/** Solo, on the computer's turn. */
const thinking = () => solo && !game.over && game.turn === COMPUTER;
/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!game.over && game.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** No taps from the player right now. */
const locked = () => game.over || busy || thinking() || waiting() || offline() || pending !== null;

/** The column nearest the labels: this phone's player online, else amber. */
const near = (): Seat => (channel ? me : 0);

/** Offline the dice come from the game's seed. Online they come from the host's list. */
const roller = (): Roller => (latest && channel ? rollsOf(latest.dice) : (k) => faces(seed, k));

// ---------- the card and the dice ----------

const cardEl = $("yt-card");
const diceEl = $("yt-dice");

/** One cell per seat, in each row of the card. */
const cells: [HTMLElement, HTMLElement][] = [];
const rows: HTMLElement[] = [];

function addRow(kind: string, label: string, box: number | null): void {
  const el = document.createElement(box === null ? "div" : "button");
  el.className = `yt-row ${kind}`;
  if (box !== null) {
    (el as HTMLButtonElement).type = "button";
    el.addEventListener("click", () => tapRow(box));
  }
  el.innerHTML = `<span class="yt-label">${label}</span><span class="yt-cell"></span><span class="yt-cell"></span>`;
  const [a, b] = el.querySelectorAll<HTMLElement>(".yt-cell");
  cardEl.append(el);
  rows.push(el);
  cells.push([a!, b!]);
}

addRow("yt-head", "", null);
for (let b = 0; b <= SIXES; b++) addRow("yt-box", SHORT[b]!, b);
addRow("yt-bonus", `Bonus at ${BONUS_AT}`, null);
for (let b = SIXES + 1; b < BOXES; b++) addRow("yt-box", SHORT[b]!, b);
addRow("yt-total", "Total", null);

/** The row of `box` on the card: the head, the upper boxes, the bonus, then the lower boxes. */
const rowOf = (box: number) => (isUpper(box) ? 1 + box : 2 + box);
const HEAD = 0;
const BONUS_ROW = 1 + SIXES + 1;
const TOTAL_ROW = rows.length - 1;

const dieEls: HTMLButtonElement[] = [];
for (let i = 0; i < DICE; i++) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yt-die";
  el.innerHTML = `<span class="yt-face">${"<i></i>".repeat(9)}</span><small>Held</small>`;
  el.addEventListener("click", () => toggleHold(i));
  diceEl.append(el);
  dieEls.push(el);
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
  const saved: Saved = { names, first: game.first, actions: game.actions, wins, seed: [...seed], held };
  if (solo) saved.level = level;
  save(saveKey(), JSON.stringify(saved));
}

/** The saved game, if it is intact. */
function savedGame(): (Saved & { game: Game; seed: Seed }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.actions) || !Array.isArray(s.wins)) return null;
  if ((s.first !== 0 && s.first !== 1) || !isSeed(s.seed)) return null;
  if (solo && (!s.level || !Object.hasOwn(LEVEL_LABELS, s.level))) return null;
  const g = replay(s.first, s.actions, (k) => faces(s.seed, k));
  if (!g) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  // Held dice are for show: a bad mask holds nothing.
  const h = Number.isInteger(s.held) && s.held >= 0 && s.held < ALL_HELD && g.rolls > 0 ? s.held : 0;
  return { ...s, names: [n(0), n(1)], wins: [w(0), w(1)], held: h, game: g, seed: s.seed };
}

// ---------- drawing ----------

/** How this phone talks about `seat`: "You" for its own player in solo and online. */
const you = (seat: Seat) => (solo ? seat !== COMPUTER : channel !== null && seat === me);

/** A column's head: "You" for this phone's player, else the name. */
const headName = (seat: Seat) => (you(seat) ? "You" : names[seat]);

/** The player on turn may tap the card now. */
const canAim = () => !locked() && canPick(game);

function drawCard(flash = false) {
  const turn = game.turn;
  const live = !game.over && game.rolls > 0;
  const order: [Seat, Seat] = [near(), other(near())];
  order.forEach((seat, col) => {
    const card = game.cards[seat];
    const on = !game.over && turn === seat;
    const head = cells[HEAD]![col]!;
    head.className = `yt-cell s${seat}${on ? " on" : ""}`;
    head.innerHTML = `<i class="yt-mini s${seat}"></i><b>${escape(headName(seat))}</b>`;
    for (let box = 0; box < BOXES; box++) {
      const el = cells[rowOf(box)]![col]!;
      const v = card.boxes[box];
      el.className = `yt-cell s${seat}${on ? " on" : ""}`;
      if (v !== null && v !== undefined) {
        el.textContent = String(v);
        if (box === YACHT && card.extra > 0) {
          el.insertAdjacentHTML("beforeend", `<em class="yt-extra">+${card.extra * 100}</em>`);
        }
        if (flash && game.last && game.last.seat === seat && game.last.box === box) el.classList.add("just");
      } else if (on && live && canScore(card, box, game.dice)) {
        // What this roll would score here, in faint gold.
        const p = scoreFor(card, box, game.dice)!;
        el.textContent = String(p);
        el.classList.add("can");
        if (p === 0) el.classList.add("zero");
      } else {
        el.textContent = "";
      }
    }
    const up = upperSum(card);
    const upperFilled = card.boxes.slice(0, SIXES + 1).every((b) => b !== null);
    const bonusEl = cells[BONUS_ROW]![col]!;
    bonusEl.className = `yt-cell s${seat}${on ? " on" : ""}`;
    if (bonus(card) > 0) bonusEl.textContent = String(bonus(card));
    else if (upperFilled) bonusEl.textContent = "0";
    else {
      bonusEl.innerHTML = `${up}<small>/${BONUS_AT}</small>`;
      bonusEl.classList.add("progress");
    }
    const totalEl = cells[TOTAL_ROW]![col]!;
    totalEl.className = `yt-cell s${seat}${on ? " on" : ""}`;
    totalEl.textContent = String(total(card));
  });
  const open = canAim();
  for (let box = 0; box < BOXES; box++) {
    const row = rows[rowOf(box)] as HTMLButtonElement;
    const ok = live && canScore(game.cards[turn], box, game.dice);
    row.classList.toggle("can", ok && open);
    row.classList.toggle("pick", aim === box);
    row.setAttribute("aria-disabled", String(!(ok && open)));
    const p = ok ? scoreFor(game.cards[turn], box, game.dice) : null;
    row.setAttribute("aria-label", `${BOX_NAMES[box]}${p === null ? "" : `: ${p} points`}`);
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function setFace(el: HTMLElement, face: number) {
  const pips = PIPS[face] ?? [];
  el.querySelectorAll(".yt-face i").forEach((p, i) => p.classList.toggle("on", pips.includes(i)));
}

function drawDice() {
  const blank = game.rolls === 0 || game.dice.length !== DICE;
  const canHold = !locked() && game.rolls > 0 && game.rolls < ROLLS;
  dieEls.forEach((el, i) => {
    const isHeld = !blank && (held & (1 << i)) !== 0;
    el.classList.toggle("blank", blank);
    el.classList.toggle("held", isHeld);
    el.classList.toggle("can", canHold);
    el.disabled = !canHold;
    if (!el.classList.contains("tumble")) setFace(el, blank ? 0 : game.dice[i]!);
    el.setAttribute("aria-pressed", String(isHeld));
    el.setAttribute(
      "aria-label",
      blank ? "Die, not rolled" : `Die showing ${game.dice[i]}${isHeld ? ", held" : ""}`,
    );
  });
  const left = ROLLS - game.rolls;
  $("yt-pips").innerHTML = Array.from(
    { length: ROLLS },
    (_, i) => `<i class="${i < left ? "on" : ""}"></i>`,
  ).join("");
  $("yt-left-text").textContent =
    left === 0 ? "No rolls left" : `${left} ${left === 1 ? "roll" : "rolls"} left`;
}

function statusText(): string {
  if (channel && !latest) return "Connecting";
  if (thinking()) return game.rolls === 0 ? "Computer is up" : "Computer is rolling";
  if (waiting()) return `${names[other(me)]} is rolling`;
  if (solo || channel) return "Your turn";
  return `${names[game.turn]}'s turn`;
}

function drawDock() {
  const wait = thinking() || waiting();
  const tray = $("yt-tray");
  tray.className = `yt-tray s${game.turn}`;
  $("yt-status").textContent = statusText();
  $("yt-dots").hidden = !wait;
  tray.classList.toggle("go", !wait && !game.over);
  const roll = $<HTMLButtonElement>("yt-roll");
  const rollHeld = game.rolls === 0 ? 0 : held;
  roll.disabled = locked() || !canRoll(game, rollHeld);
  roll.textContent = game.rolls === 0 ? "Roll" : held === ALL_HELD ? "All held" : "Roll again";
  const score = $<HTMLButtonElement>("yt-score");
  score.disabled = !canAim() || aim === null;
  score.textContent = aim === null ? "Score" : `Score ${SHORT[aim]}`;
  // With no rolls left, scoring is the only move: the Score button leads.
  score.classList.toggle("primary", game.rolls === ROLLS && !locked());
  score.classList.toggle("outline", !(game.rolls === ROLLS && !locked()));
  $("yt-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="yt-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="yt-mini s1"></i>`
      : "";
  $("yt-turn").hidden = game.over;
  $("yt-result").hidden = !game.over;
  if (game.over) drawResult();
}

/** The end of a game: who won and by how much, and online, who wants a rematch. */
function drawResult() {
  const w = game.winner;
  const [a, b] = [total(game.cards[0]), total(game.cards[1])];
  $("yt-result-title").textContent = w === null ? "It's a tie!" : you(w) ? "You win!" : `${names[w]} wins!`;
  $("yt-why").textContent = w === null ? `${a} points each.` : `${Math.max(a, b)} to ${Math.min(a, b)}.`;
  const again = $<HTMLButtonElement>("yt-again");
  const note = $("yt-note");
  const friend = names[other(me)];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  // Online the line keeps its place, so the panel does not jump when the friend asks.
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : " ";
}

/** Draws the game as it stands. `flash` lights up the box just scored. */
function draw(flash = false) {
  drawCard(flash);
  drawDice();
  drawDock();
}

// ---------- rolling ----------

function stopTumble() {
  clearTimeout(tumbleTimer);
  busy = false;
  for (const el of dieEls) el.classList.remove("tumble");
}

/**
 * Shows the roll just made: the dice not held tumble for a moment, then
 * land on the faces already saved, and `then` runs. With reduced motion they
 * land at once.
 */
function tumble(kept: number, then: () => void) {
  stopTumble();
  if (stillMotion.matches) {
    draw();
    then();
    return;
  }
  const after = game;
  busy = true;
  dieEls.forEach((el, i) => {
    if (kept & (1 << i)) return;
    void el.offsetWidth;
    el.classList.add("tumble");
    // A blur of faces while it spins: for show only, the roll is already made.
    setFace(el, 1 + ((i * 7 + game.rolled) % 6));
  });
  draw();
  let ticks = 0;
  const spin = () => {
    if (game !== after) return;
    if (++ticks * 90 < TUMBLE_MS) {
      dieEls.forEach((el, i) => {
        if (el.classList.contains("tumble")) setFace(el, 1 + ((i * 5 + ticks * 3 + game.rolled) % 6));
      });
      tumbleTimer = window.setTimeout(spin, 90);
      return;
    }
    stopTumble();
    draw();
    then();
  };
  tumbleTimer = window.setTimeout(spin, 90);
}

function buzz(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

/** Plays `action` for the player on turn, offline: it counts and saves at once, then shows. */
function apply(action: number, then: () => void): boolean {
  const next = act(game, action, roller());
  if (!next) return false;
  const before = game;
  game = next;
  aim = null;
  if (action >= ROLL) {
    // The held dice stay held for the next roll.
    held = heldOf(action);
    persist();
    tumble(held, then);
    buzz(10);
    return true;
  }
  held = 0;
  if (game.winner !== null && game.over && !before.over) wins[game.winner] += 1;
  persist();
  draw(true);
  buzz(game.over ? [20, 40, 20, 40, 60] : 12);
  then();
  return true;
}

/** The player rolls, keeping the dice they hold. */
function roll() {
  const keep = game.rolls === 0 ? 0 : held;
  if (locked() || !canRoll(game, keep)) return;
  if (channel) {
    if (!channel.send({ t: "roll", held: keep, at: game.actions.length })) return;
    pending = game.actions.length;
    aim = null;
    draw();
    return;
  }
  apply(rollAction(keep), () => {});
}

function toggleHold(i: number) {
  if (locked() || game.rolls === 0 || game.rolls >= ROLLS) return;
  held ^= 1 << i;
  if (channel) channel.send({ t: "hold", held, at: game.actions.length });
  else persist();
  drawDice();
  drawDock();
}

/** A tap on a row aims at that box. A second tap, or the Score button, fills it. */
function tapRow(box: number) {
  if (!canAim() || !canScore(game.cards[game.turn], box, game.dice)) return;
  if (aim !== box) {
    aim = box;
    drawCard();
    drawDock();
    return;
  }
  scoreBox(box);
}

function scoreBox(box: number) {
  if (!canAim() || !canScore(game.cards[game.turn], box, game.dice)) return;
  if (channel) {
    if (!channel.send({ t: "score", box, at: game.actions.length })) return;
    pending = game.actions.length;
    draw();
    return;
  }
  apply(box, takeTurn);
}

/**
 * On the computer's turn, plays its next action after a pause, one roll at a
 * time: its holds show before it rolls, and its box before it scores. Each
 * step comes from the game and the seed alone, so a reload mid-turn plays on
 * the same way.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  if (!thinking() || busy) return;
  const before = game;
  const action = think(game, level, seed[0]!).action;
  const go = (ms: number, step: () => void) => {
    thinkTimer = window.setTimeout(() => {
      if (game !== before || !$("yt-game").classList.contains("on")) return;
      step();
    }, ms);
  };
  if (action >= ROLL) {
    const keep = heldOf(action);
    if (keep !== (game.rolls === 0 ? 0 : held) && game.rolls > 0) {
      // Show the dice it holds, then roll.
      go(HOLD_MS, () => {
        held = keep;
        drawDice();
        go(ROLL_MS, () => apply(action, takeTurn));
      });
      return;
    }
    go(ROLL_MS, () => apply(action, takeTurn));
    return;
  }
  go(ROLL_MS, () => {
    aim = action;
    drawCard();
    go(AIM_MS, () => apply(action, takeTurn));
  });
}

function startGame(next: Game, keep = 0) {
  stopTumble();
  clearTimeout(thinkTimer);
  game = next;
  held = keep;
  aim = null;
  show("yt-game");
  draw();
  takeTurn();
}

/** A fresh game with the same players. Whoever went second last time starts. */
function rematch() {
  seed = newSeed();
  startGame(newGame(other(game.first)));
  persist();
}

/** The saved game, if it is between the session's players (in solo, at the session's level). */
function ourGame() {
  const saved = savedGame();
  if (!saved || saved.names[0] !== names[0] || saved.names[1] !== names[1]) return null;
  return !solo || saved.level === level ? saved : null;
}

/** Who starts a new game: the other player after a game, the same one if nobody played. */
function nextStarter(saved: ReturnType<typeof ourGame>): Seat {
  if (!saved) return 0;
  return saved.actions.length === 0 ? saved.first : other(saved.first);
}

function goHome() {
  clearTimeout(thinkTimer);
  stopTumble();
  const saved = ourGame();
  const first = nextStarter(saved);
  $("yt-resume").hidden = !saved || saved.game.over || saved.actions.length === 0;
  $("yt-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Roll five dice up to three times a turn, holding any you like. " +
    "Then fill one box of your scorecard. After 13 turns each, the higher total wins.";
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`yt-name-${seat}`).textContent = names[seat];
    $(`yt-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · goes first" : "");
  }
  show("yt-home");
}

$("yt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  startGame(newGame(nextStarter(saved)));
  persist();
});

$("yt-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  startGame(saved.game, saved.held);
});

$("yt-roll").addEventListener("click", roll);
$("yt-score").addEventListener("click", () => {
  if (aim !== null) scoreBox(aim);
});

// ---------- online ----------

/** The two games agree on their first `n` actions. */
const sameStart = (a: Game, b: Game, n: number) =>
  a.first === b.first && a.actions.slice(0, n).every((x, i) => b.actions[i] === x);

/**
 * Catches the game up with the host's latest match. A roll one step ahead
 * tumbles as it would on one phone; anything else (a score, a rematch, a
 * reconnect, a refused action) redraws at once.
 */
function settle() {
  const m = latest;
  if (!channel || !m) return;
  const target = replay(m.first, m.actions, rollsOf(m.dice));
  if (!target) return;
  wins = [...m.wins];
  const before = game;
  if (pending !== null) {
    // The action this phone sent never counted (a drop in the connection, say).
    if (target.actions.length <= pending) toast("Connection hiccup · try again");
    pending = null;
  }
  const alert = () => {
    const mine = !game.over && game.turn === me;
    if (mine && !wasMine) yourTurn();
    wasMine = mine;
  };
  const same =
    target.actions.length === before.actions.length && sameStart(target, before, before.actions.length);
  if (same) {
    // A rematch asked for, or a resync with nothing new.
    if (!busy) draw();
    alert();
    return;
  }
  const step =
    target.actions.length === before.actions.length + 1 && sameStart(before, target, before.actions.length);
  game = target;
  aim = null;
  const last = target.actions.at(-1);
  if (step && last !== undefined && last >= ROLL) {
    held = heldOf(last);
    tumble(held, alert);
    return;
  }
  stopTumble();
  // A turn just ended, or the phone caught up from afar: nothing is held.
  held = target.rolls > 0 && last !== undefined ? heldOf(last) : 0;
  draw(step);
  if (step) buzz(12);
  alert();
}

function yourTurn() {
  toast("Your turn");
  buzz([30, 60, 30]);
}

function toast(text: string) {
  const el = $("yt-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("yt-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: YachtServerMessage) {
  if (msg.t === "hold") {
    // The friend's held dice, live, on the game this phone has.
    if (msg.at !== game.actions.length || game.turn === me || game.rolls === 0) return;
    held = msg.held;
    drawDice();
    return;
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
  if (!busy) draw();
}

function openOnline(ch: Channel<YachtServerMessage, YachtClientMessage>) {
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
  // An empty card, waiting, until the host sends the game.
  startGame(newGame());
  ch.listen({ message: onMessage, change: onChange });
}

$("yt-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("yt-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __yacht: unknown }).__yacht = {
  state: () => ({
    actions: game.actions,
    first: game.first,
    turn: game.turn,
    rolls: game.rolls,
    dice: game.dice,
    held,
    aim,
    over: game.over,
    winner: game.winner,
    draw: game.draw,
    totals: [total(game.cards[0]), total(game.cards[1])],
    boxes: [game.cards[0].boxes, game.cards[1].boxes],
    legal: [...Array(BOXES).keys()].filter(
      (b) => game.rolls > 0 && !game.over && canScore(game.cards[game.turn], b, game.dice),
    ),
    thinking: thinking(),
    busy,
    wins,
    level: solo ? level : null,
    me: channel ? me : null,
    near: near(),
    locked: locked(),
    pending,
    rematch: latest?.rematch ?? null,
    hasSeed: channel ? latest !== null && "seed" in latest : null,
  }),
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    // Straight into the party's game, on this phone's seat.
    solo = false;
    if (!channel) openOnline(session.channel as Channel<YachtServerMessage, YachtClientMessage>);
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
  // Only the computer's pause and the tumbling dice run in the background; the game is saved after every action.
  clearTimeout(thinkTimer);
  stopTumble();
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("yt-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
