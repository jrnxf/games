// What an online game gets from the shell: a small channel to its own server
// side (see src/party/host.ts) through the party both phones are already in.
// The shell owns the connection; a game only sends, listens and leaves.

import type { PlayerView, Seat } from "../party/protocol.ts";

export interface ChannelHandlers<In> {
  /** A message from the game's server side. The first is its sync, and another follows every reconnect. */
  message(msg: In): void;
  /** `connected` or `players` changed. */
  change?(): void;
}

export interface Channel<In = unknown, Out = unknown> {
  /** This phone's seat: 0 made the party, 1 joined it. Both phones agree on it. */
  readonly me: Seat;
  /** Both players by seat: name, and whether their phone is connected now. */
  readonly players: readonly [PlayerView, PlayerView];
  /** True while this phone is connected and seated. Nothing is sent while it is false. */
  readonly connected: boolean;
  /** Sends a message to the game's server side. False when it could not go (not queued). */
  send(msg: Out): boolean;
  /** Starts listening, and asks the server for the game's state. */
  listen(handlers: ChannelHandlers<In>): void;
  /** Closes the game on both phones: the party goes back to the menu. */
  leave(): void;
}
