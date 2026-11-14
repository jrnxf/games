// Mini golf's per-device preferences: names, best rounds and the device token.

import { store } from "../../../shell/storage.ts";

export const { load, save, loadJson } = store("mini-golf.");

let token: string | null = null;

/** A random secret that lets this phone take its seat back in a room after a drop. */
export function deviceToken(): string {
  token ??= load("token");
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    save("token", token);
  }
  return token;
}
