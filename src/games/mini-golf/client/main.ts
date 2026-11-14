// Mini golf's entry: the shell loads it on first open, which adds the screens
// below to the page and wires them up. The shell then calls open() and close().

import "./styles.css";
import screens from "./screens.html?raw";

import { formatVsPar } from "../core/solo.ts";
import type { GolfClientMessage, GolfServerMessage } from "../core/protocol.ts";
import type { Channel } from "../../../shell/channel.ts";
import { $, show } from "../../../shell/dom.ts";
import type { GameSession } from "../../../shell/session.ts";
import { GameScreen } from "./game.ts";
import { LocalGame, savedLocalGame } from "./local.ts";
import { OnlineGame } from "./online.ts";
import { SoloGame, loadBest } from "./solo.ts";
import { sfx } from "./sfx.ts";

/** Where the shell mounts mini golf. */
const BASE = "/mini-golf";

document.body.insertAdjacentHTML("beforeend", screens);

const screen = new GameScreen();
/** How the shell says we're playing. Set on every open(). */
let play: GameSession = { mode: "solo", names: ["You"], difficulty: "medium" };
let online: OnlineGame | null = null;

// ---------- navigation ----------

/** The saved pass & play game, if it is these two players'. */
function resumable() {
  const saved = savedLocalGame();
  return saved && play.mode === "pass-and-play" && saved.names.join("\n") === play.names.join("\n")
    ? saved
    : null;
}

/** The tee-off screen for the current mode. */
function goHome(replace = true) {
  if (screen.active) screen.stop();
  if (location.pathname !== BASE) history[replace ? "replaceState" : "pushState"](history.state, "", BASE);
  $("home-tagline").textContent =
    play.mode === "solo"
      ? `${play.names[0]} · 18 holes · against par`
      : `${play.names.join(" vs ")} · 18 holes`;
  $("go-play").hidden = false;
  $("resume-local").hidden = !resumable();
  const best = play.mode === "solo" ? loadBest() : null;
  $("solo-best").hidden = !best;
  if (best) $("solo-best").textContent = `Best solo round ${best.strokes} (${formatVsPar(best.vsPar)})`;
  show("home");
}

/** Shows `rest`, the path after /mini-golf (always "" now). */
export function open(_rest: string, session: GameSession): void {
  play = session;
  if (session.mode === "online") {
    if (online) return;
    // Home, briefly, until the server sends the round; then straight into it.
    goHome();
    const [a, b] = session.channel.players;
    $("home-tagline").textContent = `${a.name} vs ${b.name} · 18 holes`;
    $("go-play").hidden = true;
    $("resume-local").hidden = true;
    online = new OnlineGame(session.channel as Channel<GolfServerMessage, GolfClientMessage>, screen);
    return;
  }
  // The back button during a pass & play or solo game stays in the game.
  if (screen.active) return;
  goHome();
}

export function close(): void {
  online?.end();
  online = null;
  if (screen.active) screen.stop();
}

document.addEventListener("pointerdown", () => sfx.unlock(), { capture: true });

// ---------- home ----------

function syncSound() {
  const btn = $("sound-toggle");
  btn.textContent = sfx.enabled ? "Sound on" : "Sound off";
  btn.setAttribute("aria-pressed", String(sfx.enabled));
}
syncSound();
$("sound-toggle").addEventListener("click", () => {
  sfx.enabled = !sfx.enabled;
  syncSound();
});

$("go-play").addEventListener("click", () => {
  if (play.mode === "solo") new SoloGame(screen, play.names[0], () => goHome());
  else if (play.mode === "pass-and-play") new LocalGame(screen, [...play.names], () => goHome());
});

$("resume-local").addEventListener("click", () => {
  const saved = resumable();
  if (saved) new LocalGame(screen, saved.names, () => goHome(), saved.match);
});
