import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "mancala",
  title: "Mancala",
  modes: { solo: "computer", "pass-and-play": true, online: true },
  themeColor: "#2a1a14",
  tile: ["#e0924d", "#a8522b"],
  art: `<rect x="12" y="15" width="76" height="40" rx="20" fill="#7a3c1e"/>
    <rect x="17" y="21" width="11" height="28" rx="5.5" fill="#54260f"/>
    <rect x="72" y="21" width="11" height="28" rx="5.5" fill="#54260f"/>
    <g fill="#54260f">
      <circle cx="37" cy="27" r="5.5"/><circle cx="50" cy="27" r="5.5"/><circle cx="63" cy="27" r="5.5"/>
      <circle cx="37" cy="43" r="5.5"/><circle cx="50" cy="43" r="5.5"/><circle cx="63" cy="43" r="5.5"/>
    </g>
    <g fill="#ffe9c4">
      <circle cx="35.5" cy="26" r="1.8"/><circle cx="38.8" cy="28.3" r="1.8"/>
      <circle cx="50" cy="42" r="1.8"/><circle cx="64" cy="44" r="1.8"/><circle cx="22.5" cy="30" r="1.8"/>
    </g>
    <g fill="#6fe0cf">
      <circle cx="50" cy="27" r="1.8"/><circle cx="61.5" cy="42" r="1.8"/><circle cx="77.5" cy="38" r="1.8"/>
      <circle cx="36" cy="43.5" r="1.8"/><circle cx="22.5" cy="36" r="1.8"/>
    </g>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
