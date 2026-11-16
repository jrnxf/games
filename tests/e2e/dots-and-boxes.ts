// Dots and Boxes' part of the end-to-end suites, driven by taps on the real
// lines. `pnpm test:menu` plays it solo against the Hard computer (with a
// reload on its turn) and pass & play (a whole game, a line that closes two
// boxes and a reload), and `pnpm test:online` plays it between two phones to
// a result, a rematch, an extra turn on a slow link and a second visit that
// keeps the score.

import { think } from "../../src/games/dots-and-boxes/core/ai.ts";
import { BOXES, across, replay } from "../../src/games/dots-and-boxes/core/board.ts";
import { DOUBLE, GIFT, SWEEP } from "../unit/dots-and-boxes-games.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const BOXES_ID = "dots-and-boxes";

/** What Dots and Boxes' test hook reports. */
interface BoxesState {
  moves: number[];
  starter: 0 | 1;
  turn: 0 | 1;
  again: boolean;
  over: boolean;
  winner: 0 | 1 | null;
  score: [number, number];
  legal: number[];
  thinking: boolean;
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
  me: 0 | 1 | null;
  locked: boolean;
  rematch: [boolean, boolean] | null;
  notes: { at: number; positions: number; ms: number; exact: boolean }[];
}

/** GIFT, then every other line in line order: the second player wins 15 to 10. */
const WHOLE: number[] = [...GIFT, ...SWEEP.filter((line) => !GIFT.includes(line))];

const db = (p: Browser) => p.eval<BoxesState>("() => window.__boxes.state()");
// The 25 boxes come first in the board, then the 60 lines.
const lineOf = (line: number) => `#db-board > :nth-child(${BOXES + line + 1})`;
const open = (p: Browser) =>
  p.eval<number>(`() => document.querySelectorAll("#db-board .db-line.can").length`);
