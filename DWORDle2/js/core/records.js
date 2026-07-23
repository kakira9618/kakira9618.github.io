// プレイ履歴・進行中ゲーム・統計の管理。
//
// レコード形式（原作 history.json のゲームオブジェクトの互換スーパーセット）:
//   {
//     startTime: 秒, endTime: 秒,
//     gameMode: "normal" | "uso",
//     problemID: number,
//     guessWord: ["about", ...],
//     usoResults: [["correct",...], ...]  // uso のみ（表示された嘘の判定）
//     clear: boolean,                     // キャッシュ。guessWord から再計算可能
//     imported: "auto" | "json" | undefined, // 旧作から移行したレコードの印
//     extraShot: { word, success, result? } | undefined, // v2 追加スキーマ: EXTRA SHOT の
//       // 追加推理（クリア時のみ発生しうる）。success ならDOUBLE CLEAR。
//       // result はその場で表示した判定。DWORDlie のランダムな嘘も再現するため保存する。
//       // 旧キー finalAnswer は読込時に extraShot へ移行する。
//   }

import { loadJSON, saveJSON, onExternalChange } from "./store.js";
import { Logic, CELL, queryWordSingle } from "./logic.js";
import { isDailyPID } from "./problems.js";

export const MODES = {
  normal: { key: "normal", title: "DWORDle", maxGuess: 10 },
  uso: { key: "uso", title: "DWORDlie", maxGuess: 15 },
};

let history = null; // startTime 昇順の配列（キャッシュ）

// 旧バージョンの finalAnswer レコードも、その場で失わず EXTRA SHOT として扱う。
export function getExtraShot(record) {
  return record?.extraShot ?? record?.finalAnswer ?? null;
}

const FEEDBACK_STATES = new Set([CELL.UNUSED, CELL.USED, CELL.CORRECT]);

// 新形式はプレイ時に表示した判定をそのまま返す。旧形式には result が無いため、
// 当時の「残る答え 1 語だけで真の判定」という仕様を再現して互換表示する。
export function getExtraShotResult(record, logic = new Logic(record.problemID)) {
  const attempt = getExtraShot(record);
  if (!attempt?.word) return null;
  if (
    Array.isArray(attempt.result) &&
    attempt.result.length === 5 &&
    attempt.result.every((state) => FEEDBACK_STATES.has(state))
  ) {
    return attempt.result.slice();
  }
  const lastWord = record.guessWord?.[record.guessWord.length - 1];
  const target = lastWord ? logic.otherAnswer(lastWord) : null;
  return target ? queryWordSingle(attempt.word, target) : null;
}

export function normalizeExtraShotRecord(record) {
  if (!record || typeof record !== "object") return record;
  const extraShot = getExtraShot(record);
  if (!("finalAnswer" in record) && (extraShot === null || record.extraShot === extraShot)) return record;
  const normalized = { ...record };
  delete normalized.finalAnswer;
  if (extraShot !== null) normalized.extraShot = extraShot;
  return normalized;
}

// 別タブが履歴を書き換えたらキャッシュを捨て、次の保存で他タブの記録を巻き戻さないようにする
onExternalChange("history", () => {
  history = null;
});

function ensureLoaded() {
  if (history === null) {
    const loaded = loadJSON("history", []);
    history = loaded.map(normalizeExtraShotRecord);
    history.sort((a, b) => a.startTime - b.startTime);
    // 一度読み込んだ旧履歴は新キーで保存し直す。以後のエクスポートも extraShot になる。
    if (history.some((record, index) => record !== loaded[index])) persist();
  }
  return history;
}

function persist() {
  saveJSON("history", history);
}

export function getHistory() {
  return ensureLoaded();
}

// 新しい順のプレイ一覧（履歴閲覧モード用）
export function getRecentGames(mode = null) {
  return ensureLoaded()
    .filter((g) => (mode ? g.gameMode === mode : true))
    .slice()
    .reverse();
}

export function findGame(startTime, gameMode) {
  return ensureLoaded().find((g) => g.startTime === startTime && g.gameMode === gameMode) ?? null;
}

export function computeClear(record) {
  if (record.guessWord.length === 0) return false;
  const logic = new Logic(record.problemID);
  return logic.isGameClear(record.guessWord[record.guessWord.length - 1]);
}

// タイトルメニューの段階解放用のプレイ回数。実績のカウントと違い、
// 同日・同じ問題の再プレイも数える。旧作からのインポート（imported 付き）は数えない。
export function countPlays() {
  const saved = loadJSON("playCount", null);
  if (saved !== null) return saved;
  // 既存ユーザーは手元の実プレイ数（インポート除く）をそのまま引き継ぐ
  const n = ensureLoaded().filter((g) => !g.imported).length;
  saveJSON("playCount", n);
  return n;
}

export function addFinishedGame(record) {
  ensureLoaded();
  record = normalizeExtraShotRecord(record);
  // 追加前にカウンタを初期化しておく（履歴からの初期化で今回の分を二重に数えない）
  const playsBefore = countPlays();
  record.clear = computeClear(record);
  // startTime 衝突（同秒開始）は 1 秒ずらして一意にする
  while (history.some((g) => g.startTime === record.startTime && g.gameMode === record.gameMode)) {
    record.startTime++;
  }
  history.push(record);
  history.sort((a, b) => a.startTime - b.startTime);
  persist();
  saveJSON("playCount", playsBefore + 1);
  return record;
}

