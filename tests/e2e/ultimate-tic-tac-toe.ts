// Ultimate Tic-Tac-Toe's part of the end-to-end suites, driven by taps on
// the real spots. `pnpm test:menu` plays it solo against the Hard computer
// (with a reload on its turn) and pass & play (a win, a draw, a free choice
// of board and a reload), and `pnpm test:online` plays it between two phones
// to a result, a rematch, a free choice of board and a second visit that
// keeps the score.

import { think } from "../../src/games/ultimate-tic-tac-toe/core/ai.ts";
import { replay } from "../../src/games/ultimate-tic-tac-toe/core/board.ts";
import { DRAW, SENT_TO_FULL, SENT_TO_WON, WIN } from "../unit/ultimate-tic-tac-toe-games.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const ULTIMATE = "ultimate-tic-tac-toe";

/** What Ultimate Tic-Tac-Toe's test hook reports. */
interface UltimateState {
  moves: number[];
  starter: 0 | 1;
  turn: 0 | 1;
  target: number | null;
  open: number[];
  legal: number[];
  won: (0 | 1 | null)[];
  line: number[];
  over: boolean;
  winner: 0 | 1 | null;
  draw: boolean;
  boards: [number, number];
  aim: number | null;
  thinking: boolean;
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
  me: 0 | 1 | null;
  locked: boolean;
  rematch: [boolean, boolean] | null;
  foeAim: number | null;
  pending: number | null;
  notes: { at: number; playouts: number; ms: number }[];
}

const ut = (p: Browser) => p.eval<UltimateState>("() => window.__ultimate.state()");
const cellOf = (cell: number) =>
  `#ut-board .ut-small:nth-child(${Math.floor(cell / 9) + 1}) .ut-cell:nth-child(${(cell % 9) + 1})`;
