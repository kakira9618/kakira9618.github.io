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
//   }

import { loadJSON, saveJSON, onExternalChange } from "./store.js";
import { Logic } from "./logic.js";
import { isDailyPID } from "./problems.js";

export const MODES = {
  normal: { key: "normal", title: "DWORDle", maxGuess: 10 },
  uso: { key: "uso", title: "DWORDlie", maxGuess: 15 },
};

let history = null; // startTime 昇順の配列（キャッシュ）

// 別タブが履歴を書き換えたらキャッシュを捨て、次の保存で他タブの記録を巻き戻さないようにする
onExternalChange("history", () => {
  history = null;
});

function ensureLoaded() {
  if (history === null) {
    history = loadJSON("history", []);
    history.sort((a, b) => a.startTime - b.startTime);
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

export function addFinishedGame(record) {
  ensureLoaded();
  record.clear = computeClear(record);
  // startTime 衝突（同秒開始）は 1 秒ずらして一意にする
  while (history.some((g) => g.startTime === record.startTime && g.gameMode === record.gameMode)) {
    record.startTime++;
  }
  history.push(record);
  history.sort((a, b) => a.startTime - b.startTime);
  persist();
  return record;
}

export function addImportedGames(records) {
  ensureLoaded();
  let added = 0;
  for (const rec of records) {
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

// mode の全履歴から PID -> { played, cleared, times: [startTime...] } を作る
export function buildProblemStatus(mode) {
  const map = new Map();
  for (const g of ensureLoaded()) {
    if (g.gameMode !== mode) continue;
    let st = map.get(g.problemID);
    if (!st) {
      st = { played: 0, cleared: 0, times: [] };
      map.set(g.problemID, st);
    }
    st.played++;
    if (g.clear) st.cleared++;
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
  const times = [];
  for (const g of games) {
    count++;
    times.push(g.startTime);
    if (g.clear) {
      win++;
      if (hist[g.guessWord.length] !== undefined) hist[g.guessWord.length]++;
    }
  }
  if (count === 0) {
    return { count: 0, win: 0, currentStreak: 0, maxStreak: 0, hist };
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
  return { count, win, currentStreak, maxStreak, hist };
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
