// Sea Battle's part of the end-to-end suites, driven by taps on the real
// grids. `pnpm test:menu` plays it solo against the Hard computer (a fleet
// placed with a drag, a tap and the buttons, a reload on the computer's turn)
// and pass & play (the "Pass to" card between turns, a whole game, a reload
// and a rematch), and `pnpm test:online` plays it between two phones: both
// place a fleet, one phone never holds the other's ships, a live aim, a
// reload, a result and a rematch.

import { rng, think } from "../../src/games/sea-battle/core/ai.ts";
import {
  CELLS,
  cellsOf,
  placed,
  randomFleet,
  replay,
  turned,
  validFleet,
  type Fleet,
  type Seat,
  type Shot,
  type Sight,
} from "../../src/games/sea-battle/core/board.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const SEA = "sea-battle";

/** What Sea Battle's test hook reports. */
interface SeaState {
  screen: string | null;
  placing: Seat;
  draft: Fleet;
  picked: number;
  shots: number[];
  starter: Seat;
  turn: Seat;
  over: boolean;
  winner: Seat | null;
  last: Shot | null;
  fleets: [Fleet, Fleet];
  seen: [Sight, Sight];
  view: Seat;
  aim: number | null;
  resting: boolean;
  thinking: boolean;
  canAim: boolean;
  wins: [number, number];
  seed: number;
  level: "easy" | "medium" | "hard" | null;
  notes: { at: number; placements: number; ms: number }[];
  me: Seat | null;
  placed: [boolean, boolean] | null;
  rematch: [boolean, boolean] | null;
  foeAim: number | null;
  pending: number | null;
}

const sea = (p: Browser) => p.eval<SeaState>("() => window.__sea.state()");
// The 100 cells sit in each grid in row order.
const cellOf = (cell: number) => `#sb-sea .sb-cell:nth-child(${cell + 1})`;
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("sb-toast").classList.contains("on")`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decks = (fleet: Fleet) => fleet.flatMap(cellsOf);
/** The open water of `fleet`: every shot there is a miss. */
const water = (fleet: Fleet) => {
  const ships = new Set(decks(fleet));
  return Array.from({ length: CELLS }, (_, cell) => cell).filter((cell) => !ships.has(cell));
};

/** Aims `p` at `cell` and fires, then waits until every phone has the shot. */
async function fire(p: Browser, cell: number, phones: Browser[] = [p]) {
  const s = await waitFor("a turn to fire", () => {
    const now = sea(p);
    return now.canAim ? now : null;
  });
  const n = s.shots.length;
  // A tap on the aimed cell would fire: tap only to move the aim, then fire with the button.
  if (s.aim !== cell) {
    p.click(cellOf(cell));
    await waitFor("the aim", () => sea(p).aim === cell);
  }
  p.click("#sb-fire");
  await waitFor("the shot on every phone", () => phones.every((q) => sea(q).shots.length === n + 1));
}

/** How many cells of grid `id` have the class `cls`. */
const count = (p: Browser, id: string, cls: string) =>
  p.eval<number>(`() => document.querySelectorAll("#${id} .sb-cell.${cls}").length`);

/** How many of `seat`'s ships its card shows as lost. */
const lost = (p: Browser, seat: Seat) =>
  p.eval<number>(`() => document.querySelectorAll("#sb-pl-${seat} .sb-fleet .lost").length`);

/**
 * A finger on the placement grid: down in the middle of cell `from`, across
 * to cell `to`, and up. With no `to` it is a tap, and with `hold` the finger
 * stays down.
 */
function finger(p: Browser, from: number, to: number | null, hold = false) {
  p.run(`await page.eval(async () => {
    const yard = document.getElementById("sb-yard");
    const mid = (cell) => {
      const r = yard.children[cell].getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    const send = (type, [x, y]) => yard.dispatchEvent(new PointerEvent(type, {
      pointerId: 12, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }));
    const a = mid(${from});
    const b = ${to === null ? "a" : `mid(${to})`};
    send("pointerdown", a);
    for (let i = 1; i <= ${to === null ? 0 : 8}; i++) {
      send("pointermove", [a[0] + ((b[0] - a[0]) * i) / 8, a[1] + ((b[1] - a[1]) * i) / 8]);
      await new Promise((res) => setTimeout(res, 16));
    }
    ${hold ? "" : 'send("pointerup", b);'}
  });`);
}

/** Lifts a finger that `finger` held down. */
function lift(p: Browser) {
  p.run(`await page.eval(() => {
    document.getElementById("sb-yard").dispatchEvent(new PointerEvent("pointerup", { pointerId: 12, pointerType: "touch", isPrimary: true, bubbles: true }));
  });`);
}

/**
 * The screen `screen` fits a phone of `size`: no sideways scroll, buttons a
 * thumb can hit, the dock in view, and cells of at least `min` px. A phone on
 * its side fits two grids in 390 px of height, so it passes a lower `min`.
 */
function fits(p: Browser, size: string, screen: string, name: string, min = 30) {
  p.viewport(size);
  const m = p.eval<{
    cell: number;
    button: number;
    scroll: number;
    width: number;
    bottom: number;
    height: number;
  }>(
    `() => {
    const on = document.getElementById(${JSON.stringify(screen)});
    const buttons = [...on.querySelectorAll(".sb-dock .btn")].filter((el) => el.getClientRects().length > 0);
    return {
      cell: on.querySelector(".sb-play .sb-cell").getBoundingClientRect().width,
      button: Math.min(...buttons.map((el) => el.getBoundingClientRect().height)),
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
      bottom: on.querySelector(".sb-dock").getBoundingClientRect().bottom,
      height: innerHeight,
    };
  }`,
  );
  check(
    m.cell >= min && m.button >= 44 && m.scroll <= m.width && m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} ${name} fits: ${m.cell.toFixed(1)} px cells, ${m.button.toFixed(0)} px buttons, no sideways scroll`,
  );
  p.screenshot(name);
}

