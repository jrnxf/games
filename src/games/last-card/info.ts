import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "last-card",
  title: "Last Card",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#1a1430",
  tile: ["#6b4fd8", "#2b1d66"],
  art: `<rect x="18" y="14" width="28" height="40" rx="5" fill="#3b8cff" stroke="#fff" stroke-width="2" transform="rotate(-14 32 34)"/>
    <rect x="54" y="14" width="28" height="40" rx="5" fill="#ff5a4d" stroke="#fff" stroke-width="2" transform="rotate(14 68 34)"/>
    <rect x="36" y="10" width="28" height="40" rx="5" fill="#ffc23a" stroke="#fff" stroke-width="2"/>
    <text x="50" y="37" font-size="18" font-weight="900" text-anchor="middle" fill="#fff" font-family="Outfit Variable, system-ui, sans-serif">7</text>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
