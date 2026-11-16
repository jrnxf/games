import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "ultimate-tic-tac-toe",
  title: "Ultimate Tic-Tac-Toe",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#2a1626",
  tile: ["#e8508f", "#9c2a66"],
  art: `<rect x="22" y="7" width="56" height="56" rx="8" fill="#5c173d"/>
    <path d="M40.5 12 V58 M59.5 12 V58 M27 25.5 H73 M27 44.5 H73" stroke="#8f2c60" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M27.5 12.5 l7 7 m0 -7 l-7 7 M65.5 50.5 l7 7 m0 -7 l-7 7" stroke="#ffc93c" stroke-width="3" stroke-linecap="round"/>
    <circle cx="69" cy="16" r="4" fill="none" stroke="#5ad6e8" stroke-width="3"/>
    <circle cx="31" cy="54" r="4" fill="none" stroke="#5ad6e8" stroke-width="3"/>
    <path d="M44.5 29.5 l11 11 m0 -11 l-11 11" stroke="#ffc93c" stroke-width="4.4" stroke-linecap="round"/>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
