# Pocket Arcade

Small games for your phone, in one web app you add to your home screen: no app store, no accounts. Open it and pick a game from the menu. Each game has its own address, so you can link straight to it.

**Mini Golf** (`/mini-golf`): eighteen holes on a sunny outdoor course, played solo against par, by passing one phone back and forth, or online with a friend through an invite link.

- **Pass & play**: both players on one phone. A "Pass to Kai / I'm ready" card goes up between strokes so nobody sees the other player's aim.
- **Online**: create a room, send the link (or the five-letter code), and take live turns. You see your friend's aim line as they drag, get a "your turn" alert, and drop back in after a lost connection or a closed tab.
- **Aim**: drag anywhere on the screen and let go. The preview line shows where the ball goes, bounces included.

**Connect Four** (`/connect-four`): two players on one phone. A chip hovers over the board: move it with the arrow buttons (or tap a column) and press Drop. The game saves after every move and keeps a running score.

## Stack

TypeScript everywhere, no framework.

| Part   | What                                                                         |
| ------ | ---------------------------------------------------------------------------- |
| Client | Vite, canvas 2D rendering, plain DOM screens, a hand-written service worker  |
| Server | One Cloudflare Worker that serves the app and a Durable Object per room      |
| Shared | each game's `core/`: rules (and for golf, physics and protocol), with no DOM |

Why these, and the other choices: [docs/decisions.md](docs/decisions.md).

## Develop

Needs Node 24+ and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm dev            # the app with hot reload at http://localhost:5173 (all but online golf)
pnpm dev:worker     # in a second terminal: the room server on :8787, so online play works in `pnpm dev`
pnpm preview        # production build served by `wrangler dev` on :8787, app and rooms together
```

`wrangler dev` runs the Worker and Durable Objects locally; it needs no Cloudflare login.

## Test

```sh
pnpm lint           # eslint + prettier
pnpm typecheck      # app, tests and worker
pnpm test           # unit tests: golf physics, rules, rooms, protocol, course bake; Connect Four rules
pnpm test:e2e       # a full 18-hole pass-and-play game in headless Chrome at 390x844, plus offline load
pnpm test:solo      # a full 18-hole solo round in headless Chrome, then the best round on the home screen
pnpm test:online    # two clients against `wrangler dev`: join, turns, reconnect, leave
pnpm test:look      # plays to the Volcano, Sand Alley and Twin Peaks and checks the colours on screen
pnpm test:arcade    # the menu, a Connect Four game to a win, resume, rematch, back to the menu, offline
```

The browser suites drive Chrome through [`chrome-devtools-axi`](https://www.npmjs.com/package/chrome-devtools-axi), which must be on your `PATH`. Set `E2E_SHOTS=<folder>` to keep their screenshots. Cloudflare Workers Builds runs lint, type-check, unit tests and a build on every push.

## Deploy

```sh
pnpm build && pnpm exec wrangler deploy
```

This creates the `pocket-arcade` Worker with its `ROOMS` Durable Object (SQLite-backed, so it runs on the free plan). Rooms delete themselves after two idle hours.

## Layout

```
src/arcade/                 the shell: menu, router, game list, shared styles, storage, DOM helpers
src/games/<id>/info.ts      a game's menu entry: title, blurb, colours, tile art, and a lazy load()
src/games/<id>/core/        the game's rules, with no DOM, unit-tested
src/games/<id>/client/      the game's screens (screens.html), styles and code (main.ts)
src/sw.js                   service worker template (the build fills in the file list)
worker/                     Worker entry and the golf Room Durable Object
scripts/                    icon generator (icons are drawn at build time, not committed)
tests/unit/                 vitest
tests/e2e/                  browser and online end-to-end runs
```

## Adding a game

1. Make `src/games/<id>/` with `core/`, `client/` and `info.ts`. Copy Connect Four: it is the smallest.
2. In `client/main.ts`, import the styles and `screens.html?raw`, insert the screens into the body, and export `open(rest)` and `close()`. The arcade calls `open` with the rest of the path after `/<id>`, and `close` when the player leaves.
3. Scope the game's colours under `body[data-game="<id>"]`. Give each screen `class="screen" data-screen`, and a back button with `data-arcade` to return to the menu.
4. Save with `store("<id>.")` from `src/arcade/storage.ts`, so games never share keys.
5. Add the `info` to `GAMES` in `src/arcade/games.ts`. The menu tile, the route and offline caching follow from that.
