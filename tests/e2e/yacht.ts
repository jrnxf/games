// Yacht's part of the end-to-end suites, driven by taps on the real dice and
// scorecard. `pnpm test:menu` plays it solo against the Hard computer (with a
// reload on its turn) and pass & play (a whole game, a rematch and a reload
// with dice held), then resumes it offline. `pnpm test:online` plays it
// between two phones to a result, with live holds, a reload and a rematch,
// and a second visit that keeps the score.

import { think } from "../../src/games/yacht/core/ai.ts";
import { BOXES, isUpper, replay, scoreFor, type Game, type Seat } from "../../src/games/yacht/core/board.ts";
import { faces, type Seed } from "../../src/games/yacht/core/dice.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const YACHT = "yacht";

/** What Yacht's test hook reports. */
interface YachtState {
  actions: number[];
  first: Seat;
  turn: Seat;
  rolls: number;
  dice: number[];
  held: number;
  aim: number | null;
  over: boolean;
  winner: Seat | null;
  draw: boolean;
  totals: [number, number];
  boxes: [(number | null)[], (number | null)[]];
  legal: number[];
  thinking: boolean;
  busy: boolean;
  wins: [number, number];
  level: "easy" | "medium" | "hard" | null;
  me: Seat | null;
  near: Seat;
  locked: boolean;
  pending: number | null;
  rematch: [boolean, boolean] | null;
  hasSeed: boolean | null;
}

const yt = (p: Browser) => p.eval<YachtState>("() => window.__yacht.state()");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The card's rows: the head, the six upper boxes, the bonus, the seven lower boxes, the total. */
const rowOf = (box: number) => `#yt-card > :nth-child(${(isUpper(box) ? 1 + box : 2 + box) + 1})`;
const BONUS_ROW = "#yt-card > :nth-child(8)";
const TOTAL_ROW = "#yt-card > :nth-child(16)";
const dieOf = (i: number) => `#yt-dice > :nth-child(${i + 1})`;
const openRows = (p: Browser) =>
  p.eval<number>(`() => document.querySelectorAll("#yt-card .yt-row.can").length`);
const disabled = (p: Browser, id: string) =>
  p.eval<boolean>(`() => document.getElementById(${JSON.stringify(id)}).disabled`);
const hasClass = (p: Browser, selector: string, name: string) =>
  p.eval<boolean>(
    `() => document.querySelector(${JSON.stringify(selector)}).classList.contains(${JSON.stringify(name)})`,
  );
/** The text of `seat`'s cell in a row, from the column order this phone uses. */
const cellText = (p: Browser, row: string, col: 0 | 1) => p.text(`${row} > .yt-cell:nth-of-type(${col + 2})`);

/** Taps Roll on `p` and waits until the roll counts and its dice land on every phone. */
async function roll(p: Browser, phones: Browser[] = [p]) {
  const s = await waitFor("a roll to make", () => {
    const now = yt(p);
    return now.locked ? null : now;
  });
  const n = s.actions.length;
  p.click("#yt-roll");
  await waitFor("the roll", () =>
    phones.every((x) => {
      const now = yt(x);
      return now.actions.length > n && !now.busy && now.pending === null;
    }),
  );
}

/** Taps the row of `box` twice on `p`: once to aim, once to fill it. Waits for every phone to have it. */
async function score(p: Browser, box: number, phones: Browser[] = [p]) {
  const n = yt(p).actions.length;
  p.click(rowOf(box));
  p.click(rowOf(box));
  await waitFor(`box ${box}`, () =>
    phones.every((x) => {
      const now = yt(x);
      return now.actions.length > n && now.actions[n] === box && now.pending === null;
    }),
  );
}

/**
 * Plays on with taps made inside the page for up to `ms`: on each turn it can
 * play, it rolls once and fills the first open box. Returns true once the game
 * is over.
 */
function playOn(p: Browser, ms = 8000): boolean {
  return p.eval<boolean>(`async () => {
    const api = window.__yacht;
    const t0 = Date.now();
    const pause = () => new Promise((r) => setTimeout(r, 15));
    while (!api.state().over && Date.now() - t0 < ${ms}) {
      const s = api.state();
      if (s.locked) {
        await pause();
        continue;
      }
      if (s.rolls === 0) {
        document.getElementById("yt-roll").click();
        while (api.state().actions.length === s.actions.length && Date.now() - t0 < ${ms}) await pause();
        continue;
      }
      const row = document.querySelector("#yt-card .yt-row.can");
      row.click();
      row.click();
      while (api.state().actions.length === s.actions.length && Date.now() - t0 < ${ms}) await pause();
    }
    return api.state().over && !api.state().busy;
  }`);
}

