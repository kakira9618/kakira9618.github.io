// 実績システム。通常 30 種 + 隠し 10 種。
//
// 解放判定はイベント駆動:
//   - checkOnGameFinish(ctx): ゲーム終了時（ctx はこのファイル冒頭のコメント参照）
//   - checkOnEvent(type): 分析モード使用・履歴移行などの単発イベント
// 新規解放された実績の配列を返すので、呼び出し側がトースト表示する。
//
// icon は js/ui/icons.js のアイコン名、color はバッジのアクセント色。
// hidden: true の実績は、解放するまで名前・説明が「？？？」表示になる。
//
// ctx = {
//   record,        // 終了したゲームレコード（clear 済みフィールド付き）
//   results,       // 真の判定履歴 [["correct",...], ...]
//   durationSec,   // プレイ時間（秒）
//   endDate,       // 終了時刻の Date
//   maxGuess,      // そのモードの最大手数
//   hadLostBefore, // この問題で過去に敗北していたか
// }

import { loadJSON, saveJSON } from "./store.js";
import { isDailyPID, PID } from "./problems.js";
import { totalWins, totalPlays, currentWinStreak, dailyClearStreak, getHistory } from "./records.js";
import { CELL, Logic } from "./logic.js";

const RECONCILE_VERSION = 2;

