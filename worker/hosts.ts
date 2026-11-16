// The games a party can open, by id: each one's server side. A game is
// online when it is listed here and its info.ts says `online: true`.

import { fourHost } from "../src/games/connect-four/core/host.ts";
import { boxesHost } from "../src/games/dots-and-boxes/core/host.ts";
import { golfHost } from "../src/games/mini-golf/core/host.ts";
import { reversiHost } from "../src/games/reversi/core/host.ts";
import type { Hosts } from "../src/party/host.ts";

export const HOSTS: Hosts = {
  "mini-golf": golfHost,
  "connect-four": fourHost,
  reversi: reversiHost,
  "dots-and-boxes": boxesHost,
};
