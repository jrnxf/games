// Ultimate Tic-Tac-Toe's part of the end-to-end suites, driven by taps on
// the real spots. `pnpm test:online` plays it between two phones to a result,
// a rematch, a free choice of board and a second visit that keeps the score.

import { replay } from "../../src/games/ultimate-tic-tac-toe/core/board.ts";
import { SENT_TO_WON, WIN } from "../unit/ultimate-tic-tac-toe-games.ts";
import { Browser, check, waitFor } from "./browser.ts";

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
