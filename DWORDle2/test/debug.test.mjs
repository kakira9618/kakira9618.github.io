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
const { loadJSON, removeKey, saveJSON } = await import("../js/core/store.js");

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

// デバッグ中の保存はセッション内オーバーレイから読み戻せる。
// これが無いと「進行中ゲームの保存 → ゲーム画面の再開読み込み」が壊れ、
// デバッグ中にゲームを開始した瞬間タイトルへ戻される（2026-07-23 の不具合）。
assert.deepEqual(loadJSON("history", []), [{ problemID: 1 }], "debug saves must be readable in the same session");
saveJSON("current.normal", { problemID: 123, guessWord: [] });
assert.deepEqual(
  loadJSON("current.normal", null),
  { problemID: 123, guessWord: [] },
  "an in-progress debug game must survive the save/load round trip"
);
assert.equal(data.has("dwordle2.current.normal"), false, "the debug in-progress game must not persist");
// 実データが既にあるキーは、デバッグ中の上書きでもオーバーレイ側が読める
data.set("dwordle2.playCount", "10");
saveJSON("playCount", 11);
assert.equal(loadJSON("playCount", 0), 11, "debug overlay should shadow existing real data");
assert.equal(data.get("dwordle2.playCount"), "10", "the real play count must stay untouched");

data.set("dwordle2.keep", "true");
removeKey("keep");
assert.equal(data.has("dwordle2.keep"), false, "explicit data deletion should still work in debug mode");
removeKey("current.normal");
assert.equal(loadJSON("current.normal", null), null, "removeKey should also clear the debug overlay");

delete globalThis.localStorage;
console.log("デバッグモードテスト: OK");