export const ACHIEVEMENTS = [
  // --- 入門 ---
  { id: "first-play", icon: "footprints", color: "#8fd3ff", name: "はじめの一歩", desc: "初めてゲームを最後までプレイする" },
  { id: "first-clear", icon: "trophy", color: "#ffd166", name: "初勝利", desc: "初めてクリアする" },
  { id: "daily-clear", icon: "calendar", color: "#7bd88f", name: "今日の一問", desc: "デイリー問題をクリアする" },
  // --- 難易度・モード ---
  { id: "extreme-clear", icon: "mountain", color: "#ff8c66", name: "語彙の深淵", desc: "極 (No.10000-19999) の問題を 1 問クリアする" },
  { id: "level-clear", icon: "compass", color: "#66e0d5", name: "開拓者", desc: "レベル問題 (No.20000-39999) を 1 問クリアする" },
  { id: "uso-clear", icon: "mask", color: "#ff5f8f", name: "嘘を見抜く", desc: "裏モード DWORDlie をクリアする" },
  { id: "uso-5", icon: "layers", color: "#ff7aa8", name: "嘘マスター", desc: "裏モード DWORDlie で通算 5 勝する" },
  // --- 手数 ---
  { id: "one-shot", icon: "bolt", color: "#ffe066", name: "神の一手", desc: "1 手目でクリアする" },
  { id: "two-shot", icon: "eye", color: "#c9a0ff", name: "エスパー", desc: "2 手以内にクリアする" },
  { id: "within-4", icon: "target", color: "#ff9f66", name: "早解き名人", desc: "4 手以内にクリアする" },
  { id: "last-gasp", icon: "hourglass", color: "#a0b8d0", name: "土壇場", desc: "最終手でクリアする" },
  // --- 連勝・通算 ---
  { id: "streak-3", icon: "wave", color: "#66c7ff", name: "波に乗って", desc: "3 連勝する" },
  { id: "streak-5", icon: "flame", color: "#ff9a5c", name: "連勝街道", desc: "5 連勝する" },
  { id: "streak-10", icon: "crown", color: "#ffd700", name: "無敗神話", desc: "10 連勝する" },
  { id: "wins-10", icon: "star", color: "#ffe680", name: "勝ち星コレクター", desc: "通算 10 勝する" },
  { id: "wins-50", icon: "shield", color: "#9fd8a8", name: "歴戦の勇者", desc: "通算 50 勝する" },
  { id: "wins-100", icon: "gem", color: "#7ee8ff", name: "レジェンド", desc: "通算 100 勝する" },
  { id: "plays-100", icon: "book", color: "#d8b88f", name: "習うより慣れろ", desc: "通算 100 回プレイする" },
  // --- 盤面の模様 ---
  { id: "all-gray", icon: "cloud", color: "#a8b0bd", name: "完全なる空振り", desc: "1 回の Guess で 5 文字すべて灰色になる" },
  { id: "rainbow", icon: "palette", color: "#ffb3de", name: "三色盛り", desc: "1 回の Guess で緑・黄・灰をすべて出す" },
  { id: "green-start", icon: "rocket", color: "#8fffb0", name: "ロケットスタート", desc: "初手で緑を 3 つ以上出す" },
  { id: "green-zero", icon: "moon", color: "#b8c4ff", name: "大逆転", desc: "最終手まで緑が 1 つも無い状態からクリアする" },
  { id: "revenge", icon: "swords", color: "#ff8080", name: "リベンジ", desc: "一度敗北した問題をクリアする" },
  // --- 時間 ---
  { id: "speed-60", icon: "gauge", color: "#7cf5ff", name: "スピードスター", desc: "開始から 60 秒以内にクリアする" },
  { id: "slow-10", icon: "clock", color: "#c8b8a0", name: "熟考の人", desc: "10 分以上かけてクリアする" },
  { id: "night-owl", icon: "nightMoon", color: "#9a8fff", name: "真夜中のワードラー", desc: "深夜 0 時〜4 時にクリアする" },
  { id: "daily-7", icon: "flag", color: "#8fd88f", name: "週間皆勤", desc: "デイリー問題を 7 日連続でクリアする" },
  // --- その他 ---
  { id: "analyst", icon: "flask", color: "#66ffc2", name: "アナリスト", desc: "分析モードを使う" },
  { id: "migrator", icon: "box", color: "#d0a878", name: "引っ越し完了", desc: "旧作からプレイ履歴を移行する" },
  { id: "collector", icon: "medal", color: "#ffcf5c", name: "実績ハンター", desc: "実績を 15 個解放する" },

  // --- 隠し実績（解放するまで内容非公開）---
  { id: "h-mirror", hidden: true, icon: "mirror", color: "#c0e8ff", name: "鏡の言葉", desc: "回文になっている単語を Guess する" },
  { id: "h-phantom", hidden: true, icon: "ghost", color: "#baffc9", name: "幻の正解", desc: "正解ではない単語を Guess して、全部緑を出す" },
  { id: "h-anagram", hidden: true, icon: "shuffle", color: "#ffd8a0", name: "並べ替えの妙", desc: "直前の Guess のアナグラム（同じ文字構成の別単語）を Guess する" },
  { id: "h-alphabet", hidden: true, icon: "type", color: "#a0c8ff", name: "アルファベットマラソン", desc: "すべての Guess をしりとりでつなぎ、5 手以上でクリアする" },
  { id: "h-noreuse", hidden: true, icon: "ban", color: "#e8c0ff", name: "潔癖症", desc: "3 手以上のクリアで、全 Guess を通して同じ文字を 2 度使わない" },
  { id: "h-zorome", hidden: true, icon: "dice", color: "#ffe8a0", name: "ゾロ目コレクター", desc: "ゾロ目の No.（111, 7777, 22222 など）をクリアする" },
  { id: "h-uso-green", hidden: true, icon: "sparkle", color: "#8fffd0", name: "全緑の嘘", desc: "DWORDlie で表示が 5 つとも緑になる Guess を出す" },
  { id: "h-abyss", hidden: true, icon: "skull", color: "#ff9090", name: "深淵を一撃", desc: "極 (No.10000-19999) を 4 手以内にクリアする" },
  { id: "h-lightning", hidden: true, icon: "bolt", color: "#fff0a0", name: "電光石火", desc: "3 手以上で、開始から 20 秒以内にクリアする" },
  { id: "h-lexicon", hidden: true, icon: "book", color: "#c0ffd8", name: "語彙の泉", desc: "通算 100 種類の異なる単語を Guess する" },
];

let unlocked = loadJSON("achievements", {}); // { id: unlockedAt(sec) }

export function getUnlocked() {
  return { ...unlocked };
}

export function isUnlocked(id) {
  return unlocked[id] !== undefined;
}

function unlock(id, newly) {
  if (unlocked[id] !== undefined) return;
  unlocked[id] = Math.floor(Date.now() / 1000);
  newly.push(ACHIEVEMENTS.find((a) => a.id === id));
}

