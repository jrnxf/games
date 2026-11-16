// End-to-end: online play against `wrangler dev` on this machine, no
// Cloudflare account needed. Part one talks the party protocol (and golf on
// top of it) with raw WebSocket clients; part two plays through the real UI
// on two headless phones (separate Chrome sessions). Covers making a party,
// joining by link and by code, picking games from either phone, turns, live
// aim, reconnect (page reload and a server restart) and leaving, in golf and
// in a Connect Four game to a win and a rematch. The other board games play
// between the same two phones from their own files (reversi.ts,
// dots-and-boxes.ts).
// Run with `pnpm test:online`.

import { execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyShot, holeOf, type MatchState } from "../../src/games/mini-golf/core/match.ts";
import type { GolfClientMessage, GolfServerMessage } from "../../src/games/mini-golf/core/protocol.ts";
import { findShot } from "../../src/games/mini-golf/core/solver.ts";
import { PROTOCOL, type ClientMessage, type ServerMessage } from "../../src/party/protocol.ts";
import { Browser, check, freePort, serverPort, SHOTS, startServer, waitFor } from "./browser.ts";
import { BOXES_ID, boxesOnline } from "./dots-and-boxes.ts";
import { REVERSI, reversiOnline } from "./reversi.ts";

const PORT = await serverPort();
// Its own devtools port too, so two runs of wrangler dev never clash.
const INSPECTOR = await freePort();
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STATE = mkdtempSync(join(tmpdir(), "games-wrangler-"));
const GOLF = "mini-golf";

let worker: ChildProcess | null = null;

async function startWorker() {
  worker = await startServer(
    "node_modules/.bin/wrangler",
    [
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      String(INSPECTOR),
      "--persist-to",
      STATE,
    ],
    /Ready on/,
  );
}

function stopWorker(): Promise<void> {
  return new Promise((resolve) => {
    if (!worker || worker.exitCode !== null) return resolve();
    worker.removeAllListeners("exit");
    worker.once("exit", () => resolve());
    worker.kill("SIGINT");
  });
}

const token = (c: string) => c.repeat(32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Golf<T extends GolfServerMessage["t"]> = Extract<GolfServerMessage, { t: T }>;

/** A raw protocol client: one WebSocket and every message it received. */
class Client {
  readonly inbox: ServerMessage[] = [];
  closed: number | null = null;
  private ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => this.inbox.push(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = (e) => (this.closed = e.code);
  }

  static async join(code: string, tok: string, name: string, v = PROTOCOL): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/parties/${code}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("socket failed"));
    });
    const c = new Client(ws);
    c.send({ t: "hello", v, token: tok, name });
    return c;
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  golf(m: GolfClientMessage) {
    this.send({ t: "game", game: GOLF, m });
  }

  /** Waits for the next message that matches, and takes it out of the inbox. */
  async next<T extends ServerMessage["t"]>(
    t: T,
    match: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    ms = 5000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const found = await waitFor(
      `"${t}" message`,
      () => this.inbox.find((m): m is Extract<ServerMessage, { t: T }> => m.t === t && match(m as never)),
      ms,
    );
    this.inbox.splice(this.inbox.indexOf(found), 1);
    return found;
  }

  /** Waits for golf's next message of kind `t`. */
  async nextGolf<T extends GolfServerMessage["t"]>(t: T, match: (m: Golf<T>) => boolean = () => true) {
    const msg = await this.next("game", (m) => {
      const g = m.m as GolfServerMessage;
      return m.game === GOLF && g.t === t && match(g as Golf<T>);
    });
    return msg.m as Golf<T>;
  }

  hasGolf(t: GolfServerMessage["t"]): boolean {
    return this.inbox.some((m) => m.t === "game" && (m.m as GolfServerMessage).t === t);
  }

  close() {
    this.ws.close();
  }
}

