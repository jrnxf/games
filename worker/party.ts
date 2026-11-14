// One Durable Object per party. It holds the authoritative party record (the
// two seats, their names and the open game's state), hands each game message
// to that game's host, and fans the results out to both phones' sockets.
// Sockets use the hibernation API, so a party only costs anything while
// someone is actually sending messages.

import { DurableObject } from "cloudflare:workers";
import {
  claimSeat,
  createParty,
  leave,
  partyView,
  pick,
  receive,
  sync,
  type PartyRecord,
} from "../src/party/party.ts";
import {
  CLOSE_FULL,
  CLOSE_GONE,
  CLOSE_REPLACED,
  PROTOCOL,
  cleanName,
  parseClientMessage,
  type ErrorCode,
  type Seat,
  type ServerMessage,
} from "../src/party/protocol.ts";
import { HOSTS } from "./hosts.ts";
import type { Env } from "./index.ts";

/** A party nobody has touched for this long is deleted. */
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
/** A party someone left is kept just long enough for the other phone to see it. */
const ENDED_TTL_MS = 10 * 60 * 1000;

interface Attachment {
  seat: Seat | null;
}

export class Party extends DurableObject<Env> {
  private party: PartyRecord | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the party.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    void ctx.blockConcurrencyWhile(async () => {
      this.party = (await ctx.storage.get<PartyRecord>("party")) ?? null;
    });
  }

  /** Claims this party for a new code. False if it already exists. */
  async init(code: string): Promise<boolean> {
    if (this.party) return false;
    this.party = createParty(code);
    await this.save();
    return true;
  }

  /** Info for the invite screen, or null when the party does not exist. */
  async info(): Promise<{ host: string | null; open: boolean } | null> {
    const party = this.party;
    if (!party || party.status === "ended") return null;
    return {
      host: party.seats[0]?.name ?? null,
      open: !party.seats[1] || (party.status === "waiting" && this.sockets(1).length === 0),
    };
  }

  override async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    if (!this.party) this.reject(server, "gone", CLOSE_GONE);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const party = this.party;
    const msg = parseClientMessage(data);
    if (!party || !msg) return this.send(ws, { t: "error", code: party ? "bad" : "gone" });
    const { seat } = ws.deserializeAttachment() as Attachment;

    if (msg.t === "ping") return this.send(ws, { t: "pong" });
    if (msg.t === "hello") {
      // One player per socket: a second hello must not claim the other seat.
      if (seat !== null) return this.send(ws, { t: "error", code: "bad" });
      return this.hello(ws, party, msg.v, msg.token, msg.name);
    }
    if (seat === null) return this.send(ws, { t: "error", code: "bad" });

    switch (msg.t) {
      case "pick":
        if (pick(party, seat, msg.game, HOSTS)) await this.saveAndShare();
        return;
      case "sync": {
        const m = sync(party, seat, msg.game, HOSTS);
        if (m !== null) this.send(ws, { t: "game", game: msg.game, m });
        return;
      }
      case "game": {
        const reply = receive(party, seat, msg.game, msg.m, HOSTS);
        if (!reply) return;
        if (reply.state !== undefined) await this.save();
        const out = (m: unknown): ServerMessage => ({ t: "game", game: msg.game, m });
        if (reply.me !== undefined) this.send(ws, out(reply.me));
        if (reply.others !== undefined) this.broadcast(out(reply.others), ws);
        if (reply.all !== undefined) this.broadcast(out(reply.all));
        return;
      }
      case "leave":
        leave(party, seat);
        ws.serializeAttachment({ seat: null } satisfies Attachment);
        await this.saveAndShare();
        ws.close(1000, "left");
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropped(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.dropped(ws);
  }

  override async alarm(): Promise<void> {
    const last = (await this.ctx.storage.get<number>("active")) ?? 0;
    const ttl = this.ttl();
    if (Date.now() - last < ttl) {
      await this.ctx.storage.setAlarm(last + ttl);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) this.reject(ws, "gone", CLOSE_GONE);
    this.party = null;
    await this.ctx.storage.deleteAll();
  }

  private async hello(ws: WebSocket, party: PartyRecord, v: number, token: string, name: string) {
    if (v !== PROTOCOL) return this.reject(ws, "version", CLOSE_GONE);
    const fallback = party.seats[0] ? "Player 2" : "Player 1";
    const seat = claimSeat(party, token, cleanName(name, fallback), this.connected());
    if (typeof seat !== "number") return this.reject(ws, seat, seat === "full" ? CLOSE_FULL : CLOSE_GONE);
    // The same player on a fresh connection replaces their old one.
    for (const other of this.sockets(seat)) {
      if (other !== ws) {
        other.serializeAttachment({ seat: null } satisfies Attachment);
        this.reject(other, "replaced", CLOSE_REPLACED);
      }
    }
    ws.serializeAttachment({ seat } satisfies Attachment);
    await this.save();
    this.send(ws, { t: "welcome", seat, party: this.view() });
    this.broadcast({ t: "party", party: this.view() }, ws);
  }

  private dropped(ws: WebSocket) {
    const { seat } = (ws.deserializeAttachment() as Attachment | null) ?? { seat: null };
    ws.serializeAttachment({ seat: null } satisfies Attachment);
    if (seat !== null && this.party) this.broadcast({ t: "party", party: this.view() }, ws);
  }

  private sockets(seat: Seat): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a?.seat === seat && ws.readyState === WebSocket.OPEN;
    });
  }

  private view() {
    return partyView(this.party!, this.connected());
  }

  private connected(): [boolean, boolean] {
    return [this.sockets(0).length > 0, this.sockets(1).length > 0];
  }

  private ttl() {
    return this.party?.status === "ended" ? ENDED_TTL_MS : IDLE_TTL_MS;
  }

  private async save() {
    const now = Date.now();
    await this.ctx.storage.put({ party: this.party, active: now });
    await this.ctx.storage.setAlarm(now + this.ttl());
  }

  private async saveAndShare() {
    await this.save();
    this.broadcast({ t: "party", party: this.view() });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket is already closing; its close handler cleans up.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (ws !== except && a?.seat != null) this.send(ws, msg);
    }
  }

  private reject(ws: WebSocket, code: ErrorCode, closeCode: number) {
    this.send(ws, { t: "error", code });
    try {
      ws.close(closeCode, code);
    } catch {
      // Already closed.
    }
  }
}
