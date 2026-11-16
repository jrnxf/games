# New games progress

Five games, one at a time, in this order. Each game follows the steps below. Delete this file when all five are done.

Steps per game: core rules + unit tests, computer + tests, client (solo and pass & play) + `info.ts` + `GAMES`, online host + protocol + `worker/hosts.ts` + online client, e2e (`menu.ts`, `online.ts`), README + `docs/decisions.md`.

## 1. Reversi (`reversi`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/reversi.test.ts`)
- [x] Computer: alpha-beta, positional + mobility evaluation, depth by level, capped by positions + tests (`core/ai.ts`, `tests/unit/reversi-ai.test.ts`)
- [x] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score
- [x] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump (5), host tests (`tests/unit/reversi-host.test.ts`), online client code
- [ ] E2E: `tests/e2e/menu.ts` and `tests/e2e/online.ts`, screenshots checked at 390x844, 360x740 and tablet
- [ ] README entry and `docs/decisions.md` section

## 2. Dots and Boxes (`dots-and-boxes`)

- [ ] All steps

## 3. Mancala (`mancala`)

- [ ] All steps

## 4. Sea Battle (`sea-battle`)

- [ ] All steps

## 5. Ultimate Tic-Tac-Toe (`ultimate-tic-tac-toe`)

- [ ] All steps

## Notes

- Reversi board: seat colours are fixed, and the starter holds cells (3,4) and (4,3), so the opening is the same shape whoever starts. A pass is never stored in `moves`. `play` keeps the turn with the mover and sets `passed`.

- Reversi computer: `think(board, level, seed)` returns `{ cell, positions, ms, depth }`. The cap is a position budget, not a clock, so a move is a pure function of the board, the level and the seed. Hard scores 40,000 positions at most, about 55 ms on a desktop. Write this choice in `docs/decisions.md` at the README step.

- Reversi client: solo and pass & play were played to the end in a browser at 390x844, 360x740 and 820x1180. The online client code is written on the Connect Four model, but two phones have not played it yet. The e2e step must do that first. The test hook is `window.__reversi.state()`, and a cell is `#rv-board .rv-cell:nth-child(cell + 1)`.

- Reversi has no dimmed pending choice online: one tap plays a disc, so there is no aim to show. Write this in `docs/decisions.md` at the README step, with the edge-to-edge board (44 px cells at 360 px) and the move that saves before its discs turn.

Next: the Reversi e2e. Extend `tests/e2e/menu.ts` (solo to the end with a reload on the computer's turn, pass & play to the end, a pass, the running score) and `tests/e2e/online.ts` (two phones to a result and a rematch). Fix any online bug that shows.
