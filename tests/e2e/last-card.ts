// Last Card's part of the end-to-end suites, driven by taps on the real
// cards. `pnpm test:menu` plays it solo against the Hard computer (a card
// lifted and played, a reload on the computer's turn, a whole game, a
// rematch, a Wild with the colour sheet in a hand of 14 cards) and pass &
// play (the "Pass to" card between turns, a whole game, a reload and a
// rematch), and `pnpm test:online` plays it between two phones: neither
// phone holds the other's hand, the "Your turn" alert, a reload, a result
// and a rematch that waits for both.

import { choose, type Level } from "../../src/games/last-card/core/ai.ts";
import {
  apply,
  isWild,
  nameOf,
  newGame,
  other,
  replay,
  viewOf,
  type Board,
  type Color,
  type Move,
  type Seat,
} from "../../src/games/last-card/core/board.ts";
import { Browser, check, VIEWPORT, waitFor } from "./browser.ts";

export const LAST_CARD = "last-card";

/** What Last Card's test hook reports. */
interface LastState {
  screen: string | null;
  seat: Seat | null;
  hand: number[];
  shown: number[];
  others: number;
  top: number | null;
  want: Color | null;
  pile: number;
  turn: Seat | null;
  first: Seat | null;
  drawing: boolean;
  drawn: number | null;
  open: Seat | null;
  called: [boolean, boolean];
  moves: number;
  over: boolean;
  winner: Seat | null;
  playable: number[];
  catchable: boolean;
  locked: boolean;
  lifted: number | null;
  calling: boolean;
  sheet: boolean;
  resting: boolean;
  thinking: boolean;
  wins: [number, number];
  level: Level | null;
  me: Seat | null;
  rematch: [boolean, boolean] | null;
  pending: number | null;
}

/** A game as the page saves it. */
interface Saved {
  names: [string, string];
  seed: number;
  first: Seat;
  moves: Move[];
  wins: [number, number];
  level?: Level;
  luck?: number;
}

const last = (p: Browser) => p.eval<LastState>("() => window.__last.state()");
const saved = (p: Browser, key: "solo" | "game") =>
  p.eval<Saved | null>(`() => JSON.parse(localStorage.getItem("last-card.${key}") ?? "null")`);
const cardEl = (id: number) => `#lc-hand .lc-card[data-id="${id}"]`;
const toastOn = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("lc-toast").classList.contains("on")`);

/**
 * One move with the taps a player would make, inside the page: "I'm ready"
 * on a "Pass to" card, Catch! when it shows, else a card that fits (tapped
 * twice, a Wild's colour from the sheet, "Last card!" first when it goes
 * down to one), else Draw or "Keep it". Says what it did, or "wait".
 */
const STEP = `
  const api = window.__last;
  const s = api.state();
  const click = (id) => document.getElementById(id).click();
  if (s.screen === "lc-pass") { click("lc-ready"); return "ready"; }
  if (s.over) return "over";
  if (s.catchable) { click("lc-catch"); return "catch"; }
  if (s.locked) return "wait";
  if (s.playable.length === 0) { click("lc-draw"); return s.drawing ? "keep" : "draw"; }
  const el = (id) => document.querySelector('#lc-hand .lc-card[data-id="' + id + '"]');
  const id = s.playable.find((id) => !el(id).classList.contains("wild")) ?? s.playable[0];
  if (s.hand.length === 2 && !s.calling && !document.getElementById("lc-call").hidden) click("lc-call");
  el(id).click();
  el(id).click();
  if (api.state().sheet) document.querySelector('#lc-swatches [data-color="wave"]').click();
  return "play";