/**
 * Whether the viewer's fleet sits level with the other's water, to its right
 * and the same size (true), or under it and smaller (false).
 */
function fleetBeside(p: Browser): boolean | null {
  return p.eval<boolean | null>(`() => {
    const sea = document.getElementById("sb-sea").getBoundingClientRect();
    const own = document.getElementById("sb-own").getBoundingClientRect();
    if (Math.abs(own.top - sea.top) < 2 && own.left > sea.right && Math.abs(own.width - sea.width) < 6) return true;
    if (own.top > sea.bottom && own.width < sea.width) return false;
    return null;
  }`);
}

/** Takes the phone from the "Pass to" card: taps "I'm ready" and waits for the screen behind it. */
async function hand(p: Browser, to: string, sub: string, next = "sb-game") {
  await waitFor("the pass card", () => sea(p).screen === "sb-pass");
  check(
    p.text("#sb-pass-title") === `Pass to ${to}` && p.text("#sb-pass-sub") === sub,
    `the card says “Pass to ${to}” and “${sub}”`,
  );
  p.click("#sb-ready");
  await waitFor("the screen behind the card", () => sea(p).screen === next);
}

/**
 * Fires at `cells`, turn about, with taps made inside the page: "I'm ready"
 * on each "Pass to" card, then the aim, then "Fire". The last shot's card may
 * still be on its way when this returns.
 */
