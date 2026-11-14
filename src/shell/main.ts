// The app shell: the session (how you're playing), the game menu, and a router
// that hands each /<game>/... path to that game's code, loaded the first time
// it opens. Online, the party decides which game is open: the router follows
// it on both phones, and a tap or a back button only asks the party for a
// change.

import "@fontsource-variable/outfit/wght.css";
import "./base.css";
import "./menu.css";

import { isCode, normalizeCode } from "../party/protocol.ts";
import { $, show } from "./dom.ts";
import { GAMES, blurb, refusal, unsupported, type GameInfo, type GameModule } from "./games.ts";
import { go, onRoute } from "./nav.ts";
import { PartyClient, createParty, invitePath, partyHost } from "./party.ts";
import {
  describe,
  lastNames,
  loadSession,
  saveSession,
  type OnlineSession,
  type Session,
} from "./session.ts";
import { askName, initStart, pickParty, pickSession } from "./start.ts";

const TITLE = "Games";
const THEME = "#181a28";

const modules = new Map<string, Promise<GameModule>>();
let current: { info: GameInfo; mod: GameModule } | null = null;
/** Bumped on every route, so a slow game load cannot open over a later choice. */
let routeId = 0;

/** The party this phone is in, while the session is online. */
let party: PartyClient | null = null;
/** The name `party` was joined under, to rejoin after a change. */
let partyName = "";
/** Set while joining a party that is not saved yet: a code just made, typed or followed from a link. */
let joining: string | null = null;
/** The game the router last followed the party to; undefined before the first party view. */
let followed: string | null | undefined;

function loadGame(info: GameInfo): Promise<GameModule> {
  let mod = modules.get(info.id);
  if (!mod) {
    mod = info.load();
    // A failed load (offline before the chunk was cached) may succeed next time.
    mod.catch(() => modules.delete(info.id));
    modules.set(info.id, mod);
  }
  return mod;
}

function theme(info: GameInfo | null) {
  if (info) document.body.dataset.game = info.id;
  else delete document.body.dataset.game;
  document.title = info ? `${info.title} · ${TITLE}` : TITLE;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", info?.themeColor ?? THEME);
}

function leaveGame() {
  current?.mod.close();
  current = null;
  party?.closeChannel();
}

/**
 * Clears the screen for a new route: any game closed, the app's own colours,
 * and a slow game load called off. With `home`, the URL goes back to the menu too.
 */
function resetScreen(home: boolean) {
  ++routeId;
  leaveGame();
  theme(null);
  if (home && location.pathname !== "/") history.replaceState(null, "", "/");
}

function showMenu() {
  leaveGame();
  theme(null);
  const session = loadSession();
  if (!session) return pickSession(null, null);
  paintMenu(session);
  show("games");
}

/** Why online games can't open right now, or null when they can. */
function partyBlocked(): string | null {
  if (!party) return "Not in a party";
  if (party.error === "version") return "Reload to update";
  if (party.error === "replaced") return "On another screen";
  if (party.status !== "open" || !party.view) return "Connecting...";
  if (!party.friend) return "Waiting for a friend";
  return null;
}

/** The chip, the party code and the tiles, for `session`. */
function paintMenu(session: Session) {
  const online = session.mode === "online";
  const blocked = online ? partyBlocked() : null;
  const friend = party?.friend ?? null;
  const dot = $("menu-chip-dot");
  dot.hidden = !online;
  dot.className = "dot";
  if (!online) {
    $("menu-chip-text").textContent = describe(session);
  } else if (blocked && blocked !== "Waiting for a friend") {
    $("menu-chip-text").textContent = `Online · ${blocked}`;
    dot.classList.add("wait");
  } else if (!friend) {
    $("menu-chip-text").textContent = "Online · Waiting for a friend";
  } else {
    $("menu-chip-text").textContent = friend.connected
      ? `Online · with ${friend.name}`
      : `Online · ${friend.name} is away`;
    dot.classList.add(friend.connected ? "live" : "wait");
  }

  // Until a friend is seated, the code to send them sits above the games.
  const code = online && party && party.view && !friend ? party.code : null;
  $("menu-party").hidden = !code;
  if (code) {
    $("menu-party-code").textContent = code;
    $("menu-invite-url").textContent = `${location.host}${invitePath(code)}`;
  }

  for (const a of tiles.querySelectorAll<HTMLAnchorElement>("a.tile")) {
    const info = GAMES.find((g) => g.id === a.dataset.id)!;
    const why = unsupported(info, session.mode) ?? blocked;
    a.classList.toggle("off", why !== null);
    if (why) a.setAttribute("aria-disabled", "true");
    else a.removeAttribute("aria-disabled");
    a.querySelector("small")!.textContent = why ?? blurb(info, session.mode);
  }
}

