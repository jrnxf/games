// End-to-end: the arcade menu and a Connect Four game in headless Chrome at a
// phone viewport, driven by taps on the real buttons. Covers a win, the
// running score, a reload mid-game, the trip back to the menu, and playing
// offline. Run with `pnpm test:arcade` (builds first, serves with vite preview).

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
const phone = new Browser("arcade-e2e");

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
  console.log(`arcade e2e at ${ORIGIN} (screenshots in ${SHOTS})`);
  phone.open(`${ORIGIN}/`);
  check(phone.visible("arcade"), "the menu shows at /");
  check(phone.eval<number>(`() => document.querySelectorAll("#tiles .tile").length`) === 2, "two game tiles");
  check(phone.eval<string>("() => document.title") === "Pocket Arcade", "the page is called Pocket Arcade");
  phone.screenshot("arcade-menu");

  phone.click('#tiles a[href="/connect-four"]');
  await waitFor("connect four home", () => phone.visible("c4-home"));
  check(phone.eval<string>("() => location.pathname") === "/connect-four", "the URL is /connect-four");
  check(phone.eval<string>("() => document.body.dataset.game") === "connect-four", "the game's theme is on");
  phone.fill("#c4-name-0", "Zoe");
  phone.fill("#c4-name-1", "Kai");
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
  phone.click("#c4-home [data-arcade]");
  await waitFor("menu", () => phone.visible("arcade"));
  check(phone.eval<string>("() => location.pathname") === "/", "back at /");
  check(
    phone.eval<string | null>("() => document.body.dataset.game ?? null") === null,
    "the menu theme is back",
  );

  // Mini golf opens from the same menu, and the browser back button returns.
  phone.click('#tiles a[href="/mini-golf"]');
  await waitFor("golf home", () => phone.visible("home"));
  phone.run("await page.back();");
  await waitFor("menu after back", () => phone.visible("arcade"));
  check(true, "the back button leaves a game for the menu");

  // An unknown path falls back to the menu.
  phone.open(`${ORIGIN}/no-such-game`);
  check(
    phone.visible("arcade") && phone.eval<string>("() => location.pathname") === "/",
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
  console.log("arcade e2e passed");
} finally {
  phone.stop();
  server.kill();
}
