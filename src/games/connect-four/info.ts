import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "connect-four",
  title: "Connect Four",
  blurb: "2 players · one phone",
  themeColor: "#181a28",
  tile: ["#3b80f0", "#2257b8"],
  art: `<rect x="14" y="10" width="72" height="54" rx="8" fill="#1d4fa8"/>
    <g fill="#12131d">
      <circle cx="29" cy="25" r="7"/><circle cx="50" cy="25" r="7"/><circle cx="71" cy="25" r="7"/>
      <circle cx="29" cy="46" r="7"/><circle cx="50" cy="46" r="7"/><circle cx="71" cy="46" r="7"/>
    </g>
    <circle cx="50" cy="46" r="7" fill="#ff5c4d"/><circle cx="71" cy="46" r="7" fill="#ffd23f"/>
    <circle cx="71" cy="25" r="7" fill="#ff5c4d"/>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
