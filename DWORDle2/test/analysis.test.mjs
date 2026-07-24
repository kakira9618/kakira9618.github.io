// 分析コアのテスト。
// 実行: node test/analysis.test.mjs

import { Logic, queryWordPair } from "../js/core/logic.js?v=20260723-fa";
import {
  encodeWords,
  patternIdFast,
  resultToPatternId,
  patternIdToStates,
  computeTruePatternIds,
  analyzeGame,
  makeRng,
} from "../js/core/analysis-core.js?v=20260723-fa";
import { ALL_WORDS } from "../js/data/words.js?v=20260723-fa";

let failures = 0;
function check(cond, message) {
  if (!cond) {
    failures++;
    console.error("FAIL:", message);
  }
}

// ---- 1. patternIdFast と queryWordPair の一致（ファズ）----
{
  const rng = makeRng(20260720);
  const pick = () => ALL_WORDS[Math.floor(rng() * ALL_WORDS.length)];
  let cases = 0;
  for (let k = 0; k < 30000; k++) {
    const g = pick();
    let a = pick();
    let b = pick();
    if (a === b) continue;
    const slow = resultToPatternId(queryWordPair(g, a, b));
    const bytes = encodeWords([g, a, b]);
    const fast = patternIdFast(bytes, 0, bytes, 5, 10);
    const swapped = patternIdFast(bytes, 0, bytes, 10, 5);
    cases++;
    check(slow === fast, `pattern mismatch g=${g} a=${a} b=${b}: slow=${slow} fast=${fast}`);
    check(fast === swapped, `answer pair order should not affect feedback g=${g} a=${a} b=${b}`);
  }
  // 繰り返し文字が絡むケースを重点的に
  const tricky = [
    ["eeeee", "eagle", "elite"],
    ["allee", "small", "level"],
    ["aabbb", "ababa", "babab"],
    ["mamma", "madam", "drama"],
  ];
  for (const [g, a, b] of tricky) {
    if (![g, a, b].every((w) => w.length === 5)) continue;
    const slow = resultToPatternId(queryWordPair(g, a, b));
    const bytes = encodeWords([g, a, b]);
    const fast = patternIdFast(bytes, 0, bytes, 5, 10);
    cases++;
    check(slow === fast, `tricky mismatch g=${g} a=${a} b=${b}`);
  }
  console.log(`patternIdFast ファズ: ${cases} cases`);
}

// ---- 2. patternId 変換の往復 ----
{
  for (let id = 0; id < 243; id++) {
    check(resultToPatternId(patternIdToStates(id)) === id, `pattern roundtrip ${id}`);
  }
}

// ---- 3. analyzeGame のスモークテスト（やさしい問題・正しい答えペアが生き残るか）----
{
  const pid = 1234;
  const logic = new Logic(pid);
  const guesses = ["about", "crane", logic.ans1];
  const truePatternIds = computeTruePatternIds(logic.ans1, logic.ans2, guesses);
  const t0 = Date.now();
  const res = analyzeGame({ pid, mode: "normal", guessWords: guesses, truePatternIds });
  const elapsed = Date.now() - t0;
  console.log(
    `analyzeGame(easy): ${elapsed}ms, pairs ${res.initialPairs} -> ${res.turns.map((t) => t.after).join(" -> ")}`
  );
  check(res.sampled === false, "easy は厳密計算のはず");
  check(res.initialPairs === (res.candListSize * (res.candListSize - 1)) / 2, "初期ペア数は順序なし組合せ");
  check(res.turns.length === 3, "turns 数");
  check(res.turns[0].before === res.initialPairs, "初期ペア数");
  for (let t = 0; t < res.turns.length; t++) {
    check(res.turns[t].after >= 1, `turn ${t}: 真の答えペアが生き残るはず`);
    check(res.turns[t].after <= res.turns[t].before, `turn ${t}: 単調減少`);
    check(res.turns[t].bitsGained >= 0, `turn ${t}: bits >= 0`);
    check(res.turns[t].suggestions.list.length > 0, `turn ${t}: 提案あり`);
  }
  // 最終 Guess が正解 → 生き残りペアに ans1 を含むペアがあるはず
  check(res.turns[2].after < res.turns[0].before, "絞り込みが機能している");
}

// ---- 4. analyzeGame の嘘モードスモークテスト ----
{
  const pid = 55;
  const logic = new Logic(pid);
  const guesses = ["about", "shine"];
  const truePatternIds = computeTruePatternIds(logic.ans1, logic.ans2, guesses);
  // 嘘: 各位置で真と異なる状態にずらす（0->1, 1->2, 2->0）
  const shownPatternIds = truePatternIds.map((id) => {
    const states = patternIdToStates(id);
    const lie = states.map((s) => (s === "unused" ? "used" : s === "used" ? "correct" : "unused"));
    return resultToPatternId(lie);
  });
  const res = analyzeGame({ pid, mode: "uso", guessWords: guesses, truePatternIds, shownPatternIds });
  for (let t = 0; t < res.turns.length; t++) {
    check(res.turns[t].after >= 1, `uso turn ${t}: 真の答えペアが生き残るはず`);
    check(res.turns[t].after <= res.turns[t].before, `uso turn ${t}: 単調減少`);
  }
  console.log(`analyzeGame(uso): pairs ${res.initialPairs} -> ${res.turns.map((t) => t.after).join(" -> ")}`);
}

// ---- 5. 極（サンプリング帯）のスモークテスト ----
{
  const pid = 15000;
  const logic = new Logic(pid);
  const guesses = ["raise", "mount"];
  const truePatternIds = computeTruePatternIds(logic.ans1, logic.ans2, guesses);
  const t0 = Date.now();
  const res = analyzeGame({ pid, mode: "normal", guessWords: guesses, truePatternIds });
  console.log(
    `analyzeGame(extreme, sampled): ${Date.now() - t0}ms, pairs ${res.initialPairs} -> ${res.turns
      .map((t) => t.after)
      .join(" -> ")}`
  );
  check(res.sampled === true, "極はサンプリングのはず");
  check(res.turns[0].before === res.initialPairs, "スケール後の初期ペア数表示");
}

if (failures === 0) console.log("ALL TESTS PASSED");
else {
  console.error(`${failures} failures`);
  process.exit(1);
}
