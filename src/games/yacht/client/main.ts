// Yacht's entry: pass-and-play on one phone, solo on your own card for a best
// score, or online with a friend in a party. The player on turn rolls up to three
// times, tapping dice to hold them between rolls, then taps a row of the
// scorecard to aim and taps it again (or presses Score) to fill it. Each
// action counts and saves at once; the dice are then tossed onto the felt
// (toss.ts), a picture of a roll already made. Offline, a game is its seed plus its
// actions, so a reload or a trip to the menu picks up where it left off. Online, the host on the server rolls
// the dice (core/host.ts) and this phone draws what it says.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store as storage } from "../../../shell/storage.ts";
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
  filled,
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
import { toss, type Pose } from "./toss.ts";
import type { YachtClientMessage, YachtServerMessage, YachtView } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = storage("yacht.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Amber", "Sky"] as const;
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
}

/** The highest solo total, and the first word of the seed of the game that made it. */
interface Best {
  points: number;
  seed: number;
}

/** Solo: one player on one card, out for a best score. */
let solo = false;
let best: Best | null = null;
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
let tumbleFrame = 0;

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
/** Online, while the friend is on turn or the host has not sent the game yet. */
const waiting = () => channel !== null && (latest === null || (!game.over && game.turn !== me));
/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** No taps from the player right now. */
const locked = () => game.over || busy || waiting() || offline() || pending !== null;

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

// Each die is a cube of six sides. A face shows by turning the cube so that
// side is on top, and a tossed die turns about its own axis on the way.
/**
 * Where each face sits on the cube. Face 1 needs a real turn, not "" or
 * "none": the CSS puts a translateZ after it, and "none translateZ(...)" is
 * not valid, so the side would sit flat in the middle of the cube.
 */
const SIDE_AT = [
  "",
  "rotate(0deg)",
  "rotateY(90deg)",
  "rotateX(90deg)",
  "rotateX(-90deg)",
  "rotateY(-90deg)",
  "rotateY(180deg)",
];
/** The turn of the cube that puts each face on top. */
const TOP = [
  "",
  "",
  "rotateY(-90deg)",
  "rotateX(-90deg)",
  "rotateX(90deg)",
  "rotateY(90deg)",
  "rotateY(180deg)",
];
/** The direction light comes from: the top left, toward the player. */
const LIGHT = { x: -0.35, y: -0.55, z: 0.76 };

interface Cube {
  lift: HTMLElement;
  cube: HTMLElement;
  shadow: HTMLElement;
  /** The shade over each side, from face 1 to 6. */
  shades: HTMLElement[];
  face: number;
}

const dieEls: HTMLButtonElement[] = [];
const cubes: Cube[] = [];
for (let i = 0; i < DICE; i++) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yt-die";
  const pips = (f: number) =>
    Array.from({ length: 9 }, (_, k) => `<i${PIPS[f]!.includes(k) ? ' class="on"' : ""}></i>`).join("");
  const sides = [1, 2, 3, 4, 5, 6]
    .map(
      (f) =>
        `<span class="yt-side" style="--at:${SIDE_AT[f]}"><span class="yt-face">${pips(f)}</span><span class="yt-shade"></span></span>`,
    )
    .join("");
  const core = [
    "rotate(0deg)",
    "rotateY(90deg)",
    "rotateX(90deg)",
    "rotateY(180deg)",
    "rotateY(-90deg)",
    "rotateX(-90deg)",
  ]
    .map((at) => `<span class="yt-core" style="--at:${at}"></span>`)
    .join("");
  el.innerHTML = `<span class="yt-shadow"></span><span class="yt-lift"><span class="yt-cube">${sides}${core}</span></span><small>Held</small>`;
  el.addEventListener("click", () => toggleHold(i));
  diceEl.append(el);
  dieEls.push(el);
  const shades = [...el.querySelectorAll<HTMLElement>(".yt-shade")];
  cubes.push({
    lift: el.querySelector(".yt-lift")!,
    cube: el.querySelector(".yt-cube")!,
    shadow: el.querySelector(".yt-shadow")!,
    shades,
    face: 0,
  });
}
const SIDE_M = SIDE_AT.map((at) => new DOMMatrix(at || "none"));
const TOP_M = TOP.map((at) => new DOMMatrix(at || "none"));

// ---------- saving ----------

function cleanName(raw: string, fallback: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 12) || fallback;
}

/**
 * Solo and pass & play keep separate saves, so neither overwrites the other.
 * "alone" is the one-player game: the old "solo" key held games against the
 * computer, which no longer exists.
 */
const saveKey = () => (solo ? "alone" : "game");

