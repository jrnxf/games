// Online play: live turns and presence over the party's channel. Golf's host
// on the server is the authority; this phone predicts its own strokes so they
// start rolling at once, then settles on whatever the server says.

import { applyShot, type MatchState } from "../core/match.ts";
import type { Shot } from "../core/physics.ts";
import type { Aim, GolfClientMessage, GolfServerMessage, GolfState } from "../core/protocol.ts";
import { ConnectionBanner } from "../../../shell/banner.ts";
import type { Channel } from "../../../shell/channel.ts";
import type { Driver, GameScreen } from "./game.ts";
import { PLAYER_COLORS } from "./render.ts";

export class OnlineGame implements Driver {
  private channel: Channel<GolfServerMessage, GolfClientMessage>;
  private screen: GameScreen;
  /** The last match state the server confirmed. */
  private match: MatchState | null = null;
  private shown = "";
  /** The `at` of a stroke this phone sent and has already started rolling. */
  private pending: number | null = null;
  private online: boolean;
  private readonly banner: ConnectionBanner;
  private closed = false;

  constructor(channel: Channel<GolfServerMessage, GolfClientMessage>, screen: GameScreen) {
    this.channel = channel;
    this.screen = screen;
    this.online = channel.connected;
    this.banner = new ConnectionBanner(channel, (text, ok) => screen.setBanner(text, ok));
    channel.listen({ message: (m) => this.onMessage(m), change: () => this.onChange() });
  }

  get me() {
    return this.channel.me;
  }

  // ---------- Driver ----------

  shoot(shot: Shot): void {
    const m = this.match;
    if (!m || this.pending !== null) return;
    const out = applyShot(m, this.me, shot);
    if (!out || !this.channel.send({ t: "shot", shot, at: m.strokes })) return;
    this.pending = m.strokes;
    this.screen.enqueueShot(this.me, shot, m, out.state);
    this.shown = JSON.stringify(out.state);
  }

  aim(aim: Aim | null): void {
    this.channel.send({ t: "aim", aim });
  }

  next(): void {
    this.channel.send({ t: "ready" });
  }

  again(): void {
    this.channel.send({ t: "rematch" });
  }

  /** Back to the menu, on both phones. */
  quit(): void {
    this.channel.leave();
  }

  /** Stops drawing: the shell closed the game. */
  end(): void {
    this.closed = true;
    this.banner.stop();
    this.screen.stop();
  }

  // ---------- server ----------

  private onMessage(msg: GolfServerMessage) {
    if (this.closed) return;
    switch (msg.t) {
      case "state":
        this.applyState(msg.golf);
        return;
      case "shot":
        this.applyShot(msg.seat, msg.shot, msg.golf);
        return;
      case "aim":
        if (msg.seat !== this.me) this.screen.setGhost(msg.seat, msg.aim);
        return;
    }
  }

  private onChange() {
    if (this.closed || !this.screen.active) return;
    this.online = this.channel.connected;
    this.screen.setConnected(this.online);
    this.banner.update();
  }

  /** The whole state: on open, after every reconnect, and after a refused stroke. */
  private applyState(golf: GolfState) {
    const match = golf.match;
    if (!this.screen.active) {
      this.match = match;
      this.shown = JSON.stringify(match);
      this.pending = null;
      const [a, b] = this.channel.players;
      this.screen.start(this, [a.name, b.name], match);
    } else {
      if (this.pending !== null && match.strokes === this.pending) {
        // The stroke we sent never counted (a drop, or the state moved on).
        this.screen.toast("Connection hiccup · take that one again", PLAYER_COLORS[this.me]);
      }
      if (this.pending !== null && match.strokes <= this.pending) this.pending = null;
      this.match = match;
      this.settle(match);
    }
    this.online = this.channel.connected;
    this.screen.setConnected(this.online);
    this.screen.setFlags(golf.ready, golf.rematch);
    this.banner.update();
  }

  private applyShot(seat: 0 | 1, shot: Shot, golf: GolfState) {
    const before = this.match;
    if (!before || !this.screen.active) return this.applyState(golf);
    if (seat === this.me && this.pending === before.strokes) {
      // Our own stroke, already rolling: settle on the server's result (a no-op when the prediction was right).
      this.pending = null;
      this.match = golf.match;
      this.settle(golf.match);
    } else {
      this.match = golf.match;
      this.screen.enqueueShot(seat, shot, before, golf.match);
      this.shown = JSON.stringify(golf.match);
    }
    this.screen.setFlags(golf.ready, golf.rematch);
  }

  /** Queues a state only when it differs from what the screen will end up showing. */
  private settle(match: MatchState) {
    const json = JSON.stringify(match);
    if (json === this.shown) return;
    this.shown = json;
    this.screen.enqueueState(match);
  }
}