/** Where `path` points: a game, or null for the menu. */
function gameAt(path: string): { info: GameInfo; rest: string } | null {
  const [, first = "", rest = ""] = /^\/([^/]*)(.*)$/.exec(path) ?? [];
  const info = GAMES.find((g) => g.id === first);
  return info ? { info, rest: rest.replace(/\/$/, "") } : null;
}

async function route(): Promise<void> {
  const path = location.pathname;

  // Old per-game room links now go to the party with the same code.
  const old = /^\/mini-golf\/r\/([^/]+)\/?$/.exec(path);
  if (old) {
    history.replaceState(null, "", invitePath(normalizeCode(decodeURIComponent(old[1]!))));
    return route();
  }
  const invite = /^\/p\/([^/]*)\/?$/.exec(path);
  if (invite) return followInvite(normalizeCode(decodeURIComponent(invite[1]!)));

  const target = gameAt(path);
  const session = loadSession();
  if (!session) {
    // A link straight to a game: ask how they're playing, then carry on to it.
    resetScreen(false);
    return pickSession(null, null);
  }
  if (session.mode === "online") return routeOnline(session, target);
  if (!target) {
    resetScreen(true);
    return showMenu();
  }
  return openGame(target.info, target.rest, session);
}

async function openGame(info: GameInfo, rest: string, session: Session) {
  const id = ++routeId;
  const why = refusal(info, session.mode);
  if (why) {
    history.replaceState(null, "", "/");
    showMenu();
    return toast(why);
  }
  if (current && current.info !== info) leaveGame();
  theme(info);
  let mod: GameModule;
  try {
    mod = await loadGame(info);
  } catch {
    if (id !== routeId) return;
    if (session.mode === "online") party?.pick(null);
    history.replaceState(null, "", "/");
    showMenu();
    return toast(
      navigator.onLine ? `${info.title} didn't load. Try again.` : "You're offline. Connect once to load it.",
    );
  }
  if (id !== routeId) return;
  current = { info, mod };
  if (session.mode === "online") {
    if (!party) return showMenu();
    mod.open(rest, { ...session, channel: party.open(info.id) });
  } else {
    mod.open(rest, session);
  }
}

