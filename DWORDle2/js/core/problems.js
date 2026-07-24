// 問題番号 (PID) と語彙リストの対応。
//
// - No.0            : 入力用エイリアス（今日のデイリー問題に変換される）
// - No.1-9999       : やさしい問題（原作 DWORDle の Easy と同一の出題）
// - No.10000-19999  : 極・全語彙問題（原作 DWORDle の Hard と同一の出題）
// - No.20000-39999  : レベル別問題（本作の新規領域。5000 問ごとにレベルが上がる）
// - No.YYYYMMDD     : デイリー問題（1000000 より大きい PID。やさしい語彙）
//
// 原作と同じ No. は必ず同じ問題になるよう、リスト内容・順序を変更しないこと。

import { ALL_WORDS, EASY_WORDS } from "../data/words.js?v=20260723-fa";
import { FREQ_ORDER } from "../data/levels.js?v=20260723-fa";

export const PID = {
  DAILY_ALIAS: 0,
  EASY_MIN: 1,
  EASY_MAX: 9999,
  HARD_MIN: 10000,
  HARD_MAX: 19999,
  LEVEL_MIN: 20000,
  LEVEL_MAX: 39999,
  LEVEL_SPAN: 5000, // 1 レベルあたりの問題数
  DAILY_THRESHOLD: 1000000, // これより大きい PID はデイリー
};

// レベル定義。topK はレベル別候補リストに使う頻度上位語数（levels.js 参照）。
// range が既存帯のものは原作互換。順序・値を変更しないこと。
export const LEVELS = [
  { id: 1, key: "easy", name: "やさしい", nameEn: "Easy", desc: "だれでも知っている単語だけ", descEn: "Familiar everyday words", range: [PID.EASY_MIN, PID.EASY_MAX], topK: null },
  { id: 2, key: "common", name: "ふつう", nameEn: "Normal", desc: "よく見かける単語まで", descEn: "Commonly seen words", range: [20000, 24999], topK: 750 },
  { id: 3, key: "middle", name: "やや難", nameEn: "Tricky", desc: "少しひねった単語まで", descEn: "Some less obvious words", range: [25000, 29999], topK: 1800 },
  { id: 4, key: "hard", name: "難しい", nameEn: "Hard", desc: "辞書で引くレベルの単語まで", descEn: "Words you may need to look up", range: [30000, 34999], topK: 4000 },
  { id: 5, key: "mania", name: "マニア", nameEn: "Expert", desc: "英語マニア向けの単語まで", descEn: "For serious word enthusiasts", range: [35000, 39999], topK: 8000 },
  { id: 6, key: "extreme", name: "極", nameEn: "Extreme", desc: "全 14847 語。人智を超えろ", descEn: "All 14,847 words. Go beyond reason", range: [PID.HARD_MIN, PID.HARD_MAX], topK: Infinity },
];

// ---- レベル別候補リストの構築（決定的・不変） ----

const rankOfIndex = new Map(); // ALL_WORDS の index -> 頻度順位
FREQ_ORDER.forEach((wordIndex, rank) => rankOfIndex.set(wordIndex, rank));

const topKCache = new Map();
function wordsForTopK(topK) {
  if (topK === Infinity) return ALL_WORDS;
  if (!topKCache.has(topK)) {
    // ALL_WORDS の順序を保ったまま、頻度上位 topK 語だけを抜き出す
    const list = ALL_WORDS.filter((_, i) => {
      const rank = rankOfIndex.get(i);
      return rank !== undefined && rank < topK;
    });
    topKCache.set(topK, Object.freeze(list));
  }
  return topKCache.get(topK);
}

export function isDailyPID(pid) {
  return pid > PID.DAILY_THRESHOLD;
}

// No.0（デイリーエイリアス）は入力時に todayPID() へ変換される一時的な表記であり、
// プレイ・保存される PID としては無効（レコードに混入すると別問題として扱われてしまう）。
export function isValidPID(pid) {
  if (!Number.isInteger(pid)) return false;
  if (isDailyPID(pid)) return true;
  return pid >= PID.EASY_MIN && pid <= PID.LEVEL_MAX;
}

// 今日のデイリー PID（例: 2026年7月20日 -> 20260720）。原作互換（ローカル日付）。
export function todayPID(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return parseInt(`${y}${m}${d}`, 10);
}

export function levelForPID(pid) {
  if (isDailyPID(pid)) return LEVELS[0]; // デイリーはやさしい語彙
  return LEVELS.find((lv) => pid >= lv.range[0] && pid <= lv.range[1]) ?? null;
}

// PID に対応する「答え候補リスト」。原作 WordList.setList() 互換 + レベル拡張。
export function candidateWordsForPID(pid) {
  if (pid < 10000 || isDailyPID(pid)) return EASY_WORDS;
  if (pid <= PID.HARD_MAX) return ALL_WORDS;
  const level = levelForPID(pid);
  if (!level) return ALL_WORDS;
  return wordsForTopK(level.topK);
}

// レベルと 0 始まりの連番から PID を作る（レベル選択 UI 用）
export function pidForLevelIndex(level, index) {
  return level.range[0] + (index % (level.range[1] - level.range[0] + 1));
}

export function pidLabel(pid) {
  return isDailyPID(pid) ? `Daily ${String(pid).slice(0, 4)}-${String(pid).slice(4, 6)}-${String(pid).slice(6, 8)}` : `No.${pid}`;
}