`;

/** Plays moves on one phone, inside the page, until the game ends or `ms` runs out. */
function autoplay(p: Browser, ms = 8000): boolean {
  return p.eval<boolean>(`async () => {
    const t0 = Date.now();
    const step = async () => { ${STEP} };
    while (!window.__last.state().over && Date.now() - t0 < ${ms}) {
      const did = await step();
      await new Promise((r) => setTimeout(r, did === "wait" ? 30 : 10));
    }
    return window.__last.state().over;
  }`);
}

/** One move on `p`, then waits until every phone counts it. */
async function step(p: Browser, phones: Browser[] = [p]): Promise<string> {
  const n = last(p).moves;
  const did = p.eval<string>(`async () => { ${STEP} }`);
  if (did === "wait" || did === "ready" || did === "over") return did;
  await waitFor(`the ${did} on every phone`, () =>
    phones.every((q) => {
      const s = last(q);
      return s.moves === n + 1 && s.pending === null;
    }),
  );
  return did;
}

/**
 * The game screen fits a phone of `size`: no scroll either way, dock buttons
 * a thumb can hit, the draw pile big enough to tap, and every card of the
 * hand on screen.
 */
function fits(p: Browser, size: string, name: string) {
  p.viewport(size);
  // The fan is placed again on resize.
  p.run("await page.eval(() => new Promise((r) => setTimeout(r, 400)));");
  const m = p.eval<{
    scrollW: number;
    scrollH: number;
    width: number;
    height: number;
    button: number;
    pile: number;
    left: number;
    right: number;
    bottom: number;
  }>(`() => {
    const on = (el) => el.getClientRects().length > 0;
    const buttons = [...document.querySelectorAll("#lc-dock .btn, #lc-result .btn")].filter(on);
    const cards = [...document.querySelectorAll("#lc-hand .lc-card")].map((el) => el.getBoundingClientRect());
    const pile = document.getElementById("lc-pile").getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      width: innerWidth,
      height: innerHeight,
      button: Math.min(...buttons.map((el) => el.getBoundingClientRect().height)),
      pile: Math.min(pile.width, pile.height),
      left: Math.min(0, ...cards.map((r) => r.left)),
      right: Math.max(0, ...cards.map((r) => r.right)),
      bottom: Math.max(0, ...cards.map((r) => r.bottom)),
    };
  }`);
  check(
    m.scrollW <= m.width &&
      m.scrollH <= m.height &&
      m.button >= 44 &&
      m.pile >= 44 &&
      m.left >= 0 &&
      m.right <= m.width &&
      m.bottom <= m.height + 1,
    `at ${size.split("x", 2).join("x")} ${name} fits: no scroll, ${m.button.toFixed(0)} px buttons, a ${m.pile.toFixed(0)} px pile, the hand on screen`,
  );
  p.screenshot(name);
}

/** Every screen size a game must fit, then back upright. */
function fitsAll(p: Browser, name: string) {
  fits(p, "360x740x2,mobile,touch", `${name}-360`);
  fits(p, "844x390x2,mobile,touch", `${name}-landscape`);
  fits(p, "1180x820x2,mobile,touch", `${name}-wide`);
  p.viewport(VIEWPORT);
}

/** Takes the phone from the "Pass to" card: checks it, taps "I'm ready", waits for the table. */
async function hand(p: Browser, to: string, sub: (s: string) => boolean, what: string, shot?: string) {
  await waitFor("the pass card", () => last(p).screen === "lc-pass");
  const said = p.text("#lc-pass-sub");
  check(
    p.text("#lc-pass-title") === `Pass to ${to}` && sub(said),
    `the card says “Pass to ${to}” and ${what} (${said})`,
  );
  check(!p.visible("lc-game"), "the card covers the table: no hand in sight");
  if (shot) p.screenshot(shot);
  p.click("#lc-ready");
  await waitFor("the table behind the card", () => last(p).screen === "lc-game");
}

/**
 * A solo game where Zoe only draws: Hard plays, and Zoe's hand grows. Stops
 * on Zoe's turn once she holds `size` cards and a Wild.
 */
function bigHand(size: number): { seed: number; luck: number; moves: Move[]; board: Board } {
  const luck = 11;
  for (let seed = 1; seed < 5000; seed++) {
    let b = newGame(seed, 0);
    for (let i = 0; i < 300 && !b.over; i++) {
      if (b.turn === 1) {
        b = apply(b, { ...choose(viewOf(b, 1), "hard", luck), by: 1 })!;
        continue;
      }
      if (b.drawn === null && b.hands[0].length >= size && b.hands[0].some(isWild))
        return { seed, luck, moves: b.moves, board: b };
      b = apply(b, { t: b.drawn === null ? "draw" : "keep", by: 0 })!;
    }
  }
  throw new Error("no seed gives a big hand");
}

/** Solo against the Hard computer, from the menu and back to it. The session is Zoe, solo, Hard. */
export async function lcSolo(phone: Browser) {
  check(
    phone.text(`#tiles a[href="/${LAST_CARD}"] small`) === "Solo · vs computer",
    "Last Card plays solo, against the computer",
  );
  phone.click(`#tiles a[href="/${LAST_CARD}"]`);
  await waitFor("last card home, solo", () => phone.visible("lc-home"));
  check(
    phone.text("#lc-name-0") === "Zoe" && phone.text("#lc-name-1") === "Computer",
    "solo Last Card is Zoe against the computer",
  );
  check(
    phone.text("#lc-sub-0") === "Coral · plays first" && phone.text("#lc-sub-1") === "Teal · Hard",
    "Zoe plays first, and the computer's card shows its level",
  );
  check(!phone.visible("lc-resume"), "no game to resume yet");
  phone.screenshot("lc-home-solo");

  phone.click("#lc-start");
  await waitFor("the solo table", () => last(phone).screen === "lc-game");
  const dealt = saved(phone, "solo")!;
  const start = newGame(dealt.seed, 0);
  check(
    dealt.first === 0 && dealt.level === "hard" && start.hands[1].length === 7,
    "a deal of 7 cards, with Zoe first, against Hard",
  );
  check(
    phone.text("#lc-told").startsWith(`The first card is a ${nameOf(start.discard.at(-1)!)}.`) ||
      start.start.skipped,
    "the table says what the first card is",
  );
  check(last(phone).others === start.hands[1].length, "the computer's hand shows only as a count");
  check(
    phone.eval<boolean>(
      `() => [...document.querySelectorAll("#lc-foe .lc-card")].every((el) => el.classList.contains("back"))`,
    ),
    "the computer's cards lie face down",
  );

  // Zoe's turn with a card that fits: draw until one does.
  await waitFor("Zoe's turn with a card that fits", () => {
    const s = last(phone);
    if (s.over) throw new Error("the game ended before a card was played");
    if (s.locked) return false;
    if (s.playable.length > 0) return true;
    phone.click("#lc-draw");
    return false;
  });
  let s = last(phone);
  const pick = s.playable.find((id) => !isWild(id)) ?? s.playable[0]!;
  const dim = phone.eval<number>(`() => document.querySelectorAll("#lc-hand .lc-card.dim").length`);
  check(dim === s.hand.length - s.playable.length, `cards that do not fit are dimmed (${dim})`);
  phone.click(cardEl(pick));
  s = last(phone);
  check(
    s.lifted === pick && s.moves === dealt.moves.length,
    "the first tap lifts the card, and plays nothing",
  );
  check(
    phone.text("#lc-line-text") === "Tap it again to play" &&
      !phone.eval<boolean>(`() => document.getElementById("lc-play").disabled`) &&
      phone.eval<boolean>(
        `() => document.querySelector(${JSON.stringify(cardEl(pick))}).classList.contains("up")`,
      ),
    "the lifted card stands out, and Play is on",
  );
  phone.screenshot("lc-solo-lift");
  fitsAll(phone, "lc-solo");
  check(last(phone).lifted === pick, "the card stays lifted through a turn of the phone");

  const played = phone.eval<{ top: number | null; thinking: boolean; line: string }>(`() => {
    document.getElementById("lc-play").click();
    const s = window.__last.state();
    return { top: s.top, thinking: s.thinking, line: document.getElementById("lc-line-text").textContent };
  }`);
  check(played.top === pick, `Play plays the lifted card (${nameOf(pick)})`);
  if (played.thinking)
    check(played.line === "Computer is thinking", "the line says the computer is thinking");

  // Play on until a move hands the turn to the computer, then reload at once.
  const atReload = await waitFor(
    "a reload on the computer's turn",
    () =>
      phone.eval<{ s: LastState; savedMoves: number } | null>(`async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 4000) {
          const s = window.__last.state();
          if (s.over) return null;
          if (s.thinking && s.turn === 1) {
            // Read the save in this same tick: a slow reload can let the computer move first.
            const savedMoves = JSON.parse(localStorage.getItem("last-card.solo")).moves.length;
            setTimeout(() => location.reload(), 0);
            return { s, savedMoves };
          }
          if (!s.locked) { ${STEP} }
          await new Promise((r) => setTimeout(r, 10));
        }
        return null;
      }`),
    60_000,
  );
  const pending = atReload.s;
  check(atReload.savedMoves === pending.moves, "the game is saved after every move");
  // Seed, first and luck stay the same. Replay only the moves before the reload.
  const before = saved(phone, "solo")!;
  await waitFor("home after reload", () => phone.visible("lc-home"));
  check(phone.visible("lc-resume"), "a solo game in play offers to resume");
  phone.click("#lc-resume");
  await waitFor("the computer's move after the resume", () => last(phone).moves > pending.moves);
  const b = replay(before.seed, before.first, before.moves.slice(0, pending.moves))!;
  const expected = choose(viewOf(b, 1), "hard", before.luck!);
  const after = saved(phone, "solo")!;
  // The same move, whatever order its fields are in.
  const same = (m: object) => JSON.stringify(Object.entries(m).sort(([x], [y]) => x.localeCompare(y)));
  const made = after.moves[pending.moves]!;
  check(
    same(made) === same({ ...expected, by: 1 }),
    `after the resume, the computer makes the move its view and luck picked (${same(made)})`,
  );

  // Zoe plays on to the end.
  await waitFor("the end of the solo game", () => autoplay(phone), 240_000);
  const end = last(phone);
  const won = end.winner === 0;
  check(end.wins[end.winner!] === 1 && end.wins[other(end.winner!)] === 0, "the winner gets a point");
  check(
    phone.text("#lc-result-title") === (won ? "You win!" : "Computer wins!"),
    `the result names the winner (${phone.text("#lc-result-title")})`,
  );
  check(
    phone.text("#lc-why") === `${won ? "You" : "Computer"} played the last card, a ${nameOf(end.top!)}.`,
    "one line says how it ended",
  );
  const stats = phone.text("#lc-stats");
  check(
    stats.includes("Cards played") &&
      stats.includes(won ? `Left with Computer${end.others}` : `Left in your hand${end.hand.length}`),
    "the recap counts the cards",
  );
  check(
    phone.eval<boolean>(
      `() => !document.querySelector("#lc-foe .lc-card.back") && document.querySelectorAll("#lc-foe .lc-card").length === ${end.others}`,
    ),
    "once the game is over the computer's cards turn face up",
  );
  check(phone.text("#lc-tally") === (won ? "1–0" : "0–1"), "the bar shows the score");
  check(!phone.visible("lc-dock") && phone.visible("lc-result"), "the result replaces the buttons");
  phone.screenshot("lc-solo-result");
  fitsAll(phone, "lc-solo-result");

  // The rematch: the computer plays first, on its own.
  phone.click("#lc-again");
  await waitFor("the computer's opening move", () => {
    const s = last(phone);
    // After a Skip or a draw it goes again, so wait for Zoe's turn: a later move would save over the game below.
    return !s.over && s.first === 1 && s.moves > 0 && s.turn === 0 && !s.thinking;
  });
  check(last(phone).wins.join() === end.wins.join(), "the rematch keeps the score");

  // A saved game where Zoe has drawn to 14 cards and holds a Wild.
  const big = bigHand(14);
  const game: Saved = {
    names: ["Zoe", "Computer"],
    seed: big.seed,
    first: 0,
    moves: big.moves,
    wins: end.wins,
    level: "hard",
    luck: big.luck,
  };
  phone.run(
    `await page.eval(() => localStorage.setItem("last-card.solo", ${JSON.stringify(JSON.stringify(game))}));`,
  );
  phone.click("#lc-leave");
  await waitFor("last card home", () => phone.visible("lc-home"));
  phone.click("#lc-resume");
  await waitFor(
    "the big hand",
    () => last(phone).hand.length === big.board.hands[0].length && !last(phone).locked,
  );
  const wild = big.board.hands[0].find(isWild)!;
  check(last(phone).hand.length >= 14, `Zoe holds ${last(phone).hand.length} cards`);
  check(
    phone.eval<boolean>(
      `() => [...document.querySelectorAll("#lc-hand .lc-card")].every((el) => el.getBoundingClientRect().width < 72)`,
    ),
    "past 12 cards the fan tightens",
  );
  phone.screenshot("lc-big-hand");
  fitsAll(phone, "lc-big-hand");

  // A Wild asks for a colour. The shade closes the sheet without a move.
  phone.click(cardEl(wild));
  phone.click(cardEl(wild));
  check(last(phone).sheet && phone.visible("lc-sheet"), "a Wild opens the colour sheet");
  check(
    phone.eval<number>(`() => document.querySelectorAll("#lc-swatches button").length`) === 4,
    "the sheet offers the four colours",
  );
  phone.screenshot("lc-sheet");
  phone.click("#lc-shade");
  check(!last(phone).sheet && last(phone).moves === big.moves.length, "a tap off the sheet plays nothing");
  phone.click(cardEl(wild));
  phone.click(cardEl(wild));
  phone.click('#lc-swatches [data-color="wave"]');
  s = last(phone);
  check(s.top === wild && s.moves === big.moves.length + 1, "the Wild is played");
  check(s.want === "wave", "the colour picked is the one to match");
  check(phone.text("#lc-told").includes(`You played a ${nameOf(wild)} and picked wave`), "the table says so");

  phone.click("#lc-leave");
  await waitFor("last card home", () => phone.visible("lc-home"));
  check(phone.visible("lc-resume"), "the game can be resumed");
  phone.click("#lc-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/**
 * Pass & play, from the menu and back to it: the "Pass to" card between
 * turns, a whole game, a reload, and a rematch left after one move. The
 * session is Zoe and Kai.
 */
export async function lcPassAndPlay(phone: Browser, origin: string) {
  const names = ["Zoe", "Kai"];
  phone.click(`#tiles a[href="/${LAST_CARD}"]`);
  await waitFor("last card home", () => phone.visible("lc-home"));
  check(phone.eval<string>("() => location.pathname") === `/${LAST_CARD}`, "the URL is /last-card");
  check(phone.eval<string>("() => document.body.dataset.game") === LAST_CARD, "Last Card's theme is on");
  check(
    phone.text("#lc-name-0") === "Zoe" && phone.text("#lc-name-1") === "Kai",
    "Last Card takes the names from the session",
  );
  check(
    phone.text("#lc-sub-0") === "Coral · plays first" && phone.text("#lc-sub-1") === "Teal",
    "coral plays first",
  );
  check(!phone.visible("lc-resume"), "the solo game is saved apart from pass & play");
  phone.screenshot("lc-home");

  phone.click("#lc-start");
  const dealt = saved(phone, "game")!;
  const b = newGame(dealt.seed, dealt.first);
  check(dealt.first === 0, "Zoe plays first");
  await hand(
    phone,
    names[b.turn]!,
    (sub) =>
      sub.startsWith(`The first card is a ${nameOf(b.discard.at(-1)!)}.`) &&
      sub.endsWith(b.start.skipped ? "lost the turn." : "You play first."),
    "what the first card did",
  );
  let s = last(phone);
  check(
    s.seat === b.turn && JSON.stringify(s.hand) === JSON.stringify(b.hands[b.turn]),
    "the player on turn sees their own hand",
  );

  // Moves until one passes the turn: the result stays up, then the card covers it.
  const from = s.seat!;
  for (;;) {
    await step(phone);
    s = last(phone);
    if (s.resting || s.screen === "lc-pass") break;
  }
  check(s.seat === from, "after the move the table stays a moment, with the same hand");
  phone.screenshot("lc-rest");
  await hand(
    phone,
    names[other(from)]!,
    (sub) => sub.startsWith(`${names[from]} `) && /[.!"]$/.test(sub),
    "what the last turn did",
    "lc-pass",
  );
  phone.screenshot("lc-pass-next");
  check(last(phone).seat === other(from), "the next player sees their own hand");

  // A few moves more, then a reload: the game comes back behind the card.
  for (let i = 0; i < 6 && !last(phone).over; i++) await step(phone);
  const mid = saved(phone, "game")!;
  const midBoard = replay(mid.seed, mid.first, mid.moves)!;
  phone.open(`${origin}/${LAST_CARD}`);
  await waitFor("home after reload", () => phone.visible("lc-home"));
  if (!midBoard.over) {
    check(phone.visible("lc-resume"), "a game in play offers to resume");
    phone.click("#lc-resume");
    await hand(phone, names[midBoard.turn]!, () => true, "the moves since");
    check(last(phone).moves === mid.moves.length, "the resumed game has every move");
    phone.screenshot("lc-midgame");
  }

  await waitFor("the end of the game", () => autoplay(phone), 300_000);
  const end = last(phone);
  const w = end.winner!;
  check(phone.text("#lc-result-title") === `${names[w]} wins!`, "the result names the winner");
  check(
    phone.text("#lc-tally") === (w === 0 ? "1–0" : "0–1") && end.wins[w] === 1,
    "the bar shows the score",
  );
  check(phone.text("#lc-stats").includes(`Left with ${names[other(w)]}`), "the recap names the loser");
  check(!phone.visible("lc-note"), "pass & play shows no rematch note");
  phone.screenshot("lc-win");

  // The rematch: Kai plays first.
  phone.click("#lc-again");
  await waitFor("the pass card", () => last(phone).screen === "lc-pass");
  const again = saved(phone, "game")!;
  check(again.first === 1 && again.moves.length === 0, "the player who went second starts the rematch");
  phone.click("#lc-ready");
  await waitFor("the rematch table", () => last(phone).screen === "lc-game");
  await step(phone);
  phone.click("#lc-leave");
  await waitFor("last card home", () => phone.visible("lc-home"));
  check(phone.visible("lc-resume"), "the rematch can be resumed");
  phone.click("#lc-home [data-menu]");
  await waitFor("menu", () => phone.visible("games"));
}

/** Offline, after the pass & play game above: Last Card loads from the service worker and resumes. */
export async function lcOffline(phone: Browser, origin: string) {
  const game = saved(phone, "game")!;
  phone.openOffline(`${origin}/${LAST_CARD}`);
  await waitFor("last card offline", () => phone.visible("lc-home"));
  phone.click("#lc-resume");
  await waitFor("the pass card", () => last(phone).screen === "lc-pass");
  phone.click("#lc-ready");
  await waitFor("the table", () => last(phone).screen === "lc-game");
  check(
    last(phone).moves === game.moves.length,
    "offline: Last Card loads from the service worker and resumes",
  );
  phone.screenshot("lc-offline");
}

/** Online between two phones: `a` made the party and `b` joined it. Both start and end at the menu. */
export async function lcOnline(a: Browser, b: Browser, origin: string, atMenu: (p: Browser) => boolean) {
  const both = [a, b];
  const on = (seat: Seat) => (seat === 0 ? a : b);

  // Each phone records its toasts as they show: a toast lasts 2.2 s, and the
  // slower phone can keep the check waiting past that.
  for (const p of both) {
    p.eval(`() => {
      window.__lcToasts = [];
      new MutationObserver((rs) => {
        for (const r of rs)
          if (r.target.id === "lc-toast" && r.target.classList.contains("on")) window.__lcToasts.push(r.target.textContent);
      }).observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
    }`);
  }
  const toasted = (p: Browser, text: string) =>
    p.eval<boolean>(`() => (window.__lcToasts ?? []).includes(${JSON.stringify(text)})`);

  // Ana picks Last Card, so Ana plays first.
  a.click(`#tiles a[data-id="${LAST_CARD}"]`);
  await waitFor("both at the table", () => {
    const [sa, sb] = [last(a), last(b)];
    return (
      sa.me === 0 &&
      sb.me === 1 &&
      sa.screen === "lc-game" &&
      sb.screen === "lc-game" &&
      sa.moves === sb.moves
    );
  });
  check(
    b.eval<string>("() => location.pathname") === `/${LAST_CARD}`,
    "the friend's phone opens Last Card too",
  );
  let [sa, sb] = [last(a), last(b)];
  check(sa.first === 0 && sb.first === 0, "the player who picked it plays first");
  check(
    sa.hand.length === sb.others &&
      sb.hand.length === sa.others &&
      !sa.hand.some((id) => sb.hand.includes(id)),
    "each phone holds its own hand and only the size of the other",
  );
  check(
    both.every((p) =>
      p.eval<boolean>(
        `() => [...document.querySelectorAll("#lc-foe .lc-card")].every((el) => el.classList.contains("back"))`,
      ),
    ),
    "the other hand lies face down on both phones",
  );
  const starter = on(sa.turn!);
  await waitFor("your-turn toast for the starter", () => toasted(starter, "Your turn"));
  const waiter = on(other(sa.turn!));
  check(
    waiter.text("#lc-line-text") === `Waiting for ${sa.turn === 0 ? "Ana" : "Kai"}` && last(waiter).locked,
    "the other phone waits",
  );
  a.screenshot("online-lc-start");
  b.screenshot("online-lc-friend");

  // Out of turn, a tap on a card does nothing.
  const idle = last(waiter);
  waiter.click(cardEl(idle.hand[0]!));
  check(last(waiter).lifted === null && last(waiter).moves === idle.moves, "a tap out of turn does nothing");

  // Moves until the turn changes hands: the other phone gets the alert.
  const turn0 = sa.turn!;
  while (last(a).turn === turn0 && !last(a).over) await step(on(turn0), both);
  const next = on(other(turn0));
  if (!last(a).over)
    await waitFor("your-turn toast", () => toastOn(next) && next.text("#lc-toast") === "Your turn");
  check(
    last(on(turn0)).locked && !last(next).locked,
    "after a turn, the phone that moved waits and the other may move",
  );

  // Ana's page reloads: the same game, the same hand.
  sa = last(a);
  a.open(`${origin}/${LAST_CARD}`);
  await waitFor("maker back at the table", () => {
    const s = last(a);
    return s.me === 0 && s.screen === "lc-game" && s.moves === sa.moves;
  });
  check(
    JSON.stringify(last(a).hand) === JSON.stringify(sa.hand),
    "after a reload the maker has the same hand",
  );

  // Play on to the end, a move at a time on the phone on turn.
  for (let i = 0; !last(a).over; i++) {
    if (i > 600) throw new Error("timed out waiting for the end of the online game");
    await step(on(last(a).turn!), both);
  }
  [sa, sb] = [last(a), last(b)];
  const w = sa.winner!;
  const winner = w === 0 ? "Ana" : "Kai";
  check(
    on(w).text("#lc-result-title") === "You win!" &&
      on(other(w)).text("#lc-result-title") === `${winner} wins!`,
    "both phones show the result",
  );
  check(sa.wins.join() === sb.wins.join() && sa.wins[w] === 1, "both phones keep the score");
  const faceUp = (p: Browser) =>
    p.eval<number>(`() => document.querySelectorAll("#lc-foe .lc-card:not(.back)").length`);
  check(
    faceUp(a) === sb.hand.length && faceUp(b) === sa.hand.length && sa.hand.length + sb.hand.length > 0,
    "once the game is over each phone shows the other hand face up",
  );
  a.screenshot("online-lc-over");
  b.screenshot("online-lc-over-friend");

  // A rematch waits for both players, then the other player goes first.
  b.click("#lc-again");
  await waitFor("rematch asked", () => a.text("#lc-note") === "Kai wants a rematch");
  check(
    b.text("#lc-again") === "Waiting for Ana" &&
      b.eval<boolean>(`() => document.getElementById("lc-again").disabled`),
    "the asker waits for the friend",
  );
  a.screenshot("online-lc-rematch-asked");
  a.click("#lc-again");
  await waitFor("the rematch", () => both.every((p) => !last(p).over && last(p).first === 1));
  check(
    both.every((p) => last(p).wins.join() === sa.wins.join()),
    "the rematch swaps who plays first, and keeps the score",
  );
  check(
    both.every((p) =>
      p.eval<boolean>(
        `() => [...document.querySelectorAll("#lc-foe .lc-card")].every((el) => el.classList.contains("back"))`,
      ),
    ),
    "the new hands are hidden again",
  );

  // Ana leaves the game: both phones go back to the menu.
  a.click("#lc-leave");
  await waitFor("both at the menu", () => atMenu(a) && atMenu(b));
}
