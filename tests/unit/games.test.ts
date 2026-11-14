import { describe, expect, it } from "vitest";
import { GAMES, blurb, refusal, unsupported, type GameInfo } from "../../src/shell/games.ts";

// Every real game runs in every mode today, so the menu's "can't" paths only
// run here, on a made-up game.
const chess: GameInfo = {
  id: "chess",
  title: "Chess",
  modes: { solo: false, "pass-and-play": true, online: false },
  themeColor: "#000",
  tile: ["#000", "#111"],
  art: "",
  load: () => Promise.reject(new Error("not a real game")),
};

describe("menu modes", () => {
  it("says why a game can't run in a mode, on the tile and in the toast", () => {
    expect(unsupported(chess, "online")).toBe("Not online yet");
    expect(blurb(chess, "online")).toBe("Not online yet");
    expect(refusal(chess, "online")).toBe("Chess: not online yet");
    expect(refusal(chess, "solo")).toBe("Chess: needs two players");
    expect(refusal({ ...chess, modes: { ...chess.modes, "pass-and-play": false } }, "pass-and-play")).toBe(
      "Chess: one player only",
    );
  });

  it("says nothing against a mode a game supports", () => {
    expect(refusal(chess, "pass-and-play")).toBeNull();
    expect(blurb(chess, "pass-and-play")).toBe("2 players · one phone");
    for (const info of GAMES) expect(refusal(info, "online")).toBeNull();
  });
});
