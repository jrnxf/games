// Reversi's part of the end-to-end suites, driven by taps on the real cells.
// `pnpm test:menu` plays it solo against the Hard computer (with a reload on
// its turn) and pass & play (a wipeout, a draw, a pass and a reload), and
// `pnpm test:online` plays it between two phones to a result, a rematch, a
// pass and a second visit that keeps the score.

import { think } from "../../src/games/reversi/core/ai.ts";
import { replay } from "../../src/games/reversi/core/board.ts";
import { DRAW, PASS, WIPEOUT } from "../unit/reversi-games.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const REVERSI = "reversi";

/** What Reversi's test hook reports. */
interface ReversiState {
  moves: number[];
  starter: 0 | 1;
  turn: 0 | 1;
  passed: boolean;
  over: boolean;
  winner: 0 | 1 | null;
  draw: boolean;
  discs: [number, number];
  legal: number[];
  busy: boolean;
  thinking: boolean;
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
  me: 0 | 1 | null;
  locked: boolean;
  rematch: [boolean, boolean] | null;
  notes: { at: number; positions: number; ms: number; depth: number }[];
}

const rv = (p: Browser) => p.eval<ReversiState>("() => window.__reversi.state()");
const cellOf = (cell: number) => `#rv-board .rv-cell:nth-child(${cell + 1})`;
const dots = (p: Browser) => p.eval<number>(`() => document.querySelectorAll("#rv-board .rv-dot").length`);
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("rv-toast").classList.contains("on")`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Taps `cell` on `p`, then waits until the disc has landed and its discs have turned on every phone. */
async function tap(p: Browser, cell: number, phones: Browser[] = [p]) {
  const n = rv(p).moves.length;
  p.click(cellOf(cell));
  await waitFor(`disc on cell ${cell}`, () =>
    phones.every((x) => {
      const s = rv(x);
      return s.moves.length === n + 1 && s.moves[n] === cell && !s.busy;
    }),
  );
}

/** Plays `cells` with taps made inside the page, a few at a time: a whole game in seconds. */
function tapAll(p: Browser, cells: number[]) {
  for (let i = 0; i < cells.length; i += 12) {
    p.run(`await page.eval(async () => {
      const api = window.__reversi;
      for (const cell of ${JSON.stringify(cells.slice(i, i + 12))}) {
        const n = api.state().moves.length;
        document.querySelectorAll("#rv-board .rv-cell")[cell].click();
        const t0 = Date.now();
        while ((api.state().moves.length !== n + 1 || api.state().busy) && Date.now() - t0 < 4000)
          await new Promise((r) => setTimeout(r, 10));
      }
    });`);
  }
}

/** Waits out the computer's turn: its discs have turned and the game is Zoe's again, or over. */
async function computerMoved(p: Browser) {
  await waitFor("the computer's move", () => {
    const s = rv(p);
    return !s.busy && (s.turn === 0 || s.over);
  });
}

/** The board fits a screen of `size`: no sideways scroll, cells a thumb can hit, the dock in view. */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  const m = p.eval<{ cell: number; scroll: number; width: number; bottom: number; height: number }>(`() => {
    const cell = document.querySelector("#rv-board .rv-cell").getBoundingClientRect();
    return {
      cell: Math.min(cell.width, cell.height),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: document.querySelector("#rv-game .rv-dock").getBoundingClientRect().bottom,
      height: innerHeight,
    };
  }`);
  check(
    m.cell >= 44 && m.scroll <= m.width && m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} the board fits: ${m.cell.toFixed(1)} px cells, no sideways scroll`,
  );
  p.screenshot(name);
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function reversiSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${REVERSI}"] small`) === "Solo · vs computer",
    "Reversi plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${REVERSI}"]`);
  await waitFor("reversi home, solo", () => phone.visible("rv-home"));
  check(
    phone.text("#rv-name-0") === "Zoe" && phone.text("#rv-name-1") === "Computer",
    "solo Reversi is Zoe against the computer",
  );
  check(
    phone.text("#rv-sub-0") === "Dark · goes first" && phone.text("#rv-sub-1") === "Light · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  phone.screenshot("rv-home-solo");
  phone.click("#rv-start");
  await waitFor("solo board", () => phone.visible("rv-game"));
  const start = rv(phone);
  check(start.turn === 0 && !start.thinking && start.level === "hard", "Zoe starts against Hard");
  check(dots(phone) === 4 && start.legal.length === 4, "faint dots mark the four opening moves");
  phone.screenshot("rv-solo-start");

  // Tap, then check the thinking state inside the page in one go: the
  // computer waits only 500 ms, too short to span several browser calls.
  const blocked = phone.eval<{
    thinking: boolean;
    still: boolean;
    dots: number;
    label: string;
  }>(`async () => {
    const api = window.__reversi;
    const cells = document.querySelectorAll("#rv-board .rv-cell");
    cells[api.state().legal[0]].click();
    const t0 = Date.now();
    while (api.state().busy && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 5));
    const before = api.state();
    for (const cell of before.legal) cells[cell].click();
    const after = api.state();
    return {
      thinking: before.thinking && after.thinking,
      still: !after.busy && after.moves.length === before.moves.length,
      dots: document.querySelectorAll("#rv-board .rv-dot").length,
      label: document.getElementById("rv-status-text").innerText.trim(),
    };
  }`);
  check(blocked.thinking && blocked.still, "taps do nothing while the computer is thinking");
  check(
    blocked.dots === 0 && blocked.label === "Computer is thinking",
    "the dots go and the status says “Computer is thinking”",
  );
  await computerMoved(phone);
  const answered = rv(phone);
  check(answered.moves.length === 2 && answered.turn === 0, "the computer answers, then it is Zoe's turn");
  check(
    answered.notes.length === 1 && answered.notes[0]!.positions > 0 && answered.notes[0]!.at === 1,
    "the computer keeps the numbers behind its move",
  );
  check(
    phone.text("#rv-pl-0 .rv-count") === String(answered.discs[0]) &&
      phone.text("#rv-pl-1 .rv-count") === String(answered.discs[1]) &&
      answered.discs[0] + answered.discs[1] === 6,
    "each card counts its discs",
  );
  phone.screenshot("rv-solo-turn");
  fits(phone, "360x740x2,mobile,touch", "rv-solo-360");
  fits(phone, "820x1180x2,mobile,touch", "rv-solo-tablet");
  phone.viewport(VIEWPORT);

  // Zoe's second disc, then a reload while the computer is still thinking.
  const pending = phone.eval<ReversiState | null>(`async () => {
    const api = window.__reversi;
    document.querySelectorAll("#rv-board .rv-cell")[api.state().legal[0]].click();
    const t0 = Date.now();
    while (api.state().busy && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 5));
    const s = api.state();
    if (!s.thinking) return null;
    setTimeout(() => location.reload(), 0);
    return s;
  }`);
  check(pending, "the reload lands during the computer's turn");
  await waitFor("home after reload", () => phone.visible("rv-home"));
  check(phone.visible("rv-resume"), "a solo game in progress offers to resume");
  phone.click("#rv-resume");
  await waitFor("resumed solo", () => phone.visible("rv-game"));
  // The computer may already be turning discs by the time this looks.
  const resumed = rv(phone);
  check(
    resumed.moves.slice(0, pending.moves.length).join() === pending.moves.join() &&
      (resumed.thinking || resumed.busy || resumed.moves.length > pending.moves.length),
    "the resumed game is on the computer's turn",
  );
  await waitFor("the computer's move after the resume", () => {
    const s = rv(phone);
    return s.moves.length > pending.moves.length && !s.busy;
  });
  const expected = think(replay(pending.starter, pending.moves)!, "hard", pending.seed).cell;
  check(
    rv(phone).moves[pending.moves.length] === expected,
    "after the resume, the computer plays the cell its seed picked",
  );
  await computerMoved(phone);

  // Zoe always takes the first cell she may, and loses.
  for (let s = rv(phone); !s.over; s = rv(phone)) {
    await tap(phone, s.legal[0]!);
    await computerMoved(phone);
  }
  const lost = rv(phone);
  check(lost.winner === 1 && lost.wins.join() === "0,1", "Hard beats a player who never looks");
  check(phone.text("#rv-result-title") === "Computer wins!", "the result names the computer");
  const why = phone.text("#rv-why");
  const [hi, lo] = [Math.max(...lost.discs), Math.min(...lost.discs)];
  check(
    why === `${hi + lo < 64 ? "Nobody can move: " : "Most discs: "}${hi} to ${lo}.`,
    `one line says why (${why})`,
  );
  check(
    phone.text("#rv-stats").includes("Positions checked") && phone.text("#rv-stats").includes("Deepest look"),
    "the recap counts the computer's search",
  );
  check(
    phone.text("#rv-tally") === "0–1" && phone.text("#rv-pl-1 .rv-sub") === "Winner",
    "the score reads Zoe 0, Computer 1",
  );
  check(!phone.visible("rv-status") && phone.visible("rv-result"), "the result replaces the status line");
  phone.screenshot("rv-solo-lost");

  // The rematch: the computer goes first this time and moves on its own.
  phone.click("#rv-again");
  await waitFor("solo rematch", () => rv(phone).starter === 1);
  await computerMoved(phone);
  check(rv(phone).moves.length === 1 && rv(phone).turn === 0, "the computer opens the rematch");
  check(!rv(phone).notes.some((n) => n.at > 0), "the rematch starts a fresh recap");
  phone.click("#rv-leave");
  await waitFor("reversi home", () => phone.visible("rv-home"));
  check(phone.visible("rv-resume"), "the rematch can be resumed");
  phone.click("#rv-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: a wipeout, a drawn full board,
 * then a game left on a pass, eight discs in. The session is Zoe and Kai.
 */
export async function reversiPassAndPlay(phone: Browser, origin: string) {
  phone.click(`#tiles a[href="/${REVERSI}"]`);
  await waitFor("reversi home", () => phone.visible("rv-home"));
  check(phone.eval<string>("() => location.pathname") === `/${REVERSI}`, "the URL is /reversi");
  check(phone.eval<string>("() => document.body.dataset.game") === REVERSI, "Reversi's theme is on");
  check(
    phone.text("#rv-name-0") === "Zoe" && phone.text("#rv-name-1") === "Kai",
    "Reversi takes the names from the session",
  );
  check(
    phone.text("#rv-sub-0") === "Dark · goes first" && phone.text("#rv-sub-1") === "Light",
    "dark goes first",
  );
  check(!phone.visible("rv-resume"), "the solo Reversi game is saved apart from pass & play");
  phone.screenshot("rv-home");
  phone.click("#rv-start");
  await waitFor("board", () => phone.visible("rv-game"));
  check(
    rv(phone).turn === 0 && dots(phone) === 4 && phone.text("#rv-status-text") === "Zoe's turn",
    "Zoe starts, with four cells to pick from",
  );

  // A cell that outflanks nothing takes no disc.
  phone.click(cellOf(0));
  check(
    rv(phone).moves.length === 0 && !rv(phone).busy,
    "a tap on a cell that outflanks nothing does nothing",
  );
  await tap(phone, WIPEOUT[0]!);
  check(
    rv(phone).discs.join() === "4,1" && phone.text("#rv-pl-0 .rv-count") === "4",
    "the outflanked disc turns over, and the counts follow",
  );
  check(
    phone.text("#rv-status-text") === "Kai's turn" && phone.text("#rv-pl-1 .rv-sub") === "Your turn",
    "the turn passes to Kai",
  );
  for (const cell of WIPEOUT.slice(1, 5)) await tap(phone, cell);
  phone.screenshot("rv-midgame");
  for (const cell of WIPEOUT.slice(5)) await tap(phone, cell);
  const won = rv(phone);
  check(won.over && won.winner === 0 && won.wins.join() === "1,0", "Zoe takes every disc and wins");
  check(phone.text("#rv-result-title") === "Zoe wins!", "the result names the winner");
  check(phone.text("#rv-why") === "Nobody can move: 13 to 0.", "one line says why the game ended early");
  check(
    phone.text("#rv-stats") === "" && !phone.visible("rv-note"),
    "pass & play shows no computer recap and no rematch note",
  );
  phone.screenshot("rv-win");

  // The rematch: Kai starts, and the same game with the seats swapped ends 32 each.
  phone.click("#rv-again");
  await waitFor("rematch", () => rv(phone).moves.length === 0 && !rv(phone).over);
  check(rv(phone).turn === 1, "the player who went second starts the rematch");
  check(phone.text("#rv-tally") === "1–0", "the score shows 1-0");
  tapAll(phone, DRAW);
  await waitFor("full board", () => rv(phone).over && !rv(phone).busy);
  const drawn = rv(phone);
  check(drawn.draw && drawn.winner === null && drawn.discs.join() === "32,32", "a full board, 32 discs each");
  check(
    phone.text("#rv-result-title") === "It's a draw" && phone.text("#rv-why") === "32 discs each.",
    "the result calls the draw",
  );
  check(drawn.wins.join() === "1,0", "a draw scores for nobody");
  phone.screenshot("rv-draw");

  // A third game, to a pass: Kai's fourth disc leaves Zoe with no move.
  phone.click("#rv-again");
  await waitFor("third game", () => rv(phone).moves.length === 0 && rv(phone).starter === 0);
  for (const cell of PASS) await tap(phone, cell);
  const passed = rv(phone);
  check(passed.passed && passed.turn === 1 && !passed.over, "with no move for Zoe, Kai plays again");
  check(
    phone.text("#rv-status-text") === "Zoe can't move · Kai goes again" &&
      toastOn(phone) &&
      phone.text("#rv-toast") === "Zoe can't move · Kai goes again",
    "the pass is announced",
  );
  phone.screenshot("rv-pass");

  // A reload mid-game keeps the board.
  phone.open(`${origin}/${REVERSI}`);
  await waitFor("home after reload", () => phone.visible("rv-home"));
  check(phone.visible("rv-resume"), "a Reversi game in progress offers to resume");
  phone.click("#rv-resume");
  await waitFor("resumed", () => phone.visible("rv-game"));
  check(
    rv(phone).moves.join() === PASS.join() && rv(phone).turn === 1 && rv(phone).wins.join() === "1,0",
    "the resumed board has every disc, the turn and the score",
  );
  phone.click("#rv-leave");
  await waitFor("reversi home", () => phone.visible("rv-home"));
  phone.click("#rv-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Reversi loads from the service worker and resumes. */
export async function reversiOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${REVERSI}`);
  await waitFor("reversi offline", () => phone.visible("rv-home"));
  phone.click("#rv-resume");
  await waitFor("resumed offline", () => phone.visible("rv-game"));
  check(rv(phone).moves.length === PASS.length, "offline: Reversi loads from the service worker and resumes");
  phone.screenshot("rv-offline");
}

/**
 * Makes `p`'s link slow: everything it sends leaves `ms` late, so the host's
 * answer to a move lands after the discs have turned. Also records its
 * toasts, for `toastsSeen`. Null puts it back.
 */
function slowLink(p: Browser, ms: number | null) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__send ??= WebSocket.prototype.send;
    const send = w.__send;
    const ms = ${JSON.stringify(ms)};
    WebSocket.prototype.send = ms === null ? send : function (data) { setTimeout(() => send.call(this, data), ms); };
    w.__rvToasts = [];
    w.__rvWatch?.disconnect();
    w.__rvWatch = new MutationObserver((records) => {
      for (const r of records) w.__rvToasts.push(r.target.textContent);
    });
    w.__rvWatch.observe(document.getElementById("rv-toast"), { childList: true, characterData: true, subtree: true });
  });`);
}

