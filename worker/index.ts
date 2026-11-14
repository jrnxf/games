// Entry point: party API under /api, everything else is the static app.

import { CODE_ALPHABET, CODE_LENGTH, isCode } from "../src/party/protocol.ts";
import type { Party } from "./party.ts";

export { Party } from "./party.ts";

export interface Env {
  PARTIES: DurableObjectNamespace<Party>;
  ASSETS: Fetcher;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/parties") {
      if (request.method !== "POST") return json({ error: "method" }, 405);
      // A fresh code almost never collides; init refuses one that is taken.
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        if (await env.PARTIES.getByName(code).init(code)) return json({ code }, 201);
      }
      return json({ error: "busy" }, 503);
    }

    const match = /^\/api\/parties\/([^/]+)(\/ws)?$/.exec(url.pathname);
    if (match && isCode(match[1]!)) {
      const party = env.PARTIES.getByName(match[1]!);
      if (match[2]) {
        if (request.headers.get("upgrade") !== "websocket") return json({ error: "upgrade" }, 426);
        return party.fetch(request);
      }
      const info = await party.info();
      return info ? json(info) : json({ error: "gone" }, 404);
    }
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
