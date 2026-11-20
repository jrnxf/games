// Last Card's entry: solo against the computer, pass-and-play on one phone,
// or online with a friend in a party. Match the top card by colour, number or
// symbol, or play a Wild. A tap lifts a card from the fan, and a second tap
// (or Play) plays it. A finger slid along the fan lifts the card under it.
// After a Wild a sheet asks for the next colour. With two cards left, "Last
// card!" goes with the play, or the other player may catch you.
//
// The screen draws a View (core/board.ts): this phone's hand and the size of
// the other. Offline the board lives here, and the game saves after every
// move: a reload or a trip to the menu picks up where it left off, the
// computer's pending move included. On one phone a "Pass to" card covers the
// screen between turns, so nobody sees the other hand. Online, the host on
// the server holds the deck (core/host.ts), and this phone draws the view it
// gets. It predicts nothing, not even its own play: it sends, and waits.
//
// The cards slide when they move: a played card from the hand or the other
// fan to the discard pile, a drawn card from the draw pile. The move is saved
// first, and the slide only pictures it. With reduced motion it is instant.

import "./styles.css";
import screens from "./screens.html?raw";

import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { store as storage } from "../../../shell/storage.ts";
import { LEVELS, choose, newSeed, type Level } from "../core/ai.ts";
import {
  COLORS,
  apply,
  card,
  isWild,
  nameOf,
  newGame,
  other,
  playableIn,
  replay,
  viewOf,
  type Action,
  type Board,
  type Color,
  type Event,
  type Move,
  type Seat,
  type View,
} from "../core/board.ts";
import type { LastClientMessage, LastServerMessage, LastView } from "../core/protocol.ts";

document.body.insertAdjacentHTML("beforeend", screens);