function toast(text: string) {
  const el = $("menu-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(setTimeout(() => el.classList.remove("on"), 2600));
}

// ---------- party ----------

/** A user went to `target` online: open what the party has open, or ask it for a change. */
function routeOnline(session: OnlineSession, target: { info: GameInfo; rest: string } | null) {
  if (!session.party) {
    resetScreen(true);
    return pickParty();
  }
  connect(session.party, session.names[0]);
  const p = party!;
  // A link to a game this party can't play: stay on what it has open, and say why.
  const why = target && refusal(target.info, "online");
  if (why) toast(why);
  if (!p.view || p.me === null) {
    // Not seated yet: the menu says so, and the welcome brings the party's game.
    ++routeId;
    return showMenu();
  }
  const want = target?.info.id ?? null;
  if (why || want === p.game) return follow(true);
  if (want === null) {
    // Back to the menu (the back button, say): close here at once, then for both.
    // While disconnected the party hears it once the socket is back.
    if (p.pick(null)) {
      ++routeId;
      followed = null;
      return showMenu();
    }
  } else if (!partyBlocked()) {
    p.pick(want);
  }
  // Until the party agrees, stay on what it has open.
  follow(true);
}

/** Takes the URL and the screen to the party's game, when it changed (or when `force`). */
function follow(force = false) {
  const p = party;
  const view = p?.view;
  if (!p || !view || p.me === null) return;
  const game = p.game;
  const changed = game !== followed;
  const was = followed;
  followed = game;
  if (!changed && !force) {
    const s = loadSession();
    if (s && $("games").classList.contains("on")) paintMenu(s);
    return;
  }
  const info = game ? GAMES.find((g) => g.id === game) : undefined;
  if (game && !info) {
    // A game this version doesn't have: back to the menu for both.
    p.pick(null);
    return;
  }
  if (info) {
    const path = `/${info.id}`;
    if (gameAt(location.pathname)?.info !== info) history.pushState({ party: true }, "", path);
    if (current?.info === info) return;
    void openGame(info, "", loadSession() ?? { mode: "online", names: [partyName], party: p.code });
    return;
  }
  if (location.pathname !== "/") {
    // Drop the game's history entry when the party pushed it, so back doesn't reopen it.
    if (pushedByParty()) history.back();
    else history.replaceState(null, "", "/");
  }
  ++routeId;
  showMenu();
  const by = view.pickedBy;
  // The friend's doing only when the party itself went back (not this phone, while offline).
  if (was && changed && view.game === null && by !== null && by !== p.me) {
    toast(`${view.players[by]?.name ?? "Your friend"} went back to the menu`);
  }
}

/** True when the current history entry is a game the party opened, on top of the menu. */
function pushedByParty(): boolean {
  return (history.state as { party?: boolean } | null)?.party === true;
}

/** Connects to party `code` as `name`, unless already connected that way. */
function connect(code: string, name: string) {
  if (party && party.code === code && partyName === name && !party.error && party.status !== "closed") return;
  party?.close();
  followed = undefined;
  partyName = name;
  // Only the current client may move the screens: an old one can still be mid-change.
  const client = new PartyClient(code, name, () => {
    if (party === client) onParty();
  });
  party = client;
  client.start();
}

/** Tells party `code` this phone left it, in the background, once it can reach it. */
function leaveInBackground(code: string, name: string) {
  const client = new PartyClient(code, name, () => {});
  client.start();
  client.leave();
}

function disconnect() {
  party?.close();
  party = null;
  followed = undefined;
}

/**
 * Joins party `code` from the start screens or an invite: saved once the party
 * seats this phone. The party it was in stays saved until then, and is told
 * this phone left only once the new one has a seat for it.
 */
function join(code: string) {
  const s = loadSession();
  if (s?.mode !== "online") return;
  if (s.party === code && party?.code === code && party.me !== null) return void go("/");
  joining = code;
  pickParty(`Joining party ${code}...`, "busy");
  connect(code, s.names[0]);
}

/** The party seated this phone: it's ours now, and a reload rejoins it. */
function joined(code: string) {
  joining = null;
  const s = loadSession();
  if (s?.mode !== "online") return;
  if (s.party && s.party !== code) leaveInBackground(s.party, s.names[0]);
  saveSession({ ...s, party: code });
}

/** A join failed: back to the party this phone was in, if any, else the party step. */
function joinFailed(why: string) {
  joining = null;
  const s = loadSession();
  if (s?.mode !== "online" || !s.party) return forget(why, true);
  connect(s.party, s.names[0]);
  resetScreen(true);
  void route();
  toast(why);
}

/**
 * Leaves the party for good. The client is let go, not closed: while
 * disconnected it still has to tell the party once the socket is back.
 */
function quitParty() {
  const p = party;
  party = null;
  followed = undefined;
  p?.leave();
}

/** Leaves the party for good, then asks for a new one. */
function leaveParty() {
  quitParty();
  forget("", false);
}

/** Drops the saved party without telling the server, and shows the party step. */
function forget(note: string, error: boolean) {
  disconnect();
  joining = null;
  const s = loadSession();
  if (s?.mode === "online") saveSession({ ...s, party: null });
  resetScreen(true);
  pickParty(note, error ? "error" : "info");
}

const REFUSED: Record<string, string> = {
  full: "Two players are already in that party. Ask for a new code.",
  gone: "That party has ended or expired. Make a new code.",
  version: "A newer version is out. Reload to play.",
};

/** Runs after every change on the party client. */
function onParty() {
  const p = party;
  if (!p) return;
  const code = p.code;

  if (joining === code) {
    if (p.error || p.status === "closed") return joinFailed(REFUSED[p.error ?? "gone"] ?? REFUSED.gone!);
    if (p.me === null || p.status !== "open") return;
    joined(code);
    if (location.pathname !== "/") history.replaceState(null, "", "/");
    followed = undefined;
    return follow(true);
  }

  // Only the server saying so ends a party here: a dropped socket reconnects.
  if (p.error === "gone" || p.error === "full") return forget(REFUSED[p.error]!, true);
  if (p.error === "version" || p.error === "replaced") {
    if (current) {
      resetScreen(true);
      showMenu();
    } else if ($("games").classList.contains("on")) {
      paintMenu(loadSession()!);
    }
    return toast(p.error === "version" ? REFUSED.version! : "Playing on another screen now");
  }

  const view = p.view;
  if (view?.status === "ended") {
    if (view.leftBy === p.me) return;
    const name = view.leftBy === null ? "Your friend" : (view.players[view.leftBy]?.name ?? "Your friend");
    return forget(`${name} left the party.`, false);
  }
  // Seated (even while reconnecting, when this phone may have left a game on its own): follow the party.
  if (p.view && p.me !== null) follow();
  else if ($("games").classList.contains("on")) paintMenu(loadSession()!);
}

/** An invite link: join it, asking for a name first if this phone has none. */
async function followInvite(code: string): Promise<void> {
  resetScreen(false);
  if (!isCode(code)) {
    history.replaceState(null, "", "/");
    return route();
  }
  const s = loadSession();
  if (s?.mode === "online" && s.party === code) {
    history.replaceState(null, "", "/");
    return route();
  }
  const name = s?.names[0] ?? lastNames()[0];
  if (!name) return askName(code, partyHost(code));
  saveSession({ mode: "online", names: [name], party: s?.mode === "online" ? s.party : null });
  join(code);
}

// ---------- menu ----------

const tiles = $("tiles");
for (const g of GAMES) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = `/${g.id}`;
  a.dataset.id = g.id;
  a.style.setProperty("--from", g.tile[0]);
  a.style.setProperty("--to", g.tile[1]);
  a.innerHTML = `<svg viewBox="0 0 100 70" aria-hidden="true">${g.art}</svg>
    <b>${g.title}</b><small></small>`;
  tiles.append(a);
}