function persist() {
  // Online, the game lives on the server.
  if (channel) return;
  const saved: Saved = { names, first: game.first, actions: game.actions, wins, seed: [...seed], held };
  save(saveKey(), JSON.stringify(saved));
}

function loadBest(): Best | null {
  const b = loadJson<Best>("best");
  if (!b || !Number.isInteger(b.points) || b.points < 0 || !Number.isInteger(b.seed)) return null;
  return b;
}

/** The game just ended solo: keep its total if it beats the best. */
function recordBest() {
  const points = total(game.cards[0]);
  if (best && best.points >= points) return;
  best = { points, seed: seed[0]! };
  save("best", JSON.stringify(best));
}

/** This finished solo game set the best score. */
const isBest = () => solo && game.over && best !== null && best.seed === seed[0];

/** The saved game, if it is intact. */
function savedGame(): (Saved & { game: Game; seed: Seed }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.actions) || !Array.isArray(s.wins)) return null;
  if ((s.first !== 0 && s.first !== 1) || !isSeed(s.seed)) return null;
  const g = replay(s.first, s.actions, (k) => faces(s.seed, k), solo ? 1 : 2);
  if (!g) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  // Held dice are for show: a bad mask holds nothing.
  const h = Number.isInteger(s.held) && s.held >= 0 && s.held < ALL_HELD && g.rolls > 0 ? s.held : 0;
  // Solo has no second player, so its second name stays empty.
  return { ...s, names: [n(0), solo ? "" : n(1)], wins: [w(0), w(1)], held: h, game: g, seed: s.seed };
}

// ---------- drawing ----------

/** How this phone talks about `seat`: "You" for its own player in solo and online. */
const you = (seat: Seat) => (solo ? seat === 0 : channel !== null && seat === me);

/** A column's head: "You" for this phone's player, else the name. */
const headName = (seat: Seat) => (you(seat) ? "You" : names[seat]);

/** The player on turn may tap the card now. */
const canAim = () => !locked() && canPick(game);

