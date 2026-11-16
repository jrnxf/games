// End-to-end: the start screens, the game menu and Connect Four games in
// headless Chrome at a phone viewport, driven by taps on the real buttons.
// Covers picking how you play, games a mode can't run, a solo game against
// the computer (with a reload on its turn), a pass & play win, the running
// score, a reload mid-game, the trip back to the menu, and playing offline.
// The other board games play the same way from their own files (reversi.ts,
// dots-and-boxes.ts, mancala.ts).
// Run with `pnpm test:menu` (builds first, serves with vite preview).

import { execFileSync } from "node:child_process";
import { computerMove } from "../../src/games/connect-four/core/ai.ts";
import { canDrop, replay } from "../../src/games/connect-four/core/board.ts";
import { Browser, check, serverPort, SHOTS, startServer, VIEWPORT, waitFor } from "./browser.ts";
import { boxesOffline, boxesPassAndPlay, boxesSolo } from "./dots-and-boxes.ts";
import { mancalaOffline, mancalaPassAndPlay, mancalaSolo } from "./mancala.ts";
import { reversiOffline, reversiPassAndPlay, reversiSolo } from "./reversi.ts";

const PORT = await serverPort();
const ORIGIN = `http://127.0.0.1:${PORT}`;

interface C4State {
  moves: number[];
  starter: 0 | 1;
  turn: 0 | 1;
  winner: 0 | 1 | null;
  draw: boolean;
  col: number;
  busy: boolean;
  thinking: boolean;
  notes: { at: number; positions: number; ms: number; win: number | null }[];
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
}

