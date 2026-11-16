// Sea Battle's part of the end-to-end suites, driven by taps on the real
// grids. `pnpm test:online` plays it between two phones: both place a fleet,
// one phone never holds the other's ships, a live aim, a reload, a result and
// a rematch.

import {
  CELLS,
  cellsOf,
  type Fleet,
  type Seat,
  type Shot,
  type Sight,
} from "../../src/games/sea-battle/core/board.ts";
import { Browser, check, waitFor } from "./browser.ts";

export const SEA = "sea-battle";

/** What Sea Battle's test hook reports. */
interface SeaState {
  screen: string | null;
  draft: Fleet;
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
  canAim: boolean;
  wins: [number, number];
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
async function fire(p: Browser, cell: number, phones: Browser[]) {
  const s = await waitFor("a turn to fire", () => {
    const now = sea(p);
    return now.canAim ? now : null;
  });
  const n = s.shots.length;
  p.click(cellOf(cell));
  await waitFor("the aim", () => sea(p).aim === cell);
  p.click("#sb-fire");
  await waitFor("the shot on every phone", () => phones.every((q) => sea(q).shots.length === n + 1));
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
