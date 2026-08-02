// 新出題（No.）と旧出題（Cls.）の分離と、新しい抽選の性質を確認するテスト。
// 実行: node test/problem-sets.test.mjs
//
// ここで守りたいのは 3 つ。
//  1. Cls. の出題は 1 問も変わらない（リリース済みの履歴・実績がそのまま読める）
//  2. デイリーの切り替えは日付（PID）で決まり、時計やタイムゾーンでは動かない
//  3. 新しい抽選が、原作 LCG の偏り（組み合わせが候補語数どまり・番号が等差数列）を解消している

import assert from "node:assert/strict";
import {
  NEW_ERA,
  PID,
  candidateWordsForPID,
  isClassicPID,
  isDailyPID,
  isNewPID,
  isValidPID,
  numberPrefix,
  pidForNumber,
  pidLabel,
  pidRangeForLevel,
  problemNumber,
  usesNewGenerator,
  LEVELS,
} from "../js/core/problems.js?v=20260803-b";
import { Logic } from "../js/core/logic.js?v=20260803-b";
import { achievementIdsFromHistory } from "../js/core/achievements.js?v=20260803-b";

// ---- 番号と内部 PID の対応 ----

assert.equal(pidForNumber(1, true), 1, "Cls. の内部 PID は表示番号そのまま（据え置き）");
assert.equal(pidForNumber(1), 100001, "新出題は表示番号 + NEW_OFFSET");
assert.equal(problemNumber(100001), 1);
assert.equal(problemNumber(1), 1);
assert.equal(problemNumber(20260729), 20260729, "デイリーは番号を持たない");

assert.equal(pidLabel(1), "Cls.1");
assert.equal(pidLabel(12345), "Cls.12345");
assert.equal(pidLabel(100001), "No.1");
assert.equal(pidLabel(139999), "No.39999");
assert.equal(pidLabel(20260729), "Daily 2026-07-29");
assert.equal(numberPrefix(true), "Cls.");
assert.equal(numberPrefix(false), "No.");

assert.equal(isClassicPID(1), true);
assert.equal(isClassicPID(39999), true);
assert.equal(isClassicPID(40000), false);
assert.equal(isNewPID(100001), true);
assert.equal(isNewPID(139999), true);
assert.equal(isNewPID(100000), false, "オフセットちょうどは番号 0 なので無効");
assert.equal(isClassicPID(20260729), false, "デイリーは Cls. でも新出題でもない");

// 保存・インポートで受け付ける PID
assert.equal(isValidPID(0), false, "0 は問題番号として無効（古い履歴に混ざっていることがある）");
assert.equal(isValidPID(1), true);
assert.equal(isValidPID(39999), true);
assert.equal(isValidPID(40000), false);
assert.equal(isValidPID(100001), true);
assert.equal(isValidPID(139999), true);
assert.equal(isValidPID(140000), false);
assert.equal(isValidPID(20260729), true);
assert.equal(isValidPID(1.5), false);

// 新旧の PID が重ならない（履歴のキーが衝突しない）
for (const number of [1, 9999, 10000, 19999, 20000, 39999]) {
  assert.notEqual(pidForNumber(number, true), pidForNumber(number, false));
  assert.equal(isDailyPID(pidForNumber(number, false)), false, "新出題がデイリーと誤認されない");
}

// レベル帯は両セットで同じ並び。100 問ブロックの区切りも揃う
for (const level of LEVELS) {
  const [classicLo, classicHi] = pidRangeForLevel(level, true);
  const [newLo, newHi] = pidRangeForLevel(level, false);
  assert.deepEqual([classicLo, classicHi], level.range);
  assert.equal(newLo - classicLo, PID.NEW_OFFSET);
  assert.equal(newHi - classicHi, PID.NEW_OFFSET);
  assert.equal(newLo % 100, classicLo % 100, "ブロックの区切りが新旧でずれない");
  assert.equal(
    candidateWordsForPID(classicLo),
    candidateWordsForPID(newLo),
    "候補語リストは新旧で共通（変えたのは引き方だけ）"
  );
}

// ---- どちらの抽選を使うか ----

assert.equal(usesNewGenerator(1), false, "Cls. は原作 LCG のまま");
assert.equal(usesNewGenerator(39999), false);
assert.equal(usesNewGenerator(100001), true);
assert.equal(NEW_ERA.dailyFromPID, 20260801);
assert.equal(usesNewGenerator(20260731), false, "切り替え日の前日のデイリーは旧のまま");
assert.equal(usesNewGenerator(20260801), true, "切り替え日のデイリーから新しい抽選");
assert.equal(usesNewGenerator(20260802), true);
// 実績カットオフはデイリーの切り替えと同じ日の 0 時
assert.equal(
  new Date(NEW_ERA.achievementCutoffSec * 1000).toDateString(),
  new Date(2026, 7, 1).toDateString(),
  "実績カットオフとデイリーの切り替え日をずらさない"
);

// ---- Cls. の出題は 1 問も変わらない ----
// 原作互換の実装そのものは parity.test.mjs が原作コードと突き合わせている。
// ここでは「新出題を足したあとも Cls. の答えが動いていない」ことだけを固定値で押さえる。
const CLASSIC_FIXTURES = [
  [1, "point", "touch"],
  [9999, "teach", "these"],
  [10000, "eucti", "email"],
  [19999, "frayn", "plash"],
  [20000, "reach", "point"],
  [39999, "wayne", "piton"],
  [20260728, "track", "woman"],
  [20260731, "other", "stood"], // 切り替え日の前日のデイリー
];
for (const [pid, ans1, ans2] of CLASSIC_FIXTURES) {
  const logic = new Logic(pid);
  assert.deepEqual([logic.ans1, logic.ans2], [ans1, ans2], `Cls. ${pid} の出題は変えてはいけない`);
}

