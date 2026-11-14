// The session: how the player is playing (solo, pass & play or online) and
// who is playing. It is picked once, before the menu, and every game gets it
// in open(). Saved under "shell." so it survives a reload.

import { store } from "./storage.ts";

export const MODES = ["solo", "pass-and-play", "online"] as const;
export type Mode = (typeof MODES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** One player on this phone, alone or against the computer at `difficulty`. */
export interface SoloSession {
  mode: "solo";
  names: readonly [string];
  difficulty: Difficulty;
}

/** Two players sharing this phone. Player 1 goes first. */
export interface PassAndPlaySession {
  mode: "pass-and-play";
  names: readonly [string, string];
}

/** This phone's player, playing a friend on another phone. */
export interface OnlineSession {
  mode: "online";
  names: readonly [string];
}

/** Each mode carries only what it needs, so a mode can grow fields without touching the others. */
export type Session = SoloSession | PassAndPlaySession | OnlineSession;

export const MODE_LABELS: Record<Mode, string> = {
  solo: "Solo",
  "pass-and-play": "Pass & play",
  online: "Online",
};

const { load, save } = store("shell.");

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 12);
}

/** The names typed last, in any mode, to fill in the form next time. */
export function lastNames(): [string, string] {
  const [a = "", b = ""] = (load("names") ?? "").split("\n").map(cleanName);
  return [a, b];
}

export function lastDifficulty(): Difficulty {
  const d = load("difficulty");
  return DIFFICULTIES.find((x) => x === d) ?? "medium";
}

/** The saved session, or null before the player has picked one. */
export function loadSession(): Session | null {
  const mode = MODES.find((m) => m === load("mode"));
  const [a, b] = lastNames();
  if (!mode || !a) return null;
  if (mode === "solo") return { mode, names: [a], difficulty: lastDifficulty() };
  if (mode === "online") return { mode, names: [a] };
  return b ? { mode, names: [a, b] } : null;
}

export function saveSession(s: Session): void {
  save("mode", s.mode);
  // Keep a second name from pass & play when switching to a one-player mode.
  const names = s.names.length === 2 ? s.names : [s.names[0], lastNames()[1]];
  save("names", names.join("\n"));
  if (s.mode === "solo") save("difficulty", s.difficulty);
}

/** The menu chip: "Solo · Colby", "Pass & play · Colby & Sam". */
export function describe(s: Session): string {
  return `${MODE_LABELS[s.mode]} · ${s.names.join(" & ")}`;
}