// collector（メタ実績）を最後に判定して保存する
function finalize(newly) {
  if (Object.keys(unlocked).length >= 15) unlock("collector", newly);
  if (newly.length > 0) saveJSON("achievements", unlocked);
  return newly;
}

function isPalindrome(w) {
  return w === [...w].reverse().join("");
}

function isAnagram(a, b) {
  return a !== b && [...a].sort().join("") === [...b].sort().join("");
}

function isGuessWordChain(words) {
  if (!Array.isArray(words) || words.length < 5) return false;
  return words.every((word, index) => {
    if (typeof word !== "string" || word.length === 0) return false;
    if (index === 0) return true;
    const previous = words[index - 1];
    return typeof previous === "string"
      && previous.length > 0
      && previous[previous.length - 1].toLowerCase() === word[0].toLowerCase();
  });
}

function isZorome(pid) {
  const s = String(pid);
  return s.length >= 3 && [...s].every((c) => c === s[0]);
}

function maxHistoricalDailyStreak(dailyPids) {
  const days = [...new Set(dailyPids)]
    .map((pid) => {
      const s = String(pid);
      if (!/^\d{8}$/.test(s)) return null;
      const y = Number(s.slice(0, 4));
      const m = Number(s.slice(4, 6));
      const d = Number(s.slice(6, 8));
      const time = Date.UTC(y, m - 1, d);
      const check = new Date(time);
      return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
        ? time
        : null;
    })
    .filter((time) => time !== null)
    .sort((a, b) => a - b);
  let best = 0;
  let streak = 0;
  let previous = null;
  for (const day of days) {
    streak = previous !== null && day - previous === 86400000 ? streak + 1 : 1;
    best = Math.max(best, streak);
    previous = day;
  }
  return best;
}

