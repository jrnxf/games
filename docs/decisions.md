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

In solo, the computer shows two things, and nothing while you play. `think()` returns its move with how many positions the search scored, how long it took, and how many chips to a forced win, if any. It draws nothing from the seed's stream, so every level plays exactly the same moves as before. Once it has a forced win, a line under the board says "I can win in 2 more moves, no matter what you play" on your turn, in the computer's voice. It never guesses where you will play: the line is a fact inside its depth, true whatever you do. The line keeps its room all game, so the board never moves. The numbers for each of its moves are saved with the game, so the recap in the result (positions checked, how early it saw its win, its longest think, a bar per move) survives a reload. "Watch the ending" replays the real last chips from the move where it first saw the forced win. The recap needs more room than the controls, so at the end the board can shrink a little to keep the winning four in view. We tried more (a live ladder of the search, a score for each column, a step to read them before your turn) and kept only these two.

Online, Connect Four's host (`core/host.ts`) holds the first player, the columns, the score and who wants a rematch, and checks every drop with the same board rules. A drop names the column and how many moves the phone saw, so a drop out of turn, into a full column, after the game or from a stale board is refused and that phone resynced. Red is seat 0 (the maker) and yellow seat 1; the player who picked the game drops first, and a rematch, once both players tap it, swaps who starts. Live aim is relayed to the friend, never stored. When the party closes a game, the host's `carry` keeps only what the next start needs (for Connect Four, the score), and `start` gets it back and checks it. So the score lasts for the party, through trips to the menu. Golf has no `carry` and keeps nothing. The protocol went to 4. The cost: the score lives on the server only, so it ends with the party.

## Pick how you're playing once

The first screen asks how you're playing (solo, pass & play or online) and then who's playing, before the menu, so no game asks again. The answer is the session: the mode, one or two names and, in solo, the computer's level (Easy, Medium or Hard). It is saved under `shell.` and passed to every game as `open(rest, session)`. Each game's `info.ts` says which modes it plays, and solo can be "alone" (Mini Golf against par) or "computer". A game that can't play the current mode stays on the menu, dimmed, with a one-line reason, so the list never jumps around; a link to it goes back to the menu and says why. A chip on the menu reopens the picker with the current answers filled in. A link to a game on a first visit shows the picker, then goes on to that game, and a Mini Golf invite link still lands on its join screen with your name filled in.

Online is kept small on purpose: the session only holds your name, and Mini Golf's own create-or-join screen and rooms do the rest. Parties, where the shell holds the connection and any game can use it, come next and will add a channel to the online session. (They did: see "Parties, not rooms".) The cost: a game with a richer setup (teams, rule options) still needs its own screen after the menu.

## Parties, not rooms

Online play is a party of two phones, not a room per game. One phone makes a code and sends the link (`/p/<code>`), the other opens it, and they stay together for every online game: either player taps a game and both phones open it, and leaving a game takes both back to the menu. The shell holds the one WebSocket, and the online session saves the party code, so reopening the app rejoins. Old golf room links (`/mini-golf/r/<code>`) go to the party with the same code.

One `Party` Durable Object per code holds the two seats (token and name), which game is open and that game's state. It keeps the room's habits: hibernating WebSockets, SQLite storage, and deleting itself two hours after the last activity or ten minutes after a player leaves. The stale-guest rule carries over: until the two players first open a game together, a guest seat with no live phone goes to the next phone with the link; after that the seat is kept. The maker's seat is never given away. After a player leaves, only the one who stayed can reconnect, so a phone that was offline at the time still hears who left. That reconnect does not count as activity, so it cannot keep an ended party past its ten minutes. The `v2` migration deletes the old `Room` class, so links to old rooms find nothing.

Each online game has a host (`src/party/host.ts`): `start`, `parse`, `receive` and `sync`, plain data and pure functions, listed in `worker/hosts.ts`. The party checks the envelope and hands the game's messages to its host; a game on the phone gets a `Channel` with its seat, both players, the connection state, `send`, `listen` and `leave`, and never sees the socket. Golf's host keeps it server-authoritative: it replays each stroke, and a stale or out-of-turn stroke is refused and that phone resynced. A new online game is a host, one line in `worker/hosts.ts` and `online: true`. The protocol version went to 3, so a phone on the old room protocol is told to reload. The cost: going back to the menu ends the round (Connect Four keeps only its score), and a party is two players only.

