# Games

Small games for your phone, in one web app you add to your home screen: no app store, no accounts. Open it, say once how you're playing (solo, pass & play on one phone, or online with a friend) and who's playing, then pick a game from the menu. The chip at the top of the menu changes that any time. A game the mode can't run stays on the menu, dimmed, with the reason. Each game has its own address, so you can link straight to it: a first visit asks how you're playing, then goes on to the game.

**Online** is a party: one phone makes a five-letter code and sends the link (`/p/<code>`), the other opens it, and from then on the two phones play any online game together. Either player taps a game and both phones open it; leaving a game takes both back to the menu. The menu chip shows your friend's name and whether their phone is connected. Reopening the app rejoins the party, and "Leave party" on the chip's online screen ends it.

**Mini Golf** (`/mini-golf`): eighteen holes on a sunny outdoor course, played solo against par, by passing one phone back and forth, or online with a friend through an invite link.

- **Pass & play**: both players on one phone. A "Pass to Kai / I'm ready" card goes up between strokes so nobody sees the other player's aim.
- **Online**: live turns in a party. You see your friend's aim line as they drag, get a "your turn" alert, and drop back in after a lost connection or a closed tab.
- **Aim**: drag anywhere on the screen and let go. The preview line shows where the ball goes, bounces included.

**Connect Four** (`/connect-four`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. A chip hovers over the board: move it with the arrow buttons (or tap a column) and press Drop. You go first in the first game, then the first move alternates. The game saves after every move, the computer's turn included, and keeps a running score. In solo, once the computer has a forced win, a line under the board says so, and the result recaps its game, with a replay of how it won.

- **Online**: red is the party's maker, yellow the friend, and whoever picked the game drops first. On your friend's turn you see their chip, dimmed, over the column they aim at, and you get a "your turn" alert when it is yours. A rematch waits until both players tap it, and the score lasts as long as the party.

**Reversi** (`/reversi`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. Faint dots mark where you can play: tap one to put a disc there, and every disc you outflank turns over to your colour, one after another. Each player's card shows their disc count. A player with no move passes, and the game says so. It ends when neither player can move, and the most discs wins. You go first in the first game, then the first move alternates. The game saves after every move and keeps a running score. In solo, the result recaps the computer's game: how many positions it checked and how long it thought.

- **Online**: dark is the party's maker, light the friend, and whoever picked the game plays first. You get a "your turn" alert when it is yours, and after a pass both phones say who plays again. A rematch waits until both players tap it, and the score lasts as long as the party.

**Dots and Boxes** (`/dots-and-boxes`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. Five rows of five boxes sit between six rows of dots. Tap between two dots to draw a line: you do not have to hit it, because the nearest line to your tap is drawn. Close a box and it fills with your colour and your initial, and you go again. The game ends when the last box closes, and the most boxes wins. With 25 boxes there is never a draw. You go first in the first game, then the first move alternates. The game saves after every line and keeps a running score. In solo, the result recaps the computer's game: how many positions it checked, how many of its lines it read to the end, and how long it thought.

- **Online**: orange is the party's maker, blue the friend, and whoever picked the game draws first. You get a "your turn" alert when it is yours, and you can draw the next line of an extra turn at once. A rematch waits until both players tap it, and the score lasts as long as the party.

**Mancala** (`/mancala`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. The board stands upright: your six pits run down the left side to your store at the bottom, and the other player's run up the right side to theirs at the top. Every pit shows its seed count. Tap one of your pits to sow its seeds, one a hole, round the board. The seeds fall one by one, so you can follow them. End in your store and you go again. End in an empty pit of yours and you capture that seed and the seeds opposite. When one side is empty, the seeds left on the other side go to their owner, and the most seeds wins. You go first in the first game, then the first move alternates. The game saves after every move and keeps a running score. In solo, the result recaps the computer's game: how many positions it checked, its deepest look ahead, and how long it thought.

- **Online**: amber is the party's maker, teal the friend, and whoever picked the game sows first. Each phone shows its own store at the bottom. You watch your friend's seeds fall, then get a "your turn" alert, and you can sow the next pit of an extra turn at once. A rematch waits until both players tap it, and the score lasts as long as the party.

**Sea Battle** (`/sea-battle`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. Each player has a fleet of five ships, of 5, 4, 3, 3 and 2 cells, on a 10 by 10 grid. The fleet starts in a random layout: drag a ship to move it, tap it to turn it, or press Random for a new layout, then press Ready. Then the players fire one shot each, turn about. Tap a cell of the big grid to aim and press Fire. A ring marks a miss, a flame a hit, and a sunk ship shows whole. The small grid under it shows your own fleet and the shots that fell there. Sink all five ships to win, and the result shows where the other fleet was. You go first in the first game, then the first shot alternates. The game saves after every shot and keeps a running score. In solo, the result recaps both players' hits and how long the computer thought.

- **Pass & play**: a "Pass to Kai / I'm ready" card goes up after each shot, and while the fleets are placed, so nobody sees the other player's ships. The card says what the last shot did.
- **Online**: yellow is the party's maker, violet the friend, and whoever picked the game fires first. Both players place their fleets at the same time. Your friend's ships never reach your phone until the game is over. On your friend's turn you see their aim, dimmed, on your own fleet, and you get a "your turn" alert when it is yours. A rematch waits until both players tap it, and the score lasts as long as the party.

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

**Ultimate Tic-Tac-Toe** (`/ultimate-tic-tac-toe`): solo against the computer (Easy, Medium or Hard), two players on one phone, or online with a friend. Nine small boards of nine spots make one big board. The spot you mark sends the other player to the small board in the same place: mark a top-right spot and they play in the top-right board. If that board is won or full, they may play in any open board. The boards you may play in are lit in your colour. Tap a spot to aim and press Place, or tap the spot again. Three in a row wins a small board, and it shows one big mark. Win three small boards in a row to win the game. A full small board with no three in a row counts for nobody. When no board is left to play and nobody has three in a row, the game is a draw. You go first in the first game, then the first move alternates. The game saves after every mark and keeps a running score. In solo, the result recaps the computer's game: how many games it played out in its head, the marks made, and how long it thought.

- **Online**: yellow X is the party's maker, blue O the friend, and whoever picked the game marks first. On your friend's turn you see their aim, dimmed, and you get a "your turn" alert when it is yours. The alert says when you may play in any board. A rematch waits until both players tap it, and the score lasts as long as the party.

## Test

```sh
pnpm lint           # eslint + prettier
pnpm typecheck      # app, tests and worker
pnpm test           # unit tests: golf physics, rules, parties, protocol, golf's host, course bake; the rules, computer and host of Connect Four, Reversi, Dots and Boxes, Mancala, Sea Battle and Ultimate Tic-Tac-Toe
pnpm test:e2e       # a full 18-hole pass-and-play game in headless Chrome at 390x844, plus offline load
pnpm test:solo      # a full 18-hole solo round in headless Chrome, then the best round on the home screen
pnpm test:online    # raw clients, then two phones against `wrangler dev`: party by link and code, golf, Connect Four, Reversi, Dots and Boxes, Mancala, Sea Battle and Ultimate Tic-Tac-Toe to a win and a rematch, menu, reconnect, leave
pnpm test:look      # plays to the Volcano, Sand Alley and Twin Peaks and checks the colours on screen
pnpm test:menu      # the start screens, the menu, Connect Four, Reversi, Dots and Boxes, Mancala, Sea Battle and Ultimate Tic-Tac-Toe solo vs the computer and pass & play, resume, rematch, offline
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