const lit = (p: Browser) =>
  p.eval<number>(`() => document.querySelectorAll("#ut-board .ut-small.open").length`);
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("ut-toast").classList.contains("on")`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Aims at `cell` on `p` and presses "Place", then waits until the mark is on every phone. */
async function tap(p: Browser, cell: number, phones: Browser[] = [p]) {
  const n = ut(p).moves.length;
  p.click(cellOf(cell));
  await waitFor(`aim at cell ${cell}`, () => ut(p).aim === cell);
  p.click("#ut-place");
  await waitFor(`mark on cell ${cell}`, () =>
    phones.every((x) => {
      const s = ut(x);
      return s.moves.length === n + 1 && s.moves[n] === cell;
    }),
  );
}

/** Plays `cells` with taps made inside the page, a few at a time: a whole game in seconds. */
function tapAll(p: Browser, cells: number[]) {
  for (let i = 0; i < cells.length; i += 12) {
    p.run(`await page.eval(async () => {
      const api = window.__ultimate;
      for (const cell of ${JSON.stringify(cells.slice(i, i + 12))}) {
        const n = api.state().moves.length;
        const el = document.querySelectorAll("#ut-board .ut-cell")[cell];
        el.click();
        el.click();
        const t0 = Date.now();
        while (api.state().moves.length !== n + 1 && Date.now() - t0 < 4000)
          await new Promise((r) => setTimeout(r, 10));
      }
    });`);
  }
}

/** Waits out the computer's turn: its mark is down and the game is Zoe's again, or over. */
async function computerMoved(p: Browser) {
  await waitFor("the computer's move", () => {
    const s = ut(p);
    return !s.thinking && (s.turn === 0 || s.over);
  });
}

/**
 * Solo, Zoe marks the first spot she may, up to `turns` times, inside the
 * page, and the computer answers each one. Stops early when the game is over.
 */
function rush(p: Browser, turns: number) {
  p.run(`await page.eval(async () => {
    const api = window.__ultimate;
    const until = async (fn) => {
      const t0 = Date.now();
      while (!fn(api.state()) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 10));
    };
    for (let i = 0; i < ${turns} && !api.state().over; i++) {
      const el = document.querySelectorAll("#ut-board .ut-cell")[api.state().legal[0]];
      el.click();
      el.click();
      await until((s) => !s.thinking && (s.turn === 0 || s.over));
    }
  });`);
}

/** The board fits a screen of `size`: no sideways scroll, buttons a thumb can hit, the dock in view. */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  const m = p.eval<{
    cell: number;
    button: number;
    scroll: number;
    width: number;
    bottom: number;
    height: number;
  }>(`() => {
    const buttons = [...document.querySelectorAll("#ut-game .ut-dock .btn")].filter((el) => el.getClientRects().length > 0);
    return {
      cell: document.querySelector("#ut-board .ut-cell").getBoundingClientRect().width,
      button: Math.min(...buttons.map((el) => el.getBoundingClientRect().height)),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: document.querySelector("#ut-game .ut-dock").getBoundingClientRect().bottom,
      height: innerHeight,
    };
  }`);
  check(
    m.cell >= 30 && m.button >= 44 && m.scroll <= m.width && m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} the board fits: ${m.cell.toFixed(1)} px spots, ${m.button.toFixed(0)} px buttons, no sideways scroll`,
  );
  p.screenshot(name);
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function ultimateSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${ULTIMATE}"] small`) === "Solo · vs computer",
    "Ultimate Tic-Tac-Toe plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${ULTIMATE}"]`);
  await waitFor("ultimate home, solo", () => phone.visible("ut-home"));
  check(
    phone.text("#ut-name-0") === "Zoe" && phone.text("#ut-name-1") === "Computer",
    "solo Ultimate Tic-Tac-Toe is Zoe against the computer",
  );
  check(
    phone.text("#ut-sub-0") === "X · goes first" && phone.text("#ut-sub-1") === "O · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  phone.screenshot("ut-home-solo");
  phone.click("#ut-start");
  await waitFor("solo board", () => phone.visible("ut-game"));
  const start = ut(phone);
  check(start.turn === 0 && !start.thinking && start.level === "hard", "Zoe starts against Hard");
  check(
    lit(phone) === 9 && start.legal.length === 81 && phone.text("#ut-status-text") === "Your turn",
    "every small board is lit for the first mark",
  );
  phone.screenshot("ut-solo-start");

  // Place, then check the thinking state inside the page in one go: the
  // computer waits only 500 ms, too short to span several browser calls.
  const blocked = phone.eval<{
    thinking: boolean;
    still: boolean;
    lit: number;
    place: boolean;
    label: string;
  }>(`() => {
    const api = window.__ultimate;
    const cells = document.querySelectorAll("#ut-board .ut-cell");
    cells[40].click();
    document.getElementById("ut-place").click();
    const before = api.state();
    for (const cell of before.legal) cells[cell].click();
    const after = api.state();
    return {
      thinking: before.thinking && after.thinking,
      still: after.aim === null && after.moves.length === before.moves.length,
      lit: document.querySelectorAll("#ut-board .ut-small.open").length,
      place: document.getElementById("ut-place").disabled,
      label: document.getElementById("ut-status-text").innerText.trim(),
    };
  }`);
  check(blocked.thinking && blocked.still, "taps do nothing while the computer is thinking");
  check(
    blocked.lit === 0 && blocked.place && blocked.label === "Computer is thinking",
    "no board is lit, “Place” is off and the status says “Computer is thinking”",
  );
  await computerMoved(phone);
  const answered = ut(phone);
  check(
    answered.moves.length === 2 && answered.turn === 0 && Math.floor(answered.moves[1]! / 9) === 4,
    "the computer answers in the small board Zoe sent it to, then it is Zoe's turn",
  );
  check(
    answered.notes.length === 1 && answered.notes[0]!.playouts > 0 && answered.notes[0]!.at === 1,
    "the computer keeps the numbers behind its move",
  );
  check(
    lit(phone) === 1 &&
      answered.open.join() === String(answered.target) &&
      answered.target === answered.moves[1]! % 9,
    "only the small board Zoe was sent to is lit",
  );
  phone.screenshot("ut-solo-turn");
  fits(phone, "360x740x2,mobile,touch", "ut-solo-360");
  fits(phone, "820x1180x2,mobile,touch", "ut-solo-tablet");
  phone.viewport(VIEWPORT);

  // Zoe's second mark, then a reload while the computer is still thinking.
  const pending = phone.eval<UltimateState | null>(`() => {
    const api = window.__ultimate;
    const el = document.querySelectorAll("#ut-board .ut-cell")[api.state().legal[0]];
    el.click();
    el.click();
    const s = api.state();
    if (!s.thinking) return null;
    setTimeout(() => location.reload(), 0);
    return s;
  }`);
  check(pending, "the reload lands during the computer's turn");
  await waitFor("home after reload", () => phone.visible("ut-home"));
  check(phone.visible("ut-resume"), "a solo game in progress offers to resume");
  phone.click("#ut-resume");
  await waitFor("resumed solo", () => phone.visible("ut-game"));
  // The computer may already have marked by the time this looks.
  const resumed = ut(phone);
  check(
    resumed.moves.slice(0, pending.moves.length).join() === pending.moves.join() &&
      (resumed.thinking || resumed.moves.length > pending.moves.length),
    "the resumed game is on the computer's turn",
  );
  await computerMoved(phone);
  const expected = think(replay(pending.starter, pending.moves)!, "hard", pending.seed, Infinity).cell;
  check(
    ut(phone).moves[pending.moves.length] === expected,
    "after the resume, the computer plays the spot its seed picked",
  );

  // Zoe always marks the first spot she may, and loses.
  while (!ut(phone).over) rush(phone, 8);
  const lost = ut(phone);
  check(lost.winner === 1 && lost.wins.join() === "0,1", "Hard beats a player who never looks");
  check(phone.text("#ut-result-title") === "Computer wins!", "the result names the computer");
  check(phone.text("#ut-why") === "Three small boards in a row.", "one line says why");
  check(
    lost.line.length === 3 &&
      phone.eval<number>(`() => document.querySelectorAll("#ut-board .ut-small.line.won.s1").length`) === 3,
    "the three winning boards are marked",
  );
  check(
    phone.text("#ut-stats").includes("Games played out") && phone.text("#ut-stats").includes("Time thinking"),
    "the recap counts the computer's search",
  );
  check(
    lost.notes.every((n) => n.ms < 300),
    `Hard answers within 300 ms (slowest ${Math.max(...lost.notes.map((n) => n.ms)).toFixed(0)} ms)`,
  );
  check(
    phone.text("#ut-tally") === "0–1" && phone.text("#ut-pl-1 .ut-sub") === "Winner",
    "the score reads Zoe 0, Computer 1",
  );
  check(!phone.visible("ut-act") && phone.visible("ut-result"), "the result replaces the status line");
  phone.screenshot("ut-solo-lost");
  fits(phone, "360x740x2,mobile,touch", "ut-solo-lost-360");
  phone.viewport(VIEWPORT);

  // The rematch: the computer goes first this time and moves on its own.
  phone.click("#ut-again");
  await waitFor("solo rematch", () => ut(phone).starter === 1);
  await computerMoved(phone);
  check(ut(phone).moves.length === 1 && ut(phone).turn === 0, "the computer opens the rematch");
  check(!ut(phone).notes.some((n) => n.at > 0), "the rematch starts a fresh recap");
  phone.click("#ut-leave");
  await waitFor("ultimate home", () => phone.visible("ut-home"));
  check(phone.visible("ut-resume"), "the rematch can be resumed");
  phone.click("#ut-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: a win by three small boards in
 * a row, a draw, then a game left on a free choice of board, 26 marks in.
 * The session is Zoe and Kai.
 */
export async function ultimatePassAndPlay(phone: Browser, origin: string) {
  phone.click(`#tiles a[href="/${ULTIMATE}"]`);
  await waitFor("ultimate home", () => phone.visible("ut-home"));
  check(phone.eval<string>("() => location.pathname") === `/${ULTIMATE}`, "the URL is /ultimate-tic-tac-toe");
  check(
    phone.eval<string>("() => document.body.dataset.game") === ULTIMATE,
    "Ultimate Tic-Tac-Toe's theme is on",
  );
  check(
    phone.text("#ut-name-0") === "Zoe" && phone.text("#ut-name-1") === "Kai",
    "Ultimate Tic-Tac-Toe takes the names from the session",
  );
  check(phone.text("#ut-sub-0") === "X · goes first" && phone.text("#ut-sub-1") === "O", "X goes first");
  check(!phone.visible("ut-resume"), "the solo Ultimate Tic-Tac-Toe game is saved apart from pass & play");
  phone.screenshot("ut-home");
  phone.click("#ut-start");
  await waitFor("board", () => phone.visible("ut-game"));
  check(
    ut(phone).turn === 0 && lit(phone) === 9 && phone.text("#ut-status-text") === "Zoe's turn",
    "Zoe starts, with every small board to pick from",
  );
  check(
    phone.eval<boolean>(`() => document.getElementById("ut-place").disabled`),
    '"Place" waits for an aim',
  );

  // A tap only aims: the mark shows dimmed, and another tap moves it.
  phone.click(cellOf(WIN[0]! + 1));
  await waitFor("aim", () => ut(phone).aim === WIN[0]! + 1);
  phone.click(cellOf(WIN[0]!));
  await waitFor("aim moved", () => ut(phone).aim === WIN[0]);
  check(
    ut(phone).moves.length === 0 &&
      phone.eval<number>(`() => document.querySelectorAll("#ut-board .ut-mark.ghost.s0").length`) === 1 &&
      phone.eval<boolean>(`() => !!document.querySelector('${cellOf(WIN[0]!)} .ut-mark.ghost')`),
    "a tap aims with a dimmed mark, and a tap elsewhere moves the aim",
  );
  phone.screenshot("ut-aim");
  phone.click("#ut-place");
  await waitFor("first mark", () => ut(phone).moves.join() === String(WIN[0]));
  check(
    ut(phone).target === WIN[0]! % 9 && lit(phone) === 1 && ut(phone).aim === null,
    "the mark sends Kai to the small board in the same place",
  );
  check(
    phone.text("#ut-status-text") === "Kai's turn" && phone.text("#ut-pl-1 .ut-sub") === "Your turn",
    "the turn passes to Kai",
  );

  // A spot outside that small board takes no aim, and a second tap on the aimed spot marks it.
  phone.click(cellOf(40));
  check(ut(phone).aim === null, "a tap outside the lit board aims at nothing");
  phone.click(cellOf(WIN[1]!));
  await waitFor("aim", () => ut(phone).aim === WIN[1]);
  phone.click(cellOf(WIN[1]!));
  await waitFor("second mark", () => ut(phone).moves.length === 2);
  check(ut(phone).moves[1] === WIN[1], "a second tap on the aimed spot makes the mark");
  phone.click(cellOf(WIN[0]!));
  check(ut(phone).aim === null, "a taken spot takes no aim");
  tapAll(phone, WIN.slice(2, 12));
  await waitFor("midgame", () => ut(phone).moves.length === 12);
  check(
    ut(phone).won[4] === 0 &&
      phone.text("#ut-pl-0 .ut-count") === "1" &&
      phone.eval<boolean>(
        `() => !!document.querySelector("#ut-board .ut-small:nth-child(5).won.s0 .ut-big .ut-mark")`,
      ),
    "three in a row wins a small board: a big mark covers it, and the card counts it",
  );
  phone.screenshot("ut-midgame");
  tapAll(phone, WIN.slice(12));
  await waitFor("win", () => ut(phone).over);
  const won = ut(phone);
  check(won.winner === 0 && won.wins.join() === "1,0", "Zoe wins three small boards in a row");
  check(phone.text("#ut-result-title") === "Zoe wins!", "the result names the winner");
  check(phone.text("#ut-why") === "Three small boards in a row.", "one line says why");
  check(
    won.line.join() === "2,4,6" &&
      phone.eval<number>(`() => document.querySelectorAll("#ut-board .ut-small.line").length`) === 3 &&
      won.boards.join() === "3,1",
    "the three winning boards are marked",
  );
  check(
    phone.text("#ut-stats") === "" && !phone.visible("ut-note"),
    "pass & play shows no computer recap and no rematch note",
  );
  phone.screenshot("ut-win");

  // The rematch: Kai starts, and the game ends with no board left and no line.
  phone.click("#ut-again");
  await waitFor("rematch", () => ut(phone).moves.length === 0 && !ut(phone).over);
  check(ut(phone).turn === 1, "the player who went second starts the rematch");
  check(phone.text("#ut-tally") === "1–0", "the score shows 1-0");
  tapAll(phone, DRAW);
  await waitFor("draw", () => ut(phone).over);
  const drawn = ut(phone);
  check(
    drawn.draw && drawn.winner === null && drawn.boards.join() === "3,5" && drawn.open.length === 0,
    "no board is left and nobody has three in a row",
  );
  check(
    phone.text("#ut-result-title") === "It's a draw" &&
      phone.text("#ut-why") === "No board left to play, and no three in a row: 3 to 5.",
    "the result calls the draw: the boards held do not count",
  );
  check(
    phone.eval<boolean>(
      `() => document.querySelector("#ut-board .ut-small:nth-child(5)").classList.contains("dead")`,
    ),
    "a full board nobody won counts for nobody",
  );
  check(drawn.wins.join() === "1,0", "a draw scores for nobody");
  phone.screenshot("ut-draw");

  // A third game: the 26th mark sends Zoe to a full small board, so she may play in any open one.
  phone.click("#ut-again");
  await waitFor("third game", () => ut(phone).moves.length === 0 && ut(phone).starter === 0);
  tapAll(phone, SENT_TO_FULL);
  await waitFor("sent to a full board", () => ut(phone).moves.length === SENT_TO_FULL.length);
  const free = ut(phone);
  check(
    free.turn === 0 && free.target === null && !free.open.includes(8) && lit(phone) === free.open.length,
    "sent to a full board, Zoe may play in any open board",
  );
  check(phone.text("#ut-status-text") === "Zoe's turn · any board", "the status says so");
  phone.screenshot("ut-any-board");

  // A reload mid-game keeps the board.
  phone.open(`${origin}/${ULTIMATE}`);
  await waitFor("home after reload", () => phone.visible("ut-home"));
  check(phone.visible("ut-resume"), "an Ultimate Tic-Tac-Toe game in progress offers to resume");
  phone.click("#ut-resume");
  await waitFor("resumed", () => phone.visible("ut-game"));
  check(
    ut(phone).moves.join() === SENT_TO_FULL.join() &&
      ut(phone).turn === 0 &&
      ut(phone).wins.join() === "1,0" &&
      lit(phone) === free.open.length,
    "the resumed board has every mark, the turn, the lit boards and the score",
  );
  phone.click("#ut-leave");
  await waitFor("ultimate home", () => phone.visible("ut-home"));
  phone.click("#ut-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Ultimate Tic-Tac-Toe loads from the service worker and resumes. */
export async function ultimateOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${ULTIMATE}`);
  await waitFor("ultimate offline", () => phone.visible("ut-home"));
  phone.click("#ut-resume");
  await waitFor("resumed offline", () => phone.visible("ut-game"));
  check(
    ut(phone).moves.length === SENT_TO_FULL.length,
    "offline: Ultimate Tic-Tac-Toe loads from the service worker and resumes",
  );
  phone.screenshot("ut-offline");
}

/**
 * Makes `p`'s link slow: everything it sends leaves `ms` late, so the host's
 * answer to a mark lands well after the mark shows. Also records its toasts,
 * for `toastsSeen`. Null puts it back.
 */
function slowLink(p: Browser, ms: number | null) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__send ??= WebSocket.prototype.send;
    const send = w.__send;
    const ms = ${JSON.stringify(ms)};
    WebSocket.prototype.send = ms === null ? send : function (data) { setTimeout(() => send.call(this, data), ms); };
    w.__utToasts = [];
    w.__utWatch?.disconnect();
    w.__utWatch = new MutationObserver((records) => {
      for (const r of records) w.__utToasts.push(r.target.textContent);
    });
    w.__utWatch.observe(document.getElementById("ut-toast"), { childList: true, characterData: true, subtree: true });
  });`);
}

