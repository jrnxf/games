# New games progress

Five games, one at a time, in this order. Each game follows the steps below. Delete this file when all five are done.

Steps per game: core rules + unit tests, computer + tests, client (solo and pass & play) + `info.ts` + `GAMES`, online host + protocol + `worker/hosts.ts` + online client, e2e (`menu.ts`, `online.ts`), README + `docs/decisions.md`.

## 1. Reversi (`reversi`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/reversi.test.ts`)
- [x] Computer: alpha-beta, positional + mobility evaluation, depth by level, capped by positions + tests (`core/ai.ts`, `tests/unit/reversi-ai.test.ts`)
- [x] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score
- [x] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (5), host tests (`tests/unit/reversi-host.test.ts`), online client code
- [x] E2E: `tests/e2e/reversi.ts`, called from `tests/e2e/menu.ts` and `tests/e2e/online.ts`, screenshots checked at 390x844, 360x740 and tablet
- [x] README entry and `docs/decisions.md` section

## 2. Dots and Boxes (`dots-and-boxes`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/dots-and-boxes.test.ts`)
- [x] Computer: plain rules on Easy and Medium, a search of safe lines and of the endgame on Hard, capped by positions + tests (`core/ai.ts`, `tests/unit/dots-and-boxes-ai.test.ts`)
- [x] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score
- [x] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (6), host tests (`tests/unit/dots-and-boxes-host.test.ts`), online client code
- [x] E2E: `tests/e2e/dots-and-boxes.ts`, called from `tests/e2e/menu.ts` and `tests/e2e/online.ts`, screenshots checked at 390x844, 360x740 and tablet
- [x] README entry and `docs/decisions.md` section

## 3. Mancala (`mancala`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/mancala.test.ts`)
- [x] Computer: alpha-beta on store difference, depth by level, capped by positions + tests (`core/ai.ts`, `tests/unit/mancala-ai.test.ts`)
- [x] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score, sowing animated seed by seed
- [x] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (7), host tests (`tests/unit/mancala-host.test.ts`), online client code
- [x] E2E: `tests/e2e/mancala.ts`, called from `tests/e2e/menu.ts` and `tests/e2e/online.ts`, screenshots checked at 390x844, 360x740 and tablet
- [x] README entry (and its Test section) and `docs/decisions.md` section

## 4. Sea Battle (`sea-battle`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/sea-battle.test.ts`)
- [x] Computer: Easy fires at random, Medium hunts then targets, Hard uses a probability density map + tests (`core/ai.ts`, `tests/unit/sea-battle-ai.test.ts`)
- [x] Client: placement (drag, rotate, Random), solo and pass & play with the hand-off card, `info.ts`, added to `GAMES`, save and running score
- [x] Online host: `core/protocol.ts`, `core/host.ts` (each phone gets only its own fleet and the shot results), `worker/hosts.ts`, `PROTOCOL` bump (8), host tests with no-leak tests (`tests/unit/sea-battle-host.test.ts`)
- [x] Online client: `online: true` in `info.ts`, the filter gone from `tests/unit/games.test.ts`, placement sent to the host, the friend's aim dimmed, "your turn" alert, `ConnectionBanner`, rematch that waits for both
- [x] E2E online: `seaOnline` in `tests/e2e/sea-battle.ts`, called from `tests/e2e/online.ts`
- [x] E2E menu: solo, pass & play and offline parts in `tests/e2e/sea-battle.ts`, called from `tests/e2e/menu.ts`, screenshots checked at 390x844, 360x740 and tablet
- [x] README entry (and its Test section) and `docs/decisions.md` section

