// 実績に付ける「初見の問題で達成したか」の署名のテスト。
// 実行: node test/achievement-mark.test.mjs
//
// 解放状態は achievements.js のモジュール内キャッシュに載るので、
// シナリオごとにクエリ付き import で新しいインスタンスを読み込んで隔離する
// （test/game-finish.test.mjs と同じやり方）。

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { Logic } = await import("../js/core/logic.js?v=20260803-b");
const records = await import("../js/core/records.js?v=20260803-b");
const { MODES } = records;
const { MARK, MARK_STATES, signAchievement, verifyAchievementMark } =
  await import("../js/core/achievement-mark.js?v=20260803-b");

let scenarioSerial = 0;

// ---- 署名そのもの ----

const at = 1_700_000_000;
for (const state of MARK_STATES) {
  const signature = signAchievement("one-shot", state, at);
  assert.match(signature, /^[0-9a-f]{8}$/, "署名は 16 進 8 桁のはず");
  assert.equal(verifyAchievementMark("one-shot", signature, at), state, "自分で作った署名は読み戻せるはず");
}

// 同じ状態でも実績ごとに違う値になる（並べても状態を突き合わせられないように）
{
  const ids = ["one-shot", "two-shot", "within-4", "h-abyss", "all-gray"];
  const signatures = ids.map((id) => signAchievement(id, MARK.FRESH, at));
  assert.equal(new Set(signatures).size, ids.length, "同じ状態でも実績ごとに違う署名になるはず");
  // 状態が違えば同じ実績でも変わる
  assert.notEqual(signAchievement("one-shot", MARK.FRESH, at), signAchievement("one-shot", MARK.REPLAY, at));
  // 解除時刻が違えば変わる（他人の署名をそのまま貼っても合わない）
  assert.notEqual(signAchievement("one-shot", MARK.FRESH, at), signAchievement("one-shot", MARK.FRESH, at + 1));
}

// 合わない署名は「不明」。長さ違い・非文字列でも例外にしない
assert.equal(verifyAchievementMark("one-shot", "deadbeef", at), null);
assert.equal(verifyAchievementMark("one-shot", signAchievement("two-shot", MARK.FRESH, at), at), null);
assert.equal(verifyAchievementMark("one-shot", undefined, at), null);
assert.equal(verifyAchievementMark("one-shot", "abc", at), null);

// ---- ゲーム終了時に付く署名 ----

function finishGameCtx({ pid, guessWords, startTime, durationSec = 30 }) {
  const logic = new Logic(pid);
  const record = {
    startTime,
    endTime: startTime + durationSec,
    gameMode: "normal",
    problemID: pid,
    guessWord: guessWords.slice(),
    clear: logic.isGameClear(guessWords[guessWords.length - 1]),
  };
  return {
    record,
    results: guessWords.map((word) => logic.queryWord(word)),
    durationSec,
    endDate: new Date(startTime * 1000),
    maxGuess: MODES.normal.maxGuess,
    hadLostBefore: false,
  };
}

async function scenario(history, unlocked = null) {
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify(history));
  if (unlocked) storage.set("dwordle2.achievements", JSON.stringify(unlocked));
  records._reload();
  return import(`../js/core/achievements.js?mark-scenario=${++scenarioSerial}`);
}

// 初見の問題での 1 手クリア → 1 局で決まる実績はすべて「初見」の署名が付く
{
  const pid = 123;
  const ctx = finishGameCtx({ pid, guessWords: [new Logic(pid).ans1], startTime: 1_700_000_000 });
  const achievements = await scenario([ctx.record]);
  const newly = achievements.checkOnGameFinish(ctx);
  const ids = newly.map((achievement) => achievement.id);
  assert.ok(ids.includes("one-shot"), "1 手クリアの実績が解除されるはず");
  for (const id of ["first-play", "first-clear", "one-shot", "two-shot", "within-4"]) {
    assert.equal(achievements.achievementMarkState(id), MARK.FRESH, `${id} は初見の署名になるはず`);
  }
  // カウント系・イベント系には署名を付けない（1 局に紐付かないので状態を言えない）
  assert.equal(achievements.getAchievementMarks()["plays-100"], undefined);
  assert.equal(achievements.achievementMarkState("collector"), null);
}