async function protocolTest() {
  console.log("part 1: party protocol with raw clients");
  const res = await fetch(`${ORIGIN}/api/parties`, { method: "POST" });
  check(res.status === 201, "POST /api/parties makes a party");
  const { code } = (await res.json()) as { code: string };
  check(/^[A-Z0-9]{5}$/.test(code), `party code looks right (${code})`);

  const ana = await Client.join(code, token("a"), "Ana");
  const welcomeA = await ana.next("welcome");
  check(
    welcomeA.seat === 0 && welcomeA.party.status === "waiting" && welcomeA.party.game === null,
    "the maker takes seat 0, at the menu",
  );
  const info = (await (await fetch(`${ORIGIN}/api/parties/${code}`)).json()) as { host: string };
  check(info.host === "Ana", "the invite sees the maker's name");

  const kai = await Client.join(code, token("b"), "Kai");
  check((await kai.next("welcome")).seat === 1, "a friend joins seat 1 from the invite");
  const joined = await ana.next("party", (m) => !!m.party.players[1]);
  check(joined.party.players[1]?.name === "Kai" && joined.party.players[1].connected, "the maker sees them");

  ana.send({ t: "hello", v: PROTOCOL, token: token("d"), name: "Sneaky" });
  check((await ana.next("error")).code === "bad", "a socket cannot claim a second seat");
  const zed = await Client.join(code, token("c"), "Zed");
  check((await zed.next("error")).code === "full", "a third player is turned away");
  await waitFor("third socket closed", () => zed.closed);
  const old = await Client.join(code, token("f"), "Old", PROTOCOL - 1);
  check((await old.next("error")).code === "version", "an out-of-date phone is told to update");

  // The friend's phone drops before they play; another phone takes the seat.
  kai.close();
  await ana.next("party", (m) => m.party.players[1]?.connected === false);
  // A game now would lock the dropped friend's seat: the pick is refused.
  ana.inbox.length = 0;
  ana.send({ t: "pick", game: GOLF });
  await sleep(300);
  check(!ana.inbox.some((m) => m.t === "party"), "the maker can't start a game with the friend's seat empty");
  const kaiPhone = await Client.join(code, token("e"), "Kai");
  const welcomeK = await kaiPhone.next("welcome");
  check(
    welcomeK.seat === 1 && welcomeK.party.game === null && welcomeK.party.status === "waiting",
    "a new phone takes a dropped friend's seat",
  );
  await ana.next("party", (m) => m.party.players[1]?.connected === true);
  const oldPhone = await Client.join(code, token("b"), "Kai");
  check((await oldPhone.next("error")).code === "full", "the old phone no longer owns the seat");
  await waitFor("old phone socket closed", () => oldPhone.closed);

  // Either player picks a game; both phones are told.
  kaiPhone.send({ t: "pick", game: "chess" });
  kaiPhone.send({ t: "pick", game: GOLF });
  const picked = await ana.next("party", (m) => m.party.game !== null);
  check(picked.party.game === GOLF && picked.party.pickedBy === 1, "the friend opens golf for both");
  await kaiPhone.next("party", (m) => m.party.game === GOLF);
  ana.send({ t: "sync", game: GOLF });
  let match: MatchState = (await ana.nextGolf("state")).golf.match;
  check(match.turn === 0 && match.strokes === 0, "golf syncs a fresh round; the maker tees off");
  const stranger = await Client.join(code, token("c"), "Zed");
  check((await stranger.next("error")).code === "full", "once they have played, a dropped seat is kept");

  ana.golf({ t: "aim", aim: { angle: -1.5, power: 0.4 } });
  const aim = await kaiPhone.nextGolf("aim");
  check(aim.seat === 0 && aim.aim?.power === 0.4, "the friend sees the live aim");
  kaiPhone.golf({ t: "aim", aim: { angle: 1, power: 0.5 } });
  await sleep(300);
  check(!ana.hasGolf("aim"), "aim out of turn is not relayed");

  kaiPhone.golf({ t: "shot", shot: { vx: 0, vy: -300 }, at: 0 });
  await kaiPhone.nextGolf("state");
  check(!ana.hasGolf("shot"), "a stroke out of turn is refused and that phone resynced");

  const shot = findShot(holeOf(match), match.balls[0]).shot;
  ana.golf({ t: "shot", shot, at: 0 });
  const [sa, sk] = [await ana.nextGolf("shot"), await kaiPhone.nextGolf("shot")];
  const local = applyShot(match, 0, shot)!.state;
  check(JSON.stringify(sa.golf.match) === JSON.stringify(local), "server and client physics agree");
  check(JSON.stringify(sk.golf.match) === JSON.stringify(local), "both phones get the same result");
  match = sa.golf.match;

  ana.golf({ t: "shot", shot, at: 0 });
  check((await ana.nextGolf("state")).golf.match.strokes === 1, "a repeated stroke is refused and resynced");

  kaiPhone.close();
  await ana.next("party", (m) => m.party.players[1]?.connected === false);
  const kai2 = await Client.join(code, token("e"), "Kai");
  const back = await kai2.next("welcome");
  kai2.send({ t: "sync", game: GOLF });
  const resynced = await kai2.nextGolf("state");
  check(
    back.seat === 1 &&
      back.party.game === GOLF &&
      JSON.stringify(resynced.golf.match) === JSON.stringify(match),
    "the friend reconnects into the same seat, game and state",
  );
  await ana.next("party", (m) => m.party.players[1]?.connected === true);

  // Play out the hole, alternating as the rules say.
  const clients = [ana, kai2] as const;
  while (match.phase === "aim") {
    const seat = match.turn;
    const s = findShot(holeOf(match), match.balls[seat]).shot;
    clients[seat].golf({ t: "shot", shot: s, at: match.strokes });
    match = (await clients[seat].nextGolf("shot")).golf.match;
  }
  check(match.phase === "holeDone", "both balls in: hole done");
  ana.golf({ t: "ready" });
  const waiting = await kai2.nextGolf("state", (m) => m.golf.ready[0]);
  check(waiting.golf.match.holeIdx === 0, "the next hole waits for both players");
  kai2.golf({ t: "ready" });
  const hole2 = await ana.nextGolf("state", (m) => m.golf.match.holeIdx === 1);
  check(hole2.golf.match.phase === "aim", "both ready: hole 2 starts");

  // Back to the menu, then golf again: a fresh round.
  ana.send({ t: "pick", game: null });
  const menu = await kai2.next("party", (m) => m.party.game === null);
  check(menu.party.pickedBy === 0, "the maker takes both phones back to the menu");
  await ana.next("party", (m) => m.party.game === null);
  ana.inbox.length = 0;
  ana.golf({ t: "ready" });
  ana.send({ t: "sync", game: GOLF });
  await sleep(300);
  check(!ana.hasGolf("state"), "a closed game answers nothing");
  kai2.send({ t: "pick", game: GOLF });
  await ana.next("party", (m) => m.party.game === GOLF);
  ana.send({ t: "sync", game: GOLF });
  check((await ana.nextGolf("state")).golf.match.holeIdx === 0, "picking golf again starts a new round");

  kai2.send({ t: "leave" });
  const ended = await ana.next("party", (m) => m.party.status === "ended");
  check(ended.party.leftBy === 1 && ended.party.game === null, "the maker is told the friend left");
  const gone = await Client.join(code, token("e"), "Kai");
  check((await gone.next("error")).code === "gone", "a finished party cannot be rejoined");
  const missing = await fetch(`${ORIGIN}/api/parties/BCDFG`);
  check(missing.status === 404, "unknown parties are 404");
  ana.close();
}