## Reversi

Reversi follows Connect Four's shape: a game is its first player plus the list of cells played, which replays to the same board every time. That list is the save and the whole wire protocol. Dark is seat 0 and light seat 1, and the first player's discs sit on the same two opening cells whoever starts. A pass is not a move and is never stored: the board rules keep the turn with the player who can move, and say that the other one passed. So no phone and no host can get a pass wrong, and a pass needs no message online.

The computer (`core/ai.ts`, no DOM) is a negamax with alpha-beta that deepens one ply at a time. It scores a position by where the discs sit and by how many moves each side has. Corners score high. The cells next to a corner cost, but only while that corner is empty. A finished game scores its disc margin above every guess, and a sooner win scores higher. Easy looks 1 ply ahead and plays a random legal move 30% of the time, Medium 3 plies and 10%, Hard 7 plies and never. Near the end the search runs to the last disc, from 6 empty cells on Medium and 12 on Hard, so Hard plays a perfect endgame.

The search is capped by positions, not by the clock: Hard scores 40,000 at most. A deeper pass that spends the budget is dropped, and the move comes from the last pass that finished. That is about 55 ms on a laptop and should stay under about 220 ms on a phone 4x slower, inside the 300 ms limit. A clock would stop at a different depth on each phone. A position budget keeps a move a pure function of the board, the level and the seed, so a reload on the computer's turn plays the same cell, as in Connect Four. The cost: a fast phone does not search deeper than a slow one.

A move is committed and saved before its discs turn. The flips are only a picture of a board that is already final, so a reload or a closed tab in the middle of the animation loses nothing, and the result waits until the last disc has turned. Online there is no dimmed pending choice, unlike Connect Four's hovering chip: one tap plays a disc, so there is no aim to show. The faint dots on your own turn do that job. The host checks each move with the same board rules, and a move names how many moves the phone saw, so a stale, out-of-turn or illegal move is refused and that phone resynced. `carry` keeps the score. The protocol went to 5.

Eight cells of 44 px do not fit a 360 px phone with the normal side padding. On narrow phones the board runs edge to edge, so every cell stays a full tap target. The cost: the board has no margin there, which is fine for a grid with its own frame.

## Dots and Boxes

Dots and Boxes keeps the same shape: a game is its first player plus the list of lines drawn. The 60 lines have fixed numbers, the 30 across first and then the 30 down, so the list replays to the same board every time. It is the save and the whole wire protocol. An extra turn is not stored: the board rules keep the turn with the player who closed a box. Orange is seat 0 and blue seat 1. The grid is 5 by 5, so the 25 boxes can never split evenly and the game has no draw.

Each line is a button whose tap area is a diamond: from its two dots to the middle of the box on each side. The diamonds tile the whole board with no gap and no overlap, so a tap anywhere draws the nearest line, and no one has to hit a thin stroke. The cost: a careless tap always draws something, and a line can't be taken back.

The computer (`core/ai.ts`, no DOM) plays by plain rules on two levels and searches on the third. Easy never draws the third side of a box while it has another line, and takes a box on offer only half the time, so it looks careless and not broken. Medium takes every box, and gives away the fewest when it must give some. Hard does the same until 24 or fewer safe lines are left, then it searches. The first pass plays out the safe lines and scores the chains and loops that remain when they run out. That is the long-chain rule: Hard aims to be the player who does not have to open the first long chain. The second pass runs to the end of the game. It finds the double-deal, where Hard leaves the last two boxes of a chain so its opponent must open the next one. The search never gives a box away while a safe line is left, which keeps it small. The endgame pass matches a brute-force solver in tests.

Each pass is capped by positions, not by the clock: 40,000 at most, as in Reversi, and for the same reason. A pass that spends its budget is dropped, and with no finished pass Hard plays like Medium. The worst move is about 45 ms on a laptop and should stay under about 180 ms on a phone 4x slower, inside the 300 ms limit. The cost: early in the game, with more than 24 safe lines, Hard is no stronger than Medium. Those lines rarely decide a game.