const { save, loadJson } = storage("last-card.");
const DEFAULT_NAMES = ["Zoe", "Kai"] as const;
const COLOURS = ["Coral", "Teal"] as const;
/** In solo the player is coral and the computer teal. */
const HUMAN: Seat = 0;
const COMPUTER: Seat = 1;
const COMPUTER_NAME = "Computer";
/** How long the computer waits before a move, and before it plays or keeps a card it drew. */
const THINK_MS = 700;
const AGAIN_MS = 550;
/** Pass & play: how long a turn stays up before the "Pass to" card. */
const PASS_MS = 1300;
/** How long a card takes to slide. */
const SLIDE_MS = 280;
/** Past this many cards the fan uses smaller cards, closer together. */
const ROOMY = 12;
/** The narrowest strip of a card the fan shows. A hand too big for that takes a second row. */
const MIN_STRIP = 22;
/** How far a lifted card rises. */
const LIFT = 18;
const LEVEL_LABELS: Record<Level, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Each colour's mark, so the colours differ by shape as well as hue. */
const MARKS: Record<Color, string> = {
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  leaf: '<path d="M20 4C9 4 4 9 4 16c0 1.5.3 2.8.8 4C6 14 10 10 16 8c-5 3-8 7-9.5 12.5C8 21 9.5 21 11 21c7 0 10-7 9-17z"/>',
  wave: '<path d="M2 9c3-3 5-3 7 0s4 3 7 0 5-3 6-1v4c-1-2-3-2-6 1s-5 3-7 0-4-3-7 0zM2 16c3-3 5-3 7 0s4 3 7 0 5-3 6-1v3c-1-2-3-2-6 1s-5 3-7 0-4-3-7 0z"/>',
  flame: '<path d="M12 2c1 4 6 6 6 12a6 6 0 01-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
};
const SKIP =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M6.2 17.8L17.8 6.2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const REVERSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h14l-4-4M20 15.5H6l4 4" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5L2.5 9.4l6.6-.8z"/></svg>';
const mark = (c: Color, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${MARKS[c]}</svg>`;

interface Saved {
  names: [string, string];
  seed: number;
  first: Seat;
  moves: Move[];
  wins: [number, number];
  /** Solo only: the computer's level and its luck, a seed apart from the deck's. */
  level?: Level;
  luck?: number;
}

let solo = false;
let level: Level = "medium";
let names: [string, string] = [...DEFAULT_NAMES];
let wins: [number, number] = [0, 0];
/** Offline: the game, the deck's seed and the computer's luck. */
let board: Board = newGame(1, 0);
let seed = 1;
let luck = 0;
/** Offline: whose hand the screen shows. In solo always the player's. */
let viewer: Seat = HUMAN;
let thinkTimer = 0;
let passTimer = 0;
/** Pass & play: a turn just ended, and the "Pass to" card is on its way. */
let resting = false;
/** What "I'm ready" on the "Pass to" card does. */
let ready: (() => void) | null = null;

/** The card lifted from the fan, the Wild waiting for a colour, and the "Last card!" toggle. */
let lifted: number | null = null;
let wildCard: number | null = null;
let calling = false;

/** Online: the party's channel for this game, and this phone's seat (coral is 0, teal 1). */
let channel: Channel<LastServerMessage, LastClientMessage> | null = null;
let me: Seat = 0;
/** Online: the last view the host sent. */
let latest: LastView | null = null;
/** Online: the move count a move this phone sent was aimed from, until the host answers it. */
let pending: number | null = null;
let wasMine = false;
let banner: ConnectionBanner | null = null;
let toastTimer = 0;

/** What the screen shows: the view of the phone's player, or null online before the host's first message. */
function view(): View | null {
  if (channel) return latest;
  return viewOf(board, viewer);
}

/** The seat this phone speaks to as "you". */
const holder = (): Seat => (channel ? me : viewer);

/** Solo: the computer moves now, on its turn or to catch the player. */
const thinking = () =>
  solo && !board.over && (board.turn === COMPUTER || (level === "hard" && board.open === HUMAN));

/** Online, while this phone has no connection: nothing can be sent. */
const offline = () => channel !== null && !channel.connected;

/** The phone's player may not move now. */
function locked(): boolean {
  const v = view();
  if (!v || v.over || v.turn !== v.seat || resting || offline() || pending !== null) return true;
  return solo && board.turn === COMPUTER;
}

/** The phone's player may catch the other: they hold one card and did not call. */
function catchable(): boolean {
  const v = view();
  return !!v && !v.over && v.open === other(v.seat) && !resting && !offline() && pending === null;
}

// ---------- cards ----------

const FACE_WORDS: Record<string, string> = { skip: "Skip", reverse: "Reverse", draw2: "Draw Two" };

/** A card's face as markup: corners, centre and marks. */
function faceOf(id: number): string {
  const { color, face } = card(id);
  const sym =
    face === "skip"
      ? SKIP
      : face === "reverse"
        ? REVERSE
        : face === "draw2"
          ? "+2"
          : face === "wild4"
            ? "+4"
            : face === "wild"
              ? STAR
              : String(face);
  return (
    `<span class="cn tl">${sym}</span><span class="big">${sym}</span><span class="cn br">${sym}</span>` +
    (color ? mark(color, "mk tr") + mark(color, "mk bl") : "")
  );
}

function cardClass(id: number): string {
  const c = card(id).color;
  return `lc-card ${c ?? "wild"}`;
}

/** Hand order on screen: by colour, Wilds last, then by face. The board keeps its own order. */
function sorted(hand: readonly number[]): number[] {
  const rank = (id: number) => {
    const { color, face } = card(id);
    const f =
      typeof face === "number" ? face : ["skip", "reverse", "draw2", "wild", "wild4"].indexOf(face) + 10;
    return (color ? COLORS.indexOf(color) : 4) * 100 + f;
  };
  return [...hand].sort((a, b) => rank(a) - rank(b) || a - b);
}

// ---------- words ----------

const said = (c: Color) => `<span class="${c}">${mark(c)}<b>${c}</b></span>`;
const youOr = (seat: Seat, to: Seat) => (seat === to ? "You" : names[seat]);

/** One move in words, told to `to`. */
function sayEvent(e: Event, to: Seat): string {
  const who = youOr(e.by, to);
  const them = youOr(other(e.by), to);
  switch (e.t) {
    case "play": {
      let s = `${who} played a ${nameOf(e.card)}`;
      if (e.color) s += ` and picked ${e.color}`;
      if (e.call) s += ` · "Last card!"`;
      if (e.drew > 0) s += `. ${them} drew ${e.drew}`;
      return s;
    }
    case "draw":
      return e.card !== null && e.by === to ? `${who} drew a ${nameOf(e.card)}` : `${who} drew a card`;
    case "keep":
      return `${who} kept it`;
    case "catch":
      return `${who} caught ${them === "You" ? "you" : them} without a call. ${them} drew ${e.drew}`;
  }
}

/** The moves since `to` last moved, in words: what the "Pass to" card says. */
function sinceLast(v: View, to: Seat): string {
  const log = v.log;
  let from = log.length;
  while (from > 0 && log[from - 1]!.by !== to) from--;
  return join(log.slice(from).slice(-3), to);
}

/** The last two moves, in words. */
function recent(v: View, to: Seat): string {
  if (v.log.length === 0) return startText(v, to);
  return join(v.log.slice(-2), to);
}

/** Moves in words. A draw and a keep by the same player read as one. */
function join(events: Event[], to: Seat): string {
  const parts: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const next = events[i + 1];
    if (e.t === "draw" && next?.t === "keep" && next.by === e.by) {
      parts.push(`${sayEvent(e, to)} and kept it`);
      i++;
      continue;
    }
    parts.push(sayEvent(e, to));
  }
  return parts.length ? parts.join(". ") + "." : "";
}

/** How the game began: the first card, and what it did. */
function startText(v: View, to: Seat): string {
  const { start, first } = v;
  let s = `The first card is a ${nameOf(start.card)}.`;
  if (start.skipped) {
    const who = youOr(first, to);
    s += start.drew > 0 ? ` ${who} drew ${start.drew} and lost the turn.` : ` ${who} lost the turn.`;
  }
  return s;
}

/** What may be played on the top card, in words with the colour's mark. */
function wantText(v: View): string {
  const top = card(v.top);
  if (v.want === null) return "Any card goes";
  if (top.color === null) return `Play a ${said(v.want)} card`;
  const face = typeof top.face === "number" ? String(top.face) : FACE_WORDS[top.face]!;
  return `Play a ${said(v.want)} card or a ${face}`;
}

// ---------- the hand ----------

const handEl = $("lc-hand");
const foeEl = $("lc-foe");
const discardEl = $("lc-discard");
const pileEl = $<HTMLButtonElement>("lc-pile");
/** The card buttons in the hand, by card id. */
const handCards = new Map<number, HTMLButtonElement>();

function handCard(id: number): HTMLButtonElement {
  let el = handCards.get(id);
  if (!el) {
    el = document.createElement("button");
    el.type = "button";
    el.className = cardClass(id);
    el.dataset.id = String(id);
    el.innerHTML = faceOf(id);
    handCards.set(id, el);
  }
  return el;
}

/**
 * Places the hand's cards in a fan. Up to ROOMY cards the cards are big and
 * overlap less. Past that they get smaller and closer. A hand too big for one
 * row at MIN_STRIP takes more rows, the later ones in front.
 */
function fan(ids: number[]) {
  const n = ids.length;
  const W = handEl.clientWidth;
  const w = Math.round(Math.min(n <= ROOMY ? 72 : 60, W / 4.4));
  const h = w * 1.45;
  const perRow = Math.max(1, Math.floor((W - w) / MIN_STRIP) + 1);
  const rows = Math.max(1, Math.ceil(n / perRow));
  const per = Math.ceil(n / rows);
  const rowGap = Math.round(h * 0.46);
  handEl.style.setProperty("--w", `${w}px`);
  handEl.style.height = `${Math.ceil(h + LIFT + 14 + (rows - 1) * rowGap)}px`;
  ids.forEach((id, i) => {
    const el = handCard(id);
    const r = Math.floor(i / per);
    const j = i - r * per;
    const inRow = Math.min(per, n - r * per);
    const step = inRow > 1 ? Math.min(w * 0.66, (W - w) / (inRow - 1)) : 0;
    const x = (W - (w + step * (inRow - 1))) / 2 + j * step;
    const mid = (inRow - 1) / 2;
    const off = mid > 0 ? (j - mid) / mid : 0;
    const spread = Math.min(8, inRow * 1.2);
    const y = off * off * 6 - (rows - 1 - r) * rowGap - (id === lifted ? LIFT : 0);
    el.style.zIndex = String(i + 1);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(off * spread).toFixed(2)}deg)`;
  });
}