// 保存済み履歴だけから判定可能な実績 ID を復元する。
// 分析モード利用など、履歴に情報が残らない条件は対象外。
export function achievementIdsFromHistory(records) {
  const games = records
    .filter((record) => Array.isArray(record?.guessWord) && record.guessWord.length > 0)
    .slice()
    .sort((a, b) => a.startTime - b.startTime);
  const ids = new Set();
  if (games.length === 0) return ids;

  ids.add("first-play");
  if (games.some((record) => record.imported)) ids.add("migrator");
  if (games.length >= 100) ids.add("plays-100");

  const words = new Set();
  const dailyClears = [];
  const lostProblems = new Set();
  const winStreak = { normal: 0, uso: 0 };
  let wins = 0;
  let usoWins = 0;

  for (const record of games) {
    const mode = record.gameMode === "uso" ? "uso" : "normal";
    const pid = record.problemID;
    const guesses = record.guessWord.length;
    const cleared = Boolean(record.clear);
    const problemKey = `${mode}:${pid}`;
    const lettersUsed = new Set(record.guessWord.join(""));
    record.guessWord.forEach((word) => words.add(word));

    let logic = null;
    let results = [];
    try {
      logic = new Logic(pid);
      results = record.guessWord.map((word) => logic.queryWord(word));
    } catch {
      // 壊れた履歴が混ざっていても、通算数など判定可能な実績は復元を続ける。
    }

    for (let turn = 0; turn < results.length; turn++) {
      const row = results[turn];
      const greens = row.filter((state) => state === CELL.CORRECT).length;
      const yellows = row.filter((state) => state === CELL.USED).length;
      const grays = row.filter((state) => state === CELL.UNUSED).length;
      if (grays === 5) ids.add("all-gray");
      if (greens > 0 && yellows > 0 && grays > 0) ids.add("rainbow");
      if (turn === 0 && greens >= 3) ids.add("green-start");
      if (greens === 5 && logic && !logic.isGameClear(record.guessWord[turn])) ids.add("h-phantom");
    }

    for (let turn = 0; turn < record.guessWord.length; turn++) {
      const word = record.guessWord[turn];
      if (word && isPalindrome(word)) ids.add("h-mirror");
      if (turn > 0 && isAnagram(record.guessWord[turn - 1], word)) ids.add("h-anagram");
    }
    if (
      mode === "uso" &&
      Array.isArray(record.usoResults) &&
      record.usoResults.some((row) => Array.isArray(row) && row.every((state) => state === CELL.CORRECT))
    ) {
      ids.add("h-uso-green");
    }

    if (!cleared) {
      lostProblems.add(problemKey);
      winStreak[mode] = 0;
      continue;
    }

    ids.add("first-clear");
    wins++;
    if (mode === "uso") {
      usoWins++;
      ids.add("uso-clear");
    }
    if (isDailyPID(pid)) {
      ids.add("daily-clear");
      dailyClears.push(pid);
    }
    if (mode === "normal" && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX) {
      ids.add("extreme-clear");
      if (guesses <= 4) ids.add("h-abyss");
    }
    if (mode === "normal" && pid >= PID.LEVEL_MIN && pid <= PID.LEVEL_MAX) ids.add("level-clear");

    if (guesses === 1) ids.add("one-shot");
    if (guesses <= 2) ids.add("two-shot");
    if (guesses <= 4) ids.add("within-4");
    if (guesses === (mode === "uso" ? 15 : 10)) ids.add("last-gasp");
    if (
      guesses >= 3 &&
      results.length === guesses &&
      !results.slice(0, -1).some((row) => row.includes(CELL.CORRECT))
    ) {
      ids.add("green-zero");
    }
    if (lostProblems.has(problemKey)) ids.add("revenge");

    const startTime = Number(record.startTime);
    const endTime = Number(record.endTime);
    const durationKnown = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime;
    if (durationKnown) {
      const durationSec = endTime - startTime;
      if (durationSec <= 60) ids.add("speed-60");
      if (durationSec >= 600) ids.add("slow-10");
      if (guesses >= 3 && durationSec <= 20) ids.add("h-lightning");
    }
    const completedAt = Number.isFinite(endTime) && endTime > 0 ? endTime : startTime;
    if (Number.isFinite(completedAt)) {
      const hour = new Date(completedAt * 1000).getHours();
      if (hour >= 0 && hour < 4) ids.add("night-owl");
    }

    if (isZorome(pid)) ids.add("h-zorome");
    if (isGuessWordChain(record.guessWord)) ids.add("h-alphabet");
    if (guesses >= 3 && lettersUsed.size === guesses * 5) ids.add("h-noreuse");

    winStreak[mode]++;
    if (winStreak[mode] >= 3) ids.add("streak-3");
    if (winStreak[mode] >= 5) ids.add("streak-5");
    if (winStreak[mode] >= 10) ids.add("streak-10");
  }

  if (wins >= 10) ids.add("wins-10");
  if (wins >= 50) ids.add("wins-50");
  if (wins >= 100) ids.add("wins-100");
  if (usoWins >= 5) ids.add("uso-5");
  if (words.size >= 100) ids.add("h-lexicon");
  if (maxHistoricalDailyStreak(dailyClears) >= 7) ids.add("daily-7");
  return ids;
}

export function reconcileAchievementsFromHistory() {
  const inferred = achievementIdsFromHistory(getHistory());
  const newly = [];
  for (const achievement of ACHIEVEMENTS) {
    if (inferred.has(achievement.id)) unlock(achievement.id, newly);
  }
  return finalize(newly);
}

// この機能を導入する前に移行済みだった履歴も、更新後の初回起動で一度だけ復元する。
export function reconcileAchievementsOnce() {
  if (loadJSON("achievements.reconcileVersion", 0) >= RECONCILE_VERSION) return [];
  const newly = reconcileAchievementsFromHistory();
  saveJSON("achievements.reconcileVersion", RECONCILE_VERSION);
  return newly;
}

