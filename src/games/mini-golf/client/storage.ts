// Mini golf's per-device preferences: sound, best rounds and a pass & play game in progress.

import { store } from "../../../shell/storage.ts";

export const { load, save, loadJson } = store("mini-golf.");