function drawHand(v: View | null) {
  const ids = v ? sorted(v.hand) : [];
  const can = new Set(v && !locked() ? playableIn(v) : []);
  const mine = !locked();
  if (lifted !== null && !can.has(lifted)) lifted = null;
  for (const [id, el] of handCards) {
    if (!ids.includes(id)) {
      el.remove();
      handCards.delete(id);
    }
  }
  ids.forEach((id, i) => {
    const el = handCard(id);
    // Keep the DOM in hand order, so the tab order runs left to right.
    if (handEl.children[i] !== el) handEl.insertBefore(el, handEl.children[i] ?? null);
    const dim = mine && !can.has(id);
    el.classList.toggle("dim", dim);
    el.classList.toggle("up", id === lifted);
    el.setAttribute("aria-pressed", String(id === lifted));
    el.setAttribute("aria-label", nameOf(id) + (dim ? ", does not fit" : ""));
  });
  fan(ids);
}

/** The other hand: face down, or face up once the game is over. */
function drawFoe(v: View | null) {
  const faces = v?.over ? (v.foe ?? []) : null;
  const n = faces ? faces.length : (v?.others ?? 0);
  const els = [...foeEl.children] as HTMLElement[];
  // Face-up cards replace the backs: draw them all again.
  if (faces || els.some((el) => !el.classList.contains("back"))) foeEl.replaceChildren();
  while (foeEl.childElementCount > n) foeEl.lastElementChild!.remove();
  while (foeEl.childElementCount < n) {
    const el = document.createElement("i");
    const id = faces?.[foeEl.childElementCount];
    el.className = id === undefined ? "lc-card back" : cardClass(id);
    if (id !== undefined) el.innerHTML = faceOf(id);
    foeEl.append(el);
  }
  const W = foeEl.clientWidth;
  const w = parseFloat(getComputedStyle(foeEl).getPropertyValue("--w")) || 34;
  const step = n > 1 ? Math.min(w * (faces ? 0.62 : 0.42), (W * 0.9 - w) / (n - 1)) : 0;
  const x0 = (W - (w + step * (n - 1))) / 2;
  [...foeEl.children].forEach((el, i) => {
    const mid = (n - 1) / 2;
    const off = mid > 0 ? (i - mid) / mid : 0;
    (el as HTMLElement).style.transform =
      `translate(${(x0 + i * step).toFixed(1)}px, ${(off * off * 4).toFixed(1)}px) rotate(${(-off * Math.min(8, n)).toFixed(2)}deg)`;
  });
  const who = v ? names[other(v.seat)] : "";
  foeEl.setAttribute(
    "aria-label",
    faces ? `${who}'s cards: ${faces.map(nameOf).join(", ")}` : `${who} holds ${n}`,
  );
}

