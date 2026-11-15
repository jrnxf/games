// Drives a headless Chrome through chrome-devtools-axi. Each Browser gets
// its own named session, so several can run side by side (two phones), and
// session names and server ports are picked per run, so suites in different
// checkouts can run at the same time.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dragFromPower } from "../../src/games/mini-golf/client/power.ts";
import type { MatchState, Seat } from "../../src/games/mini-golf/core/match.ts";

export const VIEWPORT = "390x844x2,mobile,touch";

/** Where screenshots go: E2E_SHOTS if set, else a temp folder. */
export const SHOTS = process.env.E2E_SHOTS ?? join(tmpdir(), "games-e2e");
mkdirSync(SHOTS, { recursive: true });

export interface ScreenState {
  match: MatchState | null;
  me: Seat | null;
  busy: boolean;
  canAim: boolean;
  overlay: string | null;
  view: {
    s: number;
    ox: number;
    oy: number;
    maxDrag: number;
    baked: boolean;
    bake: { ms: number; samples: number };
  };
}

/** The port a suite serves on: E2E_PORT if set, else a free one. */
export async function serverPort(): Promise<number> {
  return Number(process.env.E2E_PORT) || freePort();
}

/** Tells this run's browser sessions apart from any other run's. */
const RUN = process.env.E2E_RUN ?? String(process.pid);

/** A port nothing is listening on right now. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export class Browser {
  readonly session: string;

  /** `name` says which suite and phone; the run's id is added to it. */
  constructor(name: string) {
    this.session = `${name}-${RUN}`;
  }

  private axi(args: string[], input?: string): string {
    return execFileSync("chrome-devtools-axi", args, {
      env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: this.session },
      input,
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  /** Runs a script with the axi `page` API and returns what it printed. */
  run(script: string): string {
    return this.axi(["run"], script).trim();
  }

  open(url: string): void {
    this.axi(["open", url]);
    this.axi(["emulate", "--viewport", VIEWPORT]);
    this.axi(["open", url]);
    this.settle();
  }

  /** Sizes the page, for example "1280x720x1" for a laptop. */
  viewport(size: string): void {
    this.axi(["emulate", "--viewport", size]);
  }

  /** Waits for a screen to show: a game's code loads after the page does. */
  settle(): void {
    this.run(`await page.eval(async () => {
      for (let i = 0; i < 200 && !document.querySelector(".screen.on"); i++) await new Promise((r) => setTimeout(r, 50));
    });`);
  }

  /** Cuts the network, then reloads `url`: only the service worker can answer. */
  openOffline(url: string): void {
    this.axi(["emulate", "--network", "Offline"]);
    this.run(`await page.open(${JSON.stringify(url)});`);
    this.settle();
  }

  eval<T>(fn: string): T {
    const out = this.run(`console.log(JSON.stringify(await page.eval(${fn})));`);
    return JSON.parse(out.split("\n").pop()!) as T;
  }

  state(): ScreenState {
    return this.eval<ScreenState>("() => window.__miniGolf.state()");
  }

  click(selector: string): void {
    this.run(`await page.click(${JSON.stringify(selector)});`);
  }

  fill(selector: string, text: string): void {
    this.run(`await page.fill(${JSON.stringify(selector)}, ${JSON.stringify(text)});`);
  }

  text(selector: string): string {
    return this.eval<string>(`() => document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
  }

  visible(id: string): boolean {
    return this.eval<boolean>(
      `() => { const el = document.getElementById(${JSON.stringify(id)}); return !!el && !el.hidden && el.getClientRects().length > 0; }`,
    );
  }

  /**
   * Answers the start screens the way a player would: tap a mode, type the
   * names, tap Continue. The mode picker must be on screen.
   */
  async pickSession(mode: "solo" | "pass-and-play" | "online", names: string[]): Promise<void> {
    await waitFor("mode picker", () => this.visible("start-mode"));
    this.click(`[data-mode="${mode}"]`);
    await waitFor("names screen", () => this.visible("start-names"));
    names.forEach((name, i) => this.fill(`#start-name-${i}`, name));
    this.click("#start-go");
    await waitFor("start screens to close", () => !this.visible("start-names"));
  }

  screenshot(name: string): string {
    const path = join(SHOTS, `${name}.png`);
    this.axi(["screenshot", path]);
    return path;
  }

  consoleErrors(): string {
    return this.axi(["console", "--type", "error"]);
  }

  /**
   * Plays a stroke the way a thumb would: touch down anywhere on the
   * course, pull back away from the target, let go. `hold` keeps the finger
   * down at the end so a screenshot can catch the aim preview.
   */
  drag(angle: number, power: number, opts: { hold?: boolean } = {}): void {
    this.run(`await page.eval(async () => {
      const c = document.getElementById("canvas");
      const r = c.getBoundingClientRect();
      const len = ${dragFromPower(power)} * window.__miniGolf.state().view.maxDrag;
      const sx = r.width / 2, sy = r.height / 2;
      const ex = sx - Math.cos(${angle}) * len, ey = sy - Math.sin(${angle}) * len;
      const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
        pointerId: 11, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
        clientX: r.left + x, clientY: r.top + y,
      }));
      fire("pointerdown", sx, sy);
      for (let i = 1; i <= 10; i++) {
        fire("pointermove", sx + ((ex - sx) * i) / 10, sy + ((ey - sy) * i) / 10);
        await new Promise((res) => setTimeout(res, 16));
      }
      ${opts.hold ? "" : "fire('pointerup', ex, ey);"}
    });`);
  }

  /** Lets go of a held drag at the same spot it ended. */
  release(angle: number, power: number): void {
    this.run(`await page.eval(() => {
      const c = document.getElementById("canvas");
      const r = c.getBoundingClientRect();
      const len = ${dragFromPower(power)} * window.__miniGolf.state().view.maxDrag;
      const x = r.width / 2 - Math.cos(${angle}) * len, y = r.height / 2 - Math.sin(${angle}) * len;
      c.dispatchEvent(new PointerEvent("pointerup", { pointerId: 11, pointerType: "touch", isPrimary: true, bubbles: true, clientX: r.left + x, clientY: r.top + y }));
    });`);
  }

  stop(): void {
    try {
      this.axi(["stop"]);
    } catch {
      // Already stopped.
    }
  }
}

export async function waitFor<T>(
  what: string,
  fn: () => T | null | undefined | false,
  ms = 20_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Starts a long-running command and resolves once its output contains `ready`. */
export function startServer(cmd: string, args: string[], ready: RegExp): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (ready.test(out)) resolve(child);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${cmd} exited with ${code}:\n${out}`)));
  });
}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`check failed: ${message}`);
  console.log(`  ok - ${message}`);
}