const FOUR = "connect-four";

/** What Connect Four's test hook reports. */
interface FourState {
  moves: number[];
  turn: 0 | 1;
  winner: 0 | 1 | null;
  col: number;
  busy: boolean;
  wins: [number, number];
  me: 0 | 1 | null;
  locked: boolean;
  rematch: [boolean, boolean] | null;
  ghost: boolean;
}

const four = (p: Browser) => p.eval<FourState>("() => window.__connectFour.state()");
const fourToast = (p: Browser) =>
  p.eval<boolean>(`() => document.getElementById("c4-toast").classList.contains("on")`);

/**
 * Makes `p`'s link slow: everything it sends leaves `ms` late, so the host's
 * answer to a drop lands well after the chip. Also counts the chips that fall
 * on its board and records its toasts, for `slowSeen`. Null puts it back.
 */
function slowLink(p: Browser, ms: number | null) {
  p.run(`await page.eval(() => {
    const w = window;
    w.__send ??= WebSocket.prototype.send;
    const send = w.__send;
    const ms = ${JSON.stringify(ms)};
    WebSocket.prototype.send = ms === null ? send : function (data) { setTimeout(() => send.call(this, data), ms); };
    w.__falls = 0;
    w.__toasts = [];
    w.__watch?.disconnect();
    w.__watch = new MutationObserver((records) => {
      for (const r of records) {
        if (r.target.id === "c4-toast") w.__toasts.push(r.target.textContent);
        for (const n of r.addedNodes) if (n.classList?.contains("c4-falling")) w.__falls++;
      }
    });
    w.__watch.observe(document.getElementById("c4-board"), { childList: true });
    w.__watch.observe(document.getElementById("c4-toast"), { childList: true, characterData: true, subtree: true });
  });`);
}