## 5. Ultimate Tic-Tac-Toe (`ultimate-tic-tac-toe`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/ultimate-tic-tac-toe.test.ts`)
- [x] Computer: Monte Carlo tree search, playouts by level, capped by time + tests (`core/ai.ts`, `tests/unit/ultimate-tic-tac-toe-ai.test.ts`)
- [x] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score, the open boards lit
- [x] Online host: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (9), host tests (`tests/unit/ultimate-tic-tac-toe-host.test.ts`)
- [x] Online client: `online: true` in `info.ts`, the filter gone from `tests/unit/games.test.ts`, the friend's aim dimmed, "your turn" alert, `ConnectionBanner`, rematch that waits for both
- [x] E2E online: `ultimateOnline` in `tests/e2e/ultimate-tic-tac-toe.ts`, called from `tests/e2e/online.ts`
- [x] E2E menu: solo, pass & play and offline parts in `tests/e2e/ultimate-tic-tac-toe.ts`, called from `tests/e2e/menu.ts`, screenshots checked at 390x844, 360x740 and tablet
- [ ] README entry (and its Test section) and `docs/decisions.md` section

- [ ] Last: run every check in "Done means" (`test:e2e`, `test:solo` and `test:look` too), then delete this file

## Notes

- Reversi board: seat colours are fixed, and the starter holds cells (3,4) and (4,3), so the opening is the same shape whoever starts. A pass is never stored in `moves`. `play` keeps the turn with the mover and sets `passed`.

- Reversi computer: `think(board, level, seed)` returns `{ cell, positions, ms, depth }`. The cap is a position budget, not a clock, so a move is a pure function of the board, the level and the seed. Hard scores 40,000 positions at most, about 55 ms on a desktop. Write this choice in `docs/decisions.md` at the README step.

- E2E shape: each new game has its own file in `tests/e2e/` (see `reversi.ts`) that exports a solo part, a pass & play part, an offline part and an online part. `menu.ts` and `online.ts` call them, so those two files stay short. Whole fixture games live in `tests/unit/<id>-games.ts`, shared by the unit and browser tests. The Reversi test hook is `window.__reversi.state()`, and a cell is `#rv-board .rv-cell:nth-child(cell + 1)`.

- Reversi has no dimmed pending choice online: one tap plays a disc, so there is no aim to show. Write this in `docs/decisions.md` at the README step, with the edge-to-edge board (44 px cells at 360 px) and the move that saves before its discs turn.

- Dots and Boxes board: 60 lines, the 30 horizontal ones first (`across(row, col)`), then the 30 vertical ones (`down(row, col)`). A game is its starter plus the lines drawn. `play` keeps the turn with the mover and sets `again` when a line closes a box. 25 boxes can't split evenly, so there is no draw. Fixture games are in `tests/unit/dots-and-boxes-games.ts`.

- Dots and Boxes computer: `think(board, level, seed)` returns `{ line, positions, ms, exact }`. Easy takes a box on offer half the time, so it looks careless and not broken. Medium takes every box and gives away the fewest. Hard searches once 24 or fewer safe lines are left: one pass that scores the chains and loops left when the safe lines run out (the long-chain rule), then one pass to the end of the game (double-deals), each capped at 40,000 positions, about 45 ms at worst on a desktop. Over the budget it plays like Medium. The search never gives boxes away while a safe line is left. The endgame matches a brute-force solver. Write these choices in `docs/decisions.md` at the README step.

- Dots and Boxes client: ids and classes start with `db-`. Each line is a button with a diamond tap area (`clip-path`), from its two dots to the middle of the box on each side, so the diamonds tile the page and a tap draws the nearest line. A move has no busy wait: the new line and the closed boxes carry a `fresh` class that a later redraw keeps. The computer waits 500 ms, and 260 ms before each further line of an extra turn. The test hook is `window.__boxes.state()`, and line `i` is `document.querySelectorAll("#db-board .db-line")[i]`. Online has no dimmed pending choice, as in Reversi: one tap draws the line. Write the diamond tap area and this in `docs/decisions.md` at the README step.

- Dots and Boxes online: in an extra turn a phone may draw its next line before the host has answered the last one. The host's answer then holds fewer lines than the phone's board. `settle` keeps the board when the answer is a longer prefix of it than the last answer (`heard`), and treats an answer that does not grow as a refused move. Write this in `docs/decisions.md` at the README step. Reversi has the same gap after a pass on a slow link (a second disc before the first answer shows a "Connection hiccup" toast). It is rare, because the discs must finish turning first, and it is not fixed yet.

