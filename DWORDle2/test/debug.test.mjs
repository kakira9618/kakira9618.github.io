import assert from "node:assert/strict";

const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
};

const { ACHIEVEMENTS, getUnlocked } = await import("../js/core/achievements.js");
const { getSettings, setSetting } = await import("../js/core/settings.js");
const { isDebugMode, tryEnableDebugMode } = await import("../js/core/debug.js");
const { removeKey, saveJSON } = await import("../js/core/store.js");

setSetting("theme", "classic");
const savedBeforeDebug = data.get("dwordle2.settings");
assert.match(savedBeforeDebug, /"theme":"classic"/);
assert.equal(isDebugMode(), false);
assert.equal(tryEnableDebugMode("wrong"), false);
assert.equal(tryEnableDebugMode(" dwordler "), true);
assert.equal(isDebugMode(), true);
assert.equal(Object.keys(getUnlocked()).length, ACHIEVEMENTS.length, "debug mode should expose every achievement");

setSetting("theme", "pop");
assert.equal(getSettings().theme, "pop", "debug settings should work for the current session");
assert.equal(data.get("dwordle2.settings"), savedBeforeDebug, "debug settings must not persist");

saveJSON("history", [{ problemID: 1 }]);
assert.equal(data.has("dwordle2.history"), false, "debug play data must not persist");
data.set("dwordle2.keep", "true");
removeKey("keep");
assert.equal(data.has("dwordle2.keep"), false, "explicit data deletion should still work in debug mode");

delete globalThis.localStorage;
console.log("デバッグモードテスト: OK");