/** What `slowLink` saw on `p` since it was set. */
const slowSeen = (p: Browser) =>
  p.eval<{ falls: number; toasts: string[] }>("() => ({ falls: window.__falls, toasts: window.__toasts })");

/** Aims with the arrows and taps Drop on `p`, then waits for the chip to land on both phones. */
async function fourDrop(p: Browser, other: Browser, col: number) {
  await waitFor("on turn", () => !four(p).locked);
  const n = four(p).moves.length;
  while (four(p).col < col) p.click("#c4-right");
  while (four(p).col > col) p.click("#c4-left");
  p.click("#c4-drop");
  await waitFor(`chip in column ${col} on both phones`, () =>
    [p, other].every((x) => {
      const s = four(x);
      return s.moves.length === n + 1 && s.moves[n] === col && !s.busy;
    }),
  );
}

/** Connect Four between the two phones: a game to a win, a reload mid-game, a rematch and a leave while offline. */
async function connectFour(a: Browser, b: Browser, atMenu: (p: Browser) => boolean) {
  // Kai picks Connect Four, so Kai drops first.
  b.click(`#tiles a[data-id="${FOUR}"]`);
  await waitFor("both in Connect Four", () => four(a).me === 0 && four(b).me === 1 && four(b).turn === 1);
  check(a.eval<string>("() => location.pathname") === `/${FOUR}`, "the maker's phone opens Connect Four too");
  check(!four(b).locked && four(a).locked, "the player who picked it drops first");
  check(
    a.visible("c4-wait") && !a.visible("c4-controls") && a.text("#c4-wait-text") === "Waiting for Kai",
    "the other phone waits, with no controls",
  );
  check(
    a.text("#c4-pl-1 .c4-sub") === "Their turn" && b.text("#c4-pl-1 .c4-sub") === "Your turn",
    "the cards say whose turn",
  );

  // Kai aims: Ana sees his chip, dimmed, over the column.
  b.click("#c4-right");
  await waitFor("ghost aim", () => four(a).col === 4 && four(a).ghost);
  check(!four(b).ghost, "the friend sees the live aim as a dimmed chip");
  a.screenshot("online-c4-friend-aiming");
  b.screenshot("online-c4-your-aim");

  // Kai stacks column 3, Ana column 2.
  await fourDrop(b, a, 3);
  await waitFor("your-turn toast", () => fourToast(a));
  check(a.text("#c4-toast") === "Your turn", "the maker gets the your-turn alert");
  a.screenshot("online-c4-your-turn");
  await fourDrop(a, b, 2);
  await fourDrop(b, a, 3);

  // Ana's page reloads on her turn: the same board, still her turn.
  a.open(`${ORIGIN}/${FOUR}`);
  await waitFor("maker back in the game", () => four(a).me === 0 && four(a).moves.join() === "3,2,3");
  await waitFor("maker on turn after reload", () => !four(a).locked);
  check(true, "after a reload the maker is on the same board, still on turn");
  await fourDrop(a, b, 2);
  await fourDrop(b, a, 3);
  await fourDrop(a, b, 2);
  await fourDrop(b, a, 3);
  await waitFor("game over", () => four(a).winner === 1 && four(b).winner === 1);
  check(
    b.text("#c4-result-title") === "You win!" && a.text("#c4-result-title") === "Kai wins!",
    "four in a row wins, on both phones",
  );
  check(four(a).wins.join() === "0,1" && four(b).wins.join() === "0,1", "both phones keep the score");

  // A rematch waits for both players, then the other player drops first.
  a.click("#c4-again");
  await waitFor("rematch asked", () => b.text("#c4-note") === "Ana wants a rematch");
  check(
    a.text("#c4-again") === "Waiting for Kai" &&
      a.eval<boolean>(`() => document.getElementById("c4-again").disabled`),
    "the asker waits for the friend",
  );
  a.screenshot("online-c4-rematch-waiting");
  b.screenshot("online-c4-rematch-asked");
  b.click("#c4-again");
  await waitFor("rematch", () =>
    [a, b].every((p) => four(p).moves.length === 0 && four(p).turn === 0 && !four(p).busy),
  );
  check(
    !four(a).locked && four(b).locked && four(b).wins.join() === "0,1",
    "the rematch swaps who goes first",
  );

  // On a slow link the host answers after the chip has landed. The chip stays
  // put: it falls once, with no "Connection hiccup" toast.
  slowLink(a, 1500);
  await fourDrop(a, b, 3);
  await new Promise((r) => setTimeout(r, 2500));
  const seen = slowSeen(a);
  slowLink(a, null);
  check(
    seen.falls === 1 && !seen.toasts.some((t) => t.includes("hiccup")) && four(a).moves.join() === "3",
    `on a slow link the chip falls once and stays (falls ${seen.falls}, toasts ${JSON.stringify(seen.toasts)})`,
  );

  // The connection drops. Ana can still leave the game: her phone goes at once,
  // and Kai's follows once the server is back.
  await stopWorker();
  await waitFor(
    "maker notices",
    () => a.visible("c4-banner") && a.text("#c4-banner").includes("reconnecting"),
  );
  check(four(a).locked, "offline, the board takes no taps");
  a.screenshot("online-c4-reconnecting");
  a.click("#c4-leave");
  await waitFor("maker at the menu while offline", () => atMenu(a));
  check(!atMenu(b), "offline, leaving Connect Four works on the maker's phone");
  await startWorker();
  await waitFor("friend at the menu", () => atMenu(b), 30_000);
  await waitFor("maker reconnected", () => a.text("#menu-chip-text") === "Online · with Kai", 30_000);
  check(true, "the friend follows to the menu once the server is back");
}