// ---- 新しい抽選の性質 ----

// 決定的（同じ番号なら何度作っても同じ）
for (const pid of [100001, 110000, 120345, 20260729]) {
  const first = new Logic(pid);
  const second = new Logic(pid);
  assert.deepEqual([first.ans1, first.ans2], [second.ans1, second.ans2]);
}

// 2 語が同じにならない。候補語リストの中から選ばれている
for (const [lo, hi] of [[100001, 100200], [110000, 110200], [120000, 120200], [135000, 135200]]) {
  for (let pid = lo; pid <= hi; pid++) {
    const logic = new Logic(pid);
    const words = candidateWordsForPID(pid);
    assert.notEqual(logic.ans1, logic.ans2, `${pidLabel(pid)} の 2 語が同じ`);
    assert.ok(words.includes(logic.ans1) && words.includes(logic.ans2), `${pidLabel(pid)} の答えが候補外`);
  }
}

// 原作 LCG は ans2 が ans1 だけで決まるため、やさしい帯（236 語）では
// No.1-9999 に 236 通りの出題しか無かった。新しい抽選では組み合わせが十分に散る。
{
  const pairs = new Set();
  for (let number = 1; number <= 9999; number++) {
    const logic = new Logic(pidForNumber(number));
    pairs.add(`${logic.ans1}/${logic.ans2}`);
  }
  assert.ok(pairs.size > 8000, `やさしい帯の出題が偏っている: ${pairs.size} 通り`);
}

// 番号が 1 増えたときの答えの動きが等差にならない（今日の答えから明日を逆算できない）
{
  const words = candidateWordsForPID(pidForNumber(1));
  const steps = new Set();
  for (let number = 1; number < 60; number++) {
    const here = words.indexOf(new Logic(pidForNumber(number)).ans1);
    const next = words.indexOf(new Logic(pidForNumber(number + 1)).ans1);
    steps.add((next - here + words.length) % words.length);
  }
  assert.ok(steps.size > 40, `隣り合う番号の答えが規則的に動いている: ${steps.size} 種類の差`);
}

// 1 語目の出現回数が偏らない（候補 750 語のレベル帯を 5000 問で見る）
{
  const counts = new Map();
  const [lo, hi] = pidRangeForLevel(LEVELS[1]);
  for (let pid = lo; pid <= hi; pid++) {
    const word = new Logic(pid).ans1;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const expected = (hi - lo + 1) / candidateWordsForPID(lo).length;
  assert.ok(counts.size > 700, `使われない単語が多すぎる: ${counts.size} 語`);
  assert.ok(Math.max(...values) < expected * 4, `特定の単語に寄りすぎ: 最多 ${Math.max(...values)} 回`);
}

// デイリーは切り替え日から新しい抽選になる。同じ答えの組が短期間で戻ってこない
{
  const before = new Logic(20260731);
  assert.deepEqual([before.ans1, before.ans2], ["other", "stood"], "切り替え前のデイリーは動かさない");
  const pairs = new Set();
  const start = new Date(2026, 7, 1);
  for (let i = 0; i < 365; i++) {
    const date = new Date(start.getTime() + i * 86400000);
    const pid = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    const logic = new Logic(pid);
    pairs.add(`${logic.ans1}/${logic.ans2}`);
  }
  assert.equal(pairs.size, 365, "1 年分のデイリーに同じ出題が出てはいけない");
}

// ---- 実績のカットオフ ----
{
  const before = NEW_ERA.achievementCutoffSec - 3600;
  const after = NEW_ERA.achievementCutoffSec + 3600;
  const record = (pid, startTime) => {
    const logic = new Logic(pid);
    return {
      startTime,
      endTime: startTime + 30,
      gameMode: "normal",
      problemID: pid,
      guessWord: [logic.ans1],
      clear: true,
    };
  };

  // 切り替え前の Cls. プレイ（リリース済みの履歴）は今までどおり実績になる
  const past = achievementIdsFromHistory([record(1, before)]);
  assert.equal(past.has("first-clear"), true, "切り替え前の履歴の実績を取り消してはいけない");
  assert.equal(past.has("one-shot"), true);

  // 切り替え後の Cls. プレイは実績にならない
  const classicAfter = achievementIdsFromHistory([record(1, after)]);
  assert.equal(classicAfter.has("first-clear"), false, "Cls. のプレイは実績の対象外");
  assert.equal(classicAfter.has("first-play"), false);
  assert.equal(classicAfter.has("one-shot"), false);

  // 同じ内容でも新出題ならこれまでどおり
  const newAfter = achievementIdsFromHistory([record(pidForNumber(1), after)]);
  assert.equal(newAfter.has("first-clear"), true);
  assert.equal(newAfter.has("one-shot"), true);

  // 継続系は Cls. のプレイも「遊んだ日」として数える
  const days = [];
  for (let day = 0; day < 30; day++) days.push(record(1, after + day * 86400));
  const habit = achievementIdsFromHistory(days);
  assert.equal(habit.has("play-days-30"), true, "Cls. だけ遊んだ日も通算プレイ日数に入る");
  assert.equal(habit.has("play-streak-14"), true, "Cls. だけ遊んだ日で連続プレイが途切れない");
  assert.equal(habit.has("plays-30"), false, "通算プレイ回数には Cls. を数えない");
  assert.equal(habit.has("wins-10"), false, "通算勝利数にも Cls. を数えない");
}

console.log("problem-sets: OK");