tiles.addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>("a.tile");
  if (!a) return;
  // A game that can't run in this mode stays put; its tile says why.
  if (a.classList.contains("off")) return e.preventDefault();
  // Online, the tile always asks the party; both phones open the game when it agrees.
  // Never a new tab: it would say hello with this phone's token and push this tab out.
  if (loadSession()?.mode === "online") {
    e.preventDefault();
    party?.pick(a.dataset.id!);
    return;
  }
  // Offline, a modified click may open the game in a new tab.
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go(a.pathname);
});

$("menu-chip").addEventListener("click", () => pickSession(loadSession(), () => show("games")));

function inviteLink(): string {
  return `${location.origin}${invitePath(party?.code ?? "")}`;
}

$("menu-copy").addEventListener("click", async () => {
  const btn = $("menu-copy");
  try {
    await navigator.clipboard.writeText(inviteLink());
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => (btn.textContent = "Copy link"), 1500);
});

$("menu-share").addEventListener("click", async () => {
  const url = inviteLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Games?", text: "Play some games with me", url });
    } catch {
      // Dismissed.
    }
  } else {
    $("menu-copy").click();
  }
});

// Any game's "all games" button. Online it closes the game for both phones.
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest("[data-menu]")) return;
  // The router then asks the party to go back to the menu.
  if (loadSession()?.mode === "online" && pushedByParty()) history.back();
  else go("/");
});

// ---------- start ----------

initStart({
  done(s) {
    if (s.mode !== "online") {
      // Another way of playing: the friend is told the party is over.
      quitParty();
      return void route();
    }
    if (!s.party) return pickParty();
    connect(s.party, s.names[0]);
    // Carry on to where the player was going: the menu, or a game's link on a first visit.
    void route();
  },
  join,
  leave: () => leaveParty(),
  create: () => createParty().catch(() => null),
});

onRoute(() => void route());
void route();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