/** The top card, ringed with the colour to match. */
function drawDiscard(v: View | null) {
  const top = v?.top ?? null;
  const el = discardEl.firstElementChild as HTMLElement | null;
  if (top === null) discardEl.replaceChildren();
  else if (el?.dataset.id !== String(top)) {
    const c = document.createElement("i");
    c.className = cardClass(top);
    c.dataset.id = String(top);
    c.innerHTML = faceOf(top);
    discardEl.replaceChildren(c);
  }
  discardEl.className = `lc-discard${v?.want ? ` ${v.want}` : ""}`;
  discardEl.setAttribute(
    "aria-label",
    top === null ? "No card yet" : `Top card: ${nameOf(top)}` + (v?.want ? `. Play ${v.want}.` : ""),
  );
  const drawable = !!v && !locked() && !v.drawing;
  pileEl.disabled = !drawable;
  pileEl.classList.toggle("go", drawable);
  pileEl.setAttribute("aria-label", `Draw pile: ${v?.pile ?? 0} cards. Tap to draw.`);
  $("lc-pile-n").textContent = v ? `${v.pile} left` : "";
}

// ---------- the rest of the screen ----------

function status(v: View, seat: Seat): string {
  if (v.over) return v.winner === seat ? "Winner" : "";
  const on = v.turn === seat;
  const called = v.called[seat] ? "Last card!" : "";
  if (solo && seat === COMPUTER) return called || LEVEL_LABELS[level];
  if (called) return called;
  if (!channel) return on ? "Your turn" : "";
  if (seat !== me) return on ? "Their turn" : "";
  return on ? "Your turn" : "You";
}

function drawPlayers(v: View | null) {
  const near = v?.seat ?? holder();
  for (const seat of [0, 1] as const) {
    const el = $(`lc-pl-${seat}`);
    el.style.order = seat === near ? "0" : "1";
    el.classList.toggle("right", seat !== near);
    el.classList.toggle("on", !!v && (v.over ? v.winner === seat : v.turn === seat));
    el.querySelector(".lc-name")!.textContent = names[seat];
    const sub = el.querySelector(".lc-sub")!;
    sub.textContent = v ? status(v, seat) : "";
    sub.classList.toggle("called", !!v && !v.over && v.called[seat]);
    const n = !v ? 0 : seat === v.seat ? v.hand.length : v.others;
    el.querySelector(".lc-count")!.textContent = v ? String(n) : "";
    el.setAttribute("aria-label", `${names[seat]}: ${n} ${n === 1 ? "card" : "cards"}`);
  }
  $("lc-tally").innerHTML =
    wins[0] + wins[1] > 0
      ? `<i class="lc-mini s0"></i><b>${wins[0]}</b>–<b>${wins[1]}</b><i class="lc-mini s1"></i>`
      : "";
}

/** What to do now, or who the game waits for. */
function drawLine(v: View | null) {
  const line = $("lc-line");
  const text = $("lc-line-text");
  const go = !!v && !locked();
  const wait = !v || (!v.over && !go && !resting);
  line.classList.toggle("go", go);
  line.hidden = !!v?.over;
  $("lc-dots").hidden = !wait || (!!v && offline());
  if (!v) {
    text.textContent = "Connecting";
  } else if (v.over) {
    // Keeps its words: the line is hidden.
  } else if (go) {
    const can = playableIn(v);
    text.innerHTML = v.drawing
      ? "It fits · play it or keep it"
      : lifted !== null
        ? "Tap it again to play"
        : can.length === 0
          ? "Nothing fits · draw a card"
          : wantText(v);
  } else if (resting) {
    text.innerHTML = v.want ? wantText(v).replace("Play", "Next:") : "Any card goes";
  } else if (solo) {
    text.textContent = "Computer is thinking";
  } else if (channel) {
    text.textContent = pending !== null ? "Sending" : `Waiting for ${names[other(me)]}`;
  } else {
    text.textContent = `${names[v.turn]}'s turn`;
  }
  $("lc-told").textContent = v ? recent(v, v.seat) : "";
}

