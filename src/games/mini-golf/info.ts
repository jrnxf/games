import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "mini-golf",
  title: "Mini Golf",
  modes: { solo: "alone", "pass-and-play": true, online: true },
  themeColor: "#1d281a",
  tile: ["#4aa05a", "#2f6e3f"],
  art: `<path d="M24 58 L58 30" stroke="#f4f6ea" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 6" fill="none"/>
    <circle cx="62" cy="26" r="9" fill="#14120e" stroke="#f1efe9" stroke-width="2"/>
    <path d="M62 24 V4" stroke="#e8e8e8" stroke-width="2" stroke-linecap="round"/>
    <path d="M62 4 L76 9 L62 14 Z" fill="#e2402f"/>
    <circle cx="22" cy="60" r="6.5" fill="#fff"/>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
