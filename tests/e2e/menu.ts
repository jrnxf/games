// End-to-end: the start screens, the game menu and a Connect Four game in
// headless Chrome at a phone viewport, driven by taps on the real buttons.
// Covers picking how you play, games a mode can't run, a win, the running
// score, a reload mid-game, the trip back to the menu, and playing offline.
// Run with `pnpm test:menu` (builds first, serves with vite preview).

import { execFileSync } from "node:child_process";
import { Browser, SHOTS, check, startServer, waitFor } from "./browser.ts";

const PORT = Number(process.env.E2E_PORT ?? 4321);
const ORIGIN = `http://127.0.0.1:${PORT}`;

interface C4State {
  moves: number[];
  turn: 0 | 1;
  winner: 0 | 1 | null;
  draw: boolean;
  col: number;
  busy: boolean;
  wins: [number, number];
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
  check(phone.eval<number>(`() => document.querySelectorAll("#tiles .tile").length`) === 2, "two game tiles");
  check(phone.text("#menu-chip-text") === "Solo · Zoe", "the chip shows the session");
  check(
    phone.eval<boolean>(
      `() => document.querySelector('#tiles a[href="/connect-four"]').classList.contains("off")`,
    ) && phone.text('#tiles a[href="/connect-four"] small') === "Needs two players",
    "Connect Four is dimmed in solo, with the reason",
  );
  check(phone.text('#tiles a[href="/mini-golf"] small') === "Solo · just you", "Mini Golf plays solo");
  phone.screenshot("menu-solo");
  phone.click('#tiles a[href="/connect-four"]');
  check(phone.visible("games"), "a dimmed tile does not open");

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
    "both games play",
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

  // Mini golf opens from the same menu, and the browser back button returns.
  phone.click('#tiles a[href="/mini-golf"]');
  await waitFor("golf home", () => phone.visible("home"));
  phone.run("await page.back();");
  await waitFor("menu after back", () => phone.visible("games"));
  check(true, "the back button leaves a game for the menu");

  // An online session dims Connect Four, and its link goes back to the menu.
  phone.click("#menu-chip");
  await phone.pickSession("online", ["Zoe"]);
  await waitFor("menu", () => phone.visible("games"));
  check(phone.text('#tiles a[href="/connect-four"] small') === "Not online yet", "online dims Connect Four");
  phone.open(`${ORIGIN}/connect-four`);
  await waitFor("menu toast", () =>
    phone.eval<boolean>(`() => document.getElementById("menu-toast").classList.contains("on")`),
  );
  check(
    phone.visible("games") && phone.text("#menu-toast") === "Connect Four: not online yet",
    "a link to a game the mode can't play shows the menu and says why",
  );
  phone.screenshot("menu-online-toast");
  phone.click("#menu-chip");
  await phone.pickSession("pass-and-play", ["Zoe", "Kai"]);
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
  console.log("menu e2e passed");
} finally {
  phone.stop();
  server.kill();
}