function volley(p: Browser, cells: number[]) {
  for (let i = 0; i < cells.length; i += 8) {
    const before = sea(p).shots.length;
    const part = cells.slice(i, i + 8);
    p.run(`await page.eval(async () => {
      const api = window.__sea;
      const sea = document.querySelectorAll("#sb-sea .sb-cell");
      for (const cell of ${JSON.stringify(part)}) {
        const t0 = Date.now();
        while (!api.state().canAim && Date.now() - t0 < 6000) {
          if (api.state().screen === "sb-pass") document.getElementById("sb-ready").click();
          await new Promise((r) => setTimeout(r, 10));
        }
        sea[cell].click();
        document.getElementById("sb-fire").click();
      }
    });`);
    check(
      sea(p).shots.slice(before).join() === part.join(),
      `${part.length} more shots, each after its “Pass to” card`,
    );
  }
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function seaSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${SEA}"] small`) === "Solo · vs computer",
    "Sea Battle plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${SEA}"]`);
  await waitFor("sea battle home, solo", () => phone.visible("sb-home"));
  check(
    phone.text("#sb-name-0") === "Zoe" && phone.text("#sb-name-1") === "Computer",
    "solo Sea Battle is Zoe against the computer",
  );
  check(
    phone.text("#sb-sub-0") === "Yellow · fires first" && phone.text("#sb-sub-1") === "Violet · Hard",
    "Zoe fires first, and the computer's card shows its level",
  );
  phone.screenshot("sb-home-solo");

  // First the fleet: a random layout that is always legal.
  phone.click("#sb-start");
  await waitFor("placement", () => sea(phone).screen === "sb-place");
  const dealt = sea(phone).draft;
  check(
    phone.text("#sb-place-title") === "Place your fleet" && phone.text("#sb-done") === "Start the battle",
    "solo asks for one fleet, then the battle starts",
  );
  check(validFleet(dealt) && count(phone, "sb-yard", "ship") === 17, "the fleet starts as a legal layout");
  phone.click("#sb-random");
  let draft = sea(phone).draft;
  check(
    validFleet(draft) && JSON.stringify(draft) !== JSON.stringify(dealt),
    "“Random” deals another legal layout",
  );

  // A drag moves the Skiff to the first free place, by the cell the finger holds.
  const skiff = draft[4]!;
  const free = Array.from({ length: CELLS }, (_, cell) => cell).find(
    (cell) => cell !== skiff.cell && placed(draft, 4, { ...skiff, cell }) !== null,
  )!;
  finger(phone, skiff.cell, free, true);
  check(
    count(phone, "sb-yard", "ghost") === 2 && count(phone, "sb-yard", "lifted") === 2,
    "a dragged ship shows where it would land",
  );
  phone.screenshot("sb-place-drag");
  lift(phone);
  draft = placed(draft, 4, { ...skiff, cell: free })!;
  check(JSON.stringify(sea(phone).draft) === JSON.stringify(draft), "letting go puts the ship there");

  // Onto another ship, the drag is refused.
  finger(phone, free, draft[0]!.cell);
  check(
    JSON.stringify(sea(phone).draft) === JSON.stringify(draft) &&
      phone.text("#sb-hint") === "Ships can't overlap.",
    "a ship can't land on another ship",
  );

  // A tap turns a ship, and "Turn ship" turns the last ship touched.
  finger(phone, draft[1]!.cell, null);
  draft = turned(draft, 1)!;
  check(
    JSON.stringify(sea(phone).draft) === JSON.stringify(draft) && sea(phone).picked === 1,
    "a tap turns the ship",
  );
  check(
    count(phone, "sb-yard", "picked") === 4 &&
      phone.text("#sb-hint") === "Drag a ship to move it. Tap it to turn it.",
    "the last ship touched is marked",
  );
  phone.click("#sb-turn");
  draft = turned(draft, 1)!;
  check(JSON.stringify(sea(phone).draft) === JSON.stringify(draft), "“Turn ship” turns the marked ship");
  check(validFleet(draft), "the layout is still legal");
  phone.screenshot("sb-place");
  fits(phone, "360x740x2,mobile,touch", "sb-place", "sb-place-360");
  fits(phone, "820x1180x2,mobile,touch", "sb-place", "sb-place-tablet");
  phone.viewport(VIEWPORT);

  phone.click("#sb-done");
  await waitFor("solo battle", () => sea(phone).screen === "sb-game");
  const start = sea(phone);
  check(start.turn === 0 && start.canAim && start.level === "hard", "Zoe fires first against Hard");
  check(JSON.stringify(start.fleets[0]) === JSON.stringify(draft), "Zoe's fleet is the one she placed");
  const foe = start.fleets[1];
  check(
    JSON.stringify(foe) === JSON.stringify(randomFleet(rng(start.seed))),
    "the computer's fleet comes from the game's seed",
  );
  check(
    count(phone, "sb-sea", "ship") === 0 && count(phone, "sb-own", "ship") === 17,
    "the big grid hides the computer's ships, and the small one shows Zoe's",
  );
  check(
    phone.text("#sb-status-text") === "Your turn · tap a cell to aim" &&
      phone.text("#sb-own-title") === "Your fleet" &&
      phone.eval<boolean>(`() => document.getElementById("sb-fire").disabled`),
    "“Fire” waits for an aim",
  );
  phone.screenshot("sb-solo-start");

  // A tap only aims, and a second tap moves the aim.
  const open = water(foe);
  const target = cellsOf(foe[4]!);
  phone.click(cellOf(open[0]!));
  check(sea(phone).aim === open[0] && sea(phone).shots.length === 0, "a tap aims, and fires nothing");
  phone.click(cellOf(target[0]!));
  check(
    sea(phone).aim === target[0] &&
      count(phone, "sb-sea", "aim") === 1 &&
      !phone.eval<boolean>(`() => document.getElementById("sb-fire").disabled`),
    "a second tap moves the aim",
  );
  phone.screenshot("sb-solo-aim");

  // Fire, then check the thinking state inside the page in one go: the
  // computer waits only 700 ms, too short to span several browser calls.
  const blocked = phone.eval<{
    thinking: boolean;
    still: boolean;
    label: string;
    dots: boolean;
    hit: boolean;
  }>(
    `() => {
    const api = window.__sea;
    const cells = document.querySelectorAll("#sb-sea .sb-cell");
    document.getElementById("sb-fire").click();
    const before = api.state();
    cells[${open[0]}].click();
    document.getElementById("sb-fire").click();
    const after = api.state();
    return {
      thinking: before.thinking && after.thinking,
      still: before.shots.length === 1 && after.shots.length === 1 && after.aim === null,
      label: document.getElementById("sb-status-text").textContent,
      dots: !document.getElementById("sb-dots").hidden,
      hit: cells[${target[0]}].classList.contains("hit"),
    };
  }`,
  );
  check(blocked.hit && blocked.label === "Hit!", "a shot on a ship is a hit, and the status says so");
  check(blocked.thinking && blocked.still && blocked.dots, "taps do nothing while the computer is thinking");
  await waitFor("the computer's shot", () => sea(phone).shots.length === 2 && sea(phone).canAim);
  const answered = sea(phone);
  check(
    /^Computer (missed|hit your \w+) · your turn$/.test(phone.text("#sb-status-text")),
    `the status says what the computer's shot did (${phone.text("#sb-status-text")})`,
  );
  check(
    answered.notes.length === 1 && answered.notes[0]!.at === 1 && answered.notes[0]!.placements > 0,
    "the computer keeps a note on its shot",
  );
  check(
    count(phone, "sb-own", "last") === 1 &&
      count(phone, "sb-own", "hit") + count(phone, "sb-own", "miss") === 1,
    "the small grid shows where the computer's shot fell",
  );

  // The Skiff's second cell sinks it: a second tap on the aimed cell fires, with no "Fire".
  phone.click(cellOf(target[1]!));
  check(sea(phone).aim === target[1] && sea(phone).shots.length === 2, "the first tap only aims");
  const sank = phone.eval<string>(`() => {
    document.querySelectorAll("#sb-sea .sb-cell")[${target[1]}].click();
    return document.getElementById("sb-status-text").textContent;
  }`);
  check(
    sank === "You sank a Skiff!",
    "a second tap on the aimed cell fires, and the last hit on a ship sinks it",
  );
  await waitFor("the computer's second shot", () => sea(phone).shots.length === 4 && sea(phone).canAim);
  check(
    sea(phone).seen[0].sunk.length === 1 && count(phone, "sb-sea", "sunk") === 2 && lost(phone, 1) === 1,
    "the sunk ship shows on the grid, and the computer's card loses a ship",
  );
  phone.screenshot("sb-solo-sunk");
  fits(phone, "360x740x2,mobile,touch", "sb-game", "sb-solo-360");
  check(fleetBeside(phone) === false, "on an upright phone the fleet sits under the other's water");
  fits(phone, "820x1180x2,mobile,touch", "sb-game", "sb-solo-tablet");
  check(fleetBeside(phone) === true, "on a wide screen the fleet sits beside the other's water, as big");
  fits(phone, "844x390x2,mobile,touch", "sb-game", "sb-solo-landscape", 24);
  check(fleetBeside(phone) === true, "on a phone on its side the fleet sits beside the other's water");
  phone.viewport(VIEWPORT);
  check(fleetBeside(phone) === false, "back upright, the fleet goes back under the other's water");

  // Zoe misses, then the page reloads while the computer is still thinking.
  phone.click(cellOf(open[0]!));
  const pending = phone.eval<SeaState | null>(`() => {
    document.getElementById("sb-fire").click();
    const s = window.__sea.state();
    if (!s.thinking) return null;
    setTimeout(() => location.reload(), 0);
    return s;
  }`);
  check(pending, "the reload lands during the computer's turn");
  check(pending.last?.hit === false, "a shot on open water is a miss");
  await waitFor("home after reload", () => phone.visible("sb-home"));
  check(phone.visible("sb-resume"), "a solo game in progress offers to resume");
  phone.click("#sb-resume");
  await waitFor("resumed solo", () => sea(phone).screen === "sb-game");
  // The computer may already have fired by the time this looks.
  const resumed = sea(phone);
  check(
    resumed.shots.slice(0, pending.shots.length).join() === pending.shots.join() &&
      JSON.stringify(resumed.fleets) === JSON.stringify(pending.fleets) &&
      (resumed.thinking || resumed.shots.length > pending.shots.length),
    "the resumed game has both fleets and every shot, on the computer's turn",
  );
  await waitFor("the computer's shot after the resume", () => sea(phone).shots.length > pending.shots.length);
  const expected = think(
    replay(pending.starter, pending.fleets, pending.shots)!.seen[1],
    "hard",
    pending.seed,
  ).cell;
  check(
    sea(phone).shots[pending.shots.length] === expected,
    "after the resume, the computer fires at the cell its seed picked",
  );

  // Zoe fires at open water until the computer has sunk her fleet. The taps
  // run inside the page, a few seconds at a time.
  await waitFor(
    "the end of the solo game",
    () =>
      phone.eval<boolean>(`async () => {
        const api = window.__sea;
        const cells = document.querySelectorAll("#sb-sea .sb-cell");
        const open = ${JSON.stringify(open)};
        const t0 = Date.now();
        while (!api.state().over && Date.now() - t0 < 8000) {
          const s = api.state();
          if (s.canAim) {
            cells[open.find((cell) => s.seen[0].marks[cell] === null)].click();
            document.getElementById("sb-fire").click();
          } else await new Promise((r) => setTimeout(r, 20));
        }
        return api.state().over;
      }`),
    240_000,
  );
  const beaten = sea(phone);
  const fired = beaten.shots.filter((_, i) => i % 2 === 1).length;
  check(beaten.winner === 1 && beaten.wins.join() === "0,1", "Hard beats a player who fires at open water");
  check(phone.text("#sb-result-title") === "Computer wins!", "the result names the computer");
  const why = phone.text("#sb-why");
  check(why === `Sank all five ships in ${fired} shots.`, `one line says why (${why})`);
  check(fired < 100, `Hard needs ${fired} shots, not the whole grid`);
  const stats = phone.text("#sb-stats");
  check(
    stats.includes("Your hits2 of ") &&
      stats.includes(`Computer's hits17 of ${fired}`) &&
      stats.includes("Time thinking"),
    "the recap counts both players' hits",
  );
  check(
    phone.text("#sb-tally") === "0–1" && phone.text("#sb-pl-1 .sb-sub") === "Winner",
    "the score reads Zoe 0, Computer 1",
  );
  check(!phone.visible("sb-deck") && phone.visible("sb-result"), "the result replaces the small grid");
  check(
    count(phone, "sb-sea", "ship") === 17 && count(phone, "sb-sea", "sunk") === 2 && lost(phone, 0) === 5,
    "once the game is over the ships that stayed afloat show",
  );
  phone.screenshot("sb-solo-lost");
  fits(phone, "360x740x2,mobile,touch", "sb-game", "sb-solo-lost-360");
  phone.viewport(VIEWPORT);

  // The rematch: a new fleet, then the computer fires first on its own.
  phone.click("#sb-again");
  await waitFor("placement for the rematch", () => sea(phone).screen === "sb-place");
  phone.click("#sb-done");
  await waitFor("the computer's opening shot", () => sea(phone).shots.length === 1 && sea(phone).canAim);
  const opened = sea(phone);
  check(opened.starter === 1 && opened.turn === 0, "the computer opens the rematch");
  check(opened.notes.length === 1 && opened.notes[0]!.at === 0, "the rematch starts a fresh recap");
  phone.click("#sb-leave");
  await waitFor("sea battle home", () => phone.visible("sb-home"));
  check(phone.visible("sb-resume"), "the rematch can be resumed");
  phone.click("#sb-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: two fleets placed behind the
 * "Pass to" card, a whole game that Zoe wins, a reload, and a rematch left
 * after two shots. The session is Zoe and Kai.
 */
export async function seaPassAndPlay(phone: Browser, origin: string) {
  phone.click(`#tiles a[href="/${SEA}"]`);
  await waitFor("sea battle home", () => phone.visible("sb-home"));
  check(phone.eval<string>("() => location.pathname") === `/${SEA}`, "the URL is /sea-battle");
  check(phone.eval<string>("() => document.body.dataset.game") === SEA, "Sea Battle's theme is on");
  check(
    phone.text("#sb-name-0") === "Zoe" && phone.text("#sb-name-1") === "Kai",
    "Sea Battle takes the names from the session",
  );
  check(
    phone.text("#sb-sub-0") === "Yellow · fires first" && phone.text("#sb-sub-1") === "Violet",
    "yellow fires first",
  );
  check(!phone.visible("sb-resume"), "the solo Sea Battle game is saved apart from pass & play");
  phone.screenshot("sb-home");

  // Kai fires second, so Kai places first: the battle then starts in Zoe's hands.
  phone.click("#sb-start");
  await waitFor("placement", () => sea(phone).screen === "sb-place");
  check(
    sea(phone).placing === 1 &&
      phone.text("#sb-place-title") === "Kai, place your fleet" &&
      phone.text("#sb-done") === "Ready",
    "the player who fires second places a fleet first",
  );
  const fleetK = sea(phone).draft;
  phone.screenshot("sb-place-kai");
  phone.click("#sb-done");
  await waitFor("the pass card", () => sea(phone).screen === "sb-pass");
  check(
    !phone.visible("sb-place") && !phone.visible("sb-game"),
    "the card covers the screen: Kai's fleet is out of sight",
  );
  phone.screenshot("sb-pass-place");
  await hand(phone, "Zoe", "Place your fleet.", "sb-place");
  const fleetZ = sea(phone).draft;
  check(
    sea(phone).placing === 0 &&
      phone.text("#sb-place-title") === "Zoe, place your fleet" &&
      phone.text("#sb-done") === "Start the battle",
    "then Zoe places hers",
  );
  check(JSON.stringify(fleetZ) !== JSON.stringify(fleetK), "Zoe starts from a layout of her own");
  phone.click("#sb-done");
  await waitFor("battle", () => sea(phone).screen === "sb-game");
  const start = sea(phone);
  check(
    start.turn === 0 && start.view === 0 && start.canAim && phone.text("#sb-own-title") === "Zoe's fleet",
    "Zoe fires first, with her own fleet in view",
  );
  check(
    JSON.stringify(start.fleets) === JSON.stringify([fleetZ, fleetK]),
    "each player's fleet is the one they placed",
  );
  check(
    count(phone, "sb-sea", "ship") === 0 && count(phone, "sb-own", "ship") === 17,
    "the big grid hides Kai's ships",
  );

  // Zoe hits Kai's Flagship. The result stays up a moment, then the card covers the screen.
  const hitsZ = decks(fleetK);
  const missesK = water(fleetZ);
  await fire(phone, hitsZ[0]!);
  const rested = sea(phone);
  check(
    rested.resting && !rested.canAim && rested.view === 0 && phone.text("#sb-status-text") === "Hit!",
    "the shot's result stays up, and nobody can fire",
  );
  await waitFor("the pass card", () => sea(phone).screen === "sb-pass");
  check(!phone.visible("sb-game"), "the card covers the screen between turns");
  phone.screenshot("sb-pass");
  await hand(phone, "Kai", "Zoe hit your Flagship.");
  check(
    sea(phone).view === 1 &&
      sea(phone).canAim &&
      phone.text("#sb-own-title") === "Kai's fleet" &&
      phone.text("#sb-status-text") === "Zoe hit your Flagship · your turn",
    "Kai takes the phone: his fleet, and what Zoe's shot did",
  );
  check(
    count(phone, "sb-sea", "ship") === 0 &&
      count(phone, "sb-sea", "hit") + count(phone, "sb-sea", "miss") === 0 &&
      count(phone, "sb-own", "hit") === 1,
    "Kai sees none of Zoe's ships, and the hit on his own",
  );
  phone.screenshot("sb-kai-turn");
  await fire(phone, missesK[0]!);
  check(phone.text("#sb-status-text") === "Miss.", "a shot on open water is a miss");
  await hand(phone, "Zoe", "Kai missed.");
  check(phone.text("#sb-status-text") === "Kai missed · your turn", "a miss passes the turn back");

  // Three more shots each, then a reload: the game comes back behind the card.
  volley(
    phone,
    [1, 2, 3].flatMap((i) => [hitsZ[i]!, missesK[i]!]),
  );
  phone.open(`${origin}/${SEA}`);
  await waitFor("home after reload", () => phone.visible("sb-home"));
  check(phone.visible("sb-resume"), "a Sea Battle game in progress offers to resume");
  phone.click("#sb-resume");
  await hand(phone, "Zoe", "Kai missed.");
  const back = sea(phone);
  check(
    back.shots.length === 8 && back.turn === 0 && back.view === 0 && back.canAim,
    "the resumed game starts behind the card, with every shot",
  );
  check(
    JSON.stringify(back.fleets) === JSON.stringify([fleetZ, fleetK]) &&
      count(phone, "sb-sea", "hit") === 4 &&
      count(phone, "sb-own", "miss") === 4,
    "the resumed game has both fleets and every mark",
  );
  phone.screenshot("sb-midgame");

  // Zoe's fifth hit sinks the Flagship.
  await fire(phone, hitsZ[4]!);
  check(phone.text("#sb-status-text") === "You sank a Flagship!", "the last hit on a ship sinks it");
  check(count(phone, "sb-sea", "sunk") === 5 && lost(phone, 1) === 1, "the sunk ship shows whole");
  phone.screenshot("sb-sunk");
  await hand(phone, "Kai", "Zoe sank your Flagship.");
  check(count(phone, "sb-own", "sunk") === 5, "Kai sees his sunk ship");

  // Zoe sinks the rest ship by ship, and Kai misses every time.
  volley(phone, [
    missesK[4]!,
    ...hitsZ.slice(5).flatMap((cell, i, all) => (i < all.length - 1 ? [cell, missesK[i + 5]!] : [cell])),
  ]);
  const won = sea(phone);
  check(won.over && won.winner === 0 && won.wins.join() === "1,0", "the last ship ends the game");
  check(phone.text("#sb-result-title") === "Zoe wins!", "the result names the winner");
  check(phone.text("#sb-why") === "Sank all five ships in 17 shots.", "one line says why");
  check(
    phone.text("#sb-stats") === "" && !phone.visible("sb-note"),
    "pass & play shows no computer recap and no rematch note",
  );
  check(
    sea(phone).screen === "sb-game" && phone.text("#sb-tally") === "1–0" && lost(phone, 1) === 5,
    "no card after the last shot, and the score shows 1-0",
  );
  phone.screenshot("sb-win");

  // The rematch: Zoe places first this time, and Kai fires first.
  phone.click("#sb-again");
  await waitFor("placement for the rematch", () => sea(phone).screen === "sb-place");
  check(
    sea(phone).placing === 0 && phone.text("#sb-done") === "Ready",
    "in the rematch the other player places first",
  );
  phone.click("#sb-done");
  await hand(phone, "Kai", "Place your fleet.", "sb-place");
  phone.click("#sb-done");
  await waitFor("rematch", () => sea(phone).screen === "sb-game");
  const again = sea(phone);
  check(
    again.starter === 1 && again.turn === 1 && again.view === 1 && again.shots.length === 0,
    "the player who fired second starts the rematch",
  );
  await fire(phone, water(again.fleets[0])[0]!);
  await hand(phone, "Zoe", "Kai missed.");
  await fire(phone, decks(again.fleets[1])[0]!);
  await hand(phone, "Kai", "Zoe hit your Flagship.");
  phone.click("#sb-leave");
  await waitFor("sea battle home", () => phone.visible("sb-home"));
  check(phone.visible("sb-resume"), "the rematch can be resumed");
  phone.click("#sb-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play games above: Sea Battle loads from the service worker and resumes. */
export async function seaOffline(phone: Browser, origin: string) {
  phone.openOffline(`${origin}/${SEA}`);
  await waitFor("sea battle offline", () => phone.visible("sb-home"));
  phone.click("#sb-resume");
  await hand(phone, "Kai", "Zoe hit your Flagship.");
  check(sea(phone).shots.length === 2, "offline: Sea Battle loads from the service worker and resumes");
  phone.screenshot("sb-offline");
}

/** Online between two phones: `a` made the party and `b` joined it. Both start and end at the menu. */
export async function seaOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];

  // Ana picks Sea Battle, so Ana fires first. Both phones first place a fleet.
  a.click(`#tiles a[data-id="${SEA}"]`);
  await waitFor("both placing a fleet", () => {
    const [sa, sb] = [sea(a), sea(b)];
    return sa.me === 0 && sb.me === 1 && sa.screen === "sb-place" && sb.screen === "sb-place";
  });
  check(b.eval<string>("() => location.pathname") === `/${SEA}`, "the friend's phone opens Sea Battle too");
  check(
    both.every((p) => p.text("#sb-place-title") === "Place your fleet" && p.text("#sb-done") === "Ready"),
    "both phones place a fleet at the same time",
  );
  a.screenshot("online-sb-place");

  // Ana is ready first: her phone waits for Kai's fleet.
  const fleetA = sea(a).draft;
  a.click("#sb-done");
  await waitFor("maker ready", () => sea(a).screen === "sb-game" && sea(a).placed?.[0] === true);
  await waitFor("friend told the maker is ready", () => sea(b).placed?.[0] === true);
  check(
    a.text("#sb-status-text") === "Waiting for Kai's fleet" && a.text("#sb-pl-1 .sb-sub") === "Placing fleet",
    "the phone that is ready waits for the friend's fleet",
  );
  check(!sea(a).canAim && sea(b).screen === "sb-place", "no shot before both fleets are placed");
  a.screenshot("online-sb-waiting-fleet");

  // Kai turns his layout over once, then is ready: the game starts in Ana's hands.
  b.click("#sb-random");
  const fleetB = sea(b).draft;
  b.click("#sb-done");
  await waitFor("both in the game", () => both.every((p) => sea(p).placed?.join() === "true,true"));
  await waitFor("your-turn toast for the starter", () => toastOn(a));
  check(sea(a).canAim && !sea(b).canAim, "the player who picked it fires first");
  check(
    a.text("#sb-status-text") === "Your turn · tap a cell to aim" &&
      b.text("#sb-status-text") === "Ana fires first",
    "the other phone waits",
  );
  check(
    a.text("#sb-pl-0 .sb-sub") === "Your turn" &&
      b.text("#sb-pl-0 .sb-sub") === "Their turn" &&
      b.text("#sb-pl-1 .sb-sub") === "You",
    "the cards say whose turn, and which colour is yours",
  );
  check(
    JSON.stringify(sea(a).fleets) === JSON.stringify([fleetA, []]) &&
      JSON.stringify(sea(b).fleets) === JSON.stringify([[], fleetB]),
    "each phone holds its own fleet and none of the other's ships",
  );
  a.screenshot("online-sb-your-turn");
  b.screenshot("online-sb-their-turn");

  // Out of turn, a tap aims at nothing.
  b.click(cellOf(0));
  await sleep(300);
  check(sea(b).aim === null && sea(a).foeAim === null, "a tap out of turn aims at nothing");

  // Ana aims at one of Kai's ships: Kai sees the ring on his own water, dimmed.
  const hitsA = decks(fleetB);
  const missesB = water(fleetA);
  a.click(cellOf(hitsA[0]!));
  await waitFor("the friend sees the aim", () => sea(b).foeAim === hitsA[0]);
  check(
    b.eval<boolean>(
      `() => document.querySelector("#sb-own .sb-cell:nth-child(${hitsA[0]! + 1})").classList.contains("aim")`,
    ),
    "the friend sees the live aim on their own water",
  );
  check(sea(b).shots.length === 0, "an aim is not a shot");
  b.screenshot("online-sb-friend-aims");

  await fire(a, hitsA[0]!, both);
  await waitFor("your-turn toast", () => toastOn(b) && b.text("#sb-toast") === "Your turn");
  check(
    a.text("#sb-status-text") === "Hit!" && /^Ana hit your \w+ · your turn$/.test(b.text("#sb-status-text")),
    "both phones say what the shot did",
  );
  check(sea(b).foeAim === null && sea(b).canAim, "the shot clears the aim and passes the turn");
  b.screenshot("online-sb-hit");
  await fire(b, missesB[0]!, both);
  check(a.text("#sb-status-text") === "Kai missed · your turn", "a miss passes the turn back");

  // Ana's page reloads on her turn: the same game, her fleet, still her turn.
  a.open(`${origin}/${SEA}`);
  await waitFor(
    "maker back in the game",
    () => sea(a).me === 0 && sea(a).shots.length === 2 && sea(a).canAim,
  );
  check(
    JSON.stringify(sea(a).fleets) === JSON.stringify([fleetA, []]) &&
      sea(a).seen[0].marks[hitsA[0]!] === "hit" &&
      sea(a).seen[1].marks[missesB[0]!] === "miss",
    "after a reload the maker has the same game, and still none of the friend's ships",
  );

  // Ana sinks the whole fleet, and Kai misses every time.
  for (let i = 1; i < hitsA.length; i++) {
    await fire(a, hitsA[i]!, both);
    if (i === 4) {
      check(
        both.every((p) => sea(p).seen[0].sunk.length === 1) &&
          a.text("#sb-status-text") === "You sank a Flagship!",
        "the last hit on a ship sinks it on both phones",
      );
      a.screenshot("online-sb-sunk");
    }
    if (i < hitsA.length - 1) await fire(b, missesB[i]!, both);
  }
  await waitFor("game over", () => both.every((p) => sea(p).over && sea(p).winner === 0));
  check(
    a.text("#sb-result-title") === "You win!" && b.text("#sb-result-title") === "Ana wins!",
    "the last ship ends the game, on both phones",
  );
  check(
    both.every((p) => p.text("#sb-why") === "Sank all five ships in 17 shots."),
    "both phones say why",
  );
  check(sea(a).wins.join() === "1,0" && sea(b).wins.join() === "1,0", "both phones keep the score");
  check(
    JSON.stringify(sea(b).fleets) === JSON.stringify([fleetA, fleetB]),
    "once the game is over the loser sees the ships that stayed afloat",
  );
  a.screenshot("online-sb-won");
  b.screenshot("online-sb-lost");

  // A rematch waits for both players, then both place a new fleet and the other player fires first.
  b.click("#sb-again");
  await waitFor("rematch asked", () => a.text("#sb-note") === "Kai wants a rematch");
  check(
    b.text("#sb-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("sb-again").disabled`),
    "the asker waits for the friend",
  );
  a.screenshot("online-sb-rematch-asked");
  a.click("#sb-again");
  await waitFor("both placing again", () =>
    both.every((p) => sea(p).screen === "sb-place" && sea(p).starter === 1 && !sea(p).over),
  );
  b.click("#sb-done");
  a.click("#sb-done");
  await waitFor("rematch", () => both.every((p) => sea(p).placed?.join() === "true,true"));
  await waitFor("friend on turn", () => sea(b).canAim);
  check(
    !sea(a).canAim && sea(a).shots.length === 0 && sea(a).wins.join() === "1,0",
    "the rematch swaps who fires first, and keeps the score",
  );
  check(sea(a).fleets[1].length === 0 && sea(b).fleets[0].length === 0, "the new fleets are hidden again");

  // Ana leaves the game: both phones go back to the menu.
  a.click("#sb-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));
}
