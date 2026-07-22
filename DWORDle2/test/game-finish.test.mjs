// checkOnGameFinish（ゲーム終了時のリアルタイム実績解放）のテスト。
// 実行: node test/game-finish.test.mjs
//
// 解放状態は achievements.js のモジュール内キャッシュ (unlocked) に保持されるため、
// シナリオごとにクエリ付き import で新しいモジュールインスタンスを読み込んで隔離する。
// records.js は共有インスタンスのまま、localStorage モックと _reload() で初期化する。

import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const { Logic, CELL } = await import("../js/core/logic.js");
const { ALL_WORDS } = await import("../js/data/words.js");
const records = await import("../js/core/records.js");
const { MODES } = records;

let scenarioSerial = 0;

// 履歴をセットして、新しい achievements インスタンスの checkOnGameFinish を返す
async function scenario(history) {
  storage.clear();
  storage.set("dwordle2.history", JSON.stringify(history));
  records._reload();
  const mod = await import(`../js/core/achievements.js?scenario=${++scenarioSerial}`);
  return mod.checkOnGameFinish;
}

// 終了直後のゲームの ctx（record は履歴へ入れる前提で組み立てる）
function finishGameCtx({
  pid = 123,
  mode = "normal",
  guessWords,
  usoResults,
  startTime = 1_700_000_000,
  durationSec = 30,
  endDate = new Date(2026, 6, 20, 12, 0, 0),
  hadLostBefore = false,
}) {
  const logic = new Logic(pid);
  const record = {
    startTime,
    endTime: startTime + durationSec,
    gameMode: mode,
    problemID: pid,
    guessWord: guessWords.slice(),
    usoResults,
    clear: logic.isGameClear(guessWords[guessWords.length - 1]),
  };
  const results = guessWords.map((w) => logic.queryWord(w));
  return { record, results, durationSec, endDate, maxGuess: MODES[mode].maxGuess, hadLostBefore };
}

function idsOf(newly) {
  return new Set(newly.map((achievement) => achievement.id));
}

// 両方の答えと 1 文字も共有しない単語（判定が全部灰色になる）
function allGrayWord(logic, exclude = new Set()) {
  const used = new Set([...logic.ans1, ...logic.ans2]);
  const word = ALL_WORDS.find((w) => !exclude.has(w) && [...w].every((c) => !used.has(c)));
  assert.ok(word, "全灰になる単語が見つかるはず");
  return word;
}

// 1 回の判定で緑・黄・灰が全部出る単語
function rainbowWord(logic) {
  const word = ALL_WORDS.find((w) => {
    if (logic.isGameClear(w)) return false;
    const row = logic.queryWord(w);
    return row.includes(CELL.CORRECT) && row.includes(CELL.USED) && row.includes(CELL.UNUSED);
  });
  assert.ok(word, "三色盛りになる単語が見つかるはず");
  return word;
}

// ---- 1 手クリア: 入門・手数・スピード・初手の緑 ----
{
  const ctx = finishGameCtx({ pid: 123, guessWords: [new Logic(123).ans1], durationSec: 30 });
  const check = await scenario([ctx.record]);
  const ids = idsOf(check(ctx));
  for (const id of ["first-play", "first-clear", "one-shot", "two-shot", "within-4", "speed-60", "green-start"]) {
    assert.ok(ids.has(id), `1 手 30 秒クリアで ${id} が解放されるはず`);
  }
  for (const id of ["last-gasp", "slow-10", "night-owl", "rainbow", "all-gray", "uso-clear"]) {
    assert.ok(!ids.has(id), `1 手クリアで ${id} は解放されないはず`);
  }
}

// ---- 最終手クリア: 土壇場・大逆転・完全なる空振り・リベンジ・熟考・真夜中 ----
{
  const logic = new Logic(123);
  const filler = allGrayWord(logic);
  const ctx = finishGameCtx({
    pid: 123,
    guessWords: [...Array(9).fill(filler), logic.ans1],
    durationSec: 700,
    endDate: new Date(2026, 6, 20, 2, 30, 0), // 深夜 2:30
    hadLostBefore: true,
  });
  const check = await scenario([ctx.record]);
  const ids = idsOf(check(ctx));
  for (const id of ["last-gasp", "green-zero", "all-gray", "revenge", "slow-10", "night-owl"]) {
    assert.ok(ids.has(id), `最終手クリア（全灰 9 手 → 正解、700 秒、深夜、雪辱戦）で ${id} が解放されるはず`);
  }
  for (const id of ["one-shot", "within-4", "speed-60"]) {
    assert.ok(!ids.has(id), `10 手 700 秒のクリアで ${id} は解放されないはず`);
  }
}

