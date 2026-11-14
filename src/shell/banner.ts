// The connection banner every online game shows above its board: this
// phone's link first, then the friend's, then a short "Back online" when this
// phone's link comes back. The game owns the element; this owns the words.

import type { Channel } from "./channel.ts";

/** How long "Back online" stays up. */
export const BACK_ONLINE_MS = 1600;

/** Shows `text` on the game's banner, or hides it for null. `ok` is the calm, good-news look. */
export type ShowBanner = (text: string | null, ok: boolean) => void;

export class ConnectionBanner {
  private readonly channel: Pick<Channel, "me" | "players" | "connected">;
  private readonly show: ShowBanner;
  private wasConnected: boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(channel: Pick<Channel, "me" | "players" | "connected">, show: ShowBanner) {
    this.channel = channel;
    this.show = show;
    this.wasConnected = channel.connected;
    show(null, false);
  }

  /** Call when the connection or the players change, and after each sync. */
  update(): void {
    const ch = this.channel;
    const recovered = !this.wasConnected && ch.connected;
    this.wasConnected = ch.connected;
    const friend = ch.players[1 - ch.me]!;
    if (!ch.connected) return this.set("Connection lost · reconnecting...");
    if (!friend.connected) return this.set(`${friend.name} dropped out · waiting...`);
    if (recovered) {
      this.set("Back online", true);
      this.timer = setTimeout(() => this.set(null), BACK_ONLINE_MS);
      return;
    }
    // All well: a "Back online" still up runs its course.
    if (this.timer === undefined) this.set(null);
  }

  /** Hides the banner for good: the game closed. */
  stop(): void {
    this.set(null);
  }

  private set(text: string | null, ok = false) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.show(text, ok);
  }
}