export function checkOnGameFinish(ctx) {
  const newly = [];
  const { record, results, durationSec, endDate, maxGuess, hadLostBefore } = ctx;
  const pid = record.problemID;
  const isUso = record.gameMode === "uso";
  const guesses = record.guessWord.length;
  const logic = new Logic(pid);

  unlock("first-play", newly);
  if (totalPlays() >= 100) unlock("plays-100", newly);

  // 盤面の模様（勝敗に関係なく判定）
  for (let t = 0; t < results.length; t++) {
    const row = results[t];
    const greens = row.filter((s) => s === CELL.CORRECT).length;
    const yellows = row.filter((s) => s === CELL.USED).length;
    const grays = row.filter((s) => s === CELL.UNUSED).length;
    if (grays === 5) unlock("all-gray", newly);
    if (greens > 0 && yellows > 0 && grays > 0) unlock("rainbow", newly);
    if (t === 0 && greens >= 3) unlock("green-start", newly);
    // 隠し: 2 語の文字を位置ごとに組み合わせて全緑になったが、正解語そのものではない。
    if (greens === 5 && !logic.isGameClear(record.guessWord[t])) unlock("h-phantom", newly);
  }

  // 隠し: Guess の単語そのものに関するもの（勝敗不問）
  for (let t = 0; t < record.guessWord.length; t++) {
    const w = record.guessWord[t];
    if (isPalindrome(w)) unlock("h-mirror", newly);
    if (t > 0 && isAnagram(record.guessWord[t - 1], w)) unlock("h-anagram", newly);
  }
  const lettersUsed = new Set(record.guessWord.join(""));
  if (isUso && Array.isArray(record.usoResults)) {
    if (record.usoResults.some((row) => row.every((s) => s === CELL.CORRECT))) {
      unlock("h-uso-green", newly);
    }
  }
  // 隠し: 通算 100 種類の単語（全モード・移行分も含む）
  {
    const words = new Set();
    for (const g of getHistory()) for (const w of g.guessWord) words.add(w);
    if (words.size >= 100) unlock("h-lexicon", newly);
  }

  if (record.clear) {
    unlock("first-clear", newly);
    if (isDailyPID(pid)) unlock("daily-clear", newly);
    if (!isUso && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX) unlock("extreme-clear", newly);
    if (!isUso && pid >= PID.LEVEL_MIN && pid <= PID.LEVEL_MAX) unlock("level-clear", newly);
    if (isUso) {
      unlock("uso-clear", newly);
      if (totalWins("uso") >= 5) unlock("uso-5", newly);
    }

    if (guesses === 1) unlock("one-shot", newly);
    if (guesses <= 2) unlock("two-shot", newly);
    if (guesses <= 4) unlock("within-4", newly);
    if (guesses === maxGuess) unlock("last-gasp", newly);

    // 最終手より前に緑が 1 つも無かったか
    const greenBefore = results.slice(0, -1).some((row) => row.includes(CELL.CORRECT));
    if (!greenBefore && guesses >= 3) unlock("green-zero", newly);

    if (hadLostBefore) unlock("revenge", newly);
    if (durationSec <= 60) unlock("speed-60", newly);
    if (durationSec >= 600) unlock("slow-10", newly);
    const h = endDate.getHours();
    if (h >= 0 && h < 4) unlock("night-owl", newly);
    if (dailyClearStreak() >= 7) unlock("daily-7", newly);

    const streak = currentWinStreak(record.gameMode);
    if (streak >= 3) unlock("streak-3", newly);
    if (streak >= 5) unlock("streak-5", newly);
    if (streak >= 10) unlock("streak-10", newly);

    const wins = totalWins();
    if (wins >= 10) unlock("wins-10", newly);
    if (wins >= 50) unlock("wins-50", newly);
    if (wins >= 100) unlock("wins-100", newly);

    // 隠し（クリア時のみ）
    if (isZorome(pid)) unlock("h-zorome", newly);
    if (isGuessWordChain(record.guessWord)) unlock("h-alphabet", newly);
    if (!isUso && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX && guesses <= 4) unlock("h-abyss", newly);
    if (guesses >= 3 && durationSec <= 20) unlock("h-lightning", newly);
    if (guesses >= 3 && lettersUsed.size === guesses * 5) unlock("h-noreuse", newly);
  }

  return finalize(newly);
}

// type: "analysis" | "migrate"
export function checkOnEvent(type) {
  const newly = [];
  if (type === "analysis") unlock("analyst", newly);
  if (type === "migrate") unlock("migrator", newly);
  return finalize(newly);
}
