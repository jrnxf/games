// Mancala's part of the end-to-end suites, driven by taps on the real pits.
// `pnpm test:menu` plays it solo against the Hard computer (with a reload on
// its turn) and pass & play (a win with a capture, an extra turn and a sweep,
// a draw, and a reload), and `pnpm test:online` plays it between two phones
// to a result, a rematch, an extra turn on a slow link and a second visit
// that keeps the score.

import { think } from "../../src/games/mancala/core/ai.ts";
import { hole, replay, store, type Seat } from "../../src/games/mancala/core/board.ts";
import { DRAW, QUICK, SWEPT } from "../unit/mancala-games.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const MANCALA = "mancala";

/** What Mancala's test hook reports. */
interface MancalaState {
  moves: number[];
  starter: Seat;
  turn: Seat;
  again: boolean;
  over: boolean;
  winner: Seat | null;
  draw: boolean;
  holes: number[];
  shown: number[];
  score: [number, number];
  legal: number[];
  thinking: boolean;
  busy: boolean;
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
  me: Seat | null;
  near: Seat;
  locked: boolean;
  rematch: [boolean, boolean] | null;
  notes: { at: number; positions: number; ms: number; depth: number }[];
}

const mc = (p: Browser) => p.eval<MancalaState>("() => window.__mancala.state()");
// The 14 holes sit in the board in sowing order.
const holeOf = (h: number) => `#mc-board > :nth-child(${h + 1})`;
const open = (p: Browser) =>
  p.eval<number>(`() => document.querySelectorAll("#mc-board .mc-pit.can").length`);
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("mc-toast").classList.contains("on")`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the last move's seeds have all fallen. */
async function landed(...phones: Browser[]) {
  await waitFor("the seeds to land", () => phones.every((p) => !mc(p).busy));
}

/** Taps the pit `pit` of the player on turn on `p`, then waits until every phone has the move and its seeds. */
async function tap(p: Browser, pit: number, phones: Browser[] = [p]) {
  const s = await waitFor("a pit to tap", () => {
    const now = mc(p);
    return now.locked ? null : now;
  });
  const n = s.moves.length;
  p.click(holeOf(hole(s.turn, pit)));
  await waitFor(`pit ${pit}`, () =>
    phones.every((x) => {
      const now = mc(x);
      return now.moves.length > n && now.moves[n] === pit && !now.busy;
    }),
  );
}

/**
 * Sows `picks` with taps made inside the page, each as soon as the seeds of
 * the one before have landed. The last move's seeds may still be falling when
 * this returns.
 */
function tapAll(p: Browser, picks: number[]) {
  for (let i = 0; i < picks.length; i += 6) {
    p.run(`await page.eval(async () => {
      const api = window.__mancala;
      const holes = document.getElementById("mc-board").children;
      for (const pit of ${JSON.stringify(picks.slice(i, i + 6))}) {
        const t0 = Date.now();
        while (api.state().locked && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 10));
        const s = api.state();
        holes[s.turn * 7 + pit].click();
        while (api.state().moves.length !== s.moves.length + 1 && Date.now() - t0 < 6000)
          await new Promise((r) => setTimeout(r, 10));
      }
    });`);
  }
}

/** Waits out the computer's turn: the game is Zoe's again, or over, with every seed in its hole. */
async function computerMoved(p: Browser) {
  await waitFor("the computer's move", () => {
    const s = mc(p);
    return !s.busy && (s.turn === 0 || s.over);
  });
}

/** Each hole shows its seeds twice: as a number, and as that many seeds. */
const countsMatch = (p: Browser) =>
  p.eval<boolean>(`() => {
    const s = window.__mancala.state();
    return [...document.getElementById("mc-board").children].every(
      (el, h) =>
        el.querySelector(".mc-n").textContent === String(s.holes[h]) &&
        el.querySelectorAll(".mc-seeds i").length === s.holes[h],
    );
  }`);

/** True when `seat`'s store is the one at the bottom of the board. */
const storeBelow = (p: Browser, seat: Seat) =>
  p.eval<boolean>(`() => {
    const top = (h) => document.querySelector("#mc-board > :nth-child(" + (h + 1) + ")").getBoundingClientRect().top;
    return top(${store(seat)}) > top(${store((1 - seat) as Seat)});
  }`);

/** The board fits a screen of `size`: no sideways scroll, pits a thumb can hit, the dock in view. */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  const m = p.eval<{ pit: number; scroll: number; width: number; bottom: number; height: number }>(
    `() => {
    const pits = [...document.querySelectorAll("#mc-board .mc-pit")].map((el) => el.getBoundingClientRect());
    return {
      pit: Math.min(...pits.map((r) => Math.min(r.width, r.height))),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: document.querySelector("#mc-game .mc-dock").getBoundingClientRect().bottom,
      height: innerHeight,
    };
  }`,
  );
  check(
    m.pit >= 44 && m.scroll <= m.width && m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} the board fits: ${m.pit.toFixed(1)} px pits, no sideways scroll`,
  );
  p.screenshot(name);
}