const toastsSeen = (p: Browser) => p.eval<string[]>("() => window.__utToasts");

/**
 * Ultimate Tic-Tac-Toe between the two phones, from the menu and back to it:
 * the friend's aim dimmed, a game to a win, a reload mid-game, a rematch that
 * waits for both, a slow link, a free choice of board, and a second visit
 * that keeps the score. `a` is Ana (seat 0, X) and `b` is Kai.
 */
export async function ultimateOnline(
  a: Browser,
  b: Browser,
  origin: string,
  atMenu: (p: Browser) => boolean,
) {
  const both = [a, b];
  /** Plays `cells` from the empty board, each placed on the phone whose turn it is. */
  const playOut = async (first: 0 | 1, cells: number[], from = 0) => {
    for (let i = from; i < cells.length; i++) {
      const seat = replay(first, cells.slice(0, i))!.turn;
      await waitFor("on turn", () => !ut(both[seat]!).locked);
      await tap(both[seat]!, cells[i]!, both);
    }
  };

  // Ana picks Ultimate Tic-Tac-Toe, so Ana plays first.
  a.click(`#tiles a[data-id="${ULTIMATE}"]`);
  await waitFor("both in Ultimate Tic-Tac-Toe", () => {
    const [sa, sb] = [ut(a), ut(b)];
    return sa.me === 0 && sb.me === 1 && sa.rematch !== null && sb.rematch !== null;
  });
  check(
    b.eval<string>("() => location.pathname") === `/${ULTIMATE}`,
    "the friend's phone opens Ultimate Tic-Tac-Toe too",
  );
  check(ut(a).turn === 0 && !ut(a).locked && ut(b).locked, "the player who picked it plays first");
  check(
    a.text("#ut-status-text") === "Your turn" && b.text("#ut-status-text") === "Waiting for Ana",
    "the other phone waits",
  );
  check(lit(a) === 9 && lit(b) === 0, "only the phone on turn has its boards lit");
  check(
    a.text("#ut-pl-0 .ut-sub") === "Your turn" &&
      b.text("#ut-pl-0 .ut-sub") === "Their turn" &&
      b.text("#ut-pl-1 .ut-sub") === "You",
    "the cards say whose turn, and which mark is yours",
  );
  check(
    b.eval<boolean>(`() => document.getElementById("ut-place").disabled`),
    '"Place" is off on the phone that waits',
  );

  // Out of turn, a tap aims at nothing on either phone.
  b.click(cellOf(WIN[0]!));
  await sleep(400);
  check(ut(b).aim === null && ut(a).foeAim === null, "a tap out of turn aims at nothing");

  // Ana aims: Kai sees her mark dimmed on that spot, and nothing is played yet.
  a.click(cellOf(WIN[0]!));
  await waitFor("the friend sees the aim", () => ut(b).foeAim === WIN[0]);
  check(
    b.eval<boolean>(`() => !!document.querySelector('${cellOf(WIN[0]!)} .ut-mark.ghost.theirs.s0')`),
    "the friend's aim shows dimmed",
  );
  check(ut(a).moves.length === 0 && ut(b).moves.length === 0, "an aim plays nothing");
  a.screenshot("online-ut-aim");
  b.screenshot("online-ut-friend-aims");

  a.click("#ut-place");
  await waitFor("first mark", () => both.every((p) => ut(p).moves.join() === String(WIN[0])));
  check(
    ut(b).foeAim === null && ut(b).target === WIN[0]! % 9 && lit(b) === 1,
    "the mark sends the friend to one small board",
  );
  await waitFor("your-turn toast", () => toastOn(b));
  check(b.text("#ut-toast") === "Your turn", "the friend gets the your-turn alert");
  b.screenshot("online-ut-your-turn");
  await playOut(0, WIN.slice(0, 4), 1);

  // Ana's page reloads on her turn: the same board, still her turn.
  a.open(`${origin}/${ULTIMATE}`);
  await waitFor(
    "maker back in the game",
    () => ut(a).me === 0 && ut(a).moves.join() === WIN.slice(0, 4).join(),
  );
  await waitFor("maker on turn after reload", () => !ut(a).locked);
  check(true, "after a reload the maker is on the same board, still on turn");
  await playOut(0, WIN, 4);
  await waitFor("game over", () => both.every((p) => ut(p).over && ut(p).winner === 0));
  check(
    a.text("#ut-result-title") === "You win!" && b.text("#ut-result-title") === "Ana wins!",
    "the third small board in a row wins, on both phones",
  );
  check(
    both.every((p) => p.text("#ut-why") === "Three small boards in a row."),
    "both phones say why the game ended",
  );
  check(ut(a).wins.join() === "1,0" && ut(b).wins.join() === "1,0", "both phones keep the score");
  a.screenshot("online-ut-won");
  b.screenshot("online-ut-lost");

  // A rematch waits for both players, then the other player goes first.
  b.click("#ut-again");
  await waitFor("rematch asked", () => a.text("#ut-note") === "Kai wants a rematch");
  check(
    b.text("#ut-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("ut-again").disabled`),
    "the asker waits for the friend",
  );
  b.screenshot("online-ut-rematch-waiting");
  a.screenshot("online-ut-rematch-asked");
  a.click("#ut-again");
  await waitFor("rematch", () =>
    both.every((p) => ut(p).moves.length === 0 && ut(p).starter === 1 && !ut(p).over),
  );
  check(
    !ut(b).locked && ut(a).locked && ut(a).wins.join() === "1,0",
    "the rematch swaps who goes first, and keeps the score",
  );

  // On a slow link the host answers long after the mark shows. The mark
  // stays put, with no "Connection hiccup" toast.
  slowLink(b, 1500);
  await tap(b, SENT_TO_WON[0]!, both);
  await sleep(2500);
  const toasts = toastsSeen(b);
  slowLink(b, null);
  check(
    !toasts.some((t) => t.includes("hiccup")) && ut(b).moves.join() === String(SENT_TO_WON[0]),
    `on a slow link the mark stays where it was placed (toasts ${JSON.stringify(toasts)})`,
  );

  // Ana's third mark sends Kai to a small board he has won: he may play anywhere open.
  await playOut(1, SENT_TO_WON, 1);
  await waitFor("free choice", () => !ut(b).locked && ut(b).target === null);
  check(
    b.text("#ut-status-text") === "Your turn · any board" && lit(b) === 8 && ut(b).won[4] === 1,
    "sent to a won board, the player may play in any open board",
  );
  check(b.text("#ut-toast") === "Your turn · any board", "the alert says so too");
  b.screenshot("online-ut-any-board");
  a.screenshot("online-ut-any-board-waiting");

  // Ana leaves the game: both phones go back to the menu.
  a.click("#ut-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));

  // Kai opens it again: a fresh board, his move, and the score from before.
  b.click(`#tiles a[data-id="${ULTIMATE}"]`);
  await waitFor("both in Ultimate Tic-Tac-Toe again", () =>
    both.every((p) => {
      const s = ut(p);
      return s.me !== null && s.rematch !== null && s.moves.length === 0 && s.starter === 1;
    }),
  );
  check(
    ut(a).wins.join() === "1,0" && ut(b).wins.join() === "1,0" && !ut(b).locked,
    "opening Ultimate Tic-Tac-Toe again keeps the party's score",
  );
  b.click("#ut-leave");
  await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
}
