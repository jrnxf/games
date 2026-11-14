// The start screens: pick a mode, then say who's playing, and online, make or
// enter a party code. The shell shows them before the menu on a first visit,
// and again from the menu chip.

import "./start.css";

import { isCode, normalizeCode } from "../party/protocol.ts";
import { $, show } from "./dom.ts";
import {
  DIFFICULTIES,
  MODE_LABELS,
  cleanName,
  lastDifficulty,
  lastNames,
  saveSession,
  type Difficulty,
  type Mode,
  type OnlineSession,
  type Session,
} from "./session.ts";

export interface StartHooks {
  /** A session was picked and saved. Online, it may have no party yet: the shell asks for one. */
  done(s: Session): void;
  /** Online: join party `code`, one just made or one typed in. The shell reports back with pickParty(note). */
  join(code: string): void;
  /** Online: leave the current party for good. */
  leave(): void;
  /** Online: make a party. Resolves to its code, or null when the server can't be reached. */
  create(): Promise<string | null>;
}

const COPY: Record<Mode, { title: string; lead: string; label: string }> = {
  solo: { title: "What's your name?", lead: "Then pick how tough the computer is.", label: "Your name" },
  "pass-and-play": { title: "Who's playing?", lead: "Player 1 goes first.", label: "Player 1" },
  online: { title: "What's your name?", lead: "Your friend sees it in every game.", label: "Your name" },
};

const nameInputs = [$<HTMLInputElement>("start-name-0"), $<HTMLInputElement>("start-name-1")] as const;
const levels = [...document.querySelectorAll<HTMLButtonElement>("[data-difficulty]")];

let mode: Mode = "solo";
let difficulty: Difficulty = "medium";
let hooks: StartHooks;
let current: Session | null = null;
let onBack: (() => void) | null = null;
/** Set while the names screen asks for a name to join an invite. */
let invite: string | null = null;

export function initStart(h: StartHooks): void {
  hooks = h;
}

/**
 * Shows the mode picker, with `now` ticked if there is one. `back`, if given,
 * leaves without a change.
 */
export function pickSession(now: Session | null, back: (() => void) | null): void {
  current = now;
  onBack = back;
  invite = null;
  for (const b of document.querySelectorAll<HTMLElement>("[data-mode]")) {
    const on = b.dataset.mode === now?.mode;
    b.classList.toggle("sel", on);
    b.setAttribute("aria-pressed", String(on));
  }
  $("start-mode-back").hidden = !back;
  show("start-mode");
}

/** How the line under the party form reads: news, a failure, or work under way (which holds the buttons). */
export type NoteTone = "info" | "error" | "busy";

/** Online with no party yet: make a code or enter one. `note` says what happened last. */
export function pickParty(note = "", tone: NoteTone = "info"): void {
  invite = null;
  partyNote(note, tone);
  show("start-party");
}

/** An invite link on a phone with no saved name: ask for one, then join `code`. */
export function askName(code: string, host: Promise<string | null>): void {
  current = null;
  onBack = null;
  pickMode("online");
  invite = code;
  $("start-title").textContent = "You're invited";
  $("start-lead").textContent = `Enter your name to join party ${code}.`;
  void host.then((name) => {
    if (name && invite === code) $("start-title").textContent = `${name} invited you`;
  });
}

/** The line under the party form: progress, or why a join failed. */
function partyNote(text: string, tone: NoteTone = "info"): void {
  const note = $("party-note");
  note.textContent = text;
  note.classList.toggle("error", tone === "error");
  $<HTMLButtonElement>("party-create").disabled = tone === "busy";
}

function pickMode(next: Mode) {
  mode = next;
  const copy = COPY[mode];
  const party = current?.mode === "online" && mode === "online" ? current.party : null;
  $("start-mode-title").textContent = MODE_LABELS[mode];
  $("start-title").textContent = copy.title;
  $("start-lead").textContent = party ? `You're in party ${party}. Continue to keep playing.` : copy.lead;
  $("start-label-0").textContent = copy.label;
  $("start-field-1").hidden = mode !== "pass-and-play";
  $("start-difficulty").hidden = mode !== "solo";
  $("start-leave").hidden = !party;
  const names = lastNames();
  nameInputs.forEach((input, i) => (input.value = names[i]!));
  setDifficulty(lastDifficulty());
  validate();
  show("start-names");
}

function setDifficulty(d: Difficulty) {
  difficulty = d;
  for (const b of levels) b.setAttribute("aria-checked", String(b.dataset.difficulty === d));
}

function validate() {
  const needed = mode === "pass-and-play" ? nameInputs : nameInputs.slice(0, 1);
  $<HTMLButtonElement>("start-go").disabled = needed.some((input) => !cleanName(input.value));
}

for (const b of document.querySelectorAll<HTMLElement>("[data-mode]")) {
  b.addEventListener("click", () => pickMode(b.dataset.mode as Mode));
}

for (const b of levels) {
  b.addEventListener("click", () => setDifficulty(DIFFICULTIES.find((d) => d === b.dataset.difficulty)!));
}

for (const input of nameInputs) input.addEventListener("input", validate);

$("start-mode-back").addEventListener("click", () => onBack?.());
$("start-names-back").addEventListener("click", () => {
  // Backing out of an invite goes to the full picker: the link is not followed.
  if (invite) pickSession(current, onBack);
  else show("start-mode");
});
$("start-party-back").addEventListener("click", () => pickMode("online"));

$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const a = cleanName(nameInputs[0].value);
  if (!a) return;
  let session: Session;
  if (mode === "pass-and-play") {
    let b = cleanName(nameInputs[1].value);
    if (!b) return;
    if (b.toLowerCase() === a.toLowerCase()) b = `${b.slice(0, 10)} 2`;
    session = { mode, names: [a, b] };
  } else if (mode === "solo") {
    session = { mode, names: [a], difficulty };
  } else {
    // Online keeps the party it is in; a name change carries over.
    const party = current?.mode === "online" ? current.party : null;
    session = { mode, names: [a], party } satisfies OnlineSession;
  }
  saveSession(session);
  if (invite) {
    const code = invite;
    invite = null;
    return hooks.join(code);
  }
  hooks.done(session);
});

$("start-leave").addEventListener("click", () => {
  current = current?.mode === "online" ? { ...current, party: null } : current;
  hooks.leave();
});

// ---------- party code ----------

$("party-create").addEventListener("click", async () => {
  if (!navigator.onLine) return partyNote("You're offline. Pass & play works without a connection.", "error");
  partyNote("Making a code...", "busy");
  const code = await hooks.create();
  if (code) hooks.join(code);
  else partyNote("Couldn't reach the server. Check your connection and try again.", "error");
});

$("party-input").addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  input.value = normalizeCode(input.value);
});

$("party-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = normalizeCode($<HTMLInputElement>("party-input").value);
  if (!isCode(code)) return partyNote("Party codes are 5 letters and numbers.", "error");
  hooks.join(code);
});