/** Plays the solver's stroke for whoever is on turn, from `phone`. */
function playStroke(phone: Browser) {
  const m = phone.state().match!;
  const s = findShot(holeOf(m), m.balls[m.turn]);
  phone.drag(s.angle, s.power);
}

async function sameState(a: Browser, b: Browser, strokes: number) {
  await waitFor(`stroke ${strokes} on both phones`, () => {
    const [ma, mb] = [a.state().match, b.state().match];
    return ma?.strokes === strokes && JSON.stringify(ma) === JSON.stringify(mb);
  });
}

async function uiTest() {
  console.log("part 2: two phones through the UI");
  const a = new Browser("games-e2e-online-a");
  const b = new Browser("games-e2e-online-b");
  // A second screen on the maker's own phone, later on.
  const c = new Browser("games-e2e-online-c");
  const TOAST_ON = `() => document.getElementById("menu-toast").classList.contains("on")`;
  const tile = (id: string) => `#tiles a[data-id="${id}"]`;
  const tileOff = (p: Browser, id: string) =>
    p.eval<boolean>(`() => document.querySelector('${tile(id)}').classList.contains("off")`);
  const atMenu = (p: Browser) => p.visible("games") && p.eval<string>("() => location.pathname") === "/";
  try {
    // Ana makes a party.
    a.open(`${ORIGIN}/`);
    await a.pickSession("online", ["Ana"]);
    await waitFor("party step", () => a.visible("start-party"));
    a.screenshot("online-party-step");
    a.click("#party-create");
    await waitFor("menu with a code", () => a.visible("games") && a.visible("menu-party"));
    const code = a.text("#menu-party-code");
    check(/^[A-Z0-9]{5}$/.test(code), `the menu shows the party code (${code})`);
    check(a.text("#menu-invite-url").endsWith(`/p/${code}`), "the menu shows the invite link");
    check(a.text("#menu-chip-text") === "Online · Waiting for a friend", "the chip says who's missing");
    for (const id of [GOLF, FOUR, REVERSI, BOXES_ID]) {
      check(
        tileOff(a, id) && a.text(`${tile(id)} small`) === "Waiting for a friend",
        `${id} waits for a friend`,
      );
    }
    a.click(tile(FOUR));
    check(atMenu(a) && a.visible("menu-party"), "a dimmed tile does not open");
    a.screenshot("online-menu-waiting");

    // Kai follows an old golf room link on a phone that has never been here.
    // The page rewrites its own URL, so it loads from a tab already open: axi finds pages by URL.
    b.open(`${ORIGIN}/`);
    b.eval(`() => { location.href = "/mini-golf/r/${code}"; }`);
    await waitFor("invite", () => b.visible("start-names") && b.text("#start-title") === "Ana invited you");
    check(b.eval<string>("() => location.pathname") === `/p/${code}`, "old room links go to the party");
    check(b.text("#start-lead").includes(code), "the invite names the party");
    b.screenshot("online-invite");
    b.fill("#start-name-0", "Kai");
    b.click("#start-go");
    await waitFor("friend at the menu", () => atMenu(b) && b.text("#menu-chip-text") === "Online · with Ana");
    await waitFor("maker sees friend", () => a.text("#menu-chip-text") === "Online · with Kai");
    check(!a.visible("menu-party") && !tileOff(a, GOLF), "the code card goes and golf opens up");
    check(!tileOff(b, FOUR), "Connect Four is open on the friend's phone too");
    a.screenshot("online-menu-together-a");
    b.screenshot("online-menu-together-b");

    await connectFour(a, b, atMenu);
    await reversiOnline(a, b, ORIGIN, atMenu);
    await boxesOnline(a, b, ORIGIN, atMenu);

    // Ana picks golf, with Ctrl held: online a tile never opens a new tab (it would push this one out).
    const prevented = a.eval<boolean>(`() => {
      const e = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
      document.querySelector('${tile(GOLF)}').dispatchEvent(e);
      return e.defaultPrevented;
    }`);
    check(prevented, "a Ctrl-click on a tile stays in this tab");
    await waitFor("both in golf", () => a.state().match && b.state().match);
    check(true, "the tile asks the party, and both phones open golf");
    check(a.state().me === 0 && b.state().me === 1, "each phone plays its own seat");
    check(a.state().canAim && !b.state().canAim, "the maker's turn on the maker's phone only");
    check(b.text("#turn-who") === "Ana is aiming", "the friend's phone says who is aiming");

    // Ghost aim: Ana holds a drag, Kai sees the line.
    const m0 = a.state().match!;
    const s0 = findShot(holeOf(m0), m0.balls[0]);
    a.drag(s0.angle, s0.power * 0.8, { hold: true });
    await sleep(400);
    b.screenshot("online-friend-aiming");
    a.release(s0.angle, s0.power * 0.8);
    await sameState(a, b, 1);
    check(true, "the stroke lands the same on both phones");
    await waitFor("your-turn toast", () =>
      b.eval<boolean>(`() => document.getElementById("toast").classList.contains("on")`),
    );
    check(b.text("#toast") === "Your turn", "the friend gets the your-turn alert");
    b.screenshot("online-your-turn");
    await waitFor("friend can aim", () => b.state().canAim);
    playStroke(b);
    await sameState(a, b, 2);
    check(true, "the friend's stroke lands the same on both phones");

    // Ana goes back to the menu: both phones do.
    await waitFor("maker idle", () => !a.state().busy);
    a.click("#menu-btn");
    a.click("#menu-quit");
    await waitFor("both at the menu", () => atMenu(a) && atMenu(b));
    check(b.text("#menu-toast") === "Ana went back to the menu", "the friend is told why");
    b.screenshot("online-back-to-menu");

    // Now Kai picks golf: a fresh round on both phones.
    b.click(tile(GOLF));
    await waitFor(
      "both in golf again",
      () => a.state().match?.strokes === 0 && b.state().match?.strokes === 0,
    );
    check(a.eval<string>("() => location.pathname") === `/${GOLF}`, "the maker's phone followed");
    await waitFor("maker can aim", () => a.state().canAim);
    playStroke(a);
    await sameState(a, b, 1);

    // A dropped tab: Kai's page reloads and takes the seat back, in the game.
    b.open(`${ORIGIN}/${GOLF}`);
    await waitFor("rejoined", () => b.state().match?.strokes === 1 && b.state().me === 1);
    await waitFor("friend can aim after reload", () => b.state().canAim);
    check(true, "after a reload the friend is back in the game, still on turn");

    // A dropped connection: the server restarts; both phones reconnect by themselves.
    await stopWorker();
    await waitFor("maker notices", () => a.visible("banner") && a.text("#banner").includes("reconnecting"));
    a.screenshot("online-reconnecting");
    await startWorker();
    await waitFor(
      "maker reconnected",
      () => !a.visible("banner") || a.text("#banner") === "Back online",
      30_000,
    );
    await waitFor("friend reconnected", () => b.state().canAim, 30_000);
    check(true, "both phones reconnect after the connection drops");
    playStroke(b);
    await sameState(a, b, 2);
    check(true, "play carries on after the reconnect");

    // The connection drops again. Kai can still leave the game, then the party:
    // his phone goes at once, and the party hears it once the server is back.
    await waitFor("friend idle", () => !b.state().busy);
    await stopWorker();
    await waitFor("friend notices", () => b.visible("banner") && b.text("#banner").includes("reconnecting"));
    b.click("#menu-btn");
    b.click("#menu-quit");
    await waitFor("friend at the menu while offline", () => atMenu(b));
    check(!atMenu(a) && a.state().match !== null, "offline, leaving the game works on the friend's phone");
    b.click("#menu-chip");
    await waitFor("mode picker", () => b.visible("start-mode"));
    b.click('[data-mode="online"]');
    await waitFor("leave button", () => b.visible("start-leave"));
    check(b.text("#start-lead").includes(code), "the names screen says which party you're in");
    b.screenshot("online-names-in-party");
    b.click("#start-leave");
    await waitFor("friend on the party step", () => b.visible("start-party"));
    await startWorker();
    await waitFor(
      "maker told",
      () => a.visible("start-party") && a.text("#party-note") === "Kai left the party.",
      30_000,
    );
    check(true, "a leave made while offline reaches the maker once the server is back");
    check(b.visible("start-party"), "the friend stays out of the party");
    a.screenshot("online-friend-left");

    // A new party, joined by typing the code.
    a.click("#party-create");
    await waitFor("new code", () => a.visible("menu-party") && a.text("#menu-party-code") !== code);
    const code2 = a.text("#menu-party-code");
    b.fill("#party-input", code2.toLowerCase());
    b.screenshot("online-enter-code");
    b.click('#party-form button[type="submit"]');
    await waitFor("joined by code", () => atMenu(b) && b.text("#menu-chip-text") === "Online · with Ana");
    await waitFor("maker sees friend again", () => a.text("#menu-chip-text") === "Online · with Kai");
    check(true, "a friend joins by typing the code");

    b.click("#menu-chip");
    await waitFor("mode picker", () => b.visible("start-mode"));
    b.click('[data-mode="online"]');
    await waitFor("names", () => b.visible("start-names"));
    b.fill("#start-name-0", "Kai");
    b.click("#start-go");
    await waitFor(
      "friend still with Ana",
      () => atMenu(b) && b.text("#menu-chip-text") === "Online · with Ana",
    );
    check(true, "continuing with the same party keeps it");

    // Ana's party opens on another screen (a copy of her phone's storage) and pushes this one out.
    const storage = a.eval<string>(`() => JSON.stringify(Object.fromEntries(
      Object.keys(localStorage).filter((k) => k.startsWith("shell.")).map((k) => [k, localStorage.getItem(k)])))`);
    c.open(`${ORIGIN}/`);
    c.eval(`() => {
      for (const [k, v] of Object.entries(${storage})) localStorage.setItem(k, v);
      location.reload();
    }`);
    await waitFor("pushed out", () => a.text("#menu-chip-text") === "Online · On another screen");
    check(
      a.text("#menu-toast") === "Playing on another screen now",
      "the first screen is told it was replaced",
    );
    await waitFor("toast gone", () => !a.eval<boolean>(TOAST_ON));
    c.stop();
    // Ana takes it back from the chip: no stale "another screen" news while it reconnects.
    a.click("#menu-chip");
    await waitFor("mode picker", () => a.visible("start-mode"));
    a.click('[data-mode="online"]');
    await waitFor("names", () => a.visible("start-names"));
    a.click("#start-go");
    let replacedToast = false;
    await waitFor("maker back", () => {
      replacedToast ||=
        a.eval<boolean>(TOAST_ON) && a.text("#menu-toast") === "Playing on another screen now";
      return atMenu(a) && a.text("#menu-chip-text") === "Online · with Kai";
    });
    check(!replacedToast, "taking the seat back shows no stale “another screen” toast");

    // A dead invite link while in a party: Ana stays in hers, and Kai never sees her go.
    a.eval(`() => { location.href = "/p/ZZZZZ"; }`);
    await waitFor(
      "dead invite",
      () => atMenu(a) && a.text("#menu-toast") === "That party has ended or expired. Make a new code.",
    );
    await waitFor("maker still in", () => a.text("#menu-chip-text") === "Online · with Kai");
    check(
      a.eval<string | null>(`() => localStorage.getItem("shell.party")`) === code2,
      "a failed join keeps the party this phone was in",
    );
    check(b.text("#menu-chip-text") === "Online · with Ana", "the friend still sees the maker");

    // A good invite to another party: Ana moves over, and the old party hears she left.
    const res3 = await fetch(`${ORIGIN}/api/parties`, { method: "POST" });
    const { code: code3 } = (await res3.json()) as { code: string };
    a.eval(`() => { location.href = "/p/${code3}"; }`);
    await waitFor("maker in the new party", () => atMenu(a) && a.text("#menu-party-code") === code3);
    await waitFor(
      "friend told",
      () => b.visible("start-party") && b.text("#party-note") === "Ana left the party.",
    );
    check(true, "joining another party leaves the old one, and the friend is told");

    for (const [name, browser] of [
      ["maker", a],
      ["friend", b],
    ] as const) {
      // The server restart above makes the browser log failed socket connections; nothing else is allowed.
      const errors = browser
        .consoleErrors()
        .split("\n")
        .filter((l) => /msgid=/.test(l))
        .filter((l) => !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource/.test(l));
      if (errors.length) console.log(browser.consoleErrors());
      check(errors.length === 0, `no unexpected console errors on the ${name}'s phone`);
    }
  } finally {
    a.stop();
    b.stop();
    c.stop();
  }
}

execFileSync("pnpm", ["build"], { stdio: "inherit" });
await startWorker();
try {
  console.log(`online e2e at ${ORIGIN} (screenshots in ${SHOTS})`);
  await protocolTest();
  await uiTest();
  console.log("online e2e passed");
} finally {
  await stopWorker();
  rmSync(STATE, { recursive: true, force: true });
}
