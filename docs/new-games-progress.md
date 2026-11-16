# New games progress

Five games, one at a time, in this order. Each game follows the steps below. Delete this file when all five are done.

Steps per game: core rules + unit tests, computer + tests, client (solo and pass & play) + `info.ts` + `GAMES`, online host + protocol + `worker/hosts.ts` + online client, e2e (`menu.ts`, `online.ts`), README + `docs/decisions.md`.

## 1. Reversi (`reversi`)

- [x] Core rules + unit tests (`core/board.ts`, `tests/unit/reversi.test.ts`)
- [ ] Computer: alpha-beta, positional + mobility evaluation, depth by level, capped by time + tests
- [ ] Client: solo and pass & play, `info.ts`, added to `GAMES`, save and running score
- [ ] Online: `core/protocol.ts`, `core/host.ts`, `worker/hosts.ts`, `PROTOCOL` bump, host tests, online client
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

Next: the Reversi computer (`src/games/reversi/core/ai.ts`), modelled on `src/games/connect-four/core/ai.ts`.
