// 原作 Tonyu コード (reference-orig-dwordle/) を逐語移植した参照実装と、
// 本作のロジック (js/core/logic.js) の出題・判定が一致することを確認するテスト。
// 実行: node test/parity.test.mjs

import { ALL_WORDS, EASY_WORDS } from "../js/data/words.js?v=20260723-fa";
import { Logic, queryWordPair } from "../js/core/logic.js?v=20260723-fa";
import { todayPID, isDailyPID, candidateWordsForPID } from "../js/core/problems.js?v=20260723-fa";

// ---- 参照実装: 原作 WordList.tonyu / Logic.tonyu の逐語移植 ----
// 原作は defaultCandWordsList / defaultAllWordsList を共有参照し、pickAns が
// その場で swap で破壊し、resetSeed が swap を戻す。この挙動ごと再現する。
class OrigLogic {
  constructor(seed) {
    // 原作 WordList はページロードごとに新しい配列を作るので、ここでもコピーを持つ
    this.defaultAllWordsList = ALL_WORDS.slice();
    this.defaultCandWordsList = EASY_WORDS.slice();
    this.seed = seed;
    this.setList(seed);
    this.pickAns(seed);
  }
  setList(seed) {
    if (seed < 10000 || isDailyPID(seed)) {
      this.allWordsList = this.defaultAllWordsList;
      this.candWordsList = this.defaultCandWordsList;
    } else {
      this.allWordsList = this.defaultAllWordsList;
      this.candWordsList = this.defaultAllWordsList;
    }
  }
  resetSeed(newseed) {
    const N = this.candWordsList.length;
    const temp = this.candWordsList[N - 1];
    this.candWordsList[N - 1] = this.ans1;
    this.candWordsList[this.ans1ind] = temp;
    this.setList(newseed);
    this.prevx = newseed;
    this.pickAns(newseed);
  }
  getNextInt(N) {
    const ret = (this.prevx * 48271) % N;
    this.prevx = ret;
    return ret;
  }
  pickAns(seed) {
    this.prevx = seed;
    const N = this.candWordsList.length;
    this.ans1ind = this.getNextInt(N);
    this.ans1 = this.candWordsList[this.ans1ind];
    const temp = this.candWordsList[N - 1];
    this.candWordsList[N - 1] = this.ans1;
    this.candWordsList[this.ans1ind] = temp;
    this.ans2ind = this.getNextInt(N - 1);
    this.ans2 = this.candWordsList[this.ans2ind];
  }
  queryWord(word) {
    const result = ["unused", "unused", "unused", "unused", "unused"];
    const flags = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    for (let i = 0; i < 5; i++) {
      if (word[i] === this.ans1[i] || word[i] === this.ans2[i]) {
        result[i] = "correct";
        if (word[i] === this.ans1[i]) flags[0][i] = 1;
        else if (word[i] === this.ans2[i]) flags[1][i] = 1;
      }
    }
    for (let i = 0; i < 5; i++) {
      if (result[i] === "correct") continue;
      for (let j = 0; j < 5; j++) {
        if (i === j) continue;
        if (flags[0][j] === 0 && word[i] === this.ans1[j]) {
          result[i] = "used";
          flags[0][j] = 1;
          break;
        } else if (flags[1][j] === 0 && word[i] === this.ans2[j]) {
          result[i] = "used";
          flags[1][j] = 1;
          break;
        }
      }
    }
    return result;
  }
}

let failures = 0;
function check(cond, message) {
  if (!cond) {
    failures++;
    console.error("FAIL:", message);
  }
}

// ---- 1. 出題の一致（単発の Logic 生成 = ページロード相当）----
const seedsToTest = [];
for (let s = 1; s <= 19999; s++) seedsToTest.push(s);
// デイリー相当 (2022-01-01 〜 2030-12-31 の日付整数)
for (let y = 2022; y <= 2030; y++) {
  for (const [m, d] of [[1, 1], [2, 28], [6, 15], [7, 20], [12, 31]]) {
    seedsToTest.push(parseInt(`${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`, 10));
  }
}
// 新レベル帯（互換対象外だが、決定性 = 同じ seed で同じ答えであることを確認）
for (let s = 20000; s <= 39999; s += 777) seedsToTest.push(s);

for (const seed of seedsToTest) {
  const mine = new Logic(seed);
  if (seed <= 19999 || isDailyPID(seed)) {
    const orig = new OrigLogic(seed);
    check(
      mine.ans1 === orig.ans1 && mine.ans2 === orig.ans2,
      `seed=${seed}: ans mismatch mine=(${mine.ans1},${mine.ans2}) orig=(${orig.ans1},${orig.ans2})`
    );
  }
  const again = new Logic(seed);
  check(mine.ans1 === again.ans1 && mine.ans2 === again.ans2, `seed=${seed}: 非決定的`);
  check(mine.ans1 !== mine.ans2, `seed=${seed}: ans1 == ans2 (${mine.ans1})`);
}
console.log(`出題一致テスト: ${seedsToTest.length} seeds`);