- Dots and Boxes e2e: `WHOLE` in `tests/e2e/dots-and-boxes.ts` is `GIFT` plus every other line in line order, and the second player wins 15 to 10. `rushOut` taps each run of lines by one player inside that player's page.

- Mancala board: 14 holes in sowing order: seat 0's pits 0 to 5 from its left, its store (6), seat 1's pits (7 to 12), its store (13). A move is a pit 0 to 5 counted from its mover's left, so the same moves play the same game with the seats swapped. `sowing(b, pit)` gives the hole each seed falls in, for the client's seed-by-seed animation. `play` sets `again`, `captured` (seeds taken, the last seed included) and `swept` (seeds each side keeps at the end). A capture needs seeds in the pit opposite: a last seed opposite an empty pit stays. Write that rules choice in `docs/decisions.md` at the README step. Fixture games (a quick win, a sweep, a 24-24 draw, an end with nothing swept) are in `tests/unit/mancala-games.ts`.

- Mancala computer: `think(board, level, seed)` returns `{ pit, positions, ms, depth, exact }`. It is a negamax with alpha-beta on the store difference, one ply deeper per pass. An extra turn is one more ply for the same player. A finished game scores its margin times 100, so a sure result beats every guess. Easy reads 1 ply and plays a random pit 3 times in 10. Medium reads 4 plies, with 1 random pit in 10. Hard reads as deep as 150,000 positions allow (10 to 14 plies in the middle game, about 25 ms at worst on a desktop). `exact` is true when no line stopped at a guess, so the result is certain. Write these choices in `docs/decisions.md` at the README step.

- Mancala client: ids and classes start with `mc-`. The board stands upright: a store at each end and six pits down each side. The near seat's pits run down the left into the bottom store, and the other seat's run up the right into the top store. The near seat is seat 0 offline and this phone's seat online, and the player cards swap sides with it. A move counts and saves at once. Then `sow` shows it frame by frame (`framesOf`: a lift, one seed per hole every 100 ms, a capture, the end sweep) while `busy` locks taps. `shown` holds the seeds on screen. With reduced motion the seeds land at once. The dashed pit is the one the last move came from. The computer waits 500 ms, and 300 ms before each further move of an extra turn. The test hook is `window.__mancala.state()` (it has `busy`, `shown`, `holes`, `near`), and a legal pit is `#mc-board .mc-pit.can`. Hole `h` is `#mc-board > :nth-child(h + 1)`. Online has no dimmed pending choice: one tap sows the pit. Write the upright board, the near seat and this in `docs/decisions.md` at the README step.

- Mancala online: `settle` sows the friend's move when the host's answer is one move longer than the board, keeps falling seeds on the echo of this phone's own move, and has the same `heard` rule as Dots and Boxes for a second move in an extra turn. The e2e must play an extra turn on a slow link, a capture, and a rematch.

- Mancala e2e: the pass & play part plays `QUICK` (a capture, an extra turn, a last sweep, 28 to 20), then `DRAW` with the other starter, then two moves of `SWEPT` and a reload. The online part plays `QUICK` to a result, then `SWEPT` on a slow link after the rematch. `tap` waits for the seeds to land (`!busy`) on every phone, and `tapAll` taps inside the page as soon as the board unlocks. A `MutationObserver` on the status bar records every line it shows, so the extra-turn message is checked against the moves played. The two phones found no bug in the online client.

- Sea Battle board: a `Ship` is `{ cell, len, down }` with `cell` its top or left end, and a `Fleet` lists one ship per length in `FLEET` order (5, 4, 3, 3, 2). Ships may touch but not overlap (`validFleet`). A game is its starter, the two fleets and the cells fired at, turn about: a hit gives no extra shot. `seen[seat]` is a `Sight`: the marks (`"hit"`, `"miss"`, null) on the other's water and the ships sunk there. A sight never holds a ship that is afloat, so the computer must take a `Sight`, not a `Board`, and the online host must send each phone its own fleet plus the two sights. `fire` sets `last` (`{ cell, hit, sunk }`). The winner keeps the turn. There is no draw. `randomFleet(rand)` takes a `rng(seed)` stream. Fixtures (`ROWS`, `COLUMNS`, `decks`, `rout`) are in `tests/unit/sea-battle-games.ts`. Write the touching-ships rule, the no-extra-shot rule and the `Sight` model in `docs/decisions.md` at the README step.