// 別の日に同じ問題をもう一度遊んで達成 → 「再プレイ」の署名になる
{
  const pid = 321;
  const logic = new Logic(pid);
  const firstPlay = {
    startTime: 1_700_000_000,
    endTime: 1_700_000_300,
    gameMode: "normal",
    problemID: pid,
    guessWord: ["about", "crane", logic.ans1],
    clear: true,
  };
  const ctx = finishGameCtx({ pid, guessWords: [logic.ans1], startTime: 1_700_100_000 });
  // first-clear は前の日のプレイで解除済み（＝初見の署名が付いている）とする
  const achievements = await scenario([firstPlay, ctx.record], { "first-clear": 1_700_000_300 });
  assert.equal(achievements.achievementMarkState("first-clear"), MARK.FRESH);
  achievements.checkOnGameFinish(ctx);
  assert.equal(
    achievements.achievementMarkState("one-shot"),
    MARK.REPLAY,
    "一度遊んだ問題での 1 手クリアは再プレイの署名になるはず"
  );
  assert.equal(
    achievements.achievementMarkState("first-clear"),
    MARK.FRESH,
    "解除済みの実績の署名は、あとのプレイで上書きしないはず"
  );
}

// 裏モードで遊んだ問題を表モードで遊んでも「再プレイ」（答えは表裏で共通）
{
  const pid = 456;
  const logic = new Logic(pid);
  const usoPlay = {
    startTime: 1_700_000_000,
    endTime: 1_700_000_300,
    gameMode: "uso",
    problemID: pid,
    guessWord: ["about", logic.ans1],
    clear: true,
  };
  const ctx = finishGameCtx({ pid, guessWords: [logic.ans1], startTime: 1_700_100_000 });
  const achievements = await scenario([usoPlay, ctx.record]);
  achievements.checkOnGameFinish(ctx);
  assert.equal(achievements.achievementMarkState("one-shot"), MARK.REPLAY);
}

// 履歴からの復元（インポートなど）は、初見だったか判別できないので「復元」の署名
{
  const pid = 654;
  const logic = new Logic(pid);
  const imported = {
    startTime: 1_700_000_000,
    endTime: 1_700_000_030,
    gameMode: "normal",
    problemID: pid,
    guessWord: [logic.ans1],
    clear: true,
    imported: "json",
  };
  const achievements = await scenario([imported]);
  achievements.reconcileAchievementsFromHistory();
  assert.equal(achievements.achievementMarkState("one-shot"), MARK.RESTORED);
}

// ---- 移行: この機能より前から解除済みの実績は「初見」とみなして署名を付ける ----
{
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify([]));
  storage.set("dwordle2.achievements", JSON.stringify({
    "one-shot": 1_690_000_000,
    "plays-100": 1_690_000_100, // カウント系には付けない
  }));
  records._reload();
  const achievements = await import(`../js/core/achievements.js?mark-scenario=${++scenarioSerial}`);
  assert.equal(achievements.achievementMarkState("one-shot"), MARK.FRESH, "既存の解除済み実績は初見扱いにするはず");
  assert.equal(achievements.getAchievementMarks()["plays-100"], undefined);
  const persisted = JSON.parse(storage.get("dwordle2.achievements.sig"));
  assert.equal(persisted["one-shot"], signAchievement("one-shot", MARK.FRESH, 1_690_000_000));
  assert.equal(Number(storage.get("dwordle2.achievements.sigVersion")), 1, "移行は一度だけ走るよう版を記録するはず");
}

// 新規プレイヤー（解除ゼロ）には何も書かない
{
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify([]));
  records._reload();
  await import(`../js/core/achievements.js?mark-scenario=${++scenarioSerial}`);
  assert.equal(storage.get("dwordle2.achievements.sig"), undefined);
  assert.equal(storage.get("dwordle2.achievements.sigVersion"), undefined);
}

console.log("実績署名テスト: OK");