const toastsSeen = (p: Browser) => p.eval<string[]>("() => window.__rvToasts");

/**
 * Reversi between the two phones, from the menu and back to it: a game to a
 * win, a reload mid-game, a rematch that waits for both, a slow link, a pass,
 * and a second visit that keeps the score. `a` is Ana (seat 0, dark) and `b`
 * is Kai.
 */
export async function reversiOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];
  /** Plays `cells` from the opening, each tapped on the phone whose turn it is. */
  const playOut = async (first: 0 | 1, cells: number[], from = 0) => {
    for (let i = from; i < cells.length; i++) {
      const seat = replay(first, cells.slice(0, i))!.turn;
      await waitFor("on turn", () => !rv(both[seat]!).locked);
      await tap(both[seat]!, cells[i]!, both);
    }
  };

  // Ana picks Reversi, so Ana plays first.
  a.click(`#tiles a[data-id="${REVERSI}"]`);
  await waitFor("both in Reversi", () => {
    const [sa, sb] = [rv(a), rv(b)];
    return sa.me === 0 && sb.me === 1 && sa.rematch !== null && sb.rematch !== null;
  });
  check(b.eval<string>("() => location.pathname") === `/${REVERSI}`, "the friend's phone opens Reversi too");
  check(rv(a).turn === 0 && !rv(a).locked && rv(b).locked, "the player who picked it plays first");
  check(
    a.text("#rv-status-text") === "Your turn" && b.text("#rv-status-text") === "Waiting for Ana",
    "the other phone waits",
  );
  check(dots(a) === 4 && dots(b) === 0, "only the phone on turn shows where a disc may go");
  check(
    a.text("#rv-pl-0 .rv-sub") === "Your turn" &&
      b.text("#rv-pl-0 .rv-sub") === "Their turn" &&
      b.text("#rv-pl-1 .rv-sub") === "You",
    "the cards say whose turn, and which colour is yours",
  );
  a.screenshot("online-rv-your-move");
  b.screenshot("online-rv-waiting");

  // Out of turn, a tap plays nothing on either phone.
  b.click(cellOf(WIPEOUT[0]!));
  await sleep(400);
  check(rv(a).moves.length === 0 && rv(b).moves.length === 0, "a tap out of turn plays nothing");

  await tap(a, WIPEOUT[0]!, both);
  check(rv(b).discs.join() === "4,1", "the friend sees the disc land and the outflanked disc turn");
  await waitFor("your-turn toast", () => toastOn(b));
  check(b.text("#rv-toast") === "Your turn", "the friend gets the your-turn alert");
  b.screenshot("online-rv-your-turn");
  await playOut(0, WIPEOUT.slice(0, 4), 1);

  // Ana's page reloads on her turn: the same board, still her turn.
  a.open(`${origin}/${REVERSI}`);
  await waitFor(
    "maker back in the game",
    () => rv(a).me === 0 && rv(a).moves.join() === WIPEOUT.slice(0, 4).join(),
  );
  await waitFor("maker on turn after reload", () => !rv(a).locked);
  check(true, "after a reload the maker is on the same board, still on turn");
  await playOut(0, WIPEOUT, 4);
  await waitFor("game over", () => both.every((p) => rv(p).over && rv(p).winner === 0 && !rv(p).busy));
  check(
    a.text("#rv-result-title") === "You win!" && b.text("#rv-result-title") === "Ana wins!",
    "the last disc wins, on both phones",
  );
  check(
    both.every((p) => p.text("#rv-why") === "Nobody can move: 13 to 0."),
    "both phones say why the game ended",
  );
  check(rv(a).wins.join() === "1,0" && rv(b).wins.join() === "1,0", "both phones keep the score");

  // A rematch waits for both players, then the other player goes first.
  b.click("#rv-again");
  await waitFor("rematch asked", () => a.text("#rv-note") === "Kai wants a rematch");
  check(
    b.text("#rv-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("rv-again").disabled`),
    "the asker waits for the friend",
  );
  b.screenshot("online-rv-rematch-waiting");
  a.screenshot("online-rv-rematch-asked");
  a.click("#rv-again");
  await waitFor("rematch", () =>
    both.every((p) => rv(p).moves.length === 0 && rv(p).starter === 1 && !rv(p).over && !rv(p).busy),
  );
  check(
    !rv(b).locked && rv(a).locked && rv(a).wins.join() === "1,0",
    "the rematch swaps who goes first, and keeps the score",
  );

  // On a slow link the host answers after the discs have turned. The disc
  // stays put, with no "Connection hiccup" toast.
  slowLink(b, 1500);
  await tap(b, PASS[0]!, both);
  await sleep(2500);
  const toasts = toastsSeen(b);
  slowLink(b, null);
  check(
    !toasts.some((t) => t.includes("hiccup")) && rv(b).moves.join() === String(PASS[0]),
    `on a slow link the disc stays where it landed (toasts ${JSON.stringify(toasts)})`,
  );

  // Ana's fourth disc leaves Kai with no move: Ana plays again.
  await playOut(1, PASS, 1);
  check(
    both.every((p) => rv(p).passed && rv(p).turn === 0) && !rv(a).locked && rv(b).locked,
    "with no move for the friend, the maker plays again",
  );
  check(
    a.text("#rv-status-text") === "Kai can't move · go again" &&
      b.text("#rv-status-text") === "You can't move · Ana goes again",
    "both phones announce the pass",
  );
  a.screenshot("online-rv-pass-go-again");
  b.screenshot("online-rv-pass-stuck");

  // Ana leaves the game: both phones go back to the menu.
  a.click("#rv-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));

  // Kai opens Reversi again: a fresh board, his move, and the score from before.
  b.click(`#tiles a[data-id="${REVERSI}"]`);
  await waitFor("both in Reversi again", () =>
    both.every((p) => {
      const s = rv(p);
      return s.me !== null && s.rematch !== null && s.moves.length === 0 && s.starter === 1;
    }),
  );
  check(
    rv(a).wins.join() === "1,0" && rv(b).wins.join() === "1,0" && !rv(b).locked,
    "opening Reversi again keeps the party's score",
  );
  b.click("#rv-leave");
  await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
}