- Sea Battle computer: `think(sight, level, seed)` returns `{ cell, placements, ms, chasing }`. It takes a `Sight`, never a `Board`, so it can't read the fleet. In solo, call it with `board.seen[computerSeat]`. Easy fires at any open cell. Medium fires on one colour of a checkerboard, and after a hit it fires next to the open hits, the cells that extend a line of two first. Hard builds `density(sight)`: for each open cell, the ways a ship still afloat can cover it. A way can't cross a miss or a sunk ship, and it can't lie on hits alone. A way through an open hit counts 1,000 times more per hit, so one map hunts and finishes ships. `openHits(sight)` lists the hits on ships not yet sunk, which a hit that touches a sunk ship still is. Over 300 seeded fleets Easy needs about 95 shots, Medium 52 and Hard 46. Hard beats Medium in about two games of three, because the fleets are luck. A shot takes under 1 ms, so there is no budget and no worker. Write these choices in `docs/decisions.md` at the README step.

- Sea Battle client: ids and classes start with `sb-`. Four screens: `sb-home`, `sb-place`, `sb-pass` (the "Pass to" card) and `sb-game`. A 10x10 grid can't have 44 px cells on a phone (36 px at 360), so a tap only aims and the "Fire" button shoots. The big grid (`#sb-sea`) is the other player's water as the viewer knows it. The small grid (`#sb-own`) is the viewer's own fleet with the shots that fell there. `view` is the seat the screen is for: seat 0 in solo, the player on turn in pass & play. Both grids are drawn by `paint` from cell classes (`ship`, `down`, `a`, `z`, `sunk`, `hit`, `miss`, `last`, `fresh`, `aim`, `can`). A cell keeps its class when nothing changed, so a splash plays once. Ships have names by length (Flagship, Frigate, Cutter, Skiff): they are this game's own words. Write the aim-then-fire choice, the two grids and the ship names in `docs/decisions.md` at the README step.

- Sea Battle placement: the fleet starts as a random layout, so it is always legal and "Ready" always works. A drag moves a ship (pointer events on `#sb-yard`, 8 px before a tap becomes a drag), a tap turns it, and "Turn ship" turns the last ship touched. `placed`, `clamped` and `turned` in `core/board.ts` hold the logic, with unit tests. A placement is not saved: the save holds `fleets: null` (the score and the starter only) until both fleets are placed. In pass & play the player who fires second places first, so the game starts in the starter's hands with no extra card. After each shot the result stays up 1.3 s (`resting`), then the "Pass to" card goes up with the shot in words. A resumed pass & play game starts behind the card. The test hook is `window.__sea.state()` (it has `screen`, `draft`, `fleets`, `seen`, `view`, `aim`, `canAim`, `resting`, `thinking`). Cell `c` of the big grid is `#sb-sea .sb-cell:nth-child(c + 1)`. A test can move a ship with `PointerEvent`s dispatched on a cell of `#sb-yard`.

- Sea Battle is on the menu with `online: false` until its host exists, so its tile is dimmed in a party ("Not online yet"). `tests/unit/games.test.ts` filters `sea-battle` from its "every game plays online" check: remove that filter and set `online: true` at the online step. `tests/e2e/menu.ts` now expects six tiles.

- Sea Battle online host: the server state is `SeaMatch` (`first`, `fleets` with a fleet or null per seat, `shots`, `wins`, `rematch`). It never leaves the server. A phone gets `{ t: "state", view }` with a `SeaView` made by `viewOf(match, seat)`: `first`, `placed` (who is ready), `fleet` (its own), `foe` (the other fleet, null until the game is over), `seen` (both sights), `shots` (a count: the `at` of the next shot), `turn`, `last`, `over`, `winner`, `wins`, `rematch`. The phone sends `{ t: "place", fleet }` once per game, `{ t: "aim", cell }`, `{ t: "fire", cell, at }` and `{ t: "rematch" }`. A change is answered with `me` plus `others`, one view per phone, never `all`. A rematch by both starts a game with no fleets and the other player first. The host is in `HOSTS` and `PROTOCOL` is 8, but `info.ts` still says `online: false`, so the tile stays dimmed until the client lands. Write the view model in `docs/decisions.md` at the README step.

