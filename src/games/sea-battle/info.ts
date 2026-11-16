import type { GameInfo } from "../../shell/games.ts";

export default {
  id: "sea-battle",
  title: "Sea Battle",
  // Online waits for the game's host (core/host.ts).
  modes: { solo: "computer", "pass-and-play": true, online: false },
  themeColor: "#0b2030",
  tile: ["#35a7d6", "#14547e"],
  art: `<g stroke="#ffffff" stroke-opacity=".16" stroke-width=".8">
      <path d="M20 10v50M35 10v50M50 10v50M65 10v50M80 10v50M10 20h80M10 35h80M10 50h80"/>
    </g>
    <rect x="22" y="23" width="41" height="9" rx="4.5" fill="#ffd23f"/>
    <g fill="#0b2030" fill-opacity=".45">
      <circle cx="30" cy="27.5" r="1.6"/><circle cx="38" cy="27.5" r="1.6"/><circle cx="46" cy="27.5" r="1.6"/>
    </g>
    <rect x="68" y="38" width="9" height="24" rx="4.5" fill="#c4a7ff"/>
    <circle cx="57.5" cy="27.5" r="5.2" fill="#ff5a3c"/><circle cx="57.5" cy="27.5" r="2" fill="#fff3c9"/>
    <circle cx="72.5" cy="57.5" r="5.2" fill="#ff5a3c"/><circle cx="72.5" cy="57.5" r="2" fill="#fff3c9"/>
    <g fill="none" stroke="#eefaff" stroke-width="1.8">
      <circle cx="27.5" cy="42.5" r="3.4"/><circle cx="42.5" cy="57.5" r="3.4"/><circle cx="72.5" cy="16" r="3.4"/>
    </g>`,
  load: () => import("./client/main.ts"),
} satisfies GameInfo;
