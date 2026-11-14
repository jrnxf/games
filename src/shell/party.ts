// The phone's side of a party: one socket for as long as the session is
// online, the party view the server last sent, and the channel the open game
// talks through. The shell follows `view.game` to open and close games.

import type { ErrorCode, PartyView, PlayerView, Seat, ServerMessage } from "../party/protocol.ts";
import type { Channel, ChannelHandlers } from "./channel.ts";
import { PartySocket, type SocketStatus } from "./socket.ts";
import { store } from "./storage.ts";

const { load, save } = store("shell.");

let token: string | null = null;

/** A random secret that lets this phone take its seat back in a party after a drop. */
export function deviceToken(): string {
  token ??= load("token");
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    save("token", token);
  }
  return token;
}

/** Makes a new party on the server and returns its code. Throws when the server can't be reached. */
export async function createParty(): Promise<string> {
  const res = await fetch("/api/parties", { method: "POST" });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { code: string }).code;
}

/** Who made a party, for the invite screen. Null when it is gone or the server can't be reached. */
export async function partyHost(code: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/parties/${code}`);
    return res.ok ? ((await res.json()) as { host: string | null }).host : null;
  } catch {
    return null;
  }
}

/** A party's invite link. */
export function invitePath(code: string): string {
  return `/p/${code}`;
}

class GameChannel implements Channel {
  readonly game: string;
  private party: PartyClient;
  private handlers: ChannelHandlers<unknown> | null = null;

  constructor(party: PartyClient, game: string) {
    this.party = party;
    this.game = game;
  }

  get me(): Seat {
    return this.party.me ?? 0;
  }

  get players(): [PlayerView, PlayerView] {
    const p = this.party.view?.players;
    const fallback = (seat: Seat) => ({ name: seat === 0 ? "Player 1" : "Player 2", connected: false });
    return [p?.[0] ?? fallback(0), p?.[1] ?? fallback(1)];
  }

  get connected(): boolean {
    return this.party.status === "open";
  }

  send(m: unknown): boolean {
    return this.party.channel === this && this.party.send({ t: "game", game: this.game, m });
  }

  listen(handlers: ChannelHandlers<unknown>): void {
    this.handlers = handlers;
    this.sync();
  }

  leave(): void {
    if (this.party.channel === this) this.party.pick(null);
  }

  /** Asks for the game's state: on listen and after every reconnect. */
  sync() {
    if (this.handlers) this.party.send({ t: "sync", game: this.game });
  }

  deliver(m: unknown) {
    this.handlers?.message(m);
  }

  changed() {
    this.handlers?.change?.();
  }
}

/** Clients that left their party while disconnected, by code, until the leave is sent. */
const leavers = new Map<string, PartyClient>();

export class PartyClient {
  readonly code: string;
  /** This phone's seat, once the server has seated it. */
  me: Seat | null = null;
  view: PartyView | null = null;
  status: SocketStatus = "connecting";
  /** Why the party turned this phone away or stopped talking to it. */
  error: ErrorCode | null = null;
  channel: GameChannel | null = null;
  private socket: PartySocket;
  private onChange: () => void;
  /** The game this phone went back to the menu from while disconnected: the pick waits for the socket. */
  private leftGame: string | null = null;
  /** Set once `leave()` is waiting for the socket to say so. */
  private leaving = false;

  /**
   * A client for party `code` as `name`. `onChange` runs after every change to
   * the fields above. Nothing happens until `start()`, so the caller can hold
   * on to the client before its first change.
   */
  constructor(code: string, name: string, onChange: () => void) {
    this.code = code;
    this.onChange = onChange;
    this.socket = new PartySocket(code, deviceToken(), name, {
      message: (m) => this.onMessage(m),
      status: (s) => {
        this.status = s;
        if (s === "open") {
          // Seated again: send what waited for the socket.
          if (this.leaving) return this.leave();
          if (this.leftGame !== null) this.socket.send({ t: "pick", game: null });
          // Open comes right after the welcome: the game catches up on whatever it missed.
          this.channel?.sync();
        }
        this.channel?.changed();
        this.onChange();
      },
    });
  }

  /** Connects. Joining a party again calls off a leave of it still waiting to be sent. */
  start(): void {
    leavers.get(this.code)?.close();
    this.socket.connect();
  }

  /**
   * The other player, once someone has taken the seat. A guest who dropped
   * before the first game doesn't count: their seat is up for grabs.
   */
  get friend(): PlayerView | null {
    if (this.me === null || !this.view) return null;
    const friend = this.view.players[this.me === 0 ? 1 : 0];
    if (!friend || (this.me === 0 && this.view.status === "waiting" && !friend.connected)) return null;
    return friend;
  }

  /** The game this phone should show: the party's, unless this phone already went back to the menu. */
  get game(): string | null {
    return this.leftGame === null ? (this.view?.game ?? null) : null;
  }

  /**
   * Opens `game` on both phones, or goes back to the menu for null. Back to
   * the menu always works: while disconnected this phone goes at once, and the
   * party is told when the socket is back. False when nothing was done.
   */
  pick(game: string | null): boolean {
    if (this.send({ t: "pick", game })) return true;
    const open = this.view?.game ?? null;
    if (game !== null || this.me === null || open === null) return false;
    if (this.leftGame !== open) {
      this.leftGame = open;
      this.onChange();
    }
    return true;
  }

  /** A channel for `game`, replacing any other. The shell hands it to the game on open. */
  open(game: string): Channel {
    this.channel = new GameChannel(this, game);
    return this.channel;
  }

  /** Stops delivering to the open game's channel. */
  closeChannel(): void {
    this.channel = null;
  }

  /**
   * Leaves the party for good: the friend is told and the code stops working
   * for this phone. While disconnected, the client stops reporting changes and
   * keeps trying until the socket is back to say so.
   */
  leave(): void {
    this.channel = null;
    this.onChange = () => {};
    // Sent, or the party is gone anyway.
    if (this.send({ t: "leave" }) || this.status === "closed") return this.close();
    this.leaving = true;
    leavers.get(this.code)?.close();
    leavers.set(this.code, this);
  }

  /** Stops talking to the party without leaving it (the seat stays ours). */
  close(): void {
    this.channel = null;
    this.socket.close();
    if (leavers.get(this.code) === this) leavers.delete(this.code);
  }

  send(msg: Parameters<PartySocket["send"]>[0]): boolean {
    return this.status === "open" && this.socket.send(msg);
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome":
        this.me = msg.seat;
        this.view = msg.party;
        this.error = null;
        this.settleLeft();
        break;
      case "party":
        this.view = msg.party;
        this.settleLeft();
        this.channel?.changed();
        break;
      case "game":
        if (this.channel?.game === msg.game) this.channel.deliver(msg.m);
        return;
      case "error":
        if (msg.code === "bad") return;
        this.error = msg.code;
        break;
      default:
        return;
    }
    this.onChange();
  }

  /** The party moved on from the game this phone left (to the menu, or to a new pick): follow it again. */
  private settleLeft() {
    if (this.leftGame !== null && this.view?.game !== this.leftGame) this.leftGame = null;
  }
}
