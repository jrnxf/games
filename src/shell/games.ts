// The games on the menu, in menu order. Adding a game: make a folder in
// src/games with an info.ts like these two, then list it here.

import connectFour from "../games/connect-four/info.ts";
import miniGolf from "../games/mini-golf/info.ts";

/** What a game's code exports. The shell loads it the first time the game opens. */
export interface GameModule {
  /** Shows the game at `rest`, the path after its own prefix ("" or "/r/ABCDE"). */
  open(rest: string): void;
  /** Stops anything running: the player went back to the menu. */
  close(): void;
}

export interface GameInfo {
  /** The URL prefix and the body[data-game] value its styles key on. */
  id: string;
  title: string;
  /** One short line under the title on the menu tile. */
  blurb: string;
  /** Browser chrome colour while the game is open. */
  themeColor: string;
  /** Tile background, top-left to bottom-right. */
  tile: readonly [string, string];
  /** Tile picture: inline SVG markup on a 100x70 view box. */
  art: string;
  load(): Promise<GameModule>;
}

export const GAMES: readonly GameInfo[] = [miniGolf, connectFour];
