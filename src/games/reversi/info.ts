import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "reversi",
  title: "Reversi",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#11212a",
  tile: ["#1fb596", "#0f7a6c"],
  art: `<rect x="22" y="7" width="56" height="56" rx="7" fill="#0b5a50"/>
    <path d="M50 9 V61 M24 35 H76" stroke="#084840" stroke-width="2"/>
    <circle cx="37" cy="22" r="9.5" fill="#f6f1e4"/><circle cx="63" cy="22" r="9.5" fill="#1a1d2b"/>
    <circle cx="37" cy="48" r="9.5" fill="#1a1d2b"/><circle cx="63" cy="48" r="9.5" fill="#f6f1e4"/>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