function drawDock(v: View | null) {
  const over = !!v?.over;
  $("lc-dock").hidden = over;
  $("lc-result").hidden = !over;
  $("lc-main").classList.toggle("over", over);
  const go = !!v && !locked();
  const draw = $<HTMLButtonElement>("lc-draw");
  draw.textContent = v?.drawing ? "Keep it" : "Draw";
  draw.disabled = !go;
  $<HTMLButtonElement>("lc-play").disabled = !go || lifted === null;
  const call = $<HTMLButtonElement>("lc-call");
  const callable = go && !!v && v.hand.length === 2 && playableIn(v).length > 0;
  if (!callable) calling = false;
  call.hidden = !callable;
  call.setAttribute("aria-pressed", String(calling));
  $("lc-catch").hidden = !catchable();
  if (over && v) drawResult(v);
}

/** The end of a game: who won, how, a few numbers, and online, who wants a rematch. */
function drawResult(v: View) {
  const w = v.winner!;
  const to = v.seat;
  $("lc-result-title").textContent = (solo || channel) && w === to ? "You win!" : `${names[w]} wins!`;
  $("lc-why").textContent = `${youOr(w, to)} played the last card, a ${nameOf(v.top)}.`;
  const again = $<HTMLButtonElement>("lc-again");
  const note = $("lc-note");
  const friend = names[other(me)];
  const flags = channel && latest ? latest.rematch : [false, false];
  again.disabled = flags[me]!;
  again.textContent = flags[me] ? `Waiting for ${friend}` : "Play again";
  const asked = !flags[me] && flags[1 - me];
  note.hidden = !channel;
  note.style.visibility = asked ? "" : "hidden";
  note.textContent = asked ? `${friend} wants a rematch` : " ";
  const loser = other(w);
  let played = 0;
  let drawn = 0;
  for (const e of v.log) {
    if (e.t === "play") {
      played++;
      drawn += e.drew;
    } else if (e.t === "draw") drawn++;
    else if (e.t === "catch") drawn += e.drew;
  }
  const left = loser === v.seat ? v.hand.length : v.others;
  const rows: [string, string][] = [
    ["Cards played", String(played)],
    ["Cards drawn", String(drawn + v.start.drew)],
    [
      `${loser === to && (solo || channel) ? "Left in your hand" : `Left with ${names[loser]}`}`,
      String(left),
    ],
  ];
  $("lc-stats").innerHTML = rows.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join("");
}

// ---------- slides ----------

interface Snapshot {
  hand: Map<number, DOMRect>;
  top: string | null;
  foe: DOMRect[];
  seat: Seat | null;
}

function snapshot(v: View | null): Snapshot {
  const hand = new Map<number, DOMRect>();
  for (const [id, el] of handCards) hand.set(id, el.getBoundingClientRect());
  return {
    hand,
    top: (discardEl.firstElementChild as HTMLElement | null)?.dataset.id ?? null,
    foe: [...foeEl.children].map((el) => el.getBoundingClientRect()),
    seat: v?.seat ?? null,
  };
}

const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

/** Slides `el` from where `from` was to where it is now. */
function slide(el: HTMLElement, from: DOMRect, delay = 0) {
  const to = el.getBoundingClientRect();
  const [fx, fy] = centre(from);
  const [tx, ty] = centre(to);
  const dx = fx - tx;
  const dy = fy - ty;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const scale = to.width > 0 ? Math.min(from.width, from.height / 1.45) / (to.width || 1) : 1;
  el.animate(
    [
      { translate: `${dx}px ${dy}px`, scale: String(scale) },
      { translate: "0px 0px", scale: "1" },
    ],
    {
      duration: SLIDE_MS,
      delay,
      easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
      fill: "backwards",
    },
  );
}

/** Pictures the change from `was` to the screen now: played cards fly to the discard pile, drawn ones come off the draw pile. */
function slideFrom(was: Snapshot, v: View | null) {
  if (!v || was.seat !== v.seat || stillMotion.matches) return;
  const pile = pileEl.querySelector(".lc-stack")!.getBoundingClientRect();
  const topEl = discardEl.firstElementChild as HTMLElement | null;
  if (topEl && topEl.dataset.id !== was.top) {
    const id = Number(topEl.dataset.id);
    const from = was.hand.get(id) ?? was.foe.at(-1) ?? foeEl.getBoundingClientRect();
    slide(topEl, from);
  }
  let k = 0;
  for (const [id, el] of handCards) {
    const old = was.hand.get(id);
    if (old) slide(el, old);
    else slide(el, pile, 90 * k++);
  }
  // New backs on the other fan come off the draw pile too.
  const backs = [...foeEl.children] as HTMLElement[];
  if (!v.over)
    for (let i = was.foe.length; i < backs.length; i++) slide(backs[i]!, pile, 90 * (i - was.foe.length));
}

/** Draws the game as it stands. With `animate`, the cards that moved slide there. */
function draw(animate = false) {
  const v = view();
  const was = animate ? snapshot(v) : null;
  drawPlayers(v);
  drawDiscard(v);
  drawFoe(v);
  drawHand(v);
  drawLine(v);
  drawDock(v);
  if (was) slideFrom(was, v);
}

