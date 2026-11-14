// End-to-end: online play against `wrangler dev` on this machine, no
// Cloudflare account needed. Part one talks the party protocol (and golf on
// top of it) with raw WebSocket clients; part two plays through the real UI
// on two headless phones (separate Chrome sessions). Covers making a party,
// joining by link and by code, picking games from either phone, turns, live
// aim, reconnect (page reload and a server restart) and leaving.
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
  const info = (await (await fetch(`${ORIGIN}/api/parties/${code}`)).json()) as {
    host: string;
    open: boolean;
  };
  check(info.host === "Ana" && info.open, "the invite sees the maker's name and an open seat");

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
  const reopened = (await (await fetch(`${ORIGIN}/api/parties/${code}`)).json()) as { open: boolean };
  check(reopened.open, "the seat is open again after the friend drops");
  const kaiPhone = await Client.join(code, token("e"), "Kai");
  check((await kaiPhone.next("welcome")).seat === 1, "a new phone takes a dropped friend's seat");
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
    check(
      tileOff(a, GOLF) && a.text(`${tile(GOLF)} small`) === "Waiting for a friend",
      "golf waits for a friend",
    );
    check(
      tileOff(a, "connect-four") && a.text(`${tile("connect-four")} small`) === "Not online yet",
      "Connect Four stays dimmed with its reason",
    );
    a.click(tile("connect-four"));
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
    check(tileOff(b, "connect-four"), "Connect Four is dimmed on the friend's phone too");
    a.screenshot("online-menu-together-a");
    b.screenshot("online-menu-together-b");

    // A link to a game with no online play keeps the party at the menu.
    b.open(`${ORIGIN}/connect-four`);
    await waitFor("menu toast", () => atMenu(b) && b.text("#menu-toast") === "Connect Four: not online yet");
    await waitFor("friend back", () => b.text("#menu-chip-text") === "Online · with Ana");
    check(!b.visible("c4-home"), "a link to a game with no online play shows the menu and says why");
    b.screenshot("online-not-online-yet");

    // Ana picks golf: both phones open it.
    a.click(tile(GOLF));
    await waitFor("both in golf", () => a.state().match && b.state().match);
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

    // Kai leaves the party from the chip; Ana is told.
    await waitFor("friend idle", () => !b.state().busy);
    b.click("#menu-btn");
    b.click("#menu-quit");
    await waitFor("both at the menu again", () => atMenu(a) && atMenu(b));
    check(a.text("#menu-toast") === "Kai went back to the menu", "the maker is told why");
    b.click("#menu-chip");
    await waitFor("mode picker", () => b.visible("start-mode"));
    b.click('[data-mode="online"]');
    await waitFor("leave button", () => b.visible("start-leave"));
    check(b.text("#start-lead").includes(code), "the names screen says which party you're in");
    b.screenshot("online-names-in-party");
    b.click("#start-leave");
    await waitFor("friend on the party step", () => b.visible("start-party"));
    await waitFor(
      "maker told",
      () => a.visible("start-party") && a.text("#party-note") === "Kai left the party.",
    );
    check(true, "the maker sees that the friend left");
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