execFileSync("pnpm", ["build"], { stdio: "inherit" });
const server = await startServer(
  "node_modules/.bin/vite",
  ["preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  /Local:/,
);
const phone = new Browser("games-e2e");

const c4 = () => phone.eval<C4State>("() => window.__connectFour.state()");

/** Aims with the arrow buttons and taps Drop, the way a thumb would. */
async function dropIn(col: number) {
  const before = c4().moves.length;
  while (c4().col < col) phone.click("#c4-right");
  while (c4().col > col) phone.click("#c4-left");
  phone.click("#c4-drop");
  await waitFor(`chip in column ${col}`, () => {
    const s = c4();
    return s.moves.length === before + 1 && !s.busy;
  });
}

/** Waits out the computer's turn: its chip has landed and the game is Zoe's again, or over. */
async function computerMoved() {
  await waitFor("the computer's move", () => {
    const s = c4();
    return !s.thinking && !s.busy && (s.turn === 0 || s.winner !== null || s.draw);
  });
}

try {
  console.log(`menu e2e at ${ORIGIN} (screenshots in ${SHOTS})`);
  phone.open(`${ORIGIN}/`);
  check(phone.visible("start-mode"), "a first visit asks how you're playing");
  check(!phone.visible("start-mode-back"), "the first time there is no way around it");
  check(phone.eval<string>("() => document.title") === "Games", "the page is called Games");
  phone.screenshot("start-mode");
  phone.click('[data-mode="solo"]');
  check(
    phone.visible("start-difficulty") && !phone.visible("start-field-1"),
    "solo asks one name and a level",
  );
  check(
    phone.eval<boolean>(`() => document.getElementById("start-go").disabled`),
    "Continue waits for a name",
  );
  phone.click('[data-difficulty="hard"]');
  check(
    phone.eval<string | null>(
      `() => document.querySelector('[data-difficulty="hard"]').getAttribute("aria-checked")`,
    ) === "true",
    "a tap picks the computer's level",
  );
  phone.fill("#start-name-0", "Zoe");
  phone.screenshot("start-solo");
  phone.click("#start-go");
  await waitFor("menu", () => phone.visible("games"));
  check(phone.eval<string>("() => location.pathname") === "/", "the menu is at /");
  check(phone.eval<number>(`() => document.querySelectorAll("#tiles .tile").length`) === 6, "six game tiles");
  check(phone.text("#menu-chip-text") === "Solo · Zoe", "the chip shows the session");
  check(
    phone.eval<number>(`() => document.querySelectorAll("#tiles .tile.off").length`) === 0 &&
      phone.text('#tiles a[href="/connect-four"] small') === "Solo · vs computer",
    "Connect Four plays solo, against the computer",
  );
  check(phone.text('#tiles a[href="/mini-golf"] small') === "Solo · just you", "Mini Golf plays solo");
  phone.screenshot("menu-solo");

  // The chip reopens the picker with the session ticked; back leaves it as it was.
  phone.click("#menu-chip");
  await waitFor("picker", () => phone.visible("start-mode"));
  check(
    phone.eval<boolean>(`() => document.querySelector('[data-mode="solo"]').classList.contains("sel")`),
    "the current mode is ticked",
  );
  phone.click("#start-mode-back");
  await waitFor("menu again", () => phone.visible("games"));
  check(phone.text("#menu-chip-text") === "Solo · Zoe", "back changes nothing");

  // Solo against the Hard computer: Zoe always takes the leftmost open column, and loses.
  phone.click('#tiles a[href="/connect-four"]');
  await waitFor("connect four home, solo", () => phone.visible("c4-home"));
  check(
    phone.text("#c4-name-0") === "Zoe" && phone.text("#c4-name-1") === "Computer",
    "solo is Zoe against the computer",
  );
  check(
    phone.text("#c4-sub-0") === "Red · goes first" && phone.text("#c4-sub-1") === "Yellow · Hard",
    "Zoe goes first, and the computer's card shows its level",
  );
  phone.screenshot("c4-home-solo");
  phone.click("#c4-start");
  await waitFor("solo board", () => phone.visible("c4-game"));
  check(c4().turn === 0 && !c4().thinking && c4().level === "hard", "Zoe starts against Hard");
  const boardTop = () =>
    phone.eval<number>(`() => document.getElementById("c4-board").getBoundingClientRect().top`);
  const top = boardTop();
  const lostLine = () =>
    phone.eval<string>(
      `() => { const el = document.getElementById("c4-lost"); return el.style.visibility === "hidden" ? "" : el.innerText; }`,
    );
  check(lostLine() === "", "no forced-win line at the start");
  // On a wide screen the line is wider than the board: it must not stretch it.
  phone.viewport("1280x720x1,mobile,touch");
  const shape = phone.eval<[number, number, number, string]>(`() => {
    const r = document.getElementById("c4-board").getBoundingClientRect();
    const hole = document.querySelector("#c4-board .c4-cell").getBoundingClientRect();
    return [r.width, hole.width * 7 + 20, innerWidth, document.querySelector(".screen.on")?.id];
  }`);
  check(
    shape[1] > 20 && Math.abs(shape[0] - shape[1]) < 2,
    `the board keeps its shape on a wide screen (${shape.join(", ")})`,
  );
  phone.viewport(VIEWPORT);

  // Drop, then check the thinking state inside the page in one go: the
  // computer waits only 500 ms, too short to span several browser calls.
  while (c4().col > 0) phone.click("#c4-left");
  const blocked = phone.eval<{
    thinking: boolean;
    still: boolean;
    wait: boolean;
    controls: boolean;
    label: string;
  }>(`async () => {
    const api = window.__connectFour;
    const shown = (id) => !document.getElementById(id).hidden;
    document.getElementById("c4-drop").click();
    const t0 = Date.now();
    while (!api.state().thinking && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 5));
    const before = api.state();
    document.querySelectorAll("#c4-board .c4-cell")[38].click();
    document.querySelectorAll("#c4-board .c4-cell")[39].click();
    dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const after = api.state();
    return {
      thinking: before.thinking && after.thinking,
      still: !after.busy && after.col === before.col && after.moves.length === before.moves.length,
      wait: shown("c4-wait"),
      controls: shown("c4-controls"),
      label: document.getElementById("c4-wait").innerText.trim(),
    };
  }`);
  check(blocked.thinking && blocked.still, "taps and keys do nothing while the computer is thinking");
  check(
    blocked.wait && !blocked.controls && blocked.label === "Computer is thinking",
    "the controls give way to “Computer is thinking”",
  );
  await computerMoved();
  check(c4().moves.length === 2 && c4().turn === 0, "the computer answers, then it is Zoe's turn");
  check(
    c4().notes.length === 1 && c4().notes[0]!.positions > 0 && c4().notes[0]!.at === 1,
    "the computer keeps the numbers behind its move",
  );
  phone.screenshot("c4-solo-turn");

  // Zoe's second chip, then a reload while the computer is still thinking.
  await dropIn(0);
  const pending = phone.eval<C4State | null>(`() => {
    const s = window.__connectFour.state();
    if (!s.thinking) return null;
    setTimeout(() => location.reload(), 0);
    return s;
  }`);
  check(pending, "the reload lands during the computer's turn");
  await waitFor("home after reload", () => phone.visible("c4-home"));
  check(phone.visible("c4-resume"), "a solo game in progress offers to resume");
  phone.click("#c4-resume");
  await waitFor("resumed solo", () => phone.visible("c4-game"));
  // The computer may already be dropping its chip by the time this looks.
  const resumed = c4();
  check(
    resumed.moves.join() === pending.moves.join() && resumed.turn === 1 && (resumed.thinking || resumed.busy),
    "the resumed game is on the computer's turn",
  );
  await computerMoved();
  const expected = computerMove(replay(pending.starter, pending.moves)!, "hard", pending.seed);
  check(
    c4().moves.length === pending.moves.length + 1 && c4().moves.at(-1) === expected,
    "after the resume, the computer plays the column its seed picked",
  );

  let lostSeen = "";
  for (let s = c4(); s.winner === null && !s.draw; s = c4()) {
    const b = replay(s.starter, s.moves)!;
    await dropIn([0, 1, 2, 3, 4, 5, 6].find((c) => canDrop(b, c))!);
    await computerMoved();
    if (!lostSeen && c4().winner === null && lostLine()) {
      lostSeen = lostLine();
      check(boardTop() === top, "the forced-win line takes no room from the board");
      phone.screenshot("c4-solo-lost-line");
    }
  }
  check(
    /^I can win in \d more moves?, no matter what you play\.$/.test(lostSeen),
    `once it has a forced win, the line under the board says so (${lostSeen})`,
  );
  const lost = c4();
  check(lost.winner === 1 && lost.wins.join() === "0,1", "Hard beats a player who never looks");
  check(phone.text("#c4-result-title") === "Computer wins!", "the result names the computer");
  check(
    phone.visible("c4-recap") &&
      phone.visible("c4-watch") &&
      phone.text("#c4-stats").includes("Positions checked"),
    "the recap counts the computer's search and offers to watch the ending",
  );
  phone.screenshot("c4-solo-recap");
  phone.click("#c4-watch");
  await waitFor("ending replayed", () =>
    phone.eval<boolean>(`() => !document.getElementById("c4-result").classList.contains("away")`),
  );
  check(
    phone.eval<number>(`() => document.querySelectorAll("#c4-board .c4-disc").length`) === lost.moves.length,
    "the replay ends on the real final board",
  );
  check(
    phone.text("#c4-pl-0 .c4-wins") === "0" && phone.text("#c4-pl-1 .c4-wins") === "1",
    "the score reads Zoe 0, Computer 1",
  );
  phone.screenshot("c4-solo-lost");

  // The rematch: the computer goes first this time and moves on its own.
  phone.click("#c4-again");
  await waitFor("solo rematch", () => c4().starter === 1);
  await computerMoved();
  check(c4().moves.length === 1 && c4().turn === 0, "the computer opens the rematch");
  check(!c4().notes.some((n) => n.at > 0), "the rematch starts a fresh recap");
  phone.click("#c4-leave");
  await waitFor("c4 home", () => phone.visible("c4-home"));
  check(phone.visible("c4-resume"), "the rematch can be resumed");
  phone.click("#c4-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));

  await reversiSolo(phone);
  await boxesSolo(phone);
  await mancalaSolo(phone);

  // Switch to pass & play: the last name is already filled in.
  phone.click("#menu-chip");
  phone.click('[data-mode="pass-and-play"]');
  check(
    phone.eval<string>(`() => document.getElementById("start-name-0").value`) === "Zoe",
    "the picker remembers the last name",
  );
  phone.click("#start-names-back");
  await phone.pickSession("pass-and-play", ["Zoe", "Kai"]);
  await waitFor("menu", () => phone.visible("games"));
  check(phone.text("#menu-chip-text") === "Pass & play · Zoe & Kai", "the chip shows both players");
  check(
    phone.eval<number>(`() => document.querySelectorAll("#tiles .tile.off").length`) === 0,
    "every game plays",
  );
  phone.screenshot("menu");

  phone.click('#tiles a[href="/connect-four"]');
  await waitFor("connect four home", () => phone.visible("c4-home"));
  check(phone.eval<string>("() => location.pathname") === "/connect-four", "the URL is /connect-four");
  check(phone.eval<string>("() => document.body.dataset.game") === "connect-four", "the game's theme is on");
  check(
    phone.text("#c4-name-0") === "Zoe" && phone.text("#c4-name-1") === "Kai",
    "Connect Four takes the names from the session",
  );
  check(!phone.visible("c4-resume"), "the solo game is saved apart from pass & play");
  phone.click("#c4-start");
  await waitFor("board", () => phone.visible("c4-game"));
  check(c4().col === 3 && c4().turn === 0, "red starts, aimed at the middle column");
  phone.screenshot("c4-start");

  // Zoe stacks column 3, Kai answers in column 4: Zoe wins upward on her fourth chip.
  for (const col of [3, 4, 3, 4, 3, 4]) await dropIn(col);
  check(phone.text("#c4-pl-1 .c4-sub") === "", "only the player on turn says so");
  phone.screenshot("c4-midgame");

  // A reload mid-game keeps the board.
  phone.open(`${ORIGIN}/connect-four`);
  await waitFor("home after reload", () => phone.visible("c4-home"));
  check(phone.visible("c4-resume"), "a game in progress offers to resume");
  phone.click("#c4-resume");
  await waitFor("resumed", () => phone.visible("c4-game"));
  check(c4().moves.join() === "3,4,3,4,3,4", "the resumed board has every chip");

  await dropIn(3);
  const won = c4();
  check(won.winner === 0 && won.wins[0] === 1, "four in a column wins for red");
  check(phone.text("#c4-result-title") === "Zoe wins!", "the result names the winner");
  check(!phone.visible("c4-controls") && phone.visible("c4-result"), "Play again replaces the controls");
  check(
    phone.eval<number>(`() => document.querySelectorAll("#c4-board .c4-disc.win").length`) === 4,
    "the four winning chips are marked",
  );
  phone.screenshot("c4-win");

  phone.click("#c4-again");
  await waitFor("rematch", () => c4().moves.length === 0 && c4().winner === null);
  check(c4().turn === 1, "the player who went second starts the rematch");
  check(
    phone.text("#c4-pl-0 .c4-wins") === "1" && phone.text("#c4-pl-1 .c4-wins") === "0",
    "the score shows 1-0",
  );

  // A full column cannot take another chip.
  for (let i = 0; i < 6; i++) await dropIn(0);
  check(
    phone.eval<boolean>(`() => document.getElementById("c4-drop").disabled`),
    "Drop is off over a full column",
  );

  // Back to the menu and its theme.
  phone.click("#c4-leave");
  await waitFor("c4 home", () => phone.visible("c4-home"));
  phone.click("#c4-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
  check(phone.eval<string>("() => location.pathname") === "/", "back at /");
  check(
    phone.eval<string | null>("() => document.body.dataset.game ?? null") === null,
    "the menu theme is back",
  );

  await reversiPassAndPlay(phone, ORIGIN);
  await boxesPassAndPlay(phone, ORIGIN);
  await mancalaPassAndPlay(phone, ORIGIN);

  // Mini golf opens from the same menu, and the browser back button returns.
  phone.click('#tiles a[href="/mini-golf"]');
  await waitFor("golf home", () => phone.visible("home"));
  phone.run("await page.back();");
  await waitFor("menu after back", () => phone.visible("games"));
  check(true, "the back button leaves a game for the menu");

  // Online with no party yet asks for one first, even from a game's link.
  // The party itself needs the worker: `pnpm test:online` plays it through.
  phone.click("#menu-chip");
  await phone.pickSession("online", ["Zoe"]);
  await waitFor("party step", () => phone.visible("start-party"));
  phone.open(`${ORIGIN}/connect-four`);
  await waitFor("party step from a link", () => phone.visible("start-party"));
  check(!phone.visible("c4-home"), "online, a game link waits for a party");
  phone.fill("#party-input", "abc");
  phone.click('#party-form button[type="submit"]');
  check(phone.text("#party-note") === "Party codes are 5 letters and numbers.", "a short code is refused");
  phone.click("#start-party-back");
  await waitFor("names", () => phone.visible("start-names"));
  phone.click("#start-names-back");
  await waitFor("mode picker", () => phone.visible("start-mode"));
  phone.click('[data-mode="pass-and-play"]');
  await waitFor("names screen", () => phone.visible("start-names"));
  phone.fill("#start-name-0", "Zoe");
  phone.fill("#start-name-1", "Kai");
  phone.click("#start-go");
  await waitFor("menu", () => phone.visible("games"));

  // An unknown path falls back to the menu.
  phone.open(`${ORIGIN}/no-such-game`);
  check(
    phone.visible("games") && phone.eval<string>("() => location.pathname") === "/",
    "unknown paths show the menu",
  );
  check(phone.consoleErrors().includes("<no console messages found>"), "no console errors");

  // Installed-app check: offline, Connect Four still loads and resumes.
  await waitFor("service worker", () => phone.eval<boolean>("() => !!navigator.serviceWorker.controller"));
  phone.openOffline(`${ORIGIN}/connect-four`);
  await waitFor("c4 offline", () => phone.visible("c4-home"));
  phone.click("#c4-resume");
  await waitFor("resumed offline", () => phone.visible("c4-game"));
  check(c4().moves.length === 6, "offline: Connect Four loads from the service worker and resumes");
  phone.screenshot("c4-offline");
  await reversiOffline(phone, ORIGIN);
  await boxesOffline(phone, ORIGIN);
  await mancalaOffline(phone, ORIGIN);
  console.log("menu e2e passed");
} finally {
  phone.stop();
  server.kill();
}