// ---------- playing ----------

function cleanName(raw: string, fallback: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 12) || fallback;
}

const saveKey = () => (solo ? "solo" : "game");

function persist() {
  if (channel) return;
  const saved: Saved = { names, seed, first: board.first, moves: board.moves, wins };
  if (solo) Object.assign(saved, { level, luck });
  save(saveKey(), JSON.stringify(saved));
}

/** The saved game, if it is intact. */
function savedGame(): (Saved & { board: Board }) | null {
  const s = loadJson<Saved>(saveKey());
  if (!s || !Array.isArray(s.names) || !Array.isArray(s.moves) || !Array.isArray(s.wins)) return null;
  if ((s.first !== 0 && s.first !== 1) || !Number.isInteger(s.seed)) return null;
  if (solo && (!s.level || !LEVELS.includes(s.level) || !Number.isInteger(s.luck))) return null;
  let b: Board | null;
  try {
    b = replay(s.seed, s.first, s.moves);
  } catch {
    // A corrupt move list.
    b = null;
  }
  if (!b) return null;
  const n = (i: 0 | 1) => cleanName(String(s.names[i] ?? ""), DEFAULT_NAMES[i]);
  const w = (i: 0 | 1) => Math.max(0, Math.floor(Number(s.wins[i]) || 0));
  return { ...s, names: [n(0), n(1)], wins: [w(0), w(1)], board: b };
}

/** Offline: `seat` makes a move. It counts and saves at once, and the screen slides to it. */
function act(seat: Seat, action: Action): boolean {
  const next = apply(board, { ...action, by: seat });
  if (!next) return false;
  const turned = next.turn !== board.turn;
  board = next;
  if (board.winner !== null) wins[board.winner] += 1;
  persist();
  buzz(action);
  if (!solo && !board.over && turned && board.turn !== viewer) resting = true;
  draw(true);
  if (solo) takeTurn();
  else if (resting) passTimer = window.setTimeout(passOn, PASS_MS);
  return true;
}

function buzz(action: Action) {
  if (!("vibrate" in navigator)) return;
  const v = view();
  navigator.vibrate(v?.over ? [20, 40, 20, 40, 60] : action.t === "catch" ? [20, 40, 20] : 10);
}

/** The phone's player moves. Online it goes to the host, and the screen waits for the answer. */
function send(action: Action) {
  const v = view();
  if (!v) return;
  lifted = null;
  if (action.t === "play") calling = false;
  if (channel) {
    const msg: LastClientMessage =
      action.t === "play"
        ? { ...action, call: action.call === true, at: v.moves }
        : { t: action.t, at: v.moves };
    if (!channel.send(msg)) return draw();
    pending = v.moves;
    draw();
    return;
  }
  if (!act(v.seat, action)) draw();
}

/** Plays a card from the hand. A Wild asks for its colour first. */
function playCard(id: number, color?: Color) {
  const v = view();
  if (!v || locked() || !playableIn(v).includes(id)) return;
  if (isWild(id) && !color) return openSheet(id);
  send({ t: "play", card: id, ...(color ? { color } : {}), call: calling && v.hand.length === 2 });
}

/** A tap on a card: the first lifts it, a second plays it. */
function tapCard(id: number) {
  const v = view();
  if (!v || locked()) return;
  if (!playableIn(v).includes(id)) return;
  if (lifted === id) return playCard(id);
  lifted = id;
  draw();
}

function drawOrKeep() {
  const v = view();
  if (!v || locked()) return;
  send({ t: v.drawing ? "keep" : "draw" });
}

/**
 * Solo: on the computer's turn, or when it may catch the player, it waits a
 * moment and moves. The move comes from its view and its luck alone, so a
 * reload mid-wait makes the same move.
 */
function takeTurn() {
  clearTimeout(thinkTimer);
  if (!thinking()) return;
  const before = board;
  thinkTimer = window.setTimeout(
    () => {
      if (board !== before || !$("lc-game").classList.contains("on")) return;
      const a = choose(viewOf(board, COMPUTER), level, luck);
      // Out of turn, only a catch counts.
      if (board.turn !== COMPUTER && a.t !== "catch") return;
      act(COMPUTER, a);
    },
    board.drawn !== null ? AGAIN_MS : THINK_MS,
  );
}

// ---------- the colour sheet ----------

const swatches = $("lc-swatches");
for (const c of COLORS) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.color = c;
  b.style.setProperty("--k", `var(--lc-${c})`);
  b.innerHTML = `${mark(c)}${c[0]!.toUpperCase()}${c.slice(1)}`;
  b.addEventListener("click", () => {
    const id = wildCard;
    closeSheet();
    if (id !== null) playCard(id, c);
  });
  swatches.append(b);
}

function openSheet(id: number) {
  wildCard = id;
  $("lc-shade").hidden = false;
  $("lc-sheet").hidden = false;
  (swatches.firstElementChild as HTMLElement).focus();
}

