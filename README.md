# Games

Small games for your phone, in one web app you add to your home screen: no app store, no accounts. Open it, say once how you're playing (solo, pass & play on one phone, or online with a friend) and who's playing, then pick a game from the menu. The chip at the top of the menu changes that any time. A game the mode can't run stays on the menu, dimmed, with the reason. Each game has its own address, so you can link straight to it: a first visit asks how you're playing, then goes on to the game.

**Online** is a party: one phone makes a five-letter code and sends the link (`/p/<code>`), the other opens it, and from then on the two phones play any online game together. Either player taps a game and both phones open it; leaving a game takes both back to the menu. The menu chip shows your friend's name and whether their phone is connected. Reopening the app rejoins the party, and "Leave party" on the chip's online screen ends it.

**Mini Golf** (`/mini-golf`): eighteen holes on a sunny outdoor course, played solo against par, by passing one phone back and forth, or online with a friend through an invite link.

- **Pass & play**: both players on one phone. A "Pass to Kai / I'm ready" card goes up between strokes so nobody sees the other player's aim.
- **Online**: live turns in a party. You see your friend's aim line as they drag, get a "your turn" alert, and drop back in after a lost connection or a closed tab.
- **Aim**: drag anywhere on the screen and let go. The preview line shows where the ball goes, bounces included.

**Connect Four** (`/connect-four`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. A chip hovers over the board: move it with the arrow buttons (or tap a column) and press Drop. You go first in the first game, then the first move alternates. The game saves after every move, the computer's turn included, and keeps a running score.

- **Online**: red is the party's maker, yellow the friend, and whoever picked the game drops first. On your friend's turn you see their chip, dimmed, over the column they aim at, and you get a "your turn" alert when it is yours. A rematch waits until both players tap it, and the score lasts as long as the party.

## Stack

TypeScript everywhere, no framework.

| Part   | What                                                                         |
| ------ | ---------------------------------------------------------------------------- |
| Client | Vite, canvas 2D rendering, plain DOM screens, a hand-written service worker  |
| Server | One Cloudflare Worker that serves the app and a Durable Object per party     |
| Shared | each game's `core/`: rules (and for golf, physics and protocol), with no DOM |

Why these, and the other choices: [docs/decisions.md](docs/decisions.md).

## Develop

Needs Node 24+ and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm dev            # the app with hot reload at http://localhost:5173 (all but online play)
pnpm dev:worker     # in a second terminal: the party server on :8787, so online play works in `pnpm dev`
pnpm preview        # production build served by `wrangler dev` on :8787, app and parties together
```

`wrangler dev` runs the Worker and Durable Objects locally; it needs no Cloudflare login.

## Test

```sh
pnpm lint           # eslint + prettier
pnpm typecheck      # app, tests and worker
pnpm test           # unit tests: golf physics, rules, parties, protocol, golf's host, course bake; Connect Four rules, computer and host
pnpm test:e2e       # a full 18-hole pass-and-play game in headless Chrome at 390x844, plus offline load
pnpm test:solo      # a full 18-hole solo round in headless Chrome, then the best round on the home screen
pnpm test:online    # raw clients, then two phones against `wrangler dev`: party by link and code, golf, Connect Four to a win and a rematch, menu, reconnect, leave
pnpm test:look      # plays to the Volcano, Sand Alley and Twin Peaks and checks the colours on screen
pnpm test:menu      # the start screens, the menu, Connect Four solo vs the computer and pass & play, resume, rematch, offline
```

The browser suites drive Chrome through [`chrome-devtools-axi`](https://www.npmjs.com/package/chrome-devtools-axi), which must be on your `PATH`. Set `E2E_SHOTS=<folder>` to keep their screenshots. Cloudflare Workers Builds runs lint, type-check, unit tests and a build on every push.

## Deploy

```sh
pnpm build && pnpm exec wrangler deploy
```

This creates the `games` Worker with its `PARTIES` Durable Object (SQLite-backed, so it runs on the free plan). Parties delete themselves after two idle hours, or ten minutes after a player leaves. The `v2` migration in `wrangler.jsonc` deletes the old golf `Room` class and its rooms.

## Layout

```
src/shell/                 the shell: start screens and session, menu, router, game list, shared styles, storage, DOM helpers
src/games/<id>/info.ts      a game's menu entry: title, the modes it plays, colours, tile art, and a lazy load()
src/games/<id>/core/        the game's rules, with no DOM, unit-tested
src/games/<id>/client/      the game's screens (screens.html), styles and code (main.ts)
src/sw.js                   service worker template (the build fills in the file list)
src/party/                  the party: its protocol and pure rules, shared by the phone and the server
worker/                     Worker entry, the Party Durable Object, and the online games' hosts
scripts/                    icon generator (icons are drawn at build time, not committed)
tests/unit/                 vitest
tests/e2e/                  browser and online end-to-end runs
```

## Adding a game

1. Make `src/games/<id>/` with `core/`, `client/` and `info.ts`. Copy Connect Four: it is the smallest.
2. In `client/main.ts`, import the styles and `screens.html?raw`, insert the screens into the body, and export `open(rest, session)` and `close()`. The shell calls `open` with the rest of the path after `/<id>` and the `Session` from `src/shell/session.ts` (the mode, the names and, in solo, the computer's level), and `close` when the player leaves. Go straight into the session's mode: the game does not ask for the mode or names again.
3. Scope the game's colours under `body[data-game="<id>"]`. Give each screen `class="screen" data-screen`, and a back button with `data-menu` to return to the menu.
4. Save with `store("<id>.")` from `src/shell/storage.ts`, so games never share keys.
5. In `info.ts`, set `modes`: `solo` is `"alone"`, `"computer"` or `false`, and `pass-and-play` and `online` are true or false. The tile's line and the dimmed state come from that.
6. Add the `info` to `GAMES` in `src/shell/games.ts`. The menu tile, the route and offline caching follow from that.

### Online

1. Write the game's server side as a `GameHost` (`src/party/host.ts`): `start`, `parse`, `receive` and `sync`, plain data and pure functions. `start(by, carried)` gets the seat that picked the game and what the optional `carry(state)` kept when this party last closed it, or null. Check `carried` before use, because it comes from storage. Connect Four's is `src/games/connect-four/core/host.ts`, the smaller one.
2. Add it to `HOSTS` in `worker/hosts.ts` under the game's id, and set `online: true` in `info.ts`.
3. Online, `open` gets `session.channel`: `me` (your seat), `players`, `connected`, `send(msg)`, `listen({ message, change })` and `leave()`. Call `listen` first: the first message is the host's `sync`, and another follows every reconnect. `leave()` takes both phones back to the menu. For the connection banner, make a `ConnectionBanner` (`src/shell/banner.ts`) with the channel and a function that shows the text, and call its `update()` on each change and sync.
4. Bump `PROTOCOL` in `src/party/protocol.ts` whenever the messages or the rules on both sides change.
