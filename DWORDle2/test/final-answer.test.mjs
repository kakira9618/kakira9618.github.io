// FINAL ANSWER モード（クリア後の追加推理タイム）のテスト。
// 実行: node test/final-answer.test.mjs
//
// - queryWordSingle / Logic.otherAnswer の判定
// - レコードの v2 追加スキーマ（finalAnswer）の保存・再読込・インポート透過
// - 解放条件（10 回プレイ / デバッグモード）と解放通知の一回性
// - 隠し実績 4 種（h-double-clear / h-double-uso / h-double-oneshot / h-double-10）
//
// デバッグモードはプロセス内で解除できない（unlock が恒久スキップになる）ため、
// デバッグ関連の検証は必ずファイル末尾で行う。

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { Logic, CELL, queryWordSingle } = await import("../js/core/logic.js");
const records = await import("../js/core/records.js");
const { importFromText } = await import("../js/core/migrate.js");
const { DEFAULT_SETTINGS, setSetting } = await import("../js/core/settings.js?v=20260723-fa");
const fa = await import("../js/core/final-answer.js?v=20260723-fa");
const { tryEnableDebugMode } = await import("../js/core/debug.js");

// ---- queryWordSingle: 1 語だけを対象にした Wordle 標準判定 ----
{
  assert.deepEqual(
    queryWordSingle("crane", "crane"),
    Array(5).fill(CELL.CORRECT),
    "正解語は全緑になるはず"
  );
  assert.deepEqual(
    queryWordSingle("carne", "crane"),
    [CELL.CORRECT, CELL.USED, CELL.USED, CELL.CORRECT, CELL.CORRECT],
    "位置違いの文字は黄になるはず"
  );
  // 重複文字は答え側の残り文字数だけ黄になる（本家 Wordle と同じ消費規則）
  assert.deepEqual(
    queryWordSingle("eeeee", "geese"),
    [CELL.UNUSED, CELL.CORRECT, CELL.CORRECT, CELL.UNUSED, CELL.CORRECT],
    "答えに無い分の重複文字は灰になるはず"
  );
}

// ---- Logic.otherAnswer ----
{
  const logic = new Logic(123);
  assert.equal(logic.otherAnswer(logic.ans1), logic.ans2);
  assert.equal(logic.otherAnswer(logic.ans2), logic.ans1);
  assert.equal(logic.otherAnswer("aaaaa" === logic.ans1 || "aaaaa" === logic.ans2 ? "bbbbb" : "aaaaa"), null, "答え以外の単語では null");
}

// ---- レコードの v2 追加スキーマ: 保存 → 再読込 → 統計 ----
{
  storage.clear();
  records._reload();
  const logic = new Logic(123);
  const saved = records.addFinishedGame({
    startTime: 1_700_000_000,
    endTime: 1_700_000_060,
    gameMode: "normal",
    problemID: 123,
    guessWord: [logic.ans1],
    finalAnswer: { word: logic.ans2, success: true },
  });
  assert.equal(saved.clear, true);
  records._reload(); // localStorage から読み直しても finalAnswer が残る
  const loaded = records.findGame(1_700_000_000, "normal");
  assert.deepEqual(loaded.finalAnswer, { word: logic.ans2, success: true }, "finalAnswer が履歴に保存されるはず");
  assert.equal(records.getStatistics("normal").doubleClear, 1, "統計の doubleClear が数えられるはず");
  assert.equal(records.getStatistics("uso").doubleClear, 0);
}

// ---- エクスポート JSON のインポートでも finalAnswer が透過する ----
{
  storage.clear();
  records._reload();
  const logic = new Logic(124);
  const exported = JSON.stringify({
    app: "dwordle2",
    version: 1,
    exportedAt: 1_700_100_000,
    history: [
      {
        startTime: 1_700_000_500,
        endTime: 1_700_000_700,
        gameMode: "uso",
        problemID: 124,
        guessWord: [logic.ans2],
        usoResults: [Array(5).fill(CELL.UNUSED)],
        finalAnswer: { word: logic.ans1, success: true },
      },
    ],
  });
  const { added } = importFromText(exported);
  assert.equal(added, 1);
  const imported = records.findGame(1_700_000_500, "uso");
  assert.deepEqual(imported.finalAnswer, { word: logic.ans1, success: true }, "インポートで finalAnswer が失われないはず");
}