function closeSheet() {
  wildCard = null;
  $("lc-shade").hidden = true;
  $("lc-sheet").hidden = true;
}

$("lc-shade").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && wildCard !== null) closeSheet();
});

// ---------- input ----------

/** A finger slid along the fan lifts the card under it. The tap that ends a slide plays nothing. */
let scrub: { start: number | null; moved: boolean } | null = null;
let swallow = false;

function cardAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(".lc-hand .lc-card");
  return el ? Number(el.dataset.id) : null;
}

handEl.addEventListener("pointerdown", (e) => {
  swallow = false;
  scrub = { start: cardAt(e.clientX, e.clientY), moved: false };
});

handEl.addEventListener("pointermove", (e) => {
  if (!scrub || e.buttons === 0) return;
  const id = cardAt(e.clientX, e.clientY);
  const v = view();
  if (id === null || id === lifted || id === scrub.start || !v || locked()) return;
  if (!playableIn(v).includes(id)) return;
  scrub.moved = true;
  scrub.start = null;
  lifted = id;
  draw();
});

const endScrub = () => {
  swallow = scrub?.moved ?? false;
  scrub = null;
};
handEl.addEventListener("pointerup", endScrub);
handEl.addEventListener("pointercancel", endScrub);

handEl.addEventListener("click", (e) => {
  if (swallow) {
    swallow = false;
    return;
  }
  const el = (e.target as HTMLElement).closest<HTMLElement>(".lc-card");
  if (el) tapCard(Number(el.dataset.id));
});

$("lc-play").addEventListener("click", () => {
  if (lifted !== null) playCard(lifted);
});
$("lc-draw").addEventListener("click", drawOrKeep);
pileEl.addEventListener("click", () => {
  const v = view();
  if (v && !v.drawing) drawOrKeep();
});
$("lc-call").addEventListener("click", () => {
  calling = !calling;
  draw();
});
$("lc-catch").addEventListener("click", () => {
  if (catchable()) send({ t: "catch" });
});

// A turned phone or a resized window places the fans again.
addEventListener("resize", () => {
  if ($("lc-game").classList.contains("on")) draw();
});

// ---------- games ----------

/** Covers the screen until `seat` has the phone, then runs `then`. */
function handOff(seat: Seat, sub: string, then: () => void) {
  $("lc-pass-flag").className = `lc-mini s${seat}`;
  $("lc-pass-title").textContent = `Pass to ${names[seat]}`;
  $("lc-pass-sub").textContent = sub;
  ready = then;
  show("lc-pass");
}

/** Pass & play: the phone goes to the player on turn, who then sees their own hand. */
function passOn() {
  clearTimeout(passTimer);
  closeSheet();
  const next = board.turn;
  const v = viewOf(board, next);
  const last = sinceLast(v, next);
  const sub =
    last ||
    (board.moves.length === 0
      ? `${startText(v, next)} ${next === board.first ? "You play first." : ""}`
      : "");
  handOff(next, sub.trim(), () => {
    viewer = next;
    resting = false;
    lifted = null;
    calling = false;
    show("lc-game");
    draw();
  });
}

$("lc-ready").addEventListener("click", () => {
  const go = ready;
  ready = null;
  go?.();
});

/** Shows the game. On one phone a game in play first goes behind the "Pass to" card. */
function startGame(next: Board) {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  closeSheet();
  board = next;
  lifted = null;
  calling = false;
  resting = false;
  viewer = solo ? HUMAN : board.turn;
  if (!solo && !board.over) return passOn();
  show("lc-game");
  draw();
  takeTurn();
}

/** A fresh deal with the same players. Whoever went second last time starts. */
function rematch() {
  seed = newSeed();
  luck = newSeed();
  startGame(newGame(seed, other(board.first)));
  persist();
}

function ourGame() {
  const saved = savedGame();
  if (!saved || saved.names[0] !== names[0] || saved.names[1] !== names[1]) return null;
  return !solo || saved.level === level ? saved : null;
}

/** Who starts a new game: the other player after a game, the same one if nobody moved. */
function nextFirst(saved: ReturnType<typeof ourGame>): Seat {
  if (!saved) return 0;
  return saved.moves.length === 0 ? saved.first : other(saved.first);
}

function goHome() {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  closeSheet();
  ready = null;
  resting = false;
  const saved = ourGame();
  const first = nextFirst(saved);
  $("lc-resume").hidden = !saved || saved.board.over || saved.moves.length === 0;
  $("lc-lead").textContent =
    (solo ? "You against the computer. " : "One phone, two players. ") +
    "Match the top card by colour, number or symbol, or play a Wild. " +
    "Skip and Reverse give you another turn. Draw Two and Wild Draw Four make the other player draw. " +
    'Press "Last card!" as you play your second-last card. Empty your hand to win.';
  const colours = [COLOURS[0], solo ? `${COLOURS[1]} · ${LEVEL_LABELS[level]}` : COLOURS[1]];
  for (const seat of [0, 1] as const) {
    $(`lc-name-${seat}`).textContent = names[seat];
    $(`lc-sub-${seat}`).textContent = colours[seat] + (seat === first ? " · plays first" : "");
  }
  show("lc-home");
}