- Sea Battle online client: the phone has no `Board` of its own. `boardFrom(view)` builds one in the offline shape from the host's `SeaView`, so one `draw` serves every mode: its own fleet, an empty fleet for the friend until the game is over, and `known` for the shots. `known` holds the cells this phone saw fired. A shot it missed (a reload, a reconnect) is -1, because the view holds only the last shot's cell. Nothing is played ahead of the host: "Fire" sends the shot, `pending` locks the grid, and the host's view brings the result. A view with no more shots than `pending` shows "Connection hiccup · fire again". `mine` is the fleet this phone sent. A view that still has no fleet makes the phone send it again. A view whose `first` changed (or that is not over after one that was) is a new game: the phone goes back to the placement screen. Both phones place at the same time, and the one that is ready first sees "Waiting for <name>'s fleet". The friend's aim is a dimmed still ring on the small grid (`foeAim`). The hook has `me`, `placed`, `rematch`, `foeAim` and `pending`. Write these choices in `docs/decisions.md` at the README step.

- Sea Battle e2e online: the test reads each phone's own fleet from its hook (`draft` before "Ready"), so the maker fires at the friend's ships and the friend fires at open water. It checks that `fleets` on each phone has none of the other's ships until the game is over.

- The rematch line under a result keeps its place with a non-breaking space (`"\u00a0"`). A plain space collapses, and the board jumps when the friend asks. Dots and Boxes and Mancala had the plain space: fixed.

- Sea Battle e2e menu: `seaSolo`, `seaPassAndPlay` and `seaOffline` in `tests/e2e/sea-battle.ts`. The test reads both fleets from the hook, so it needs no fixed layout: in solo Zoe sinks the Skiff and then fires at open water until Hard wins, and in pass & play Zoe sinks Kai's fleet in 17 shots while Kai misses. `finger` moves a ship with `PointerEvent`s on `#sb-yard`, `hand` checks the "Pass to" card and taps "I'm ready", and `volley` fires a run of shots inside the page. `fits` checks the placement and game screens at 360x740 and 820x1180.

- Ultimate Tic-Tac-Toe board: a cell is `board * 9 + spot` (`at`, `boardOf`, `spotOf`), with boards and spots both row-major. `won` holds the seat per small board (null for a board in play and for a full board nobody won), and `target` is the small board the player on turn must play in (null: any open board). A won small board takes no more marks, even with empty spots. The game is a draw when no board is open and nobody has a line: the number of boards held does not count. `LINES` and `lineOf` serve the spots and the grid of boards. `openBoards(b)` is the list to highlight. Fixtures are in `tests/unit/ultimate-tic-tac-toe-games.ts` (`SENT_TO_WON`, `SENT_TO_FULL`, `WIN`, `DRAW`). Write the draw rule in `docs/decisions.md` at the README step.

- Ultimate Tic-Tac-Toe computer: `think(board, level, seed, ms = LEVELS[level].ms)` returns `{ cell, playouts, ms, capped }`. It has two caps: playouts by level (Easy 40, Medium 600, Hard 12,000) and a clock of 250 ms. Hard takes about 50 ms at most on a desktop, so the clock stops it on slow phones only. A move is a pure function of the board, the level and the seed while the clock does not cut the search short: the tests pass `Infinity` as `ms` for that. Before the search, the computer takes a win in one and leaves out every mark that hands the other player a win in one, and a playout takes a game-winning mark when there is one. The client can call `think` on the main thread. `ai.ts` must stay type-strippable (no constructor parameter properties), because Node runs the TypeScript directly. Write the two caps and the root filter in `docs/decisions.md` at the README step.

