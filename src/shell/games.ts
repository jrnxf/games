// The games on the menu, in menu order. Adding a game: make a folder in
// src/games with an info.ts like these two, then list it here.

import connectFour from "../games/connect-four/info.ts";
import miniGolf from "../games/mini-golf/info.ts";
import type { GameSession, Mode } from "./session.ts";

/** What a game's code exports. The shell loads it the first time the game opens. */
export interface GameModule {
  /**
   * Shows the game at `rest`, the path after its own prefix (usually ""), set
   * up for `session`. The shell only opens a game in a mode it supports.
   * Online, both phones are seated and `session.channel` reaches the game's
   * host on the server (see src/party/host.ts and channel.ts).
   */
  open(rest: string, session: GameSession): void;
  /** Stops anything running: the player went back to the menu. */
  close(): void;
}

/** What a game can do in each mode. The menu tile's line comes from this. */
export interface GameModes {
  /** One player: on their own (against par, say), against the computer, or not at all. */
  solo: "alone" | "computer" | false;
  "pass-and-play": boolean;
  /** True needs a host for the game's id in worker/hosts.ts. */
  online: boolean;
}

export interface GameInfo {
  /** The URL prefix and the body[data-game] value its styles key on. */
  id: string;
  title: string;
  modes: GameModes;
  /** Browser chrome colour while the game is open. */
  themeColor: string;
  /** Tile background, top-left to bottom-right. */
  tile: readonly [string, string];
  /** Tile picture: inline SVG markup on a 100x70 view box. */
  art: string;
  load(): Promise<GameModule>;
}

export const GAMES: readonly GameInfo[] = [miniGolf, connectFour];

/** Why `info` can't run in `mode`, in a few words, or null when it can. */
export function unsupported(info: GameInfo, mode: Mode): string | null {
  if (info.modes[mode]) return null;
  if (mode === "solo") return "Needs two players";
  if (mode === "pass-and-play") return "One player only";
  return "Not online yet";
}

/** The line under the title on the menu tile. */
export function blurb(info: GameInfo, mode: Mode): string {
  const why = unsupported(info, mode);
  if (why) return why;
  if (mode === "solo") return info.modes.solo === "computer" ? "Solo · vs computer" : "Solo · just you";
  if (mode === "pass-and-play") return "2 players · one phone";
  return "Online · 2 players";
}
