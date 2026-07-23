// EXTRA SHOT モード（クリア後の追加推理タイム）のテスト。
// 実行: node test/extra-shot.test.mjs
//
// - モード準拠の判定 / 旧 queryWordSingle 互換 / Logic.otherAnswer
// - レコードの追加スキーマ（extraShot）の保存・再読込・旧 finalAnswer 互換
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

const { Logic, CELL, queryWordSingle, displayResultForMode } = await import("../js/core/logic.js");
const records = await import("../js/core/records.js");
const { importFromText } = await import("../js/core/migrate.js");
const { DEFAULT_SETTINGS, getSettings, setSetting } = await import("../js/core/settings.js?v=20260723-fa");
const es = await import("../js/core/extra-shot.js?v=20260723-fa");
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

// ---- 通常 Guess と EXTRA SHOT で共用するモード別の表示判定 ----
{
  const trueResult = [CELL.UNUSED, CELL.USED, CELL.CORRECT];
  assert.deepEqual(
    displayResultForMode(trueResult, "normal"),
    trueResult,
    "DWORDle は両方の答えによる真の判定をそのまま表示するはず"
  );
  const randomValues = [0.4, 0.8, 0];
  let randomIndex = 0;
  const lieResult = displayResultForMode(trueResult, "uso", () => randomValues[randomIndex++]);
  assert.deepEqual(lieResult, [CELL.USED, CELL.CORRECT, CELL.UNUSED]);
  assert.ok(
    lieResult.every((state, index) => state !== trueResult[index]),
    "DWORDlie は EXTRA SHOT を含む全マスで必ず嘘を表示するはず"
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
    extraShot: { word: logic.ans2, success: true, result: logic.queryWord(logic.ans2) },
  });
  assert.equal(saved.clear, true);
  records._reload(); // localStorage から読み直しても extraShot が残る
  const loaded = records.findGame(1_700_000_000, "normal");
  assert.deepEqual(
    loaded.extraShot,
    { word: logic.ans2, success: true, result: logic.queryWord(logic.ans2) },
    "表示した EXTRA SHOT 判定も履歴に保存されるはず"
  );
  assert.deepEqual(records.getExtraShotResult(loaded, logic), logic.queryWord(logic.ans2));
  assert.equal(Object.hasOwn(loaded, "finalAnswer"), false, "新しい履歴に旧キーを保存しないはず");
  assert.equal(Object.hasOwn(JSON.parse(storage.get("dwordle2.history"))[0], "finalAnswer"), false);
  assert.equal(records.getStatistics("normal").doubleClear, 1, "統計の doubleClear が数えられるはず");
  assert.equal(records.buildProblemStatus("normal").get(123)?.doubleClears, 1, "問題一覧にも DOUBLE CLEAR が集計されるはず");
  assert.equal(records.getStatistics("uso").doubleClear, 0);
}

// ---- 旧 finalAnswer 履歴は読込時に extraShot へ移行する ----
{
  storage.clear();
  const logic = new Logic(125);
  storage.set("dwordle2.history", JSON.stringify([{
    startTime: 1_700_000_800,
    endTime: 1_700_000_900,
    gameMode: "normal",
    problemID: 125,
    guessWord: [logic.ans1],
    clear: true,
    finalAnswer: { word: logic.ans2, success: true },
  }]));
  records._reload();
  const migrated = records.findGame(1_700_000_800, "normal");
  assert.deepEqual(migrated.extraShot, { word: logic.ans2, success: true });
  assert.deepEqual(
    records.getExtraShotResult(migrated, logic),
    queryWordSingle(logic.ans2, logic.ans2),
    "result の無い旧履歴は当時の単一回答判定で表示するはず"
  );
  assert.equal(Object.hasOwn(migrated, "finalAnswer"), false);
  const persisted = JSON.parse(storage.get("dwordle2.history"))[0];
  assert.deepEqual(persisted.extraShot, { word: logic.ans2, success: true });
  assert.equal(Object.hasOwn(persisted, "finalAnswer"), false, "旧履歴は新キーで保存し直すはず");
}

