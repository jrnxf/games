// The app shell: the game menu and a router that hands each /<game>/... path
// to that game's code, loaded the first time it opens.

import "@fontsource-variable/outfit/wght.css";
import "./base.css";
import "./menu.css";

import { $, show } from "./dom.ts";
import { GAMES, type GameInfo, type GameModule } from "./games.ts";
import { go, onRoute } from "./nav.ts";

const TITLE = "Games";
const THEME = "#181a28";

const modules = new Map<string, Promise<GameModule>>();
let current: { info: GameInfo; mod: GameModule } | null = null;
/** Bumped on every route, so a slow game load cannot open over a later choice. */
let routeId = 0;

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
}

function showMenu() {
  leaveGame();
  theme(null);
  show("games");
}

async function route() {
  const id = ++routeId;
  const path = location.pathname;
  const [, first = "", rest = ""] = /^\/([^/]*)(.*)$/.exec(path) ?? [];
  const info = GAMES.find((g) => g.id === first);
  if (!info) {
    if (path !== "/") history.replaceState(null, "", "/");
    return showMenu();
  }
  if (current && current.info !== info) leaveGame();
  theme(info);
  let mod: GameModule;
  try {
    mod = await loadGame(info);
  } catch {
    if (id !== routeId) return;
    history.replaceState(null, "", "/");
    showMenu();
    return toast(
      navigator.onLine ? `${info.title} didn't load. Try again.` : "You're offline. Connect once to load it.",
    );
  }
  if (id !== routeId) return;
  current = { info, mod };
  mod.open(rest.replace(/\/$/, ""));
}

function toast(text: string) {
  const el = $("menu-toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(setTimeout(() => el.classList.remove("on"), 2600));
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
    <b>${g.title}</b><small>${g.blurb}</small>`;
  tiles.append(a);
}

tiles.addEventListener("click", (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>("a.tile");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  go(a.pathname);
});

// Any game's "all games" button.
document.addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-menu]")) go("/");
});

// ---------- start ----------

onRoute(() => void route());
void route();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