// ---- 解放条件（10 回プレイ）と通知の一回性 ----
{
  storage.clear();
  records._reload();
  storage.set("dwordle2.playCount", "9");
  assert.equal(fa.isFinalAnswerUnlocked(), false, "9 回では未解放のはず");
  assert.equal(fa.finalAnswerRemainingPlays(), 1);
  assert.equal(fa.claimFinalAnswerUnlockNotice(), false, "未解放では通知しないはず");
  assert.equal(storage.has("dwordle2.finalAnswerUnlockSeen"), false, "未解放時に通知済みフラグを立てないはず");

  storage.set("dwordle2.playCount", "10");
  assert.equal(fa.isFinalAnswerUnlocked(), true, "10 回で解放されるはず");
  assert.equal(fa.finalAnswerRemainingPlays(), 0);
  assert.equal(fa.isFinalAnswerEnabled(), false, "解放直後は設定 OFF のまま");
  setSetting("finalAnswer", true);
  assert.equal(fa.isFinalAnswerEnabled(), true, "設定 ON で有効になるはず");
  setSetting("finalAnswer", false);

  assert.equal(fa.claimFinalAnswerUnlockNotice(), true, "解放後の初回だけ通知するはず");
  assert.equal(fa.claimFinalAnswerUnlockNotice(), false, "2 回目以降は通知しないはず");
}

// ---- 設定の既定値 ----
assert.equal(DEFAULT_SETTINGS.finalAnswer, false, "FINAL ANSWER の既定は OFF");

// ---- 隠し実績 ----

let scenarioSerial = 0;

// 履歴をセットして、新しい achievements インスタンスを返す（game-finish.test.mjs と同じ隔離方法）
async function scenario(history) {
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify(history));
  records._reload();
  return import(`../js/core/achievements.js?fa-scenario=${++scenarioSerial}`);
}

function finishCtx({
  pid = 123,
  mode = "normal",
  guessWords,
  usoResults,
  finalAnswer,
  startTime = 1_700_000_000,
  durationSec = 30,
  endDate = new Date(2026, 6, 20, 12, 0, 0),
}) {
  const logic = new Logic(pid);
  const record = {
    startTime,
    endTime: startTime + durationSec,
    gameMode: mode,
    problemID: pid,
    guessWord: guessWords.slice(),
    usoResults,
    finalAnswer,
    clear: logic.isGameClear(guessWords[guessWords.length - 1]),
  };
  const results = guessWords.map((w) => logic.queryWord(w));
  return { record, results, durationSec, endDate, maxGuess: mode === "uso" ? 15 : 10, hadLostBefore: false };
}

const idsOf = (newly) => new Set(newly.map((achievement) => achievement.id));

// 両方の答えと 1 文字も共有しない単語（クリアにならないつなぎの Guess 用）
function fillerWord(logic) {
  const used = new Set([...logic.ans1, ...logic.ans2]);
  return ["crwth", "glyph", "nymph", "jumby", "vodka", "beefs", "porgy"].find(
    (w) => ![...w].some((c) => used.has(c))
  ) ?? "aaaaa";
}

// DWORDle の 2 手クリア + FINAL ANSWER 成功 → h-double-clear のみ
{
  const logic = new Logic(123);
  const ctx = finishCtx({
    guessWords: [fillerWord(logic), logic.ans1],
    finalAnswer: { word: logic.ans2, success: true },
  });
  const ids = idsOf((await scenario([ctx.record])).checkOnGameFinish(ctx));
  assert.ok(ids.has("h-double-clear"), "DOUBLE CLEAR で h-double-clear が解放されるはず");
  assert.ok(!ids.has("h-double-uso"), "DWORDle では h-double-uso は解放されないはず");
  assert.ok(!ids.has("h-double-oneshot"), "2 手クリアでは h-double-oneshot は解放されないはず");
  assert.ok(!ids.has("h-double-10"), "1 回目では h-double-10 は解放されないはず");
}

