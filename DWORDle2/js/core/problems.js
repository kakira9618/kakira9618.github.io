// 問題番号 (PID) と語彙リストの対応。
//
// 出題セットが 2 つある。表示上の番号（1-39999）は共通で、接頭辞で見分ける。
//
// - No.n   : 新出題。splitmix32 で 2 語を独立に引く（logic.js 参照）。これが既定
// - Cls.n  : 旧出題（Classic）。原作 DWORDle 互換の LCG。v2.1.0 までの出題そのまま
//
// 内部 PID は 2 つのセットで重ならないよう、新出題側に NEW_OFFSET を足して持つ。
// 旧出題の PID を据え置くことで、リリース済みの履歴・実績・エクスポート JSON を
// 一切書き換えずに「今までの No.123 = Cls.123」として読み替えられる。
//
// - 1-9999           : Cls. やさしい（原作 DWORDle の Easy と同一の出題）
// - 10000-19999      : Cls. 極・全語彙（原作 DWORDle の Hard と同一の出題）
// - 20000-39999      : Cls. レベル別（DWORDle 2 で追加した帯）
// - 100001-139999    : 新出題（表示番号 + NEW_OFFSET。帯の並びは上と同じ）
// - YYYYMMDD         : デイリー問題（1000000 より大きい PID。やさしい語彙）
//
// 原作と同じ Cls. 番号は必ず同じ問題になるよう、リスト内容・順序を変更しないこと。

import { ALL_WORDS, EASY_WORDS } from "../data/words.js?v=20260728-a";
import { FREQ_ORDER } from "../data/levels.js?v=20260728-a";

export const PID = {
  EASY_MIN: 1,
  EASY_MAX: 9999,
  HARD_MIN: 10000,
  HARD_MAX: 19999,
  LEVEL_MIN: 20000,
  LEVEL_MAX: 39999,
  LEVEL_SPAN: 5000, // 1 レベルあたりの問題数
  NUMBER_MAX: 39999, // 表示番号の上限（両セット共通）
  NEW_OFFSET: 100000, // 新出題の内部 PID = 表示番号 + これ。100 の倍数なので 100 問ブロックの区切りも揃う
  DAILY_THRESHOLD: 1000000, // これより大きい PID はデイリー
};

// 新出題への切り替え。デイリーはこの日付の問題から新アルゴリズムになり、
// 同じ瞬間から Cls.（旧出題）のプレイは実績の対象外になる。
//
// デイリーの判定を「現在時刻 >= X」ではなく「PID（日付そのもの）>= X」で行うのが要点。
// 時計やタイムゾーンで同じ日付の答えが変わると、全員で同じ問題を解く前提と、
// 履歴からの再現（分析画面・実績の再集計）が崩れる。
export const NEW_ERA = {
  dailyFromPID: 20260801,
  // 実績カットオフ（秒）。レコードの startTime / endTime と同じ単位・ローカル基準で比べる
  achievementCutoffSec: Math.floor(new Date(2026, 7, 1, 0, 0, 0, 0).getTime() / 1000),
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
    // Object.freeze してはいけない。凍結した配列は V8 で低速な要素種別に落ち、
    // Logic#pickAns の candWords.slice() が 35 倍遅くなる（8000 語で 0.006ms → 0.21ms）。
    // 起動時の実績再集計は履歴 1 件ごとに new Logic() するため、履歴 3000 件で
    // 34ms → 577ms まで悪化する。呼び出し側は必ずコピーしてから触ること。
    topKCache.set(topK, list);
  }
  return topKCache.get(topK);
}

export function isDailyPID(pid) {
  return pid > PID.DAILY_THRESHOLD;
}

// 旧出題（Cls.）か。リリース済みの履歴に入っている PID はすべてこちら。
export function isClassicPID(pid) {
  return Number.isInteger(pid) && pid >= PID.EASY_MIN && pid <= PID.NUMBER_MAX;
}

export function isNewPID(pid) {
  return Number.isInteger(pid) && pid > PID.NEW_OFFSET && pid <= PID.NEW_OFFSET + PID.NUMBER_MAX;
}

// 内部 PID から表示上の番号へ。デイリーは番号を持たないのでそのまま返す。
export function problemNumber(pid) {
  return isNewPID(pid) ? pid - PID.NEW_OFFSET : pid;
}

// 表示上の番号から内部 PID へ。classic を指定しないと新出題として解釈する。
export function pidForNumber(number, classic = false) {
  return classic ? number : number + PID.NEW_OFFSET;
}

export function numberPrefix(classic) {
  return classic ? "Cls." : "No.";
}

// この PID の出題に新しい乱数を使うか。デイリーは日付、それ以外はセットで決まる。
export function usesNewGenerator(pid) {
  return isDailyPID(pid) ? pid >= NEW_ERA.dailyFromPID : isNewPID(pid);
}

// 0 は問題番号として無効。かつて「今日のデイリー」への入力エイリアスだったので、
// 古い履歴に混ざっていることがある（レコードに残ると別問題として扱われてしまう）。
export function isValidPID(pid) {
  if (!Number.isInteger(pid)) return false;
  if (isDailyPID(pid)) return true;
  return isClassicPID(pid) || isNewPID(pid);
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
  const number = problemNumber(pid);
  return LEVELS.find((lv) => number >= lv.range[0] && number <= lv.range[1]) ?? null;
}

// PID に対応する「答え候補リスト」。原作 WordList.setList() 互換 + レベル拡張。
// 候補リストは新旧の出題セットで共通（変えるのは引き方だけ）。
export function candidateWordsForPID(pid) {
  if (isDailyPID(pid)) return EASY_WORDS;
  const number = problemNumber(pid);
  if (number < PID.HARD_MIN) return EASY_WORDS;
  if (number <= PID.HARD_MAX) return ALL_WORDS;
  const level = levelForPID(pid);
  if (!level) return ALL_WORDS;
  return wordsForTopK(level.topK);
}

// レベルの表示番号の範囲を内部 PID の範囲にする（一覧・ランダム選択用）
export function pidRangeForLevel(level, classic = false) {
  return [pidForNumber(level.range[0], classic), pidForNumber(level.range[1], classic)];
}

// レベルと 0 始まりの連番から PID を作る（レベル選択 UI 用）
export function pidForLevelIndex(level, index, classic = false) {
  const [lo, hi] = pidRangeForLevel(level, classic);
  return lo + (index % (hi - lo + 1));
}

export function pidLabel(pid) {
  if (isDailyPID(pid)) {
    return `Daily ${String(pid).slice(0, 4)}-${String(pid).slice(4, 6)}-${String(pid).slice(6, 8)}`;
  }
  return `${numberPrefix(isClassicPID(pid))}${problemNumber(pid)}`;
}
