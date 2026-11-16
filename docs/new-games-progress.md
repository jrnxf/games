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
- [ ] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score, sowing animated seed by seed
- [ ] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (7), host tests, online client code
- [ ] E2E: `tests/e2e/mancala.ts`, called from `tests/e2e/menu.ts` and `tests/e2e/online.ts`, screenshots checked
- [ ] README entry (and its Test section) and `docs/decisions.md` section

## 4. Sea Battle (`sea-battle`)

- [ ] All steps

## 5. Ultimate Tic-Tac-Toe (`ultimate-tic-tac-toe`)

- [ ] All steps

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

Next: the Mancala client (`client/`, `info.ts`, `GAMES`): solo and pass & play, with the sowing animated seed by seed from `sowing(b, pit)`.