- Ultimate Tic-Tac-Toe client: ids and classes start with `ut-`. Nine spots across can't be 44 px on a phone (36 px at 360), so a tap only aims (a dim mark, `aim`) and "Place" makes the mark. A second tap on the aimed spot also makes it. The open boards have a ring and brighter spots in the colour of the player on turn (`.ut-small.open`, `.ut-cell.can`). A won board shows a big mark over its faded spots (`.won.s0`, `.won.s1`), a full board nobody won is `.dead`, and the winning three are `.line`. A new mark draws itself in (`fresh`). The status line adds "· any board" when the last mark sent the player to a closed board. The player is X and the computer O in solo. `think` runs on the main thread after a 500 ms wait. The test hook is `window.__ultimate.state()` (it has `moves`, `target`, `open`, `legal`, `won`, `line`, `aim`, `thinking`, `locked`, `notes`). Cell `c` is `document.querySelectorAll("#ut-board .ut-cell")[c]`, or `#ut-board .ut-small:nth-child(c / 9 + 1) .ut-cell:nth-child(c % 9 + 1)`. Write the aim-then-place choice in `docs/decisions.md` at the README step.

- Ultimate Tic-Tac-Toe is on the menu with `online: false` until its host exists, so its tile is dimmed in a party. `tests/unit/games.test.ts` filters `ultimate-tic-tac-toe` from its "every game plays online" check: remove that filter and set `online: true` at the online client step. `tests/e2e/menu.ts` now expects seven tiles. The menu tile title has `text-wrap: balance`, so the long title breaks between words.

- The client was checked by hand in a browser (pass & play to a win and a draw, a rematch, solo against Hard with a reload, 360x740 and 820x1180), but it has no e2e in the repo yet.

- Ultimate Tic-Tac-Toe host: `ultimateHost` in `core/host.ts`, with `startUltimate`, `mark`, `rematch`, `boardOf` and `carryUltimate`. The match is `{ first, moves, wins, rematch }`, like Reversi. A phone sends `{ t: "mark", cell, at }`, `{ t: "aim", cell }` or `{ t: "rematch" }`, and gets `{ t: "state", match }` or `{ t: "aim", seat, cell }`. The host relays an aim only on turn and on a cell the player may mark. `PROTOCOL` is 9.

- Ultimate Tic-Tac-Toe online client: "Place" sends the mark and shows it at once (`pending` holds its move count until the host answers). `settle` takes the host's board when it differs, and draws the friend's new mark in. A refused mark shows "Connection hiccup · place that one again". Each new aim goes to the host, and the friend's aim (`foeAim`) shows as a dimmer, still mark (`.ut-mark.ghost.theirs`) while this phone waits. No board is lit on the phone that waits. The your-turn toast adds "· any board" after a mark that sent the player to a closed board. The hook has `me`, `rematch`, `foeAim` and `pending`. Write the dimmed aim in `docs/decisions.md` at the README step.

- Ultimate Tic-Tac-Toe e2e online: `ultimateOnline` plays `WIN` to a result (with the dimmed aim, a reload and a rematch), then `SENT_TO_WON` on a slow link for the free choice of board. `tap` aims and presses "Place". The menu parts (solo, pass & play, offline, the 360x740 and tablet checks) are not written yet: `DRAW` and `SENT_TO_FULL` are free for them.

- Ultimate Tic-Tac-Toe e2e menu: `ultimateSolo`, `ultimatePassAndPlay` and `ultimateOffline`. In solo Zoe marks the first spot she may until Hard wins (`rush` plays her marks inside the page). Pass & play plays `WIN`, then `DRAW` with the other starter (3 boards to 5), then `SENT_TO_FULL` and a reload. `tapAll` taps each spot twice inside the page: the first tap aims and the second makes the mark. `fits` checks the board at 360x740 and 820x1180. The open boards lost their tint: the yellow mixed into the purple showed as brown lines between the spots, so the ring and the brighter spots now mark an open board.

Next: the Ultimate Tic-Tac-Toe README entry (and the Test section lines) and the `docs/decisions.md` section. Then run every check in "Done means" and delete this file.
