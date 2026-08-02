// 途中破棄レコードと実績除外ルールのテスト。
// 実行: node test/discard.test.mjs

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { Logic } = await import("../js/core/logic.js?v=20260803-a");
const records = await import("../js/core/records.js?v=20260803-a");
const achievements = await import("../js/core/achievements.js?discard-test");

const base = Math.floor(new Date(2026, 6, 20, 10, 0, 0).getTime() / 1000);
const pid = 321;
const logic = new Logic(pid);
const discarded = records.addDiscardedGame({
  startTime: base,
  endTime: base + 60,
  gameMode: "normal",
  problemID: pid,
  guessWord: ["crane"],
});

assert.equal(discarded.discarded, true);
assert.equal(discarded.clear, false, "破棄レコードは入力内容にかかわらず未クリア扱いになるはず");
assert.equal(records.countPlays(), 0, "破棄はメニュー解放用の完了プレイ数に加算しないはず");
assert.equal(records.findGame(base, "normal")?.discarded, true, "破棄レコードを履歴キーから取得できるはず");

const exported = JSON.parse(await records.exportJSON());
assert.equal(exported.version, 2, "破棄フィールドを含む履歴エクスポートは v2 形式になるはず");
assert.equal(exported.history[0].discarded, true, "エクスポートでも破棄状態を維持するはず");

// 同日の同じ問題は、別モードを含めて破棄以降の全プレイを実績対象外にする。
const retry = records.addFinishedGame({
  startTime: base + 600,
  endTime: base + 630,
  gameMode: "normal",
  problemID: pid,
  guessWord: [logic.ans1],
});
const usoRetry = {
  startTime: base + 1200,
  endTime: base + 1230,
  gameMode: "uso",
  problemID: pid,
  guessWord: [logic.ans1],
  clear: true,
};
const eligible = achievements.achievementEligibleRecords([...records.getHistory(), usoRetry]);
assert.deepEqual(eligible, [], "破棄以降の同日・同問題はモードを問わず全実績の対象外になるはず");
assert.deepEqual(
  achievements.achievementIdsFromHistory([...records.getHistory(), usoRetry]),
  new Set(),
  "履歴からの実績復元でも破棄と同日の再挑戦を使わないはず"
);

const realtimeUnlocks = achievements.checkOnGameFinish({
  record: retry,
  results: retry.guessWord.map((word) => logic.queryWord(word)),
  durationSec: retry.endTime - retry.startTime,
  endDate: new Date(retry.endTime * 1000),
  maxGuess: records.MODES.normal.maxGuess,
  hadLostBefore: false,
});
assert.deepEqual(realtimeUnlocks, [], "リアルタイム判定でも全実績を解除しないはず");

// 翌日の同じ問題は再び実績対象になる。
const nextDay = {
  ...retry,
  startTime: base + 86400,
  endTime: base + 86430,
};
assert.deepEqual(
  achievements.achievementEligibleRecords([...records.getHistory(), nextDay]),
  [nextDay],
  "翌日の同じ問題は実績対象へ戻るはず"
);
assert.ok(
  achievements.achievementIdsFromHistory([...records.getHistory(), nextDay]).has("first-clear"),
  "翌日のクリアからは実績を復元できるはず"
);

// 先に完了済みだったプレイは、後から同じ問題を破棄しても遡って無効にしない。
const completedFirst = { ...nextDay, startTime: base - 600, endTime: base - 570 };
const discardedLater = { ...discarded, startTime: base, endTime: base + 60 };
assert.deepEqual(
  achievements.achievementEligibleRecords([completedFirst, discardedLater]),
  [completedFirst],
  "破棄より前に完了したプレイは維持するはず"
);

// v2 エクスポートを別端末相当の空ストレージへ取り込んでも破棄状態を失わない。
storage.clear();
records._reload();
const { importFromText } = await import("../js/core/migrate.js?v=20260803-a");
assert.equal((await importFromText(JSON.stringify(exported))).added, 1);
assert.equal(records.getHistory()[0].discarded, true, "インポート後も破棄状態を維持するはず");
assert.equal(records.getHistory()[0].clear, false, "インポート後も破棄をクリア扱いにしないはず");

console.log("破棄履歴・実績除外テスト: OK");
