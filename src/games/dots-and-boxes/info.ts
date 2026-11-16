import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "dots-and-boxes",
  title: "Dots and Boxes",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#221a33",
  tile: ["#8d68ec", "#5a3bb4"],
  art: `<rect x="30" y="15" width="20" height="20" fill="#ff8a5c" opacity="0.85"/>
    <rect x="50" y="35" width="20" height="20" fill="#5cc8ff" opacity="0.85"/>
    <path d="M30 15 H70 M30 35 H70 M50 55 H70 M30 15 V35 M50 15 V55 M70 35 V55" stroke="#f6f1ff" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <g fill="#2a1f47" stroke="#f6f1ff" stroke-width="2">
      <circle cx="30" cy="15" r="3.6"/><circle cx="50" cy="15" r="3.6"/><circle cx="70" cy="15" r="3.6"/>
      <circle cx="30" cy="35" r="3.6"/><circle cx="50" cy="35" r="3.6"/><circle cx="70" cy="35" r="3.6"/>
      <circle cx="30" cy="55" r="3.6"/><circle cx="50" cy="55" r="3.6"/><circle cx="70" cy="55" r="3.6"/>
    </g>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
