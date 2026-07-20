import assert from "node:assert/strict";
import { Logic } from "../js/core/logic.js";

const storage = new Map();
globalThis.localStorage = {
  get length() { return storage.size; },
  key: (index) => [...storage.keys()][index] ?? null,
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
};

const makeLegacyGame = ({ startTime, gameMode, problemID }) => {
  const logic = new Logic(problemID);
  return {
    complete: true,
    startTime,
    endTime: startTime + 30,
    gameMode,
    problemID,
    guessWord: [logic.ans1],
  };
};

const existing = makeLegacyGame({ startTime: 1_700_000_000, gameMode: "normal", problemID: 1 });
existing.clear = true;
storage.set("dwordle2.history", JSON.stringify([existing]));
storage.set(
  "/Tonyu/Projects/dwordle/history.json",
  JSON.stringify({
    version: 1,
    "1700000100": makeLegacyGame({ startTime: 1_700_000_100, gameMode: "normal", problemID: 2 }),
  })
);
storage.set(
  "/Tonyu/Projects/dwordlie/history.json",
  JSON.stringify({
    version: 1,
    "1700000200": makeLegacyGame({ startTime: 1_700_000_200, gameMode: "uso", problemID: 3 }),
  })
);

const { scanLegacyHistory, importFromLocalStorage } = await import("../js/core/migrate.js");
const { getHistory } = await import("../js/core/records.js");
const { achievementIdsFromHistory } = await import("../js/core/achievements.js");

assert.equal(scanLegacyHistory().length, 2, "both original games should be detected");
assert.equal(importFromLocalStorage(), 2);
assert.equal(getHistory().length, 3, "existing DWORDle 2 history should be preserved and merged");
assert.equal(importFromLocalStorage(), 0, "re-importing the same records should not duplicate them");
assert.deepEqual(new Set(getHistory().map((record) => record.gameMode)), new Set(["normal", "uso"]));

const achievementIds = achievementIdsFromHistory(getHistory());
assert(achievementIds.has("migrator"));
assert(achievementIds.has("first-clear"));
assert(achievementIds.has("uso-clear"));

console.log("履歴移行テスト: OK");