/** The class and the letter of box `i`. */
const boxOf = (p: Browser, i: number) =>
  p.eval<string>(`() => {
    const el = document.querySelectorAll("#db-board .db-box")[${i}];
    return el.className.replace("fresh", "").trim() + ":" + el.textContent;
  }`);
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("db-toast").classList.contains("on")`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Taps `line` on `p`, then waits until every phone has it. */
async function tap(p: Browser, line: number, phones: Browser[] = [p]) {
  const n = db(p).moves.length;
  p.click(lineOf(line));
  await waitFor(`line ${line}`, () =>
    phones.every((x) => {
      const s = db(x);
      return s.moves.length > n && s.moves[n] === line;
    }),
  );
}

/** Draws `picks` with taps made inside the page, one straight after the other: a whole game in seconds. */
function tapAll(p: Browser, picks: number[]) {
  for (let i = 0; i < picks.length; i += 30) {
    p.run(`await page.eval(async () => {
      const api = window.__boxes;
      for (const line of ${JSON.stringify(picks.slice(i, i + 30))}) {
        const n = api.state().moves.length;
        const t0 = Date.now();
        while (api.state().locked && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 10));
        document.querySelectorAll("#db-board .db-line")[line].click();
        while (api.state().moves.length !== n + 1 && Date.now() - t0 < 4000)
          await new Promise((r) => setTimeout(r, 10));
      }
    });`);
  }
}

/** Waits out the computer's turn: the game is Zoe's again, or over. */
async function computerMoved(p: Browser) {
  await waitFor("the computer's move", () => {
    const s = db(p);
    return s.turn === 0 || s.over;
  });
}

/** The board fits a screen of `size`: no sideways scroll, lines a thumb can hit, the dock in view. */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  const m = p.eval<{
    box: number;
    line: number;
    scroll: number;
    width: number;
    bottom: number;
    height: number;
  }>(
    `() => {
    const box = document.querySelector("#db-board .db-box").getBoundingClientRect();
    const line = document.querySelector("#db-board .db-line").getBoundingClientRect();
    return {
      box: Math.min(box.width, box.height),
      line: Math.min(line.width, line.height),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: document.querySelector("#db-game .db-dock").getBoundingClientRect().bottom,
      height: innerHeight,
    };
  }`,
  );
  check(
    m.box >= 44 && m.line >= 44 && m.scroll <= m.width && m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} the board fits: ${m.box.toFixed(1)} px boxes, ${m.line.toFixed(1)} px tap areas, no sideways scroll`,
  );
  p.screenshot(name);
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function boxesSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${BOXES_ID}"] small`) === "Solo · vs computer",
    "Dots and Boxes plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${BOXES_ID}"]`);
  await waitFor("boxes home, solo", () => phone.visible("db-home"));
  check(
    phone.text("#db-name-0") === "Zoe" && phone.text("#db-name-1") === "Computer",
    "solo Dots and Boxes is Zoe against the computer",
  );
  check(
    phone.text("#db-sub-0") === "Orange · goes first" && phone.text("#db-sub-1") === "Blue · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  phone.screenshot("db-home-solo");
  phone.click("#db-start");
  await waitFor("solo board", () => phone.visible("db-game"));
  const start = db(phone);
  check(start.turn === 0 && !start.thinking && start.level === "hard", "Zoe starts against Hard");
  check(open(phone) === 60 && start.legal.length === 60, "all 60 lines are free");
  phone.screenshot("db-solo-start");

  // Tap, then check the thinking state inside the page in one go: the
  // computer waits only 500 ms, too short to span several browser calls.
  const blocked = phone.eval<{ thinking: boolean; still: boolean; open: number; label: string }>(`() => {
    const api = window.__boxes;
    const lines = document.querySelectorAll("#db-board .db-line");
    lines[api.state().legal[0]].click();
    const before = api.state();
    for (const line of before.legal) lines[line].click();
    const after = api.state();
    return {
      thinking: before.thinking && after.thinking,
      still: before.moves.length === 1 && after.moves.length === 1,
      open: document.querySelectorAll("#db-board .db-line.can").length,
      label: document.getElementById("db-status-text").innerText.trim(),
    };
  }`);
  check(blocked.thinking && blocked.still, "taps do nothing while the computer is thinking");
  check(
    blocked.open === 0 && blocked.label === "Computer is thinking",
    "no line is open and the status says “Computer is thinking”",
  );
  await computerMoved(phone);
  const answered = db(phone);
  check(answered.moves.length === 2 && answered.turn === 0, "the computer answers, then it is Zoe's turn");
  check(answered.notes.length === 1 && answered.notes[0]!.at === 1, "the computer keeps a note on its move");
  check(
    phone.text("#db-pl-0 .db-count") === "0" && phone.text("#db-pl-1 .db-count") === "0",
    "each card counts its boxes",
  );
  phone.screenshot("db-solo-turn");
  fits(phone, "360x740x2,mobile,touch", "db-solo-360");
  fits(phone, "820x1180x2,mobile,touch", "db-solo-tablet");
  phone.viewport(VIEWPORT);

  // Zoe's second line, then a reload while the computer is still thinking.
  const pending = phone.eval<BoxesState | null>(`() => {
    const api = window.__boxes;
    document.querySelectorAll("#db-board .db-line")[api.state().legal[0]].click();
    const s = api.state();
    if (!s.thinking) return null;
    setTimeout(() => location.reload(), 0);
    return s;
  }`);
  check(pending, "the reload lands during the computer's turn");
  await waitFor("home after reload", () => phone.visible("db-home"));
  check(phone.visible("db-resume"), "a solo game in progress offers to resume");
  phone.click("#db-resume");
  await waitFor("resumed solo", () => phone.visible("db-game"));
  // The computer may already have drawn by the time this looks.
  const resumed = db(phone);
  check(
    resumed.moves.slice(0, pending.moves.length).join() === pending.moves.join() &&
      (resumed.thinking || resumed.moves.length > pending.moves.length),
    "the resumed game is on the computer's turn",
  );
  await waitFor("the computer's move after the resume", () => db(phone).moves.length > pending.moves.length);
  const expected = think(replay(pending.starter, pending.moves)!, "hard", pending.seed).line;
  check(
    db(phone).moves[pending.moves.length] === expected,
    "after the resume, the computer draws the line its seed picked",
  );
  await computerMoved(phone);

  // Zoe always draws the first free line, and loses. The taps run inside the
  // page, a few seconds at a time.
  let chained = false;
  await waitFor(
    "the end of the solo game",
    () => {
      const s = phone.eval<{ over: boolean; chained: boolean }>(`async () => {
        const api = window.__boxes;
        const lines = document.querySelectorAll("#db-board .db-line");
        const said = () => document.getElementById("db-status-text").innerText.trim();
        let chained = false;
        const t0 = Date.now();
        while (!api.state().over && Date.now() - t0 < 8000) {
          const s = api.state();
          if (s.turn === 1 && s.again && said() === "Box closed · Computer goes again") chained = true;
          if (s.turn === 0) lines[s.legal[0]].click();
          else await new Promise((r) => setTimeout(r, 20));
        }
        return { over: api.state().over, chained };
      }`);
      chained ||= s.chained;
      return s.over;
    },
    120_000,
  );
  check(chained, "a box the computer closes gives it another turn, and the status says so");
  const lost = db(phone);
  check(lost.winner === 1 && lost.wins.join() === "0,1", "Hard beats a player who never looks");
  check(phone.text("#db-result-title") === "Computer wins!", "the result names the computer");
  const why = phone.text("#db-why");
  check(why === `Most boxes: ${lost.score[1]} to ${lost.score[0]}.`, `one line says why (${why})`);
  check(
    phone.text("#db-stats").includes("Positions checked") &&
      phone.text("#db-stats").includes("Lines read to the end"),
    "the recap counts the computer's search",
  );
  check(
    phone.text("#db-tally") === "0–1" && phone.text("#db-pl-1 .db-sub") === "Winner",
    "the score reads Zoe 0, Computer 1",
  );
  check(!phone.visible("db-status") && phone.visible("db-result"), "the result replaces the status line");
  phone.screenshot("db-solo-lost");

  // The rematch: the computer goes first this time and moves on its own.
  phone.click("#db-again");
  await waitFor("solo rematch", () => db(phone).starter === 1);
  await computerMoved(phone);
  check(db(phone).moves.length === 1 && db(phone).turn === 0, "the computer opens the rematch");
  check(!db(phone).notes.some((n) => n.at > 0), "the rematch starts a fresh recap");
  phone.click("#db-leave");
  await waitFor("boxes home", () => phone.visible("db-home"));
  check(phone.visible("db-resume"), "the rematch can be resumed");
  phone.click("#db-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: a whole game, then a game left
 * after a line that closes two boxes. The session is Zoe and Kai.
 */
export async function boxesPassAndPlay(phone: Browser, origin: string) {
  phone.click(`#tiles a[href="/${BOXES_ID}"]`);
  await waitFor("boxes home", () => phone.visible("db-home"));
  check(phone.eval<string>("() => location.pathname") === `/${BOXES_ID}`, "the URL is /dots-and-boxes");
  check(phone.eval<string>("() => document.body.dataset.game") === BOXES_ID, "Dots and Boxes' theme is on");
  check(
    phone.text("#db-name-0") === "Zoe" && phone.text("#db-name-1") === "Kai",
    "Dots and Boxes takes the names from the session",
  );
  check(
    phone.text("#db-sub-0") === "Orange · goes first" && phone.text("#db-sub-1") === "Blue",
    "orange goes first",
  );
  check(!phone.visible("db-resume"), "the solo Dots and Boxes game is saved apart from pass & play");
  phone.screenshot("db-home");
  phone.click("#db-start");
  await waitFor("board", () => phone.visible("db-game"));
  check(
    db(phone).turn === 0 && open(phone) === 60 && phone.text("#db-status-text") === "Zoe's turn",
    "Zoe starts, with every line free",
  );

  await tap(phone, SWEEP[0]!);
  check(
    phone.eval<boolean>(
      `() => document.querySelector(${JSON.stringify(lineOf(SWEEP[0]!))}).classList.contains("s0")`,
    ),
    "a tap between two dots draws the line in Zoe's colour",
  );
  check(
    phone.text("#db-status-text") === "Kai's turn" && phone.text("#db-pl-1 .db-sub") === "Your turn",
    "the turn passes to Kai",
  );
  // A line already drawn takes no second tap.
  phone.click(lineOf(SWEEP[0]!));
  check(db(phone).moves.length === 1 && db(phone).turn === 1, "a tap on a drawn line does nothing");

  // The other 29 lines across close nothing. Then Zoe draws the first line
  // down, and Kai's next one closes the top-left box.
  tapAll(phone, SWEEP.slice(1, 30));
  await tap(phone, SWEEP[30]!);
  await tap(phone, SWEEP[31]!);
  const closed = db(phone);
  check(closed.score.join() === "0,1" && closed.again && closed.turn === 1, "the fourth side closes the box");
  check(
    boxOf(phone, 0) === "db-box s1:K" && phone.text("#db-pl-1 .db-count") === "1",
    "the box takes Kai's colour and initial, and his count goes up",
  );
  check(phone.text("#db-status-text") === "Box closed · Kai goes again", "Kai plays again");
  phone.screenshot("db-box");
  tapAll(phone, SWEEP.slice(32, 45));
  phone.screenshot("db-midgame");
  tapAll(phone, SWEEP.slice(45));
  await waitFor("every line drawn", () => db(phone).over);
  const won = db(phone);
  check(won.winner === 1 && won.score.join() === "10,15" && won.wins.join() === "0,1", "Kai wins 15 to 10");
  check(phone.text("#db-result-title") === "Kai wins!", "the result names the winner");
  check(phone.text("#db-why") === "Most boxes: 15 to 10.", "one line says why");
  check(
    phone.text("#db-stats") === "" && !phone.visible("db-note"),
    "pass & play shows no computer recap and no rematch note",
  );
  phone.screenshot("db-win");

  // The rematch: Kai starts. Zoe's fourth line closes two boxes at once.
  phone.click("#db-again");
  await waitFor("rematch", () => db(phone).moves.length === 0 && !db(phone).over);
  check(db(phone).turn === 1, "the player who went second starts the rematch");
  check(phone.text("#db-tally") === "0–1", "the score shows 0-1");
  for (const line of DOUBLE) await tap(phone, line);
  const two = db(phone);
  check(two.score.join() === "2,0" && two.again && two.turn === 0, "one line closes two boxes");
  check(
    boxOf(phone, 0) === "db-box s0:Z" && boxOf(phone, 1) === "db-box s0:Z",
    "both boxes take Zoe's colour and initial",
  );
  check(phone.text("#db-status-text") === "Box closed · Zoe goes again", "Zoe plays again");
  phone.screenshot("db-double");

  // A reload mid-game keeps the board.
  phone.open(`${origin}/${BOXES_ID}`);
  await waitFor("home after reload", () => phone.visible("db-home"));
  check(phone.visible("db-resume"), "a Dots and Boxes game in progress offers to resume");
  phone.click("#db-resume");
  await waitFor("resumed", () => phone.visible("db-game"));
  const back = db(phone);
  check(
    back.moves.join() === DOUBLE.join() && back.turn === 0 && back.again && back.wins.join() === "0,1",
    "the resumed board has every line, the extra turn and the score",
  );
  check(boxOf(phone, 0) === "db-box s0:Z", "the resumed board keeps the closed boxes");
  phone.click("#db-leave");
  await waitFor("boxes home", () => phone.visible("db-home"));
  phone.click("#db-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Dots and Boxes loads from the service worker and resumes. */
export async function boxesOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${BOXES_ID}`);
  await waitFor("boxes offline", () => phone.visible("db-home"));
  phone.click("#db-resume");
  await waitFor("resumed offline", () => phone.visible("db-game"));
  check(
    db(phone).moves.length === DOUBLE.length,
    "offline: Dots and Boxes loads from the service worker and resumes",
  );
  phone.screenshot("db-offline");
}

/**
 * Makes `p`'s link slow: everything it sends leaves `ms` late, so the host's
 * answer to a line lands long after it is drawn. Also records its toasts, for
 * `toastsSeen`. Null puts it back.
 */
function slowLink(p: Browser, ms: number | null) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__send ??= WebSocket.prototype.send;
    const send = w.__send;
    const ms = ${JSON.stringify(ms)};
    WebSocket.prototype.send = ms === null ? send : function (data) { setTimeout(() => send.call(this, data), ms); };
    w.__dbToasts = [];
    w.__dbWatch?.disconnect();
    w.__dbWatch = new MutationObserver((records) => {
      for (const r of records) w.__dbToasts.push(r.target.textContent);
    });
    w.__dbWatch.observe(document.getElementById("db-toast"), { childList: true, characterData: true, subtree: true });
  });`);
}

