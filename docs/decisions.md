# Decisions

Short records of the choices behind the first version, newest last. Each says what was picked, why, and what it costs.

## A web app, not a native app

One codebase that runs on any phone, installs from the browser to the home screen, and needs no app store review. A manifest and a service worker make it installable and let pass & play work offline. The cost: no push notifications on every platform and a little less control over the screen than a native app, neither of which this game needs.

## TypeScript, Vite, canvas, no UI framework

The game is one canvas plus a handful of simple screens. Vite gives a fast dev server and a hashed production build with almost no config. A framework would add weight and churn for a few buttons and forms, so screens are plain HTML (each game's `screens.html`) shown and hidden by id. Canvas 2D draws the course; the static parts are baked once per hole (see "A baked, lit course") and blitted each frame.

## One shared, deterministic core

`src/games/mini-golf/core` holds the physics, the 18 holes, the match rules and the online protocol, and both the phone and the room server import it. The physics runs on a fixed clock (120 ticks a second, 4 substeps each) and uses only `+ - * /` and `Math.sqrt`, never `Math.exp`, `Math.hypot` or trigonometry, because those may round differently between JavaScript engines. A stroke is sent as a whole-number velocity, so a shot means the same thing everywhere. A unit test pins one shot's exact result, so an accidental physics change fails CI rather than splitting online games between versions.

## Cloudflare Worker with a Durable Object per room

Superseded by "Parties, not rooms" below: the Worker and the authority stay, but one Durable Object now holds a party, not a golf room.

Online play needs a small authority that holds turn state and fans out moves to two phones. A Durable Object is exactly one stateful instance per room, addressed by the room code, with WebSockets built in. One Worker serves both the static app and the `/api` routes, so there is a single deploy and no CORS. Rooms use the WebSocket hibernation API (idle rooms cost nothing) and SQLite-backed storage (free plan). It runs fully locally with `wrangler dev`.

The room replays every stroke with the shared physics and broadcasts the result, so it is the source of truth: a phone animates its own stroke at once (it would compute the same path) and then settles on the server's state. A stroke carries the stroke count it was aimed from; a stale or out-of-turn stroke is refused and the phone is resynced.

## No accounts, no personal data kept

A phone gets a random token on first launch and keeps it in local storage. That token is the only thing that ties a player to a seat, which is enough to take the seat back after a dropped connection or a reload. The one exception is the lobby: a guest seat whose phone has no live connection goes to the next phone that opens the invite, so a stale join cannot lock the host's friend out. Names are typed per game and live only in the room (now the party, see below). A room deletes all of its storage two hours after its last activity, or ten minutes after a player leaves.

## Turn and score rules

- Strokes alternate; a player whose ball is in is skipped.
- The lower score on the last hole tees off first on the next (the honour); a tie keeps the order.
- A ball still out after 6 strokes is picked up and scores 7, so no hole drags on (+3 on a par 4, +5 on a par 2).
- Lowest total after 18 holes wins. A rematch starts with the winner on the tee.
- Online, the next hole and a rematch wait until both players have tapped on, so nobody is rushed off the scorecard.

## 18 holes, every one aceable

The course is 18 holes, and every hole has a one-stroke line (a unit test proves it with the solver). A sweep of tee shots keeps each hole's hole-in-one rate between 0.005% and 2%: easy holes land about 1-2% of tee shots, the hardest far rarer but never zero. Full power is 1025 units a second (it was 760). The drag curve is unchanged for the first 70% of the pull and steeper for the rest, so soft putts feel as before and the extra power sits at the top. The curve lives only in the phone's input code: a stroke still travels as a whole-number velocity, and the room protocol version was bumped so a stale phone is refused rather than desyncing.

## Solo play

One player plays all 18 holes with a running score against par and an end-of-round card. It runs on the same match rules as pass & play with the second seat parked, so the stroke cap and pick-up score are identical. Nothing goes to a server. The best finished round (lowest total) is the only thing saved, in local storage on the phone, and shows on the home screen.

## Aim: drag anywhere with a bounce preview

Chosen on the prototype board. You drag anywhere on the screen (no need to touch the small ball), pull back like a slingshot, and let go. The preview is the real physics run forward for a short distance, so it shows bounces off walls and bumpers exactly. Its length grows with power but is capped at a short stretch, so it shows the line and the first bounces without solving the hole. Online, the other phone sees the same line, dimmed, while you aim.

## Pass & play hand-off card

Also from the board: after each stroke a full-screen "Pass to Kai / I'm ready" card covers the course until the next player taps, so the next aim stays private. Input is blocked from the moment the stroke ends until the card is dismissed.

## A baked, lit course

The course looks like a real outdoor putt-putt: loop-pile carpet, red timber rails with a black rubber strip, white-and-red posts, loose sand, a steep Volcano with a red carpet crater, bark mulch around it, and a low afternoon sun with hard shadows. To get depth without a 3D engine, each hole is baked into a heightfield (rails, posts, hills, slopes, sand dips), lit per sample (normal, soft shadow, ambient occlusion) and drawn with a slight oblique camera so raised things show their front faces. `src/games/mini-golf/client/bake.ts` does it with no DOM, so it runs in a worker (`bake.worker.ts`) and a unit test pins the look. The bake happens once per hole and screen size; the next hole is baked during play, and a hole that is not ready yet shows flat colours and fades the baked picture in. Each frame is one blit plus the flag, aim preview, balls and power ring. The texture stays near one cell per unit on purpose: finer fibre aliased into a velvet fuzz. Physics is untouched, so the Volcano looks steeper than its push feels.

## Fonts and icons are not committed binaries

Fonts (Outfit only) come from a pinned `@fontsource` package and are bundled and cached for offline use, so no request goes to a font CDN. App icons are drawn by `scripts/icons.ts` at build time (a tiny PNG encoder on Node's zlib), which keeps the repository free of image files.

## Pinned versions

Every npm dependency is pinned to an exact version. TypeScript stays on 6.0 because `typescript-eslint` does not support 7.0 yet.

## One app, many games

The app became Games: a menu of games in one installable web app, starting with Mini Golf and Connect Four. One app means one install, one service worker and one deploy, and a new game costs a folder and one line in `src/shell/games.ts`. Each game lives in `src/games/<id>/` and gets its own path (`/mini-golf`, `/connect-four`), so links go straight to a game and the browser back button returns to the menu. The menu imports only each game's small `info.ts`; the game's code, styles and screens load when it is first opened, so the menu stays light as games are added. Every built file is still precached, so all games work offline after the first visit. Games re-theme the shared screen styles through CSS tokens scoped to `body[data-game]`, and save under their own storage prefix. The cost: games share one bundle of base styles and one `body`, so a game must keep its ids and classes prefixed (`c4-…`) to avoid clashes.

Connect Four plays pass & play and solo against the computer. A game is its first player plus the list of columns played, which replays to the same board every time; that is what is saved, and it is the whole wire protocol online.

The computer (`core/ai.ts`, no DOM) is a fixed-depth minimax with alpha-beta that tries the centre columns first. Each line of four keeps a chip count per player, so a win check and a position score cost almost nothing; the search also takes a win at once and searches only the block when the other player threatens one. Easy looks 2 plies ahead and plays a random column 35% of the time, Medium 4 plies and 10%, Hard 9 plies and never. Hard's worst move in test games is about 15 ms in Chrome on a laptop and under 90 ms with the CPU slowed 6x, inside a 150 ms budget for a mid-range phone. A fixed depth, not a time limit, keeps a move the same on every phone. The randomness (mistakes, and the pick among equal best moves) comes from a seed saved with the game and mixed with the move number, so a move depends only on the position: a reload on the computer's turn plays the same column. It waits half a second before moving so the game does not feel rushed. Solo and pass & play save apart, and a solo game and its score belong to one name and level. The cost: Hard is strong but not perfect, since it does not see past 9 plies.

Online, Connect Four's host (`core/host.ts`) holds the first player, the columns, the score and who wants a rematch, and checks every drop with the same board rules. A drop names the column and how many moves the phone saw, so a drop out of turn, into a full column, after the game or from a stale board is refused and that phone resynced. Red is seat 0 (the maker) and yellow seat 1; the player who picked the game drops first, and a rematch, once both players tap it, swaps who starts. Live aim is relayed to the friend, never stored. When the party closes a game, the host's `carry` keeps only what the next start needs (for Connect Four, the score), and `start` gets it back and checks it. So the score lasts for the party, through trips to the menu. Golf has no `carry` and keeps nothing. The protocol went to 4. The cost: the score lives on the server only, so it ends with the party.

## Pick how you're playing once

The first screen asks how you're playing (solo, pass & play or online) and then who's playing, before the menu, so no game asks again. The answer is the session: the mode, one or two names and, in solo, the computer's level (Easy, Medium or Hard). It is saved under `shell.` and passed to every game as `open(rest, session)`. Each game's `info.ts` says which modes it plays, and solo can be "alone" (Mini Golf against par) or "computer". A game that can't play the current mode stays on the menu, dimmed, with a one-line reason, so the list never jumps around; a link to it goes back to the menu and says why. A chip on the menu reopens the picker with the current answers filled in. A link to a game on a first visit shows the picker, then goes on to that game, and a Mini Golf invite link still lands on its join screen with your name filled in.

Online is kept small on purpose: the session only holds your name, and Mini Golf's own create-or-join screen and rooms do the rest. Parties, where the shell holds the connection and any game can use it, come next and will add a channel to the online session. (They did: see "Parties, not rooms".) The cost: a game with a richer setup (teams, rule options) still needs its own screen after the menu.

## Parties, not rooms

Online play is a party of two phones, not a room per game. One phone makes a code and sends the link (`/p/<code>`), the other opens it, and they stay together for every online game: either player taps a game and both phones open it, and leaving a game takes both back to the menu. The shell holds the one WebSocket, and the online session saves the party code, so reopening the app rejoins. Old golf room links (`/mini-golf/r/<code>`) go to the party with the same code.

One `Party` Durable Object per code holds the two seats (token and name), which game is open and that game's state. It keeps the room's habits: hibernating WebSockets, SQLite storage, and deleting itself two hours after the last activity or ten minutes after a player leaves. The stale-guest rule carries over: until the two players first open a game together, a guest seat with no live phone goes to the next phone with the link; after that the seat is kept. The maker's seat is never given away. After a player leaves, only the one who stayed can reconnect, so a phone that was offline at the time still hears who left. The `v2` migration deletes the old `Room` class, so links to old rooms find nothing.

Each online game has a host (`src/party/host.ts`): `start`, `parse`, `receive` and `sync`, plain data and pure functions, listed in `worker/hosts.ts`. The party checks the envelope and hands the game's messages to its host; a game on the phone gets a `Channel` with its seat, both players, the connection state, `send`, `listen` and `leave`, and never sees the socket. Golf's host keeps it server-authoritative: it replays each stroke, and a stale or out-of-turn stroke is refused and that phone resynced. A new online game is a host, one line in `worker/hosts.ts` and `online: true`. The protocol version went to 3, so a phone on the old room protocol is told to reload. The cost: going back to the menu ends the round (Connect Four keeps only its score), and a party is two players only.
