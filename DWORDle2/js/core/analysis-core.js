// 分析モードの計算コア。Worker (analysis.worker.js) とテストの両方から使う。
//
// 候補空間は「答えの組 (ans1, ans2)」の順序付きペア全体。
// 各 Guess の判定結果と矛盾しないペアだけを残していき、
//   - 残り候補数の推移
//   - 獲得情報量（bit）= log2(絞り込み前 / 絞り込み後)
//   - その Guess の期待情報量（判定パターン分布のエントロピー）
//   - もっと候補を絞れたはずの単語の提案
// を turn ごとに計算する。
//
// ペア数が膨大な帯（極など、最大 14847*14846 ≈ 2.2 億）は一様サンプリングで
// 推定する（結果に sampled フラグを立てる）。乱数はシード付きで再現可能。

import { queryWordPair, CELL } from "./logic.js";
import { candidateWordsForPID } from "./problems.js";
import { EASY_WORDS, ALL_WORDS } from "../data/words.js";
import { FREQ_ORDER } from "../data/levels.js";

// ---- 計算量の上限(調整用定数) ----
export const ANALYSIS_LIMITS = {
  MAX_EXACT_PAIRS: 1_200_000, // これ以下なら全ペア列挙、超えたらサンプリング
  SAMPLE_PAIRS: 400_000, // サンプリング時のペア数
  SUGGEST_PAIR_CAP: 15_000, // 提案評価に使うペア数の上限
  SUGGEST_GUESS_CAP: 500, // 提案として評価する Guess 候補数の上限
  SUGGEST_TOP: 5, // 表示する提案数
};

const POW3 = [1, 3, 9, 27, 81];
const STATE_DIGIT = { [CELL.UNUSED]: 0, [CELL.USED]: 1, [CELL.CORRECT]: 2 };
const DIGIT_STATE = [CELL.UNUSED, CELL.USED, CELL.CORRECT];

// 判定結果の配列 (["correct","used",...]) をパターン ID (0..242) に変換
export function resultToPatternId(result) {
  let id = 0;
  for (let i = 0; i < 5; i++) id += STATE_DIGIT[result[i]] * POW3[i];
  return id;
}

export function patternIdToStates(id) {
  const states = [];
  for (let i = 0; i < 5; i++) states.push(DIGIT_STATE[DIGITS[id * 5 + i]]);
  return states;
}

// 真の判定履歴からパターン ID 配列を作る（Worker への入力生成用）
export function computeTruePatternIds(ans1, ans2, guessWords) {
  return guessWords.map((w) => resultToPatternId(queryWordPair(w, ans1, ans2)));
}

// パターン ID の各桁 (0=灰,1=黄,2=緑) を引くテーブル
const DIGITS = new Uint8Array(243 * 5);
for (let id = 0; id < 243; id++) {
  let v = id;
  for (let i = 0; i < 5; i++) {
    DIGITS[id * 5 + i] = v % 3;
    v = Math.floor(v / 3);
  }
}

// 単語配列を 1 語 5 バイト (a=0..z=25) の Uint8Array に詰める
export function encodeWords(words) {
  const bytes = new Uint8Array(words.length * 5);
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    for (let i = 0; i < 5; i++) bytes[k * 5 + i] = w.charCodeAt(i) - 97;
  }
  return bytes;
}

// queryWordPair のバイト列高速版。guess g(gOff) を答えペア (W[aOff], W[bOff]) で
// 判定したパターン ID を返す。ロジックは logic.js の queryWordPair と等価。
export function patternIdFast(g, gOff, W, aOff, bOff) {
  let f0 = 0; // ans1 の消費済み位置ビットマスク
  let f1 = 0;
  let correctMask = 0;
  for (let i = 0; i < 5; i++) {
    const c = g[gOff + i];
    if (c === W[aOff + i]) {
      correctMask |= 1 << i;
      f0 |= 1 << i;
    } else if (c === W[bOff + i]) {
      correctMask |= 1 << i;
      f1 |= 1 << i;
    }
  }
  let id = 0;
  for (let i = 0; i < 5; i++) {
    if (correctMask & (1 << i)) {
      id += 2 * POW3[i];
      continue;
    }
    const c = g[gOff + i];
    for (let j = 0; j < 5; j++) {
      if (i === j) continue;
      if (!(f0 & (1 << j)) && c === W[aOff + j]) {
        id += POW3[i];
        f0 |= 1 << j;
        break;
      }
      if (!(f1 & (1 << j)) && c === W[bOff + j]) {
        id += POW3[i];
        f1 |= 1 << j;
        break;
      }
    }
  }
  return id;
}