$("lc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  // Same players keep their running score. New names (or a new level) start from zero.
  const saved = ourGame();
  wins = saved ? saved.wins : [0, 0];
  seed = newSeed();
  luck = newSeed();
  startGame(newGame(seed, nextFirst(saved)));
  persist();
});

$("lc-resume").addEventListener("click", () => {
  const saved = ourGame();
  if (!saved) return goHome();
  wins = saved.wins;
  seed = saved.seed;
  luck = saved.luck ?? 0;
  startGame(saved.board);
});

// ---------- online ----------

/** Catches the screen up with the host's latest view. `prev` is the view before it. */
function settle(prev: LastView | null) {
  const v = latest;
  if (!channel || !v) return;
  wins = [...v.wins];
  const fresh = !prev || prev.first !== v.first || (prev.over && !v.over) || v.moves < prev.moves;
  if (pending !== null) {
    // The move this phone sent never counted (a drop in the connection, say).
    if (v.moves <= pending) toast("Connection hiccup · try that again");
    pending = null;
  }
  if (fresh) {
    lifted = null;
    calling = false;
    closeSheet();
  }
  show("lc-game");
  draw(!fresh && v.moves > prev.moves);
  if (prev && v.moves > prev.moves && v.over && "vibrate" in navigator)
    navigator.vibrate([20, 40, 20, 40, 60]);
  const mine = !v.over && v.turn === me;
  if (mine && !wasMine) yourTurn();
  wasMine = mine;
}

function yourTurn() {
  toast("Your turn");
  if ("vibrate" in navigator) navigator.vibrate([30, 60, 30]);
}

function toast(text: string) {
  const el = $("lc-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2200);
}

function setBanner(text: string | null, ok = false) {
  const el = $("lc-banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("ok", ok);
}

function onMessage(msg: LastServerMessage) {
  const prev = latest;
  latest = msg.view;
  settle(prev);
}

function onChange() {
  const ch = channel;
  if (!ch) return;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.update();
  if ($("lc-game").classList.contains("on")) draw();
}

function openOnline(ch: Channel<LastServerMessage, LastClientMessage>) {
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  closeSheet();
  channel = ch;
  me = ch.me;
  latest = null;
  pending = null;
  wasMine = false;
  wins = [0, 0];
  lifted = null;
  calling = false;
  resting = false;
  ready = null;
  const [a, b] = ch.players;
  names = [a.name, b.name];
  banner?.stop();
  banner = new ConnectionBanner(ch, setBanner);
  show("lc-game");
  draw();
  ch.listen({ message: onMessage, change: onChange });
}

$("lc-leave").addEventListener("click", () => (channel ? channel.leave() : goHome()));
$("lc-again").addEventListener("click", () => (channel ? channel.send({ t: "rematch" }) : rematch()));

// For the end-to-end test.
(window as unknown as { __last: unknown }).__last = {
  state: () => {
    const v = view();
    return {
      screen: document.querySelector("[data-screen].on")?.id ?? null,
      seat: v?.seat ?? null,
      hand: v?.hand ?? [],
      shown: [...handCards.keys()],
      others: v?.others ?? 0,
      top: v?.top ?? null,
      want: v?.want ?? null,
      pile: v?.pile ?? 0,
      turn: v?.turn ?? null,
      first: v?.first ?? null,
      drawing: v?.drawing ?? false,
      drawn: v?.drawn ?? null,
      open: v?.open ?? null,
      called: v?.called ?? [false, false],
      moves: v?.moves ?? 0,
      over: v?.over ?? false,
      winner: v?.winner ?? null,
      playable: v && !locked() ? playableIn(v) : [],
      catchable: catchable(),
      locked: locked(),
      lifted,
      calling,
      sheet: wildCard !== null,
      resting,
      thinking: thinking(),
      wins,
      level: solo ? level : null,
      me: channel ? me : null,
      rematch: latest?.rematch ?? null,
      pending,
    };
  },
};

// ---------- shell hooks ----------

export function open(_rest: string, session: GameSession): void {
  if (session.mode === "online") {
    solo = false;
    if (!channel) openOnline(session.channel as Channel<LastServerMessage, LastClientMessage>);
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
  // Only the computer's wait and the "Pass to" card's wait run in the background. The game is saved after every move.
  clearTimeout(thinkTimer);
  clearTimeout(passTimer);
  closeSheet();
  ready = null;
  resting = false;
  channel = null;
  latest = null;
  pending = null;
  clearTimeout(toastTimer);
  $("lc-toast").classList.remove("on");
  banner?.stop();
  banner = null;
}