/** Records every line the status bar shows on `p` from now on, for `said`. */
function watchStatus(p: Browser) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__mcSaid = [];
    w.__mcSaidWatch?.disconnect();
    w.__mcSaidWatch = new MutationObserver(() => {
      w.__mcSaid.push(document.getElementById("mc-status-text").textContent);
    });
    w.__mcSaidWatch.observe(document.getElementById("mc-status-text"), { childList: true, characterData: true, subtree: true });
  });`);
}

const said = (p: Browser) => p.eval<string[]>("() => window.__mcSaid");

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function mancalaSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${MANCALA}"] small`) === "Solo · vs computer",
    "Mancala plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${MANCALA}"]`);
  await waitFor("mancala home, solo", () => phone.visible("mc-home"));
  check(
    phone.text("#mc-name-0") === "Zoe" && phone.text("#mc-name-1") === "Computer",
    "solo Mancala is Zoe against the computer",
  );
  check(
    phone.text("#mc-sub-0") === "Amber · goes first" && phone.text("#mc-sub-1") === "Teal · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  phone.screenshot("mc-home-solo");
  phone.click("#mc-start");
  await waitFor("solo board", () => phone.visible("mc-game"));
  const start = mc(phone);
  check(start.turn === 0 && !start.thinking && start.level === "hard", "Zoe starts against Hard");
  check(
    start.holes.join() === "4,4,4,4,4,4,0,4,4,4,4,4,4,0" && open(phone) === 6,
    "four seeds in every pit, and Zoe's six pits are open",
  );
  check(countsMatch(phone), "every hole shows its seeds and their number");
  check(storeBelow(phone, 0), "Zoe's store is at the bottom");
  phone.screenshot("mc-solo-start");

  // Tap, then check the falling seeds and the thinking state inside the page
  // in one go: both are too short to span several browser calls.
  const blocked = phone.eval<{
    thinking: boolean;
    still: boolean;
    falling: boolean;
    open: number;
    label: string;
  }>(`async () => {
    const api = window.__mancala;
    const holes = document.getElementById("mc-board").children;
    holes[0].click();
    const before = api.state();
    for (let h = 0; h < 6; h++) holes[h].click();
    const after = api.state();
    while (api.state().busy) await new Promise((r) => setTimeout(r, 10));
    return {
      thinking: before.thinking && after.thinking,
      still: before.moves.length === 1 && after.moves.length === 1,
      falling: before.busy && before.shown[0] === 0 && before.shown[1] === 4 && before.holes[1] === 5,
      open: document.querySelectorAll("#mc-board .mc-pit.can").length,
      label: document.getElementById("mc-status-text").innerText.trim(),
    };
  }`);
  check(blocked.falling, "the move counts at once, and its seeds fall after it");
  check(blocked.thinking && blocked.still, "taps do nothing while the computer is thinking");
  check(
    blocked.open === 0 && blocked.label === "Computer is thinking",
    "no pit is open and the status says “Computer is thinking”",
  );
  await computerMoved(phone);
  const answered = mc(phone);
  check(answered.moves.length >= 2 && answered.turn === 0, "the computer answers, then it is Zoe's turn");
  check(answered.notes.length >= 1 && answered.notes[0]!.at === 1, "the computer keeps a note on its move");
  check(
    phone.text("#mc-pl-0 .mc-count") === String(answered.score[0]) &&
      phone.text("#mc-pl-1 .mc-count") === String(answered.score[1]) &&
      countsMatch(phone),
    "each card counts the seeds in its store",
  );
  phone.screenshot("mc-solo-turn");
  fits(phone, "360x740x2,mobile,touch", "mc-solo-360");
  fits(phone, "820x1180x2,mobile,touch", "mc-solo-tablet");
  phone.viewport(VIEWPORT);

  // Zoe sows until the turn passes, then the page reloads while the computer is still thinking.
  const pending = phone.eval<MancalaState | null>(`async () => {
    const api = window.__mancala;
    const t0 = Date.now();
    while (!api.state().over && Date.now() - t0 < 20000) {
      if (!api.state().locked) {
        document.querySelector("#mc-board .mc-pit.can").click();
        const s = api.state();
        if (s.thinking) {
          setTimeout(() => location.reload(), 0);
          return s;
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  }`);
  check(pending, "the reload lands during the computer's turn");
  await waitFor("home after reload", () => phone.visible("mc-home"));
  check(phone.visible("mc-resume"), "a solo game in progress offers to resume");
  phone.click("#mc-resume");
  await waitFor("resumed solo", () => phone.visible("mc-game"));
  // The computer may already have sown by the time this looks.
  const resumed = mc(phone);
  check(
    resumed.moves.slice(0, pending.moves.length).join() === pending.moves.join() &&
      (resumed.thinking || resumed.moves.length > pending.moves.length),
    "the resumed game is on the computer's turn",
  );
  await waitFor("the computer's move after the resume", () => mc(phone).moves.length > pending.moves.length);
  const expected = think(replay(pending.starter, pending.moves)!, "hard", pending.seed).pit;
  check(
    mc(phone).moves[pending.moves.length] === expected,
    "after the resume, the computer sows the pit its seed picked",
  );

  // Zoe always sows her first pit with seeds, and loses. The taps run inside
  // the page, a few seconds at a time.
  watchStatus(phone);
  const watchedFrom = mc(phone).moves.length;
  await waitFor(
    "the end of the solo game",
    () =>
      phone.eval<boolean>(`async () => {
        const api = window.__mancala;
        const t0 = Date.now();
        while (!api.state().over && Date.now() - t0 < 8000) {
          if (!api.state().locked) document.querySelector("#mc-board .mc-pit.can").click();
          else await new Promise((r) => setTimeout(r, 20));
        }
        return api.state().over && !api.state().busy;
      }`),
    180_000,
  );
  const lost = mc(phone);
  // Who earned an extra turn since the status bar was watched.
  const extra = [false, false];
  for (let i = watchedFrom; i < lost.moves.length; i++) {
    const b = replay(lost.starter, lost.moves.slice(0, i + 1))!;
    if (b.again) extra[b.turn] = true;
  }
  const lines = said(phone);
  check(
    lines.includes("Extra turn · Computer goes again") === extra[1] &&
      lines.includes("Extra turn · go again") === extra[0],
    `a last seed in the store gives another turn, and the status says so (Zoe ${extra[0]}, computer ${extra[1]})`,
  );
  check(lost.winner === 1 && lost.wins.join() === "0,1", "Hard beats a player who never looks");
  check(phone.text("#mc-result-title") === "Computer wins!", "the result names the computer");
  const why = phone.text("#mc-why");
  check(why === `Most seeds: ${lost.score[1]} to ${lost.score[0]}.`, `one line says why (${why})`);
  check(
    phone.text("#mc-stats").includes("Positions checked") && phone.text("#mc-stats").includes("Deepest look"),
    "the recap counts the computer's search",
  );
  check(
    phone.text("#mc-tally") === "0–1" && phone.text("#mc-pl-1 .mc-sub") === "Winner",
    "the score reads Zoe 0, Computer 1",
  );
  check(!phone.visible("mc-status") && phone.visible("mc-result"), "the result replaces the status line");
  check(countsMatch(phone) && lost.score[0] + lost.score[1] === 48, "all 48 seeds end in the two stores");
  phone.screenshot("mc-solo-lost");

  // The rematch: the computer goes first this time and moves on its own.
  phone.click("#mc-again");
  await waitFor("solo rematch", () => mc(phone).starter === 1);
  await computerMoved(phone);
  const opened = mc(phone);
  check(opened.moves.length >= 1 && opened.turn === 0, "the computer opens the rematch");
  check(opened.notes.length === opened.moves.length, "the rematch starts a fresh recap");
  phone.click("#mc-leave");
  await waitFor("mancala home", () => phone.visible("mc-home"));
  check(phone.visible("mc-resume"), "the rematch can be resumed");
  phone.click("#mc-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: a whole game with a capture, an
 * extra turn and a last sweep, then a draw, then a game left after an extra
 * turn. The session is Zoe and Kai.
 */
export async function mancalaPassAndPlay(phone: Browser, origin: string) {
  const gain = (seat: Seat) => phone.text(`${holeOf(store(seat))} .mc-gain`);
  phone.click(`#tiles a[href="/${MANCALA}"]`);
  await waitFor("mancala home", () => phone.visible("mc-home"));
  check(phone.eval<string>("() => location.pathname") === `/${MANCALA}`, "the URL is /mancala");
  check(phone.eval<string>("() => document.body.dataset.game") === MANCALA, "Mancala's theme is on");
  check(
    phone.text("#mc-name-0") === "Zoe" && phone.text("#mc-name-1") === "Kai",
    "Mancala takes the names from the session",
  );
  check(
    phone.text("#mc-sub-0") === "Amber · goes first" && phone.text("#mc-sub-1") === "Teal",
    "amber goes first",
  );
  check(!phone.visible("mc-resume"), "the solo Mancala game is saved apart from pass & play");
  phone.screenshot("mc-home");
  phone.click("#mc-start");
  await waitFor("board", () => phone.visible("mc-game"));
  check(
    mc(phone).turn === 0 && open(phone) === 6 && phone.text("#mc-status-text") === "Zoe's turn",
    "Zoe starts, with her six pits open",
  );

  // Zoe sows her fifth pit: one seed in her last pit, one in her store, two on Kai's side.
  await tap(phone, QUICK[0]!);
  check(
    mc(phone).holes.join() === "4,4,4,4,0,5,1,5,5,4,4,4,4,0" && countsMatch(phone),
    "a tap sows the pit, one seed a hole, through Zoe's store",
  );
  check(
    phone.eval<boolean>(
      `() => document.querySelector(${JSON.stringify(holeOf(4))}).classList.contains("from")`,
    ),
    "the pit the move came from is marked",
  );
  check(
    phone.text("#mc-status-text") === "Kai's turn" && phone.text("#mc-pl-1 .mc-sub") === "Your turn",
    "the turn passes to Kai",
  );
  // Zoe's pits take no tap on Kai's turn.
  phone.click(holeOf(0));
  check(mc(phone).moves.length === 1 && mc(phone).turn === 1, "a tap on the other player's pit does nothing");
  await tap(phone, QUICK[1]!);
  phone.click(holeOf(4));
  check(mc(phone).moves.length === 2 && mc(phone).turn === 0, "a tap on an empty pit does nothing");

  // Zoe's first pit ends in her empty fifth pit, opposite six of Kai's seeds.
  await tap(phone, QUICK[2]!);
  const took = mc(phone);
  check(
    took.score.join() === "8,0" && took.holes[4] === 0 && took.holes[8] === 0 && took.turn === 1,
    "a last seed in Zoe's empty pit captures it and the six seeds opposite",
  );
  check(
    phone.text("#mc-pl-0 .mc-count") === "8" && gain(0) === "+7" && countsMatch(phone),
    "the store shows the seven seeds it won, and Zoe's count goes up",
  );
  phone.screenshot("mc-capture");
  tapAll(phone, QUICK.slice(3, 8));
  await tap(phone, QUICK[8]!);
  const again = mc(phone);
  check(
    again.again && again.turn === 0 && again.score[0] === 11,
    "a last seed in Zoe's store keeps the turn",
  );
  check(phone.text("#mc-status-text") === "Extra turn · Zoe goes again", "Zoe plays again");
  phone.screenshot("mc-extra-turn");
  tapAll(phone, QUICK.slice(9));
  await waitFor("the end of the game", () => mc(phone).over && !mc(phone).busy);
  const won = mc(phone);
  check(won.winner === 0 && won.score.join() === "28,20" && won.wins.join() === "1,0", "Zoe wins 28 to 20");
  check(
    won.holes.join() === "0,0,0,0,0,0,28,0,0,0,0,0,0,20" && gain(1) === "+7",
    "Zoe's side is empty, so Kai's last seven seeds go to his store",
  );
  check(phone.text("#mc-result-title") === "Zoe wins!", "the result names the winner");
  check(phone.text("#mc-why") === "Most seeds: 28 to 20.", "one line says why");
  check(
    phone.text("#mc-stats") === "" && !phone.visible("mc-note"),
    "pass & play shows no computer recap and no rematch note",
  );
  phone.screenshot("mc-win");

  // The rematch: Kai starts, and the game ends with 24 seeds each.
  phone.click("#mc-again");
  await waitFor("rematch", () => mc(phone).moves.length === 0 && !mc(phone).over);
  check(mc(phone).turn === 1, "the player who went second starts the rematch");
  check(phone.text("#mc-tally") === "1–0", "the score shows 1-0");
  tapAll(phone, DRAW.slice(0, 6));
  await landed(phone);
  phone.screenshot("mc-midgame");
  tapAll(phone, DRAW.slice(6));
  await waitFor("the end of the draw", () => mc(phone).over && !mc(phone).busy);
  const drawn = mc(phone);
  check(drawn.draw && drawn.winner === null && drawn.score.join() === "24,24", "24 seeds each is a draw");
  check(
    phone.text("#mc-result-title") === "It's a draw!" && phone.text("#mc-why") === "24 seeds each.",
    "the result says it is a draw, and why",
  );
  check(
    drawn.wins.join() === "1,0" &&
      phone.text("#mc-tally") === "1–0" &&
      phone.text("#mc-pl-0 .mc-sub") !== "Winner" &&
      phone.text("#mc-pl-1 .mc-sub") !== "Winner",
    "a draw counts for nobody",
  );
  phone.screenshot("mc-draw");

  // The next game: Zoe starts. Kai's second pit ends in his store.
  phone.click("#mc-again");
  await waitFor("second rematch", () => mc(phone).moves.length === 0 && !mc(phone).over);
  check(mc(phone).turn === 0, "the first move keeps alternating after a draw");
  await tap(phone, SWEPT[0]!);
  await tap(phone, SWEPT[1]!);
  check(
    mc(phone).again &&
      mc(phone).turn === 1 &&
      phone.text("#mc-status-text") === "Extra turn · Kai goes again",
    "Kai's last seed lands in his store, and he plays again",
  );

  // A reload mid-game keeps the board.
  phone.open(`${origin}/${MANCALA}`);
  await waitFor("home after reload", () => phone.visible("mc-home"));
  check(phone.visible("mc-resume"), "a Mancala game in progress offers to resume");
  phone.click("#mc-resume");
  await waitFor("resumed", () => phone.visible("mc-game"));
  const back = mc(phone);
  check(
    back.moves.join() === SWEPT.slice(0, 2).join() &&
      back.turn === 1 &&
      back.again &&
      back.wins.join() === "1,0",
    "the resumed board has every move, the extra turn and the score",
  );
  check(
    back.holes.join() === "4,4,4,4,4,0,1,5,0,6,5,5,5,1" && countsMatch(phone),
    "the resumed board has every seed in its hole",
  );
  phone.click("#mc-leave");
  await waitFor("mancala home", () => phone.visible("mc-home"));
  phone.click("#mc-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Mancala loads from the service worker and resumes. */
export async function mancalaOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${MANCALA}`);
  await waitFor("mancala offline", () => phone.visible("mc-home"));
  phone.click("#mc-resume");
  await waitFor("resumed offline", () => phone.visible("mc-game"));
  check(mc(phone).moves.length === 2, "offline: Mancala loads from the service worker and resumes");
  phone.screenshot("mc-offline");
}

/**
 * Makes `p`'s link slow: everything it sends leaves `ms` late, so the host's
 * answer to a move lands long after its seeds. Also records its toasts, for
 * `toastsSeen`. Null puts it back.
 */
function slowLink(p: Browser, ms: number | null) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__send ??= WebSocket.prototype.send;
    const send = w.__send;
    const ms = ${JSON.stringify(ms)};
    WebSocket.prototype.send = ms === null ? send : function (data) { setTimeout(() => send.call(this, data), ms); };
    w.__mcToasts = [];
    w.__mcWatch?.disconnect();
    w.__mcWatch = new MutationObserver((records) => {
      for (const r of records) w.__mcToasts.push(r.target.textContent);
    });
    w.__mcWatch.observe(document.getElementById("mc-toast"), { childList: true, characterData: true, subtree: true });
  });`);
}

const toastsSeen = (p: Browser) => p.eval<string[]>("() => window.__mcToasts");

/**
 * Mancala between the two phones, from the menu and back to it: a whole game,
 * a reload mid-game, a rematch that waits for both, an extra turn on a slow
 * link, and a second visit that keeps the score. `a` is Ana (seat 0, amber)
 * and `b` is Kai.
 */
export async function mancalaOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];
  /** Sows `picks[from..to)` of a game `first` started, each tapped on the phone whose turn it is. */
  const playOut = async (first: Seat, picks: number[], from: number, to = picks.length) => {
    for (let i = from; i < to; i++) {
      const seat = replay(first, picks.slice(0, i))!.turn;
      await tap(both[seat]!, picks[i]!, both);
    }
  };

  // Ana picks Mancala, so Ana plays first.
  a.click(`#tiles a[data-id="${MANCALA}"]`);
  await waitFor("both in Mancala", () => {
    const [sa, sb] = [mc(a), mc(b)];
    return sa.me === 0 && sb.me === 1 && sa.rematch !== null && sb.rematch !== null;
  });
  check(b.eval<string>("() => location.pathname") === `/${MANCALA}`, "the friend's phone opens Mancala too");
  check(mc(a).turn === 0 && !mc(a).locked && mc(b).locked, "the player who picked it plays first");
  check(
    a.text("#mc-status-text") === "Your turn" && b.text("#mc-status-text") === "Waiting for Ana",
    "the other phone waits",
  );
  check(open(a) === 6 && open(b) === 0, "only the phone on turn has pits to sow");
  check(
    a.text("#mc-pl-0 .mc-sub") === "Your turn" &&
      b.text("#mc-pl-0 .mc-sub") === "Their turn" &&
      b.text("#mc-pl-1 .mc-sub") === "You",
    "the cards say whose turn, and which colour is yours",
  );
  check(
    mc(a).near === 0 && mc(b).near === 1 && storeBelow(a, 0) && storeBelow(b, 1),
    "each phone has its own store at the bottom",
  );
  a.screenshot("online-mc-your-move");
  b.screenshot("online-mc-waiting");

  // Out of turn, a tap sows nothing on either phone.
  b.click(holeOf(hole(1, 0)));
  b.click(holeOf(hole(0, 0)));
  await sleep(400);
  check(mc(a).moves.length === 0 && mc(b).moves.length === 0, "a tap out of turn sows nothing");

  // The friend's phone shows Ana's move seed by seed, then says it is Kai's turn.
  b.run(`await page.eval(() => {
    const w = window;
    w.__mcFell = false;
    w.__mcFellTimer = setInterval(() => {
      const s = w.__mancala.state();
      if (s.busy && s.moves.length === 1 && s.shown.join() !== s.holes.join()) w.__mcFell = true;
    }, 20);
  });`);
  await tap(a, QUICK[0]!, both);
  check(
    b.eval<boolean>("() => { clearInterval(window.__mcFellTimer); return window.__mcFell; }"),
    "the friend sees the move sown seed by seed",
  );
  check(mc(b).holes.join() === "4,4,4,4,0,5,1,5,5,4,4,4,4,0" && countsMatch(b), "the friend has every seed");
  await waitFor("your-turn toast", () => toastOn(b));
  check(b.text("#mc-toast") === "Your turn", "the friend gets the your-turn alert");
  b.screenshot("online-mc-your-turn");
  await playOut(0, QUICK, 1, 3);
  check(
    both.every((p) => mc(p).score.join() === "8,0" && mc(p).holes[8] === 0),
    "a capture takes the seeds on both phones",
  );
  a.screenshot("online-mc-capture");
  await playOut(0, QUICK, 3, 4);

  // Ana's page reloads on her turn: the same board, still her turn.
  a.open(`${origin}/${MANCALA}`);
  await waitFor(
    "maker back in the game",
    () => mc(a).me === 0 && mc(a).moves.join() === QUICK.slice(0, 4).join(),
  );
  await waitFor("maker on turn after reload", () => !mc(a).locked);
  check(true, "after a reload the maker is on the same board, still on turn");
  for (const p of both) slowLink(p, null);

  // Ana's last seed lands in her store.
  await playOut(0, QUICK, 4, 9);
  check(
    both.every((p) => mc(p).again && mc(p).turn === 0 && mc(p).score[0] === 11) &&
      !mc(a).locked &&
      mc(b).locked,
    "a last seed in the store keeps the turn with the maker",
  );
  check(
    a.text("#mc-status-text") === "Extra turn · go again" &&
      b.text("#mc-status-text") === "Extra turn · Ana goes again",
    "both phones say who plays again",
  );
  a.screenshot("online-mc-go-again");
  b.screenshot("online-mc-extra-theirs");

  await playOut(0, QUICK, 9);
  await waitFor("game over", () => both.every((p) => mc(p).over && mc(p).winner === 0 && !mc(p).busy));
  const played = [...toastsSeen(a), ...toastsSeen(b)];
  check(!played.some((t) => t.includes("hiccup")), "the game plays with no hiccup toast");
  check(
    a.text("#mc-result-title") === "You win!" && b.text("#mc-result-title") === "Ana wins!",
    "the last move ends the game, on both phones",
  );
  check(
    both.every((p) => p.text("#mc-why") === "Most seeds: 28 to 20."),
    "both phones say why",
  );
  check(mc(a).wins.join() === "1,0" && mc(b).wins.join() === "1,0", "both phones keep the score");
  b.screenshot("online-mc-lost");

  // A rematch waits for both players, then the other player goes first.
  b.click("#mc-again");
  await waitFor("rematch asked", () => a.text("#mc-note") === "Kai wants a rematch");
  check(
    b.text("#mc-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("mc-again").disabled`),
    "the asker waits for the friend",
  );
  b.screenshot("online-mc-rematch-waiting");
  a.screenshot("online-mc-rematch-asked");
  a.click("#mc-again");
  await waitFor("rematch", () =>
    both.every((p) => mc(p).moves.length === 0 && mc(p).starter === 1 && !mc(p).over),
  );
  check(
    !mc(b).locked && mc(a).locked && mc(a).wins.join() === "1,0",
    "the rematch swaps who goes first, and keeps the score",
  );

  // On a slow link Ana earns an extra turn and sows her next pit before the
  // host has answered. Both moves stay put, with no "Connection hiccup" toast.
  await playOut(1, SWEPT, 0, 1);
  await waitFor("maker on turn", () => !mc(a).locked);
  slowLink(a, 4000);
  tapAll(a, SWEPT.slice(1, 3));
  check(
    mc(a).moves.length === 3 && mc(b).moves.length === 1,
    "on a slow link both moves count at once on the phone that made them",
  );
  await waitFor("both moves on the friend's phone", () => mc(b).moves.length === 3);
  await sleep(1000);
  await landed(a, b);
  const toasts = toastsSeen(a);
  slowLink(a, null);
  check(
    !toasts.some((t) => t.includes("hiccup")) &&
      both.every(
        (p) =>
          mc(p).moves.join() === SWEPT.slice(0, 3).join() &&
          mc(p).holes.join() === "5,0,6,0,6,6,2,5,5,4,4,4,0,1" &&
          countsMatch(p),
      ),
    `on a slow link both moves stay as they were made (toasts ${JSON.stringify(toasts)})`,
  );
  check(mc(a).locked && !mc(b).locked, "the second move ends on the friend's side, so the turn passes");
  a.screenshot("online-mc-slow-link");

  // Ana leaves the game: both phones go back to the menu.
  a.click("#mc-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));

  // Kai opens Mancala again: a fresh board, his move, and the score from before.
  b.click(`#tiles a[data-id="${MANCALA}"]`);
  await waitFor("both in Mancala again", () =>
    both.every((p) => {
      const s = mc(p);
      return s.me !== null && s.rematch !== null && s.moves.length === 0 && s.starter === 1;
    }),
  );
  check(
    mc(a).wins.join() === "1,0" && mc(b).wins.join() === "1,0" && !mc(b).locked,
    "opening Mancala again keeps the party's score",
  );
  b.click("#mc-leave");
  await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
}