/** The game a phone shows, replayed here from its seed and actions. */
const replayed = (first: Seat, actions: number[], seed: Seed): Game =>
  replay(first, actions, (k) => faces(seed, k))!;

/** The solo save's seed: the computer's choices come from it. */
const soloSeed = (p: Browser) => p.eval<Seed>(`() => JSON.parse(localStorage.getItem("yacht.solo")).seed`);

/** Every computer action so far is the one Hard picks from the game and the seed. */
function computerAgrees(p: Browser): boolean {
  const s = yt(p);
  const seed = soloSeed(p);
  return s.actions.every((a, i) => {
    const g = replayed(s.first, s.actions.slice(0, i), seed);
    return g.turn === 0 || think(g, "hard", seed[0]!).action === a;
  });
}

/** The game fits a screen of `size`: no scroll, dice a thumb can hit, the dock in view. */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  const m = p.eval<{
    die: number;
    row: number;
    button: number;
    scrollW: number;
    scrollH: number;
    width: number;
    height: number;
    bottom: number;
  }>(`() => {
    const dice = [...document.querySelectorAll("#yt-dice .yt-die")].map((el) => el.getBoundingClientRect());
    const rows = [...document.querySelectorAll("#yt-card .yt-box")].map((el) => el.getBoundingClientRect());
    return {
      die: Math.min(...dice.map((r) => Math.min(r.width, r.height))),
      row: Math.min(...rows.map((r) => r.height)),
      button: document.getElementById("yt-roll").getBoundingClientRect().height,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      width: innerWidth,
      height: innerHeight,
      bottom: Math.max(
        document.querySelector("#yt-game .yt-dock").getBoundingClientRect().bottom,
        document.getElementById("yt-card").getBoundingClientRect().bottom,
      ),
    };
  }`);
  check(
    m.die >= 44 &&
      m.button >= 44 &&
      m.row >= 20 &&
      m.scrollW <= m.width &&
      m.scrollH <= m.height &&
      m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} the game fits with no scroll: ${m.die.toFixed(1)} px dice, ${m.row.toFixed(1)} px rows`,
  );
  p.screenshot(name);
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function yachtSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${YACHT}"] small`) === "Solo · vs computer",
    "Yacht plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${YACHT}"]`);
  await waitFor("yacht home, solo", () => phone.visible("yt-home"));
  check(
    phone.text("#yt-name-0") === "Zoe" && phone.text("#yt-name-1") === "Computer",
    "solo Yacht is Zoe against the computer",
  );
  check(
    phone.text("#yt-sub-0") === "Amber · goes first" && phone.text("#yt-sub-1") === "Sky · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  check(!phone.text("#yt-lead").includes("Yahtz"), "the rules use only the name Yacht");
  phone.screenshot("yt-home-solo");
  phone.click("#yt-start");
  await waitFor("solo game", () => phone.visible("yt-game"));
  const start = yt(phone);
  check(
    start.turn === 0 && start.rolls === 0 && !start.thinking && start.level === "hard",
    "Zoe starts against Hard",
  );
  check(
    openRows(phone) === 0 && disabled(phone, "yt-score") && phone.text("#yt-roll") === "Roll",
    "before the first roll no box is open, and Roll is the only move",
  );
  check(
    cellText(phone, rowOf(0), 0) === "" &&
      cellText(phone, TOTAL_ROW, 0) === "0" &&
      cellText(phone, TOTAL_ROW, 1) === "0",
    "the card starts empty",
  );
  check(
    phone.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(2)") === "You" &&
      phone.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(3)") === "Computer",
    "the columns are You and Computer",
  );

  // The first roll: the dice tumble, then land on faces the seed picked.
  const rolled = phone.eval<{ tumbling: boolean; label: string }>(`async () => {
    document.getElementById("yt-roll").click();
    const tumbling = document.querySelectorAll("#yt-dice .yt-die.tumble").length === 5;
    while (window.__yacht.state().busy) await new Promise((r) => setTimeout(r, 10));
    return { tumbling, label: document.getElementById("yt-left-text").textContent };
  }`);
  const one = yt(phone);
  const seed = soloSeed(phone);
  check(rolled.tumbling, "all five dice tumble on the first roll");
  check(
    phone.eval<boolean>(
      `() => [...document.querySelectorAll("#yt-dice .yt-side, #yt-dice .yt-core")].every((el) => getComputedStyle(el).transform.startsWith("matrix3d"))`,
    ),
    "every side of every die sits on the cube, the 1 too",
  );
  check(
    one.rolls === 1 && one.dice.join() === faces(seed, 0).join(),
    "the dice land on the faces the game's seed gives",
  );
  check(rolled.label === "2 rolls left", "the tray says 2 rolls left");
  check(openRows(phone) === one.legal.length && one.legal.length > 0, "every box this roll may fill is open");
  check(
    one.legal.every(
      (b) =>
        cellText(phone, rowOf(b), 0) ===
        String(scoreFor(replayed(0, one.actions, seed).cards[0], b, one.dice)),
    ),
    "each open box shows what this roll would score",
  );

  // Hold the first and third dice, then roll again: they stay put.
  phone.click(dieOf(0));
  phone.click(dieOf(2));
  check(
    yt(phone).held === 0b101 && hasClass(phone, dieOf(0), "held") && hasClass(phone, dieOf(2), "held"),
    "a tap holds a die, and it lifts with a Held label",
  );
  phone.click(dieOf(2));
  phone.click(dieOf(2));
  check(yt(phone).held === 0b101, "a second tap lets a die go, and a third holds it again");
  phone.screenshot("yt-solo-held");
  await roll(phone);
  const two = yt(phone);
  check(
    two.rolls === 2 && two.dice[0] === one.dice[0] && two.dice[2] === one.dice[2] && two.held === 0b101,
    "the held dice keep their faces through the roll",
  );
  await roll(phone);
  const three = yt(phone);
  check(
    three.rolls === 3 && disabled(phone, "yt-roll") && phone.text("#yt-left-text") === "No rolls left",
    "after three rolls Roll is off and the tray says no rolls are left",
  );
  check(
    phone.eval<boolean>(`() => [...document.querySelectorAll("#yt-dice .yt-die")].every((d) => d.disabled)`),
    "with no rolls left the dice cannot be held",
  );
  check(hasClass(phone, "#yt-score", "primary"), "with no rolls left, Score leads");

  // Aim at the first open box, then fill it with the Score button.
  const box = three.legal[0]!;
  const points = scoreFor(replayed(0, three.actions, seed).cards[0], box, three.dice)!;
  phone.click(rowOf(box));
  check(
    yt(phone).aim === box && hasClass(phone, rowOf(box), "pick") && yt(phone).actions.length === 3,
    "a first tap on a row only aims at it",
  );
  check(
    phone.text("#yt-score").startsWith("Score ") && !disabled(phone, "yt-score"),
    "the Score button names the box",
  );
  phone.screenshot("yt-aim");
  // Fill it, then follow the computer's turn inside the page: its pauses are
  // too short to span several browser calls.
  const turn = phone.eval<{
    scored: YachtState;
    locked: boolean;
    open: number;
    roll: boolean;
    dots: boolean;
    said: string[];
    steps: number[];
  }>(`async () => {
    const api = window.__yacht;
    document.getElementById("yt-score").click();
    const status = () => document.getElementById("yt-status").textContent;
    const scored = api.state();
    const out = {
      scored,
      locked: scored.locked,
      open: document.querySelectorAll("#yt-card .yt-row.can").length,
      roll: document.getElementById("yt-roll").disabled,
      dots: !document.getElementById("yt-dots").hidden,
      said: [status()],
      steps: [],
    };
    let last = scored.actions.length;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const s = api.state();
      if (out.said.at(-1) !== status()) out.said.push(status());
      if (s.actions.length !== last) {
        out.steps.push(Date.now() - t0);
        last = s.actions.length;
      }
      if (s.turn === 0 && !s.busy) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    return out;
  }`);
  const scored = turn.scored;
  check(
    scored.boxes[0][box] === points &&
      scored.totals[0] === points &&
      cellText(phone, TOTAL_ROW, 0) === String(points),
    `the box takes ${points} points, and the total counts them`,
  );
  check(
    cellText(phone, BONUS_ROW, 0) === `${box <= 5 ? points : 0}/63`,
    "the bonus row shows the upper boxes' progress to 63",
  );
  check(
    scored.thinking && scored.turn === 1 && turn.locked && turn.open === 0 && turn.roll && turn.dots,
    "then the computer is up, and Zoe can do nothing",
  );
  check(
    turn.said[0] === "Computer is up" &&
      turn.said[1] === "Computer is rolling" &&
      turn.said.at(-1) === "Your turn",
    `the status follows the computer's turn (${turn.said.join(", ")})`,
  );
  check(
    turn.steps.length >= 2 && turn.steps.every((t, i) => t - (turn.steps[i - 1] ?? 0) >= 500),
    `the computer rolls one roll at a time, with pauses (${turn.steps.join(", ")} ms)`,
  );
  const after = yt(phone);
  check(after.boxes[1].filter((b) => b !== null).length === 1, "the computer fills one box");
  check(computerAgrees(phone), "each computer action is the one Hard picks from the game and its seed");
  phone.screenshot("yt-solo-turn");
  fits(phone, "360x740x2,mobile,touch", "yt-solo-360");
  fits(phone, "820x1180x2,mobile,touch", "yt-solo-tablet");
  fits(phone, "844x390x2,mobile,touch,landscape", "yt-solo-landscape");
  phone.viewport(VIEWPORT);

  // Zoe plays on until the computer is up, then the page reloads mid-turn.
  const pending = phone.eval<YachtState | null>(`async () => {
    const api = window.__yacht;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = api.state();
      if (s.thinking && s.rolls > 0 && !s.busy) {
        setTimeout(() => location.reload(), 0);
        return s;
      }
      if (!s.locked) {
        if (s.rolls === 0) document.getElementById("yt-roll").click();
        else {
          const row = document.querySelector("#yt-card .yt-row.can");
          row.click();
          row.click();
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  }`);
  check(pending, "the reload lands in the middle of the computer's turn");
  await waitFor("home after reload", () => phone.visible("yt-home"));
  check(phone.visible("yt-resume"), "a solo game in progress offers to resume");
  phone.click("#yt-resume");
  await waitFor("resumed solo", () => phone.visible("yt-game"));
  const resumed = yt(phone);
  check(
    resumed.actions.slice(0, pending!.actions.length).join() === pending!.actions.join() &&
      resumed.boxes.join() === pending!.boxes.join(),
    "the resumed game has every roll and box",
  );
  await waitFor(
    "the computer's next action after the resume",
    () => yt(phone).actions.length > pending!.actions.length,
  );
  check(computerAgrees(phone), "after the resume, the computer plays on the way its seed says");
  phone.screenshot("yt-solo");

  // Zoe rolls once and fills her first open box every turn, and loses.
  await waitFor("the end of the solo game", () => playOn(phone), 240_000).catch((e: Error) => {
    // Say where the game stuck, so a slow run is easy to tell from a stuck one.
    const s = yt(phone);
    throw new Error(
      `${e.message}: ${s.actions.length} actions, "${phone.text("yt-status")}", locked ${s.locked}`,
    );
  });
  const lost = yt(phone);
  const [mine, its] = lost.totals;
  check(
    lost.boxes.every((c) => c.every((b) => b !== null)),
    "the game ends with all 26 boxes filled",
  );
  check(
    lost.winner === 1 && its > mine && lost.wins.join() === "0,1",
    `Hard beats a player who never looks (${its} to ${mine})`,
  );
  check(computerAgrees(phone), "every computer action in the game came from its seed");
  check(phone.text("#yt-result-title") === "Computer wins!", "the result names the computer");
  check(phone.text("#yt-why") === `${its} to ${mine}.`, "one line gives the score");
  check(
    cellText(phone, TOTAL_ROW, 0) === String(mine) && cellText(phone, TOTAL_ROW, 1) === String(its),
    "the totals row matches",
  );
  check(phone.text("#yt-tally") === "0–1", "the bar keeps the score: Zoe 0, Computer 1");
  check(!phone.visible("yt-turn") && phone.visible("yt-result"), "the result replaces the dice");
  phone.screenshot("yt-result");

  // The rematch: the computer goes first this time and rolls on its own.
  phone.click("#yt-again");
  await waitFor("solo rematch", () => yt(phone).first === 1 && !yt(phone).over);
  await waitFor("the computer's opening roll", () => yt(phone).actions.length >= 1);
  check(
    yt(phone).boxes[0].every((b) => b === null),
    "the rematch starts a fresh card",
  );
  phone.click("#yt-leave");
  await waitFor("yacht home", () => phone.visible("yt-home"));
  check(phone.visible("yt-resume"), "the rematch can be resumed");
  phone.click("#yt-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** How many actions the pass & play game had when it was left, for the offline check. */
let leftAt = 0;

/** Pass & play, from the menu and back to it: a whole game, a rematch and a reload with dice held. The session is Zoe and Kai. */
export async function yachtPassAndPlay(phone: Browser, origin: string) {
  phone.click(`#tiles a[href="/${YACHT}"]`);
  await waitFor("yacht home", () => phone.visible("yt-home"));
  check(phone.eval<string>("() => location.pathname") === `/${YACHT}`, "the URL is /yacht");
  check(phone.eval<string>("() => document.body.dataset.game") === YACHT, "Yacht's theme is on");
  check(
    phone.text("#yt-name-0") === "Zoe" && phone.text("#yt-name-1") === "Kai",
    "Yacht takes the names from the session",
  );
  check(
    phone.text("#yt-sub-0") === "Amber · goes first" && phone.text("#yt-sub-1") === "Sky",
    "amber goes first",
  );
  check(!phone.visible("yt-resume"), "the solo Yacht game is saved apart from pass & play");
  phone.screenshot("yt-home");
  phone.click("#yt-start");
  await waitFor("game", () => phone.visible("yt-game"));
  check(
    yt(phone).turn === 0 && phone.text("#yt-status") === "Zoe's turn" && !phone.visible("yt-dots"),
    "Zoe starts, and the status names her",
  );
  check(
    phone.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(2)") === "Zoe" &&
      phone.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(3)") === "Kai",
    "the columns are named Zoe and Kai",
  );

  await roll(phone);
  const box = yt(phone).legal[0]!;
  await score(phone, box);
  check(
    yt(phone).turn === 1 && yt(phone).rolls === 0 && phone.text("#yt-status") === "Kai's turn",
    "a filled box ends the turn, and Kai is up",
  );
  check(
    hasClass(phone, "#yt-tray", "s1") && hasClass(phone, `${rowOf(0)} > .yt-cell:nth-of-type(3)`, "on"),
    "the tray and Kai's column wear his colour",
  );
  check(hasClass(phone, `${rowOf(box)} > .yt-cell:nth-of-type(2)`, "just"), "the box just filled lights up");
  // Each player has their own boxes: Zoe's filled box is still open to Kai.
  await roll(phone);
  check(
    // A Yacht rolled now could force the joker box instead.
    yt(phone).legal.includes(box) || new Set(yt(phone).dice).size === 1,
    "Kai may fill the box Zoe filled, in his own column",
  );
  await score(phone, yt(phone).legal[0]!);
  check(
    yt(phone).boxes[0][box] !== null && yt(phone).turn === 0,
    "both columns keep their boxes, and Zoe is up again",
  );

  await waitFor("the end of the game", () => playOn(phone), 120_000);
  const won = yt(phone);
  const [z, k] = won.totals;
  const expected = z === k ? null : z > k ? 0 : 1;
  check(won.winner === expected && won.draw === (expected === null), `the higher total wins (${z} to ${k})`);
  check(
    won.wins.join() === (expected === null ? "0,0" : expected === 0 ? "1,0" : "0,1"),
    "a win counts once, and a tie for nobody",
  );
  check(
    phone.text("#yt-result-title") ===
      (expected === null ? "It's a tie!" : `${expected === 0 ? "Zoe" : "Kai"} wins!`),
    "the result names the winner",
  );
  check(
    phone.text("#yt-why") ===
      (expected === null ? `${z} points each.` : `${Math.max(z, k)} to ${Math.min(z, k)}.`),
    "one line gives the score",
  );
  check(!phone.visible("yt-note"), "pass & play shows no rematch note");
  phone.screenshot("yt-win");

  // The rematch: Kai starts, and the score stays in the bar.
  const tally = `${won.wins[0]}–${won.wins[1]}`;
  phone.click("#yt-again");
  await waitFor("rematch", () => yt(phone).actions.length === 0 && !yt(phone).over);
  check(yt(phone).first === 1 && yt(phone).turn === 1, "the player who went second starts the rematch");
  check(phone.text("#yt-tally") === (tally === "0–0" ? "" : tally), "the bar keeps the running score");

  // Kai fills a box, Zoe rolls twice holding two dice, then the page reloads.
  await roll(phone);
  await score(phone, yt(phone).legal[0]!);
  await roll(phone);
  phone.click(dieOf(1));
  phone.click(dieOf(4));
  await roll(phone);
  phone.click(dieOf(3));
  const before = yt(phone);
  check(before.held === 0b11010 && before.rolls === 2, "Zoe holds three dice before her last roll");
  phone.open(`${origin}/${YACHT}`);
  await waitFor("home after reload", () => phone.visible("yt-home"));
  check(phone.visible("yt-resume"), "a Yacht game in progress offers to resume");
  phone.click("#yt-resume");
  await waitFor("resumed", () => phone.visible("yt-game"));
  const back = yt(phone);
  check(
    back.actions.join() === before.actions.join() &&
      back.dice.join() === before.dice.join() &&
      back.held === before.held &&
      back.turn === 0 &&
      back.rolls === 2,
    "the resumed game has every roll, the same dice and the same holds",
  );
  check(
    phone.eval<number>(`() => document.querySelectorAll("#yt-dice .yt-die.held").length`) === 3,
    "the held dice still show as held",
  );
  leftAt = back.actions.length;
  phone.click("#yt-leave");
  await waitFor("yacht home", () => phone.visible("yt-home"));
  phone.click("#yt-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Yacht loads from the service worker and resumes. */
export async function yachtOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${YACHT}`);
  await waitFor("yacht offline", () => phone.visible("yt-home"));
  phone.click("#yt-resume");
  await waitFor("resumed offline", () => phone.visible("yt-game"));
  check(
    yt(phone).actions.length === leftAt && leftAt > 0,
    "offline: Yacht loads from the service worker and resumes",
  );
  phone.screenshot("yt-offline");
}

/**
 * Yacht between the two phones, from the menu and back to it: live holds, a
 * reload mid-turn, a whole game, a rematch that waits for both, and a second
 * visit that keeps the score. `a` is Ana (seat 0, amber) and `b` is Kai.
 */
export async function yachtOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];
  const onTurn = () => both[yt(a).turn]!;

  // Ana picks Yacht, so Ana rolls first.
  a.click(`#tiles a[data-id="${YACHT}"]`);
  await waitFor("both in Yacht", () => {
    const [sa, sb] = [yt(a), yt(b)];
    return sa.me === 0 && sb.me === 1 && sa.rematch !== null && sb.rematch !== null;
  });
  check(b.eval<string>("() => location.pathname") === `/${YACHT}`, "the friend's phone opens Yacht too");
  check(yt(a).hasSeed === false && yt(b).hasSeed === false, "the host keeps the seed: no phone gets it");
  check(yt(a).turn === 0 && !yt(a).locked && yt(b).locked, "the player who picked it rolls first");
  check(
    a.text("#yt-status") === "Your turn" && b.text("#yt-status") === "Ana is rolling",
    "the other phone waits",
  );
  check(
    yt(a).near === 0 &&
      yt(b).near === 1 &&
      b.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(2)") === "You" &&
      b.text("#yt-card > :nth-child(1) > .yt-cell:nth-of-type(3)") === "Ana",
    "each phone has its own column first, headed You",
  );

  // Out of turn, a tap rolls nothing.
  b.click("#yt-roll");
  await sleep(400);
  check(yt(a).actions.length === 0 && yt(b).actions.length === 0, "a roll out of turn does nothing");

  // Ana rolls: the host picks the dice, and both phones show them.
  await roll(a, both);
  check(
    yt(a).dice.join() === yt(b).dice.join() && yt(a).dice.every((d) => d >= 1 && d <= 6),
    "both phones show the dice the host rolled",
  );
  check(openRows(a) > 0 && openRows(b) === 0, "only the phone on turn may fill a box");

  // Ana holds two dice: Kai sees them lift.
  a.click(dieOf(0));
  a.click(dieOf(1));
  await waitFor("the holds on the friend's phone", () => yt(b).held === 0b11);
  check(
    b.eval<number>(`() => document.querySelectorAll("#yt-dice .yt-die.held").length`) === 2,
    "the friend sees the held dice live",
  );
  b.screenshot("yt-online");
  a.screenshot("online-yt-holding");
  await roll(a, both);
  check(
    both.every((p) => yt(p).rolls === 2 && yt(p).held === 0b11) && yt(a).dice.join() === yt(b).dice.join(),
    "the roll keeps the held dice on both phones",
  );

  // Ana's page reloads mid-turn: the same dice, still her turn.
  const mid = yt(a);
  a.open(`${origin}/${YACHT}`);
  await waitFor(
    "maker back in the game",
    () => yt(a).me === 0 && yt(a).actions.join() === mid.actions.join() && !yt(a).locked,
  );
  check(
    yt(a).dice.join() === mid.dice.join() && yt(a).rolls === 2 && yt(a).hasSeed === false,
    "after a reload the maker has the same dice, still on turn",
  );
  await score(a, yt(a).legal[0]!, both);
  await waitFor("your-turn toast", () =>
    b.eval<boolean>(`() => document.getElementById("yt-toast").classList.contains("on")`),
  );
  check(b.text("#yt-toast") === "Your turn", "the friend gets the your-turn alert");
  check(
    !yt(b).locked && yt(a).locked && a.text("#yt-status") === "Kai is rolling",
    "now Kai rolls and Ana waits",
  );

  // The rest of the game: each turn rolls once and fills the first open box.
  while (!yt(a).over) {
    const p = onTurn();
    await roll(p, both);
    await score(p, yt(p).legal[0]!, both);
  }
  await waitFor("game over", () => both.every((p) => yt(p).over && !yt(p).busy));
  const end = yt(a);
  const [x, y] = end.totals;
  const winner = x === y ? null : x > y ? 0 : 1;
  check(
    end.winner === winner && yt(b).totals.join() === end.totals.join(),
    `the higher total wins on both phones (${x} to ${y})`,
  );
  check(
    a.text("#yt-result-title") ===
      (winner === null ? "It's a tie!" : winner === 0 ? "You win!" : "Kai wins!") &&
      b.text("#yt-result-title") ===
        (winner === null ? "It's a tie!" : winner === 1 ? "You win!" : "Ana wins!"),
    "each phone names the winner its own way",
  );
  check(yt(a).wins.join() === yt(b).wins.join(), "both phones keep the same score");
  const wins = yt(a).wins.join();

  // A rematch waits for both players, then the other player goes first.
  b.click("#yt-again");
  await waitFor("rematch asked", () => a.text("#yt-note") === "Kai wants a rematch");
  check(
    b.text("#yt-again") === "Waiting for Ana" && disabled(b, "yt-again"),
    "the asker waits for the friend",
  );
  b.screenshot("online-yt-rematch-waiting");
  a.click("#yt-again");
  await waitFor("rematch", () =>
    both.every((p) => yt(p).actions.length === 0 && yt(p).first === 1 && !yt(p).over),
  );
  check(
    !yt(b).locked && yt(a).locked && yt(a).wins.join() === wins && yt(a).hasSeed === false,
    "the rematch swaps who goes first, and keeps the score",
  );

  // Ana leaves the game: both phones go back to the menu.
  a.click("#yt-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));

  // Kai opens Yacht again: a fresh card, his roll, and the score from before.
  b.click(`#tiles a[data-id="${YACHT}"]`);
  await waitFor("both in Yacht again", () =>
    both.every((p) => {
      const s = yt(p);
      return s.me !== null && s.rematch !== null && s.actions.length === 0 && s.first === 1;
    }),
  );
  check(
    yt(a).wins.join() === wins && yt(b).wins.join() === wins && !yt(b).locked,
    "opening Yacht again keeps the party's score",
  );
  check(
    yt(a).boxes.every((c) => c.length === BOXES && c.every((v) => v === null)),
    "the card is fresh",
  );
  b.click("#yt-leave");
  await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
}