// ---- 2. resetSeed 連鎖（原作の統計・履歴詳細再計算の呼び方）でも一致 ----
{
  const orig = new OrigLogic(0 + 1); // 原作 getStatistics は Logic{seed:0} だが 0 は N で割った余りが 0 になるだけなので 1 始まりで模す
  const chain = [5, 12345, 777, 19999, 1, 10000, 20220101, 3, 15000, 42];
  for (const s of chain) {
    orig.resetSeed(s);
    const mine = new Logic(s);
    check(
      mine.ans1 === orig.ans1 && mine.ans2 === orig.ans2,
      `resetSeed chain seed=${s}: mine=(${mine.ans1},${mine.ans2}) orig=(${orig.ans1},${orig.ans2})`
    );
  }
  console.log("resetSeed 連鎖テスト: OK 対象", chain.length);
}

// ---- 3. queryWord のファズテスト ----
{
  let rngState = 123456789;
  const rnd = (n) => {
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return rngState % n;
  };
  const seeds = [1, 77, 9999, 10000, 15555, 19999, 20240101];
  let cases = 0;
  for (const seed of seeds) {
    const mine = new Logic(seed);
    const orig = new OrigLogic(seed);
    const words = [];
    for (let k = 0; k < 2000; k++) words.push(ALL_WORDS[rnd(ALL_WORDS.length)]);
    // 答えに近い語・繰り返し文字を含む語を重点的に
    words.push(mine.ans1, mine.ans2);
    for (const base of [mine.ans1, mine.ans2]) {
      for (let i = 0; i < 5; i++) {
        for (const c of "aeostz") {
          words.push(base.slice(0, i) + c + base.slice(i + 1));
        }
      }
    }
    for (const w of words) {
      cases++;
      const a = mine.queryWord(w).join(",");
      const b = orig.queryWord(w).join(",");
      check(a === b, `seed=${seed} word=${w}: query mismatch mine=${a} orig=${b}`);
    }
  }
  console.log(`queryWord ファズテスト: ${cases} cases`);
}

// ---- 4. 候補リストの基本性質 ----
{
  check(candidateWordsForPID(1).length === 236, "easy リストは 236 語のはず");
  check(candidateWordsForPID(10000).length === 14847, "hard リストは 14847 語のはず");
  const sizes = [20000, 25000, 30000, 35000].map((p) => candidateWordsForPID(p).length);
  console.log("レベル別候補リストサイズ:", sizes.join(", "));
  check(sizes.every((n, i) => i === 0 || n > sizes[i - 1]), "レベルは単調増加のはず");
  const allSet = new Set(ALL_WORDS);
  for (const p of [20000, 25000, 30000, 35000]) {
    check(candidateWordsForPID(p).every((w) => allSet.has(w)), `PID ${p} の候補は全語彙の部分集合のはず`);
  }
  check(isDailyPID(todayPID()), "todayPID はデイリー判定されるはず");
}

// ---- 5. usoConvert（DWORDlie の嘘変換）----
// 原作 Game.usoConvert(): 真の判定と必ず異なる状態を、残り 2 状態から等確率で返す。
{
  const { CELL, usoConvert } = await import("../js/core/logic.js?v=20260723-fa");
  const STATES = [CELL.UNUSED, CELL.USED, CELL.CORRECT];

  check(usoConvert(CELL.GUESSING) === CELL.GUESSING, "guessing は変換されないはず");

  // 決定的な乱数列での境界確認: 真の状態と同じ値を引いたら引き直す
  const seq = (values) => {
    let i = 0;
    return () => values[i++];
  };
  check(usoConvert(CELL.UNUSED, seq([0 / 3, 1 / 3])) === CELL.USED, "同値 (unused) を引いたら引き直して used になるはず");
  check(usoConvert(CELL.UNUSED, seq([2 / 3])) === CELL.CORRECT, "unused から correct へ変換できるはず");
  check(usoConvert(CELL.USED, seq([1 / 3, 1 / 3, 2 / 3])) === CELL.CORRECT, "同値 (used) を何度引いても最終的に別状態になるはず");
  check(usoConvert(CELL.CORRECT, seq([0 / 3])) === CELL.UNUSED, "correct から unused へ変換できるはず");

  // 実乱数での不変条件と分布: 真の状態は決して返らず、残り 2 状態がほぼ半々
  for (const state of STATES) {
    const counts = new Map(STATES.map((s) => [s, 0]));
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const lie = usoConvert(state);
      counts.set(lie, counts.get(lie) + 1);
    }
    check(counts.get(state) === 0, `${state} の嘘に ${state} 自身が混ざってはいけない`);
    const others = STATES.filter((s) => s !== state);
    for (const other of others) {
      const ratio = counts.get(other) / N;
      check(Math.abs(ratio - 0.5) < 0.02, `${state} → ${other} は約 50% のはず (実測 ${(ratio * 100).toFixed(1)}%)`);
    }
  }
  console.log("usoConvert テスト: OK");
}

if (failures === 0) {
  console.log("ALL TESTS PASSED");
} else {
  console.error(`${failures} failures`);
  process.exit(1);
}