function drawCard(flash = false) {
  const turn = game.turn;
  const live = !game.over && game.rolls > 0;
  // Solo has one column: the second is hidden.
  cardEl.classList.toggle("alone", solo);
  const order: Seat[] = solo ? [0] : [near(), other(near())];
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

/** Turns die `i` to show `face` (0 for a blank die), at rest in its slot. */
function setFace(i: number, face: number) {
  const c = cubes[i]!;
  c.face = face;
  pose(i, null);
}

/** Puts die `i` at `p` in flight, or at rest in its slot when `p` is null, lit from the top left. */
function pose(i: number, p: Pose | null) {
  const c = cubes[i]!;
  const top = Math.max(1, c.face);
  const spin = p ? `rotateZ(${p.yaw}deg) rotate3d(${p.axis.x}, ${p.axis.y}, ${p.axis.z}, ${p.spin}deg)` : "";
  c.cube.style.transform = `${spin} ${TOP[top]}`.trim() || "none";
  c.lift.style.transform = p ? `translate3d(${p.x}px, ${p.y}px, ${p.h}px)` : "";
  c.shadow.style.transform = p
    ? `translate(${p.x + p.h * 0.35}px, ${p.y + p.h * 0.55}px) scale(${1 + p.h * 0.006})`
    : "";
  c.shadow.style.opacity = p ? String(Math.max(0.3, 1 - p.h / 120)) : "";
  dieEls[i]!.classList.toggle("flying", !!p);
  // Each side is darker the further it turns from the light. At rest only the top shows, unshaded.
  const m = p ? new DOMMatrix(spin).multiply(TOP_M[top]!) : null;
  for (let f = 1; f <= 6; f++) {
    let dark = 0;
    if (m) {
      const n = m.multiply(SIDE_M[f]!).transformPoint(new DOMPoint(0, 0, 1, 0));
      const lit = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
      dark = Math.max(0, Math.min(0.75, (LIGHT.z - lit) * 0.6));
    }
    c.shades[f - 1]!.style.opacity = dark ? String(dark) : "";
  }
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
    if (!el.classList.contains("tumble")) setFace(i, blank ? 0 : game.dice[i]!);
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
  if (solo) return `Turn ${filled(game.cards[0]) + 1} of ${BOXES}`;
  if (waiting()) return `${names[other(me)]} is rolling`;
  if (solo || channel) return "Your turn";
  return `${names[game.turn]}'s turn`;
}

function drawDock() {
  const wait = waiting();
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
  $("yt-tally").innerHTML = solo
    ? best
      ? `Best <b>${best.points}</b>`
      : ""
    : wins[0] + wins[1] > 0
      ? `<i class="yt-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="yt-mini s1"></i>`
      : "";
  $("yt-turn").hidden = game.over;
  $("yt-result").hidden = !game.over;
  if (game.over) drawResult();
}

/** The end of a game: who won and by how much, and online, who wants a rematch. */
function drawResult() {
  if (solo) {
    const points = total(game.cards[0]);
    $("yt-result-title").textContent = isBest() ? "New best!" : `${points} points`;
    $("yt-why").textContent = isBest()
      ? `${points} points, your highest yet.`
      : `Your best is ${best?.points ?? points}.`;
    $<HTMLButtonElement>("yt-again").disabled = false;
    $("yt-again").textContent = "Play again";
    $("yt-note").hidden = true;
    return;
  }
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
  cancelAnimationFrame(tumbleFrame);
  busy = false;
  dieEls.forEach((el, i) => {
    if (!el.classList.contains("tumble")) return;
    el.classList.remove("tumble");
    pose(i, null);
  });
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
  const tosses: { i: number; toss: ReturnType<typeof toss> }[] = [];
  dieEls.forEach((el, i) => {
    if (kept & (1 << i)) return;
    el.classList.add("tumble");
    // Each die is thrown toward the face it already rolled.
    cubes[i]!.face = game.dice[i]!;
    tosses.push({ i, toss: toss(tosses.length) });
  });
  draw();
  const start = performance.now();
  const frame = (now: number) => {
    if (game !== after) return;
    const t = now - start;
    let moving = false;
    for (const { i, toss: k } of tosses) {
      const lt = Math.max(0, t - k.delay);
      if (lt < k.dur) moving = true;
      pose(i, lt < k.dur ? k.at(lt) : null);
    }
    if (moving) {
      tumbleFrame = requestAnimationFrame(frame);
      return;
    }
    stopTumble();
    draw();
    then();
  };
  frame(start);
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
  if (solo && game.over && !before.over) recordBest();
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
  apply(box, () => {});
}

function startGame(next: Game, keep = 0) {
  stopTumble();
  game = next;
  held = keep;
  aim = null;
  show("yt-game");
  draw();
}

/** A new offline game: solo has one player, pass & play two. */
const fresh = (first: Seat) => newGame(first, solo ? 1 : 2);

/** A fresh game with the same players. Whoever went second last time starts. */
function rematch() {
  seed = newSeed();
  startGame(fresh(other(game.first)));
  persist();
}

/** The saved game, if it is between the session's players. */
function ourGame() {
  const saved = savedGame();
  if (!saved || saved.names[0] !== names[0] || saved.names[1] !== names[1]) return null;
  return saved;
}

/** Who starts a new game: the other player after a game, the same one if nobody played. */
function nextStarter(saved: ReturnType<typeof ourGame>): Seat {
  if (!saved) return 0;
  return saved.actions.length === 0 ? saved.first : other(saved.first);
}

function goHome() {
  stopTumble();
  const saved = ourGame();
  const first = nextStarter(saved);
  $("yt-resume").hidden = !saved || saved.game.over || saved.actions.length === 0;
  $("yt-lead").textContent = solo
    ? "Just you. Roll five dice up to three times a turn, holding any you like. " +
      "Then fill one box of your scorecard. After 13 turns, see how high you can score."
    : "One phone, two players. Roll five dice up to three times a turn, holding any you like. " +
      "Then fill one box of your scorecard. After 13 turns each, the higher total wins.";
  $("yt-pl-1").hidden = solo;
  for (const seat of [0, 1] as const) {
    $(`yt-name-${seat}`).textContent = names[seat];
    $(`yt-sub-${seat}`).textContent = solo
      ? best
        ? `Best score ${best.points}`
        : "No best score yet"
      : COLOURS[seat] + (seat === first ? " · goes first" : "");
  }
  show("yt-home");
}

$("yt-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score; new names start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  startGame(fresh(nextStarter(saved)));
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
    busy,
    wins,
    solo,
    best: best?.points ?? null,
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
    // A solo game has no second player: the second name is never shown.
    names = [cleanName(session.names[0], DEFAULT_NAMES[0]), ""];
    best = loadBest();
  } else if (session.mode === "pass-and-play") {
    names = [cleanName(session.names[0], DEFAULT_NAMES[0]), cleanName(session.names[1], DEFAULT_NAMES[1])];
  }
  goHome();
}

export function close(): void {
  // Only the tumbling dice run in the background; the game is saved after every action.
  stopTumble();
  // Online, the game stays on the server.
  channel = null;
  latest = null;
  clearTimeout(toastTimer);
  $("yt-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