// ---- エクスポート JSON のインポートでも extraShot が透過する ----
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
        extraShot: { word: logic.ans1, success: true },
      },
    ],
  });
  const { added } = importFromText(exported);
  assert.equal(added, 1);
  const imported = records.findGame(1_700_000_500, "uso");
  assert.deepEqual(imported.extraShot, { word: logic.ans1, success: true }, "インポートで extraShot が失われないはず");
}

// ---- 旧 finalAnswer を含むエクスポートも extraShot として取り込む ----
{
  storage.clear();
  records._reload();
  const logic = new Logic(126);
  const legacyExport = JSON.stringify({
    app: "dwordle2",
    version: 1,
    history: [{
      startTime: 1_700_001_000,
      endTime: 1_700_001_100,
      gameMode: "normal",
      problemID: 126,
      guessWord: [logic.ans1],
      finalAnswer: { word: logic.ans2, success: true },
    }],
  });
  assert.equal(importFromText(legacyExport).added, 1);
  const imported = records.findGame(1_700_001_000, "normal");
  assert.deepEqual(imported.extraShot, { word: logic.ans2, success: true });
  assert.equal(Object.hasOwn(imported, "finalAnswer"), false);
}

// ---- 解放条件（10 回プレイ）と通知の一回性 ----
{
  storage.clear();
  records._reload();
  storage.set("dwordle2.playCount", "9");
  assert.equal(es.isExtraShotUnlocked(), false, "9 回では未解放のはず");
  assert.equal(es.extraShotRemainingPlays(), 1);
  assert.equal(es.claimExtraShotUnlockNotice(), false, "未解放では通知しないはず");
  assert.equal(storage.has("dwordle2.extraShotUnlockSeen"), false, "未解放時に通知済みフラグを立てないはず");

  storage.set("dwordle2.playCount", "10");
  assert.equal(es.isExtraShotUnlocked(), true, "10 回で解放されるはず");
  assert.equal(es.extraShotRemainingPlays(), 0);
  assert.equal(es.isExtraShotEnabled(), false, "解放直後は設定 OFF のまま");
  setSetting("extraShot", true);
  assert.equal(es.isExtraShotEnabled(), true, "設定 ON で有効になるはず");
  setSetting("extraShot", false);
  setSetting("finalAnswer", true);
  assert.equal(getSettings().extraShot, true, "旧設定 API からも EXTRA SHOT を変更できるはず");
  const persistedSettings = JSON.parse(storage.get("dwordle2.settings"));
  assert.equal(persistedSettings.extraShot, true);
  assert.equal(Object.hasOwn(persistedSettings, "finalAnswer"), false, "設定は新キーだけを保存するはず");
  setSetting("extraShot", false);

  assert.equal(es.claimExtraShotUnlockNotice(), true, "解放後の初回だけ通知するはず");
  assert.equal(es.claimExtraShotUnlockNotice(), false, "2 回目以降は通知しないはず");
}

// ---- 旧通知フラグでは解放ダイアログを重ねて出さず、新フラグへ移行する ----
{
  storage.clear();
  storage.set("dwordle2.playCount", "10");
  storage.set("dwordle2.finalAnswerUnlockSeen", "true");
  assert.equal(es.claimExtraShotUnlockNotice(), false);
  assert.equal(storage.get("dwordle2.extraShotUnlockSeen"), "true");
}

// ---- 旧設定データはモジュール読込時に新キーへ移行する ----
{
  storage.clear();
  storage.set("dwordle2.settings", JSON.stringify({ finalAnswer: true, theme: "classic" }));
  const migratedSettings = await import("../js/core/settings.js?legacy-extra-shot-settings");
  assert.equal(migratedSettings.getSettings().extraShot, true);
  const persisted = JSON.parse(storage.get("dwordle2.settings"));
  assert.equal(persisted.extraShot, true);
  assert.equal(Object.hasOwn(persisted, "finalAnswer"), false);
}

