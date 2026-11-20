import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "yacht",
  title: "Yacht",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#0f2a20",
  tile: ["#2fa36f", "#125538"],
  art: `<rect x="14" y="16" width="30" height="30" rx="7" fill="#fdf8ec" transform="rotate(-10 29 31)"/>
    <g fill="#23201a" transform="rotate(-10 29 31)">
      <circle cx="22" cy="24" r="3"/><circle cx="29" cy="31" r="3"/><circle cx="36" cy="38" r="3"/>
    </g>
    <rect x="52" y="22" width="30" height="30" rx="7" fill="#fdf8ec" transform="rotate(12 67 37)"/>
    <g fill="#23201a" transform="rotate(12 67 37)">
      <circle cx="60" cy="30" r="3"/><circle cx="74" cy="30" r="3"/><circle cx="67" cy="37" r="3"/>
      <circle cx="60" cy="44" r="3"/><circle cx="74" cy="44" r="3"/>
    </g>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