export function addImportedGames(records) {
  ensureLoaded();
  let added = 0;
  for (let rec of records) {
    rec = normalizeExtraShotRecord(rec);
    // (startTime, gameMode) は findGame・結果画面 URL のキーなので一意にする。
    // 別 problemID と衝突したら 1 秒ずつずらす。ずらした先に同じ problemID の
    // レコードが見つかった場合は、過去のインポートで移動済みの重複なのでスキップする。
    let dup = false;
    for (;;) {
      const existing = history.find((g) => g.startTime === rec.startTime && g.gameMode === rec.gameMode);
      if (!existing) break;
      if (existing.problemID === rec.problemID) {
        dup = true;
        break;
      }
      rec.startTime++;
    }
    if (dup) continue;
    rec.clear = computeClear(rec);
    history.push(rec);
    added++;
  }
  if (added > 0) {
    history.sort((a, b) => a.startTime - b.startTime);
    persist();
  }
  return added;
}

// ---- 進行中ゲーム（モードごとに 1 つ）----

export function getCurrentGame(mode) {
  return loadJSON(`current.${mode}`, null);
}

export function saveCurrentGame(game) {
  saveJSON(`current.${game.gameMode}`, game);
}

export function clearCurrentGame(mode) {
  saveJSON(`current.${mode}`, null);
}

// ---- 問題ごとのプレイ状況（問題一覧モード用）----

// mode の全履歴から PID -> { played, cleared, doubleClears, times: [startTime...] } を作る
export function buildProblemStatus(mode) {
  const map = new Map();
  for (const g of ensureLoaded()) {
    if (g.gameMode !== mode) continue;
    let st = map.get(g.problemID);
    if (!st) {
      st = { played: 0, cleared: 0, doubleClears: 0, times: [] };
      map.set(g.problemID, st);
    }
    st.played++;
    if (g.clear) st.cleared++;
    if (g.clear && getExtraShot(g)?.success) st.doubleClears++;
    st.times.push(g.startTime);
  }
  return map;
}

export function isAlreadyPlayed(pid, mode) {
  return ensureLoaded().some((g) => g.gameMode === mode && g.problemID === pid);
}

// ---- 統計（原作 RecordManager.getStatistics の考え方を踏襲、モード別に集計）----

export function getStatistics(mode) {
  const maxGuess = MODES[mode].maxGuess;
  const games = ensureLoaded().filter((g) => g.gameMode === mode);
  const hist = {};
  for (let i = 1; i <= maxGuess; i++) hist[i] = 0;

  let count = 0;
  let win = 0;
  let doubleClear = 0; // EXTRA SHOT 成功（DOUBLE CLEAR）の回数
  const times = [];
  for (const g of games) {
    count++;
    times.push(g.startTime);
    if (g.clear) {
      win++;
      if (getExtraShot(g)?.success) doubleClear++;
      if (hist[g.guessWord.length] !== undefined) hist[g.guessWord.length]++;
    }
  }
  if (count === 0) {
    return { count: 0, win: 0, doubleClear: 0, currentStreak: 0, maxStreak: 0, hist };
  }

  // 連続プレイ日数（原作互換: プレイした日付列で隣接日差が 2 日未満なら継続）
  const days = Array.from(new Set(times.sort((a, b) => a - b).map((t) => new Date(t * 1000).toLocaleDateString())));
  let currentStreak = 1;
  let maxStreak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
    if (diff < 2) currentStreak++;
    else currentStreak = 1;
    maxStreak = Math.max(maxStreak, currentStreak);
  }
  return { count, win, doubleClear, currentStreak, maxStreak, hist };
}

// 直近の勝敗から連勝数を数える（実績用）
export function currentWinStreak(mode) {
  let streak = 0;
  for (const g of getRecentGames(mode)) {
    if (g.clear) streak++;
    else break;
  }
  return streak;
}

export function totalWins(mode = null) {
  return ensureLoaded().filter((g) => (mode ? g.gameMode === mode : true) && g.clear).length;
}

export function totalPlays(mode = null) {
  return ensureLoaded().filter((g) => (mode ? g.gameMode === mode : true)).length;
}

// デイリー問題の連続クリア日数（実績用）。今日または昨日を起点に遡る。
export function dailyClearStreak() {
  const clearedDaily = new Set(
    ensureLoaded()
      .filter((g) => g.clear && isDailyPID(g.problemID))
      .map((g) => g.problemID)
  );
  const pidOf = (d) =>
    parseInt(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`,
      10
    );
  const day = new Date();
  if (!clearedDaily.has(pidOf(day))) day.setDate(day.getDate() - 1); // 今日が未クリアなら昨日起点
  let streak = 0;
  while (clearedDaily.has(pidOf(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

// ---- エクスポート ----

export function exportJSON() {
  return JSON.stringify({ app: "dwordle2", version: 1, exportedAt: Math.floor(Date.now() / 1000), history: ensureLoaded() }, null, 2);
}

// テスト用: キャッシュ破棄
export function _reload() {
  history = null;
}