// ---- 敗北ゲームでも盤面・単語系の実績は解放される ----
{
  const logic = new Logic(123);
  const rainbow = rainbowWord(logic);
  const palindrome = ALL_WORDS.find((w) => w === [...w].reverse().join("") && !logic.isGameClear(w));
  assert.ok(palindrome, "回文の単語が見つかるはず");
  // アナグラムのペア（同じ文字構成の別単語）を語彙から探す
  const bySorted = new Map();
  let anagramPair = null;
  for (const w of ALL_WORDS) {
    if (logic.isGameClear(w)) continue;
    const key = [...w].sort().join("");
    if (bySorted.has(key)) {
      anagramPair = [bySorted.get(key), w];
      break;
    }
    bySorted.set(key, w);
  }
  assert.ok(anagramPair, "アナグラムのペアが見つかるはず");
  const filler = allGrayWord(logic);
  const guessWords = [rainbow, palindrome, ...anagramPair, ...Array(6).fill(filler)];
  const ctx = finishGameCtx({ pid: 123, guessWords, durationSec: 120 });
  assert.equal(ctx.record.clear, false, "このシナリオは敗北で終わるはず");
  const check = await scenario([ctx.record]);
  const ids = idsOf(check(ctx));
  for (const id of ["first-play", "rainbow", "h-mirror", "h-anagram"]) {
    assert.ok(ids.has(id), `敗北ゲームでも ${id} が解放されるはず`);
  }
  for (const id of ["first-clear", "green-zero", "revenge"]) {
    assert.ok(!ids.has(id), `敗北ゲームで ${id} は解放されないはず`);
  }
}

// ---- 裏モード: 嘘を見抜く・全緑の嘘 ----
{
  const logic = new Logic(123);
  const ctx = finishGameCtx({
    pid: 123,
    mode: "uso",
    guessWords: [logic.ans1],
    usoResults: [Array(5).fill(CELL.CORRECT)],
    durationSec: 45,
  });
  const check = await scenario([ctx.record]);
  const ids = idsOf(check(ctx));
  for (const id of ["uso-clear", "h-uso-green", "first-play", "first-clear", "one-shot"]) {
    assert.ok(ids.has(id), `裏モードの 1 手クリア（表示が全緑の行あり）で ${id} が解放されるはず`);
  }
  assert.ok(!ids.has("uso-5"), "裏モード 1 勝で uso-5 は解放されないはず");
}

// ---- 3 連勝 ----
{
  const prior = [124, 125].map((pid, index) =>
    finishGameCtx({ pid, guessWords: [new Logic(pid).ans1], startTime: 1_700_000_000 + index * 1000 }).record
  );
  const ctx = finishGameCtx({ pid: 123, guessWords: [new Logic(123).ans1], startTime: 1_700_002_000 });
  const check = await scenario([...prior, ctx.record]);
  const ids = idsOf(check(ctx));
  assert.ok(ids.has("streak-3"), "3 連勝で streak-3 が解放されるはず");
  assert.ok(!ids.has("streak-5"), "3 連勝で streak-5 は解放されないはず");
}

// ---- 同日・同問題の再プレイはカウント系実績から除外 ----
{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const prior = [1, 2, 3, 4].map((pid, index) =>
    finishGameCtx({
      pid,
      mode: "uso",
      guessWords: [new Logic(pid).ans1],
      startTime: base + index * 600,
    }).record
  );
  const replay = finishGameCtx({
    pid: 1,
    mode: "uso",
    guessWords: [new Logic(1).ans1],
    startTime: base + 3600,
  });
  const replayIds = idsOf((await scenario([...prior, replay.record]))(replay));
  assert.ok(replayIds.has("uso-clear"), "a per-game achievement should still be checked on a replay");
  assert.ok(!replayIds.has("uso-5"), "a same-day replay must not count as the fifth DWORDlie win");

  const nextDay = finishGameCtx({
    pid: 1,
    mode: "uso",
    guessWords: [new Logic(1).ans1],
    startTime: base + 86400,
  });
  const nextDayIds = idsOf((await scenario([...prior, nextDay.record]))(nextDay));
  assert.ok(nextDayIds.has("uso-5"), "the same puzzle on another day should count as the fifth DWORDlie win");
}