A line and the boxes it closes are final and saved at once. The draw-in and the pop of a closed box are only a picture, kept by a `fresh` class through later redraws, so play never waits for an animation. The computer waits half a second before it moves, and a quarter second before each further line of an extra turn, so you can follow a run of boxes. Online there is no dimmed pending choice, as in Reversi: one tap draws the line.

The host checks each line with the same board rules, and a line names how many lines the phone saw, so a stale, out-of-turn or repeated line is refused and that phone resynced. Extra turns add one case. A phone may draw its next line before the host has answered the last one, so an answer can hold fewer lines than the phone's board. The phone keeps its board when the answer is a longer start of it than the last answer was. An answer that did not grow means the host refused a line, and the phone takes the host's board and tells the player to draw that line again. `carry` keeps the score. The protocol went to 6. The cost: Reversi has the same gap after a pass on a slow link and does not have this fix yet. It is rare there, because the discs must finish turning before the next tap.

## Mancala

Mancala plays the common Kalah rules, and keeps the same shape: a game is its first player plus the list of pits played. A pit is a number from 0 to 5, counted from its mover's left, so the same list plays the same game with the seats swapped. It is the save and the whole wire protocol. An extra turn is not stored: the board rules keep the turn with the player whose last seed fell in their store. One rules choice is not universal. A capture needs seeds in the pit opposite: a last seed that lands across from an empty pit stays where it is. It is the most common reading, and it keeps a lone seed from scoring for nothing. Amber is seat 0 and teal seat 1, and a 24-24 game is a draw that counts for nobody.

The board stands upright, with a store at each end and six pits down each side. A phone in portrait has the height for six pits of 54 px or more in a column, and not the width for six in a row. Your pits run down the left into your store at the bottom, so sowing still goes anticlockwise. The near seat is seat 0 offline and this phone's own seat online: each phone sees its own store at the bottom, and the player cards swap sides with it. The cost: two players on one phone do not sit at opposite ends as they do at a real board, and the second player reads their pits from the far side.

The computer (`core/ai.ts`, no DOM) is a negamax with alpha-beta on the difference between the two stores, one ply deeper each pass. An extra turn is one more ply for the same player, so the search reads a run of extra turns like any other line. A finished game scores its seed margin above every guess. The evaluation has nothing else in it, and the search keeps no table of positions: depth alone makes it strong. Easy reads 1 ply and plays a random pit 30% of the time, Medium 4 plies and 10%, Hard as deep as its budget allows and never. The search is capped by positions, not by the clock, as in Reversi and for the same reason: Hard scores 150,000 at most, which is 10 to 14 plies in the middle game. A pass that spends the budget is dropped, and the move comes from the last pass that finished. The worst move is about 25 ms on a laptop and should stay under about 100 ms on a phone 4x slower, inside the 300 ms limit. Near the end the search reads every line to the last seed, and the move then matches a brute-force solver in tests.

A move counts and saves at once, before its seeds fall. The sowing is only a picture of a board that is already final: a lift, one seed a hole every 100 ms, then the capture or the last sweep with a "+N" chip on the store. A reload or a closed tab in the middle of it loses nothing. Unlike Dots and Boxes, the board locks while the seeds fall, because the next tap must read the counts on screen. The computer waits half a second before it moves, and 300 ms before each further move of an extra turn. With reduced motion the seeds land at once. Online there is no dimmed pending choice, as in Reversi: one tap sows the pit.

The host checks each move with the same board rules, and a move names how many moves the phone saw, so a stale, out-of-turn or empty-pit move is refused and that phone resynced. When the host's answer is one move longer than the phone's board, the phone sows that move seed by seed, and the "your turn" alert waits until the seeds land. The echo of the phone's own move leaves its falling seeds alone. A second move in an extra turn can leave before the first answer comes back, so the phone uses the rule from Dots and Boxes: it keeps its board while each answer is a longer start of it than the last. `carry` keeps the score. The protocol went to 7.