// DWORDlie の 1 手クリア + FINAL ANSWER 成功 → uso・oneshot も同時解放
{
  const logic = new Logic(123);
  const ctx = finishCtx({
    mode: "uso",
    guessWords: [logic.ans1],
    usoResults: [Array(5).fill(CELL.USED)],
    finalAnswer: { word: logic.ans2, success: true },
  });
  const ids = idsOf((await scenario([ctx.record])).checkOnGameFinish(ctx));
  for (const id of ["h-double-clear", "h-double-uso", "h-double-oneshot"]) {
    assert.ok(ids.has(id), `DWORDlie 1 手 DOUBLE CLEAR で ${id} が解放されるはず`);
  }
}

// FINAL ANSWER 失敗・未挑戦では解放されない
{
  const logic = new Logic(123);
  const failed = finishCtx({
    guessWords: [logic.ans1],
    finalAnswer: { word: fillerWord(logic), success: false },
  });
  const failedIds = idsOf((await scenario([failed.record])).checkOnGameFinish(failed));
  const none = ["h-double-clear", "h-double-uso", "h-double-oneshot", "h-double-10"];
  for (const id of none) assert.ok(!failedIds.has(id), `失敗では ${id} は解放されないはず`);

  const skipped = finishCtx({ guessWords: [logic.ans1] });
  const skippedIds = idsOf((await scenario([skipped.record])).checkOnGameFinish(skipped));
  for (const id of none) assert.ok(!skippedIds.has(id), `未挑戦では ${id} は解放されないはず`);
}

// 同日・同問題の再プレイでは解放されない（答えを知った稼ぎの防止）
{
  const logic = new Logic(123);
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const prior = finishCtx({ guessWords: [logic.ans1], startTime: base }).record;
  const replay = finishCtx({
    guessWords: [logic.ans1],
    finalAnswer: { word: logic.ans2, success: true },
    startTime: base + 600,
  });
  const ids = idsOf((await scenario([prior, replay.record])).checkOnGameFinish(replay));
  assert.ok(!ids.has("h-double-clear"), "同日・同問題の再プレイでは h-double-clear は解放されないはず");
}

// 通算 10 回の DOUBLE CLEAR で h-double-10
{
  const makeRecords = (n) =>
    Array.from({ length: n }, (_, i) => {
      const pid = 200 + i;
      const logic = new Logic(pid);
      return finishCtx({
        pid,
        guessWords: [logic.ans1],
        finalAnswer: { word: logic.ans2, success: true },
        startTime: 1_700_000_000 + i * 600,
      });
    });
  const nine = makeRecords(9);
  const nineIds = idsOf((await scenario(nine.map((c) => c.record))).checkOnGameFinish(nine[8]));
  assert.ok(!nineIds.has("h-double-10"), "9 回では h-double-10 は解放されないはず");
  const ten = makeRecords(10);
  const tenIds = idsOf((await scenario(ten.map((c) => c.record))).checkOnGameFinish(ten[9]));
  assert.ok(tenIds.has("h-double-10"), "10 回目の DOUBLE CLEAR で h-double-10 が解放されるはず");
}

// 履歴からの復元（achievementIdsFromHistory）でも同じ判定になる
{
  const logic = new Logic(123);
  const ctx = finishCtx({
    mode: "uso",
    guessWords: [logic.ans1],
    usoResults: [Array(5).fill(CELL.USED)],
    finalAnswer: { word: logic.ans2, success: true },
  });
  const mod = await scenario([ctx.record]);
  const ids = mod.achievementIdsFromHistory([ctx.record]);
  for (const id of ["h-double-clear", "h-double-uso", "h-double-oneshot"]) {
    assert.ok(ids.has(id), `履歴復元で ${id} が推定されるはず`);
  }
  assert.ok(!ids.has("h-double-10"), "1 件の履歴では h-double-10 は推定されないはず");
}

// ---- デバッグモードでの一時解放（プロセス内で解除できないため必ず最後に検証）----
{
  storage.clear();
  records._reload();
  storage.set("dwordle2.playCount", "0");
  assert.equal(fa.isFinalAnswerUnlocked(), false);
  assert.ok(tryEnableDebugMode("DWORDLER"));
  assert.equal(fa.isFinalAnswerUnlocked(), true, "デバッグモードで解放されるはず");
  assert.equal(fa.claimFinalAnswerUnlockNotice(), false, "デバッグの一時解放では通知しないはず");
}

console.log("FINAL ANSWER テスト: OK");