// 再現可能な乱数（mulberry32）
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// パターン分布 counts からエントロピー(bit)を計算
function entropyOfCounts(counts, total) {
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

// 提案として評価する Guess 候補（単語文字列の配列）を選ぶ。
// 候補リストが小さければ全部、大きければ「やさしい語 + 頻度上位語 + ランダム」。
function buildSuggestionPool(candWords, cap, rng) {
  if (candWords.length <= cap) return candWords.slice();
  const pool = [];
  const seen = new Set();
  const push = (w) => {
    if (!seen.has(w) && pool.length < cap) {
      seen.add(w);
      pool.push(w);
    }
  };
  EASY_WORDS.forEach(push);
  for (const idx of FREQ_ORDER) {
    if (pool.length >= cap * 0.8) break;
    push(ALL_WORDS[idx]);
  }
  let guard = 0;
  while (pool.length < cap && guard++ < cap * 20) {
    push(candWords[Math.floor(rng() * candWords.length)]);
  }
  return pool;
}

/**
 * ゲーム 1 つ分の分析を実行する。
 * @param {object} params  { pid, mode, guessWords, truePatternIds, shownPatternIds }
 *   - truePatternIds: 真の判定のパターン ID 配列（computeTruePatternIds で作る）
 *   - shownPatternIds: プレイヤーに表示されたパターン（uso のみ真と異なる）
 * @param {function} onProgress (ratio 0..1, label)
 */
export function analyzeGame(params, onProgress = () => {}) {
  const { pid, mode, guessWords, truePatternIds } = params;
  const shownPatternIds = mode === "uso" ? params.shownPatternIds : truePatternIds;
  const L = ANALYSIS_LIMITS;
  const candWords = candidateWordsForPID(pid);
  const N = candWords.length;
  const totalPairs = N * (N - 1);
  const W = encodeWords(candWords);
  const guessBytes = encodeWords(guessWords);

  // ---- 候補ペア集合の初期化（必要ならサンプリング）----
  const sampled = totalPairs > L.MAX_EXACT_PAIRS;
  const enumCount = sampled ? L.SAMPLE_PAIRS : totalPairs;
  const scale = totalPairs / enumCount;
  const rng = makeRng(pid ^ 0x5f3759df);
  let alive = new Uint32Array(enumCount); // ペアを a * N + b で持つ
  if (sampled) {
    for (let k = 0; k < enumCount; k++) {
      const a = Math.floor(rng() * N);
      let b = Math.floor(rng() * (N - 1));
      if (b >= a) b++;
      alive[k] = a * N + b;
    }
  } else {
    let k = 0;
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        if (a !== b) alive[k++] = a * N + b;
      }
    }
  }

  const turns = [];
  for (let t = 0; t < guessWords.length; t++) {
    onProgress(t / guessWords.length, `ターン ${t + 1} / ${guessWords.length} を分析中`);
    const gOff = t * 5;
    const shown = shownPatternIds[t];
    const before = alive.length;

    // (1) このターン開始時点の集合で、より良い単語の提案を評価
    const suggestions = evaluateSuggestions(alive, guessWords[t], t);

    // (2) 実際の Guess のパターン分布（期待情報量）と絞り込みを同時に行う
    const counts = new Float64Array(243);
    const survivors = [];
    for (let k = 0; k < before; k++) {
      const code = alive[k];
      const a = (code / N) | 0;
      const b = code % N;
      const patt = patternIdFast(guessBytes, gOff, W, a * 5, b * 5);
      if (mode === "uso") {
        // 嘘モード: 表示は真の判定と全位置で異なる嘘。
        // 生き残り条件: 真パターンが表示パターンと全位置で不一致。
        // 分布は「表示されうる嘘」全 32 通り（各 1/32）で数える。
        accumulateLiePatterns(counts, patt);
        if (allPositionsDiffer(patt, shown)) survivors.push(code);
      } else {
        counts[patt]++;
        if (patt === shown) survivors.push(code);
      }
    }
    alive = Uint32Array.from(survivors);
    const after = alive.length;

    turns.push({
      word: guessWords[t],
      shownPattern: shown,
      truePattern: truePatternIds[t],
      before: Math.round(before * scale),
      after: Math.round(after * scale),
      bitsGained: after > 0 ? Math.log2(before / after) : Math.log2(before || 1),
      expectedBits: entropyOfCounts(counts, before),
      maxBits: Math.log2(Math.round(before * scale) || 1),
      suggestions,
    });
  }

  onProgress(1, "完了");
  return { pid, mode, candListSize: N, initialPairs: totalPairs, sampled, turns };

  // ---- 内部ヘルパ ----

  function allPositionsDiffer(pattA, pattB) {
    for (let i = 0; i < 5; i++) {
      if (DIGITS[pattA * 5 + i] === DIGITS[pattB * 5 + i]) return false;
    }
    return true;
  }

  // 嘘パターン分布への寄与: 真パターン patt に対し、各位置で真以外の 2 状態を
  // とる 32 通りへ 1/32 ずつ加算する。
  function accumulateLiePatterns(counts, patt) {
    let ids = [0];
    for (let i = 0; i < 5; i++) {
      const trueDigit = DIGITS[patt * 5 + i];
      const opts = [];
      for (let d = 0; d < 3; d++) if (d !== trueDigit) opts.push(d * POW3[i]);
      const next = new Array(ids.length * 2);
      let w = 0;
      for (const base of ids) {
        next[w++] = base + opts[0];
        next[w++] = base + opts[1];
      }
      ids = next;
    }
    for (const id of ids) counts[id] += 1 / 32;
  }

  // このターン開始時点の候補集合で、各 Guess 候補の期待情報量を評価する。
  // uso モードでも「真の判定パターンの分布」で評価する（嘘のノイズは含めない）。
  function evaluateSuggestions(aliveSet, playedWord, turnIndex) {
    if (aliveSet.length < 2) return { list: [], playedExpectedBits: 0, playedRank: null, evalPairs: aliveSet.length };
    let evalPairs = aliveSet;
    if (aliveSet.length > L.SUGGEST_PAIR_CAP) {
      const rng2 = makeRng((pid + turnIndex * 7919) ^ 0x9e3779b9);
      const picked = new Uint32Array(L.SUGGEST_PAIR_CAP);
      for (let k = 0; k < picked.length; k++) picked[k] = aliveSet[Math.floor(rng2() * aliveSet.length)];
      evalPairs = picked;
    }
    const rng3 = makeRng(pid ^ 0xc0ffee);
    const pool = buildSuggestionPool(candWords, L.SUGGEST_GUESS_CAP, rng3);
    if (!pool.includes(playedWord)) pool.push(playedWord);
    const poolBytes = encodeWords(pool);
    const total = evalPairs.length;
    const counts = new Float64Array(243);
    const scored = [];
    for (let gi = 0; gi < pool.length; gi++) {
      counts.fill(0);
      const gOff = gi * 5;
      for (let k = 0; k < total; k++) {
        const code = evalPairs[k];
        const a = (code / N) | 0;
        const b = code % N;
        counts[patternIdFast(poolBytes, gOff, W, a * 5, b * 5)]++;
      }
      scored.push({ word: pool[gi], expectedBits: entropyOfCounts(counts, total) });
    }
    scored.sort((x, y) => y.expectedBits - x.expectedBits);
    const playedIdx = scored.findIndex((s) => s.word === playedWord);
    return {
      list: scored.slice(0, L.SUGGEST_TOP),
      playedExpectedBits: playedIdx >= 0 ? scored[playedIdx].expectedBits : 0,
      playedRank: playedIdx >= 0 ? playedIdx + 1 : null,
      evalPairs: total,
    };
  }
}