const toastsSeen = (p: Browser) => p.eval<string[]>("() => window.__dbToasts");

/**
 * Dots and Boxes between the two phones, from the menu and back to it: a
 * whole game, a reload mid-game, a rematch that waits for both, an extra turn
 * on a slow link, and a second visit that keeps the score. `a` is Ana (seat
 * 0, orange) and `b` is Kai.
 */
export async function boxesOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];
  /** Draws `picks` from an empty board, each tapped on the phone whose turn it is. */
  const playOut = async (first: 0 | 1, picks: number[], from = 0) => {
    for (let i = from; i < picks.length; i++) {
      const seat = replay(first, picks.slice(0, i))!.turn;
      await waitFor("on turn", () => !db(both[seat]!).locked);
      await tap(both[seat]!, picks[i]!, both);
    }
  };
  /** The same, fast: each run of lines by one player is tapped inside that player's page. */
  const rushOut = async (first: 0 | 1, picks: number[], from: number) => {
    for (let i = from; i < picks.length;) {
      const seat = replay(first, picks.slice(0, i))!.turn;
      let end = i + 1;
      while (end < picks.length && replay(first, picks.slice(0, end))!.turn === seat) end++;
      tapAll(both[seat]!, picks.slice(i, end));
      await waitFor(`${end} lines on both phones`, () => both.every((p) => db(p).moves.length === end));
      i = end;
    }
  };

  // Ana picks Dots and Boxes, so Ana plays first.
  a.click(`#tiles a[data-id="${BOXES_ID}"]`);
  await waitFor("both in Dots and Boxes", () => {
    const [sa, sb] = [db(a), db(b)];
    return sa.me === 0 && sb.me === 1 && sa.rematch !== null && sb.rematch !== null;
  });
  check(
    b.eval<string>("() => location.pathname") === `/${BOXES_ID}`,
    "the friend's phone opens Dots and Boxes too",
  );
  check(db(a).turn === 0 && !db(a).locked && db(b).locked, "the player who picked it plays first");
  check(
    a.text("#db-status-text") === "Your turn" && b.text("#db-status-text") === "Waiting for Ana",
    "the other phone waits",
  );
  check(open(a) === 60 && open(b) === 0, "only the phone on turn has lines to draw");
  check(
    a.text("#db-pl-0 .db-sub") === "Your turn" &&
      b.text("#db-pl-0 .db-sub") === "Their turn" &&
      b.text("#db-pl-1 .db-sub") === "You",
    "the cards say whose turn, and which colour is yours",
  );
  a.screenshot("online-db-your-move");
  b.screenshot("online-db-waiting");

  // Out of turn, a tap draws nothing on either phone.
  b.click(lineOf(WHOLE[0]!));
  await sleep(400);
  check(db(a).moves.length === 0 && db(b).moves.length === 0, "a tap out of turn draws nothing");

  await tap(a, WHOLE[0]!, both);
  check(
    b.eval<boolean>(
      `() => document.querySelector(${JSON.stringify(lineOf(WHOLE[0]!))}).classList.contains("s0")`,
    ),
    "the friend sees the line, in the maker's colour",
  );
  await waitFor("your-turn toast", () => toastOn(b));
  check(b.text("#db-toast") === "Your turn", "the friend gets the your-turn alert");
  b.screenshot("online-db-your-turn");
  await playOut(0, WHOLE.slice(0, 4), 1);

  // Ana's page reloads on her turn: the same board, still her turn.
  a.open(`${origin}/${BOXES_ID}`);
  await waitFor(
    "maker back in the game",
    () => db(a).me === 0 && db(a).moves.join() === WHOLE.slice(0, 4).join(),
  );
  await waitFor("maker on turn after reload", () => !db(a).locked);
  check(true, "after a reload the maker is on the same board, still on turn");

  // Ana draws the third side of the corner box, and Kai closes it.
  await playOut(0, GIFT, 4);
  check(
    both.every((p) => db(p).score.join() === "0,1" && db(p).again && db(p).turn === 1) &&
      !db(b).locked &&
      db(a).locked,
    "a closed box keeps the turn with the friend",
  );
  check(
    both.every((p) => boxOf(p, 0) === "db-box s1:K"),
    "both phones colour the box",
  );
  check(
    a.text("#db-status-text") === "Box closed · Kai goes again" &&
      b.text("#db-status-text") === "Box closed · go again",
    "both phones say who plays again",
  );
  a.screenshot("online-db-box-theirs");
  b.screenshot("online-db-box-go-again");

  // The rest of the game, with each run of boxes closed as fast as a page can tap.
  for (const p of both) slowLink(p, null);
  await rushOut(0, WHOLE, GIFT.length);
  await waitFor("game over", () => both.every((p) => db(p).over && db(p).winner === 1));
  const rushed = [...toastsSeen(a), ...toastsSeen(b)];
  check(
    !rushed.some((t) => t.includes("hiccup")),
    "lines drawn faster than the host answers all stay, with no hiccup toast",
  );
  check(
    a.text("#db-result-title") === "Kai wins!" && b.text("#db-result-title") === "You win!",
    "the last line ends the game, on both phones",
  );
  check(
    both.every((p) => p.text("#db-why") === "Most boxes: 15 to 10."),
    "both phones say why",
  );
  check(db(a).wins.join() === "0,1" && db(b).wins.join() === "0,1", "both phones keep the score");
  a.screenshot("online-db-lost");

  // A rematch waits for both players, then the other player goes first.
  b.click("#db-again");
  await waitFor("rematch asked", () => a.text("#db-note") === "Kai wants a rematch");
  check(
    b.text("#db-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("db-again").disabled`),
    "the asker waits for the friend",
  );
  b.screenshot("online-db-rematch-waiting");
  a.screenshot("online-db-rematch-asked");
  a.click("#db-again");
  await waitFor("rematch", () =>
    both.every((p) => db(p).moves.length === 0 && db(p).starter === 1 && !db(p).over),
  );
  check(
    !db(b).locked && db(a).locked && db(a).wins.join() === "0,1",
    "the rematch swaps who goes first, and keeps the score",
  );

  // On a slow link Ana closes two boxes and draws her next line before the
  // host has answered. Both lines stay put, with no "Connection hiccup" toast.
  await playOut(1, DOUBLE.slice(0, 7));
  await waitFor("maker on turn", () => !db(a).locked);
  const extra = across(5, 0);
  slowLink(a, 1500);
  tapAll(a, [DOUBLE[7]!, extra]);
  check(
    db(a).moves.length === 9 && db(b).moves.length === 7,
    "on a slow link both lines are drawn at once on the phone that drew them",
  );
  await waitFor("both lines on the friend's phone", () => db(b).moves.length === 9);
  await sleep(1000);
  const toasts = toastsSeen(a);
  slowLink(a, null);
  check(
    !toasts.some((t) => t.includes("hiccup")) &&
      both.every((p) => db(p).moves.join() === [...DOUBLE, extra].join() && db(p).score.join() === "2,0"),
    `on a slow link both lines stay where they were drawn (toasts ${JSON.stringify(toasts)})`,
  );
  check(db(a).locked && !db(b).locked, "the second line closes nothing, so the turn passes to the friend");
  a.screenshot("online-db-double");

  // Ana leaves the game: both phones go back to the menu.
  a.click("#db-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));

  // Kai opens Dots and Boxes again: a fresh board, his move, and the score from before.
  b.click(`#tiles a[data-id="${BOXES_ID}"]`);
  await waitFor("both in Dots and Boxes again", () =>
    both.every((p) => {
      const s = db(p);
      return s.me !== null && s.rematch !== null && s.moves.length === 0 && s.starter === 1;
    }),
  );
  check(
    db(a).wins.join() === "0,1" && db(b).wins.join() === "0,1" && !db(b).locked,
    "opening Dots and Boxes again keeps the party's score",
  );
  b.click("#db-leave");
  await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
}