// ---- 設定の既定値 ----
assert.equal(DEFAULT_SETTINGS.extraShot, false, "EXTRA SHOT の既定は OFF");

// ---- 旧モジュール API は互換シムとして残す ----
{
  storage.clear();
  storage.set("dwordle2.playCount", "10");
  const legacyApi = await import("../js/core/final-answer.js?legacy-api");
  assert.equal(legacyApi.isFinalAnswerUnlocked(), true);
  assert.equal(legacyApi.finalAnswerRemainingPlays(), 0);
}

// ---- 隠し実績 ----

let scenarioSerial = 0;

// 履歴をセットして、新しい achievements インスタンスを返す（game-finish.test.mjs と同じ隔離方法）
async function scenario(history) {
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify(history));
  records._reload();
  return import(`../js/core/achievements.js?es-scenario=${++scenarioSerial}`);
}

function finishCtx({
  pid = 123,
  mode = "normal",
  guessWords,
  usoResults,
  extraShot,
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
    extraShot,
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

// DWORDle の 2 手クリア + EXTRA SHOT 成功 → h-double-clear のみ
{
  const logic = new Logic(123);
  const ctx = finishCtx({
    guessWords: [fillerWord(logic), logic.ans1],
    extraShot: { word: logic.ans2, success: true },
  });
  const ids = idsOf((await scenario([ctx.record])).checkOnGameFinish(ctx));
  assert.ok(ids.has("h-double-clear"), "DOUBLE CLEAR で h-double-clear が解放されるはず");
  assert.ok(!ids.has("h-double-uso"), "DWORDle では h-double-uso は解放されないはず");
  assert.ok(!ids.has("h-double-oneshot"), "2 手クリアでは h-double-oneshot は解放されないはず");
  assert.ok(!ids.has("h-double-10"), "1 回目では h-double-10 は解放されないはず");
}

// DWORDlie の 1 手クリア + EXTRA SHOT 成功 → uso・oneshot も同時解放
{
  const logic = new Logic(123);
  const ctx = finishCtx({
    mode: "uso",
    guessWords: [logic.ans1],
    usoResults: [Array(5).fill(CELL.USED)],
    extraShot: { word: logic.ans2, success: true },
  });
  const ids = idsOf((await scenario([ctx.record])).checkOnGameFinish(ctx));
  for (const id of ["h-double-clear", "h-double-uso", "h-double-oneshot"]) {
    assert.ok(ids.has(id), `DWORDlie 1 手 DOUBLE CLEAR で ${id} が解放されるはず`);
  }
}

// 旧 finalAnswer レコードを直接渡しても実績判定は維持する
{
  const logic = new Logic(127);
  const ctx = finishCtx({ pid: 127, guessWords: [logic.ans1] });
  ctx.record.finalAnswer = { word: logic.ans2, success: true };
  const ids = idsOf((await scenario([ctx.record])).checkOnGameFinish(ctx));
  assert.ok(ids.has("h-double-clear"), "旧履歴でも DOUBLE CLEAR 実績を判定するはず");
}

// EXTRA SHOT 失敗・未挑戦では解放されない
{
  const logic = new Logic(123);
  const failed = finishCtx({
    guessWords: [logic.ans1],
    extraShot: { word: fillerWord(logic), success: false },
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
    extraShot: { word: logic.ans2, success: true },
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
        extraShot: { word: logic.ans2, success: true },
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
    extraShot: { word: logic.ans2, success: true },
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
  assert.equal(es.isExtraShotUnlocked(), false);
  assert.ok(tryEnableDebugMode("DWORDLER"));
  assert.equal(es.isExtraShotUnlocked(), true, "デバッグモードで解放されるはず");
  assert.equal(es.claimExtraShotUnlockNotice(), false, "デバッグの一時解放では通知しないはず");
}

console.log("EXTRA SHOT テスト: OK");