{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const prior = [1, 2].map((pid, index) =>
    finishGameCtx({ pid, guessWords: [new Logic(pid).ans1], startTime: base + index * 600 }).record
  );
  const replay = finishGameCtx({ pid: 1, guessWords: [new Logic(1).ans1], startTime: base + 1800 });
  const ids = idsOf((await scenario([...prior, replay.record]))(replay));
  assert.ok(!ids.has("streak-3"), "a same-day replay must not extend the counted win streak");
}

// ---- 同日・同問題の再プレイでは隠し実績も解除されない ----
{
  const base = Math.floor(new Date(2026, 6, 20, 12, 0, 0).getTime() / 1000);
  const logic = new Logic(123);
  const palindrome = ALL_WORDS.find((w) => w === [...w].reverse().join("") && !logic.isGameClear(w));
  assert.ok(palindrome, "回文の単語が見つかるはず");
  const prior = finishGameCtx({ pid: 123, guessWords: [logic.ans1], startTime: base }).record;
  const replay = finishGameCtx({ pid: 123, guessWords: [palindrome, logic.ans1], startTime: base + 600 });
  const replayIds = idsOf((await scenario([prior, replay.record]))(replay));
  assert.ok(!replayIds.has("h-mirror"), "同日・同問題の再プレイでは隠し実績（鏡の言葉）は解除されないはず");
  assert.ok(replayIds.has("two-shot"), "通常の 1 局実績は同日再プレイでも解除されるはず");

  const nextDay = finishGameCtx({ pid: 123, guessWords: [palindrome, logic.ans1], startTime: base + 86400 });
  const nextDayIds = idsOf((await scenario([prior, nextDay.record]))(nextDay));
  assert.ok(nextDayIds.has("h-mirror"), "別日の同じ問題なら隠し実績（鏡の言葉）が解除されるはず");
}

// ---- デイリー問題のクリア ----
{
  const pid = 20260720;
  const ctx = finishGameCtx({ pid, guessWords: [new Logic(pid).ans1] });
  const check = await scenario([ctx.record]);
  assert.ok(idsOf(check(ctx)).has("daily-clear"), "デイリー問題のクリアで daily-clear が解放されるはず");
}

// ---- 極・レベル問題のクリア ----
{
  const ctx = finishGameCtx({ pid: 10000, guessWords: [new Logic(10000).ans1] });
  const check = await scenario([ctx.record]);
  const ids = idsOf(check(ctx));
  assert.ok(ids.has("extreme-clear"), "極のクリアで extreme-clear が解放されるはず");
  assert.ok(ids.has("h-abyss"), "極の 4 手以内クリアで h-abyss が解放されるはず");
}
{
  const ctx = finishGameCtx({ pid: 20000, guessWords: [new Logic(20000).ans1] });
  const check = await scenario([ctx.record]);
  assert.ok(idsOf(check(ctx)).has("level-clear"), "レベル問題のクリアで level-clear が解放されるはず");
}

// ---- 電光石火（3 手以上 10 秒以内）と境界 ----
{
  const logic = new Logic(123);
  const filler = allGrayWord(logic);
  const make = (durationSec, guesses) =>
    finishGameCtx({ pid: 123, guessWords: [...Array(guesses - 1).fill(filler), logic.ans1], durationSec });
  const fast = make(10, 3);
  assert.ok(idsOf((await scenario([fast.record]))(fast)).has("h-lightning"), "3 手 10 秒クリアで h-lightning が解放されるはず");
  const slow = make(11, 3);
  assert.ok(!idsOf((await scenario([slow.record]))(slow)).has("h-lightning"), "11 秒では h-lightning は解放されないはず");
  const short = make(10, 2);
  assert.ok(!idsOf((await scenario([short.record]))(short)).has("h-lightning"), "2 手では h-lightning は解放されないはず");
}

// ---- 同じゲームをもう一度判定しても二重解放されない ----
{
  const ctx = finishGameCtx({ pid: 123, guessWords: [new Logic(123).ans1] });
  const check = await scenario([ctx.record]);
  const first = check(ctx);
  assert.ok(first.length > 0);
  assert.equal(check(ctx).length, 0, "解放済みの実績は 2 回目の判定で返らないはず");
}

console.log("ゲーム終了時実績テスト: OK");
