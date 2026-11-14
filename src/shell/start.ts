// The two start screens: pick a mode, then say who's playing. The shell shows
// them before the menu on a first visit, and again from the menu chip.

import "./start.css";

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
  type Session,
} from "./session.ts";

const COPY: Record<Mode, { title: string; lead: string; label: string }> = {
  solo: { title: "What's your name?", lead: "Then pick how tough the computer is.", label: "Your name" },
  "pass-and-play": { title: "Who's playing?", lead: "Player 1 goes first.", label: "Player 1" },
  online: { title: "Play a friend", lead: "Enter your name, then make or join a room.", label: "Your name" },
};

const nameInputs = [$<HTMLInputElement>("start-name-0"), $<HTMLInputElement>("start-name-1")] as const;
const levels = [...document.querySelectorAll<HTMLButtonElement>("[data-difficulty]")];

let mode: Mode = "solo";
let difficulty: Difficulty = "medium";
let onDone: (s: Session) => void = () => {};
let onBack: (() => void) | null = null;

/**
 * Shows the mode picker, with `current` ticked if there is one. `done` gets the
 * new session once it is saved. `back`, if given, leaves without a change.
 */
export function pickSession(
  current: Session | null,
  done: (s: Session) => void,
  back: (() => void) | null,
): void {
  onDone = done;
  onBack = back;
  for (const b of document.querySelectorAll<HTMLElement>("[data-mode]")) {
    const on = b.dataset.mode === current?.mode;
    b.classList.toggle("sel", on);
    b.setAttribute("aria-pressed", String(on));
  }
  $("start-mode-back").hidden = !back;
  show("start-mode");
}

function pickMode(next: Mode) {
  mode = next;
  const copy = COPY[mode];
  $("start-mode-title").textContent = MODE_LABELS[mode];
  $("start-title").textContent = copy.title;
  $("start-lead").textContent = copy.lead;
  $("start-label-0").textContent = copy.label;
  $("start-field-1").hidden = mode !== "pass-and-play";
  $("start-difficulty").hidden = mode !== "solo";
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
$("start-names-back").addEventListener("click", () => show("start-mode"));

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
    session = { mode, names: [a] };
  }
  saveSession(session);
  onDone(session);
});
