// 実績システム。通常 50 種 + 隠し 20 種。
//
// 同日・同問題の再プレイ（achievementCountableRecords のカウント対象外）では、
// カウント系実績に加えて隠し実績も判定しない（答えを知った再プレイでの稼ぎ防止）。
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

import { loadJSON, saveJSON, onExternalChange } from "./store.js";
import { isDailyPID, PID } from "./problems.js";
import { getHistory, getExtraShot } from "./records.js";
import { CELL, Logic } from "./logic.js";
import { isDebugMode } from "./debug.js";

// v6: h-play-streak-365 → h-play-streak-30 の緩和を既存ユーザーの履歴にも適用する
const RECONCILE_VERSION = 6;
export const COLLECTOR_REQUIREMENT = 30;

// 実績画面の見出しに使うカテゴリ。ACHIEVEMENTS はこの順に並べる
export const ACHIEVEMENT_CATEGORIES = [
  { id: "basic", ja: "入門", en: "Getting Started" },
  { id: "wins", ja: "勝利・連勝", en: "Wins & Streaks" },
  { id: "speed", ja: "手数・スピード", en: "Guesses & Speed" },
  { id: "habit", ja: "毎日の継続", en: "Daily Habits" },
  { id: "volume", ja: "やり込み", en: "Dedication" },
  { id: "board", ja: "盤面の模様", en: "Board Patterns" },
  { id: "modes", ja: "モード・難易度", en: "Modes & Difficulty" },
  { id: "calendar", ja: "時の記念", en: "Calendar" },
  { id: "misc", ja: "その他", en: "Miscellaneous" },
];

export const ACHIEVEMENTS = [
  // --- 入門 ---
  { id: "first-play", cat: "basic", icon: "footprints", color: "#8fd3ff", name: "はじめの一歩", desc: "初めてゲームを最後までプレイする" },
  { id: "first-clear", cat: "basic", icon: "trophy", color: "#ffd166", name: "初勝利", desc: "初めてクリアする" },
  { id: "daily-clear", cat: "basic", icon: "calendar", color: "#7bd88f", name: "今日の一問", desc: "デイリー問題をクリアする" },
  // --- 勝利・連勝 ---
  { id: "wins-10", cat: "wins", icon: "star", color: "#ffe680", name: "勝ち星コレクター", desc: "通算 10 勝する" },
  { id: "wins-50", cat: "wins", icon: "shield", color: "#9fd8a8", name: "歴戦の勇者", desc: "通算 50 勝する" },
  { id: "wins-100", cat: "wins", icon: "gem", color: "#7ee8ff", name: "レジェンド", desc: "通算 100 勝する" },
  { id: "wins-200", cat: "wins", icon: "trophy", color: "#ffb860", name: "生ける伝説", desc: "通算 200 勝する" },
  { id: "streak-3", cat: "wins", icon: "wave", color: "#66c7ff", name: "波に乗って", desc: "3 連勝する" },
  { id: "streak-5", cat: "wins", icon: "flame", color: "#ff9a5c", name: "連勝街道", desc: "5 連勝する" },
  { id: "streak-10", cat: "wins", icon: "crown", color: "#ffd700", name: "無敗神話", desc: "10 連勝する" },
  { id: "revenge", cat: "wins", icon: "swords", color: "#ff8080", name: "リベンジ", desc: "一度敗北した問題をクリアする" },
  // --- 手数・スピード ---
  { id: "one-shot", cat: "speed", icon: "bolt", color: "#ffe066", name: "神の一手", desc: "1 手目でクリアする" },
  { id: "two-shot", cat: "speed", icon: "eye", color: "#c9a0ff", name: "エスパー", desc: "2 手以内にクリアする" },
  { id: "within-4", cat: "speed", icon: "target", color: "#ff9f66", name: "早解き名人", desc: "4 手以内にクリアする" },
  { id: "last-gasp", cat: "speed", icon: "hourglass", color: "#a0b8d0", name: "土壇場", desc: "最終手でクリアする" },
  { id: "speed-60", cat: "speed", icon: "gauge", color: "#7cf5ff", name: "スピードスター", desc: "開始から 60 秒以内にクリアする" },
  { id: "slow-10", cat: "speed", icon: "clock", color: "#c8b8a0", name: "熟考の人", desc: "10 分以上かけてクリアする" },
  // --- 毎日の継続（Streak）---
  { id: "play-streak-3", cat: "habit", icon: "footprints", color: "#a8e8c0", name: "三日坊主卒業", desc: "3 日連続でプレイする" },
  { id: "play-streak-7", cat: "habit", icon: "calendar", color: "#88d8b8", name: "一週間の習慣", desc: "7 日連続でプレイする" },
  { id: "play-streak-14", cat: "habit", icon: "flame", color: "#ffb088", name: "二週間の熱中", desc: "14 日連続でプレイする" },
  { id: "daily-7", cat: "habit", icon: "flag", color: "#8fd88f", name: "週間皆勤", desc: "デイリー問題を 7 日連続でクリアする" },
  { id: "daily-streak-30", cat: "habit", icon: "flag", color: "#68c888", name: "月間皆勤", desc: "デイリー問題を 30 日連続でクリアする" },
  { id: "daily-30", cat: "habit", icon: "calendar", color: "#7bd88f", name: "デイリー常連", desc: "デイリー問題を通算 30 回クリアする" },
  { id: "play-days-30", cat: "habit", icon: "footprints", color: "#c8ffb0", name: "継続は力なり", desc: "通算 30 日プレイする" },
  { id: "play-days-100", cat: "habit", icon: "footprints", color: "#b0e8a0", name: "百日の歩み", desc: "通算 100 日プレイする" },
  // --- やり込み ---
  { id: "plays-30", cat: "volume", icon: "book", color: "#e6d2a8", name: "だんだん慣れてきた", desc: "通算 30 回プレイする" },
  { id: "plays-100", cat: "volume", icon: "book", color: "#d8b88f", name: "習うより慣れろ", desc: "通算 100 回プレイする" },
  { id: "plays-300", cat: "volume", icon: "book", color: "#d8c8a8", name: "盤上の住人", desc: "通算 300 回プレイする" },
  { id: "plays-500", cat: "volume", icon: "book", color: "#c8a878", name: "盤上の主", desc: "通算 500 回プレイする" },
  { id: "guesses-1000", cat: "volume", icon: "type", color: "#b8d8ff", name: "千語の探求者", desc: "通算 1000 回 Guess する" },
  { id: "guesses-3000", cat: "volume", icon: "type", color: "#9cc8ff", name: "三千語の探求者", desc: "通算 3000 回 Guess する" },
  { id: "same-day-5", cat: "volume", icon: "layers", color: "#ffcf80", name: "今日は絶好調", desc: "同じ日に 5 回クリアする" },
  // --- 盤面の模様 ---
  { id: "all-gray", cat: "board", icon: "cloud", color: "#a8b0bd", name: "完全なる空振り", desc: "1 回の Guess で 5 文字すべて灰色になる" },
  { id: "rainbow", cat: "board", icon: "palette", color: "#ffb3de", name: "三色盛り", desc: "1 回の Guess で緑・黄・灰をすべて出す" },
  { id: "green-start", cat: "board", icon: "rocket", color: "#8fffb0", name: "ロケットスタート", desc: "初手で緑を 3 つ以上出す" },
  { id: "green-zero", cat: "board", icon: "moon", color: "#b8c4ff", name: "大逆転", desc: "最終手まで緑が 1 つも無い状態からクリアする" },
  { id: "all-letters", cat: "board", icon: "type", color: "#ffd0e8", name: "アルファベット制覇", desc: "1 ゲームの Guess で A から Z まで全ての文字を使う" },
  // --- モード・難易度 ---
  { id: "uso-clear", cat: "modes", icon: "mask", color: "#ff5f8f", name: "嘘を見抜く", desc: "裏モード DWORDlie をクリアする" },
  { id: "uso-5", cat: "modes", icon: "layers", color: "#ff7aa8", name: "嘘マスター", desc: "裏モード DWORDlie で通算 5 勝する" },
  { id: "uso-20", cat: "modes", icon: "mask", color: "#ff9ab8", name: "嘘発見器", desc: "裏モード DWORDlie で通算 20 勝する" },
  { id: "extreme-clear", cat: "modes", icon: "mountain", color: "#ff8c66", name: "語彙の深淵", desc: "極 (No.10000-19999) の問題を 1 問クリアする" },
  { id: "level-clear", cat: "modes", icon: "compass", color: "#66e0d5", name: "開拓者", desc: "レベル問題 (No.20000-39999) を 1 問クリアする" },
  // --- 時の記念 ---
  { id: "night-owl", cat: "calendar", icon: "nightMoon", color: "#9a8fff", name: "真夜中のDWORDler", desc: "深夜 0 時〜4 時にクリアする" },
  { id: "early-bird", cat: "calendar", icon: "sun", color: "#ffd280", name: "早起きDWORDler", desc: "朝 5 時〜8 時にクリアする" },
  { id: "new-year", cat: "calendar", icon: "sunrise", color: "#ffb3a0", name: "初日の出DWORDler", desc: "1 月 1 日にクリアする" },
  { id: "christmas", cat: "calendar", icon: "gift", color: "#ff8f8f", name: "聖夜の贈り物", desc: "12 月 25 日にクリアする" },
  { id: "weekend", cat: "calendar", icon: "calendar", color: "#a0d8ff", name: "週末DWORDler", desc: "土曜日と日曜日の両方でクリアする（別の週でもOK）" },
  // --- その他 ---
  { id: "analyst", cat: "misc", icon: "flask", color: "#66ffc2", name: "アナリスト", desc: "分析モードを使う" },
  { id: "migrator", cat: "misc", icon: "box", color: "#d0a878", name: "引っ越し完了", desc: "プレイ履歴をインポート（移行）する" },
  { id: "collector", cat: "misc", icon: "medal", color: "#ffcf5c", name: "実績ハンター", desc: "実績を 30 個解除する" },

  // --- 隠し実績（解放するまで内容非公開）---
  { id: "h-mirror", hidden: true, icon: "mirror", color: "#c0e8ff", name: "鏡の言葉", desc: "回文になっている単語を Guess する" },
  { id: "h-phantom", hidden: true, icon: "ghost", color: "#baffc9", name: "幻の正解", desc: "正解ではない単語を Guess して、全部緑を出す" },
  { id: "h-anagram", hidden: true, icon: "shuffle", color: "#ffd8a0", name: "並べ替えの妙", desc: "直前の Guess のアナグラム（同じ文字構成の別単語）を Guess する" },
  { id: "h-alphabet", hidden: true, icon: "type", color: "#a0c8ff", name: "アルファベットマラソン", desc: "すべての Guess をしりとりでつなぎ、5 手以上でクリアする" },
  { id: "h-noreuse", hidden: true, icon: "ban", color: "#e8c0ff", name: "潔癖症", desc: "3 手以上のクリアで、全 Guess を通して同じ文字を 2 度使わない" },
  { id: "h-zorome", hidden: true, icon: "dice", color: "#ffe8a0", name: "ゾロ目コレクター", desc: "3 桁以上のゾロ目 No. を 10 種類クリアする" },
  { id: "h-uso-green", hidden: true, icon: "sparkle", color: "#8fffd0", name: "全緑の嘘", desc: "DWORDlie で表示が 5 つとも緑になる Guess を出す" },
  { id: "h-abyss", hidden: true, icon: "skull", color: "#ff9090", name: "深淵を一撃", desc: "極 (No.10000-19999) を 4 手以内にクリアする" },
  { id: "h-lightning", hidden: true, icon: "bolt", color: "#fff0a0", name: "電光石火", desc: "3 手以上で、開始から 10 秒以内にクリアする" },
  { id: "h-lexicon", hidden: true, icon: "book", color: "#c0ffd8", name: "語彙の泉", desc: "通算 1000 種類の異なる単語を Guess する" },
  { id: "h-plays-5000", hidden: true, icon: "layers", color: "#d8b8ff", name: "無限の探求", desc: "通算 5000 回プレイする" },
  { id: "h-uso-800", hidden: true, icon: "mask", color: "#ff6f9f", name: "嘘八百", desc: "裏モード DWORDlie で通算 800 勝する" },
  { id: "h-play-days-365", hidden: true, icon: "footprints", color: "#c0ffe0", name: "365 日の足跡", desc: "通算 365 日プレイする" },
  { id: "h-play-streak-30", hidden: true, icon: "sunrise", color: "#ffd890", name: "一ヶ月の誓い", desc: "30 日連続でプレイする（1 日 1 回を 30 日）" },
  { id: "h-play-days-1095", hidden: true, icon: "mountain", color: "#a0d8e8", name: "千日修行", desc: "通算 1095 日プレイする（約 3 年）" },
  { id: "h-play-days-1825", hidden: true, icon: "crown", color: "#ffe060", name: "五年の伝説", desc: "通算 1825 日プレイする（約 5 年）" },
  // EXTRA SHOT モード（クリア後の追加推理）関連
  { id: "h-double-clear", hidden: true, icon: "target", color: "#ffd166", name: "両手に花", desc: "EXTRA SHOT に成功して DOUBLE CLEAR する" },
  { id: "h-double-uso", hidden: true, icon: "eye", color: "#ff9ad0", name: "すべてお見通し", desc: "DWORDlie で DOUBLE CLEAR する（嘘の判定だけから両方の答えを見抜く）" },
  { id: "h-double-oneshot", hidden: true, icon: "bolt", color: "#ffe680", name: "神の二手", desc: "1 手クリアから DOUBLE CLEAR する（合計 2 手で両方の答えを当てる）" },
  { id: "h-double-10", hidden: true, icon: "crown", color: "#ffcf5c", name: "二兎を得る者", desc: "DOUBLE CLEAR を通算 10 回達成する" },
];

let unlocked = loadJSON("achievements", {}); // { id: unlockedAt(sec) }

// 別タブで解放された実績を取り込み、こちらの保存で巻き戻さないようにする
onExternalChange("achievements", () => {
  unlocked = { ...loadJSON("achievements", {}), ...unlocked };
});

// 旧バージョンで長期 Streak 実績を解除済みなら、後継の実績へ引き継ぐ。
// h-play-streak-365（一年の誓い）は難しすぎたため 30 日連続（一ヶ月の誓い）へ緩和。
const achievementIdMigrations = {
  "h-play-streak-1095": "h-play-days-1095",
  "h-play-streak-1825": "h-play-days-1825",
  "h-play-streak-365": "h-play-streak-30",
};
let migratedAchievementIds = false;
for (const [oldId, newId] of Object.entries(achievementIdMigrations)) {
  if (unlocked[oldId] === undefined) continue;
  if (unlocked[newId] === undefined) unlocked[newId] = unlocked[oldId];
  delete unlocked[oldId];
  migratedAchievementIds = true;
}
if (migratedAchievementIds) saveJSON("achievements", unlocked);

export function getUnlocked() {
  if (isDebugMode()) {
    const debugUnlockedAt = Math.floor(Date.now() / 1000);
    return Object.fromEntries(ACHIEVEMENTS.map((achievement) => [achievement.id, unlocked[achievement.id] ?? debugUnlockedAt]));
  }
  return { ...unlocked };
}

export function isUnlocked(id) {
  return isDebugMode() || unlocked[id] !== undefined;
}

function unlock(id, newly) {
  if (isDebugMode()) return;
  if (unlocked[id] !== undefined) return;
  unlocked[id] = Math.floor(Date.now() / 1000);
  newly.push(ACHIEVEMENTS.find((a) => a.id === id));
}

// collector（メタ実績）を最後に判定して保存する
function finalize(newly) {
  if (Object.keys(unlocked).length >= COLLECTOR_REQUIREMENT) unlock("collector", newly);
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

function clearedZoromeCount(records) {
  return new Set(
    records
      .filter((record) => record?.clear && isZorome(record.problemID))
      .map((record) => String(record.problemID))
  ).size;
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

// 連続した日数の最長記録（dayNums は「エポックからの日数」の Set）
function maxConsecutiveDays(dayNums) {
  const days = [...dayNums].sort((a, b) => a - b);
  let best = 0;
  let streak = 0;
  let previous = null;
  for (const day of days) {
    streak = previous !== null && day - previous === 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
    previous = day;
  }
  return best;
}

// 完了時刻（秒）。endTime が無い移行レコードは startTime を使う。
function completedAtSec(record) {
  const endTime = Number(record.endTime);
  if (Number.isFinite(endTime) && endTime > 0) return endTime;
  const startTime = Number(record.startTime);
  return Number.isFinite(startTime) && startTime > 0 ? startTime : null;
}

function localDayKey(record) {
  const at = completedAtSec(record);
  if (at === null) return null;
  const date = new Date(at * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// カウント系実績では、同じローカル日付・問題 No. の再プレイをモードを問わず除外する。
// 日付や問題 No. を判定できない移行レコードは、誤ってまとめないよう個別に数える。
export function achievementCountableRecords(records) {
  const seen = new Set();
  return records
    .filter((record) => Array.isArray(record?.guessWord) && record.guessWord.length > 0)
    .slice()
    .sort((a, b) => Number(a.startTime) - Number(b.startTime))
    .filter((record) => {
      const day = localDayKey(record);
      const pid = record.problemID;
      if (day === null || pid === null || pid === undefined || pid === "") return true;
      const key = `${day}:${pid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function countedWins(records, mode = null) {
  return achievementCountableRecords(records)
    .filter((record) => (!mode || record.gameMode === mode) && record.clear)
    .length;
}

function countedCurrentWinStreak(records, mode) {
  let streak = 0;
  const games = achievementCountableRecords(records)
    .filter((record) => record.gameMode === mode)
    .reverse();
  for (const game of games) {
    if (!game.clear) break;
    streak++;
  }
  return streak;
}

// 日付・カレンダー系と通算回数系の実績をまとめて判定する。
// ゲーム終了時（履歴に現在のレコードを追加した後）と履歴復元の両方から使う。
function calendarAndCountIds(records) {
  const ids = new Set();
  const playDays = new Set(); // ローカル日付ごとの「エポックからの日数」
  const winsPerDay = new Map();
  const clearedWeekdays = new Set();
  const dailyClearPids = [];
  let games = 0;
  let wins = 0;
  let guessTotal = 0;
  let usoWins = 0;

  // 日時そのものが条件の実績は、カウント対象外の再プレイでも判定する。
  for (const record of records) {
    if (!record?.clear || !Array.isArray(record.guessWord) || record.guessWord.length === 0) continue;
    const at = completedAtSec(record);
    if (at === null) continue;
    const date = new Date(at * 1000);
    clearedWeekdays.add(date.getDay());
    const hour = date.getHours();
    if (hour >= 5 && hour < 8) ids.add("early-bird");
    if (date.getMonth() === 0 && date.getDate() === 1) ids.add("new-year");
    if (date.getMonth() === 11 && date.getDate() === 25) ids.add("christmas");
  }

  const countableRecords = achievementCountableRecords(records);
  for (const record of countableRecords) {
    if (!Array.isArray(record?.guessWord) || record.guessWord.length === 0) continue;
    games++;
    guessTotal += record.guessWord.length;
    const at = completedAtSec(record);
    const date = at === null ? null : new Date(at * 1000);
    if (date) playDays.add(Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000));
    if (!record.clear) continue;
    wins++;
    if (record.gameMode === "uso") usoWins++;
    if (isDailyPID(record.problemID)) dailyClearPids.push(record.problemID);
    if (!date) continue;
    winsPerDay.set(date.toDateString(), (winsPerDay.get(date.toDateString()) ?? 0) + 1);
  }
  if (clearedWeekdays.has(0) && clearedWeekdays.has(6)) ids.add("weekend");
  if ([...winsPerDay.values()].some((dayWins) => dayWins >= 5)) ids.add("same-day-5");
  if (playDays.size >= 30) ids.add("play-days-30");
  if (playDays.size >= 100) ids.add("play-days-100");
  if (playDays.size >= 365) ids.add("h-play-days-365");
  if (playDays.size >= 1095) ids.add("h-play-days-1095");
  if (playDays.size >= 1825) ids.add("h-play-days-1825");
  const playStreak = maxConsecutiveDays(playDays);
  if (playStreak >= 3) ids.add("play-streak-3");
  if (playStreak >= 7) ids.add("play-streak-7");
  if (playStreak >= 14) ids.add("play-streak-14");
  if (playStreak >= 30) ids.add("h-play-streak-30");
  if (dailyClearPids.length >= 30) ids.add("daily-30");
  if (maxHistoricalDailyStreak(dailyClearPids) >= 30) ids.add("daily-streak-30");
  if (games >= 30) ids.add("plays-30");
  if (games >= 300) ids.add("plays-300");
  if (games >= 500) ids.add("plays-500");
  if (games >= 5000) ids.add("h-plays-5000");
  if (wins >= 200) ids.add("wins-200");
  if (guessTotal >= 1000) ids.add("guesses-1000");
  if (guessTotal >= 3000) ids.add("guesses-3000");
  if (usoWins >= 20) ids.add("uso-20");
  if (usoWins >= 800) ids.add("h-uso-800");
  return ids;
}

// 保存済み履歴だけから判定可能な実績 ID を復元する。
// 分析モード利用など、履歴に情報が残らない条件は対象外。
// noAchievements 付きレコード（「実績は解除しない」を選んだインポート）は判定に使わない。
export function achievementIdsFromHistory(records) {
  const games = records
    .filter((record) => Array.isArray(record?.guessWord) && record.guessWord.length > 0 && !record.noAchievements)
    .slice()
    .sort((a, b) => a.startTime - b.startTime);
  const ids = new Set();
  if (games.length === 0) return ids;
  const countableGames = achievementCountableRecords(games);
  const countableGameSet = new Set(countableGames);

  ids.add("first-play");
  if (games.some((record) => record.imported)) ids.add("migrator");
  if (countableGames.length >= 100) ids.add("plays-100");

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
    const countable = countableGameSet.has(record);
    const problemKey = `${mode}:${pid}`;
    const lettersUsed = new Set(record.guessWord.join(""));
    if (countable) record.guessWord.forEach((word) => words.add(word));

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
      // 隠し実績は同日・同問題の再プレイ（カウント対象外）では判定しない
      if (countable && greens === 5 && logic && !logic.isGameClear(record.guessWord[turn])) ids.add("h-phantom");
    }

    if (countable) {
      for (let turn = 0; turn < record.guessWord.length; turn++) {
        const word = record.guessWord[turn];
        if (word && isPalindrome(word)) ids.add("h-mirror");
        if (turn > 0 && isAnagram(record.guessWord[turn - 1], word)) ids.add("h-anagram");
      }
    }
    if (lettersUsed.size >= 26) ids.add("all-letters");
    if (
      countable &&
      mode === "uso" &&
      Array.isArray(record.usoResults) &&
      record.usoResults.some((row) => Array.isArray(row) && row.every((state) => state === CELL.CORRECT))
    ) {
      ids.add("h-uso-green");
    }

    if (!cleared) {
      lostProblems.add(problemKey);
      if (countable) winStreak[mode] = 0;
      continue;
    }

    ids.add("first-clear");
    if (countable) wins++;
    if (mode === "uso") {
      if (countable) usoWins++;
      ids.add("uso-clear");
    }
    if (isDailyPID(pid)) {
      ids.add("daily-clear");
      if (countable) dailyClears.push(pid);
    }
    if (mode === "normal" && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX) {
      ids.add("extreme-clear");
      if (countable && guesses <= 4) ids.add("h-abyss");
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
      if (countable && guesses >= 3 && durationSec <= 10) ids.add("h-lightning");
    }
    const completedAt = Number.isFinite(endTime) && endTime > 0 ? endTime : startTime;
    if (Number.isFinite(completedAt)) {
      const hour = new Date(completedAt * 1000).getHours();
      if (hour >= 0 && hour < 4) ids.add("night-owl");
    }

    if (countable && isGuessWordChain(record.guessWord)) ids.add("h-alphabet");
    if (countable && guesses >= 3 && lettersUsed.size === guesses * 5) ids.add("h-noreuse");

    // EXTRA SHOT（同日・同問題の再プレイは答えを知っているので判定しない）
    if (countable && getExtraShot(record)?.success) {
      ids.add("h-double-clear");
      if (mode === "uso") ids.add("h-double-uso");
      if (guesses === 1) ids.add("h-double-oneshot");
    }

    if (countable) {
      winStreak[mode]++;
      if (winStreak[mode] >= 3) ids.add("streak-3");
      if (winStreak[mode] >= 5) ids.add("streak-5");
      if (winStreak[mode] >= 10) ids.add("streak-10");
    }
  }

  if (wins >= 10) ids.add("wins-10");
  if (wins >= 50) ids.add("wins-50");
  if (wins >= 100) ids.add("wins-100");
  if (usoWins >= 5) ids.add("uso-5");
  if (countableGames.filter((g) => g.clear && getExtraShot(g)?.success).length >= 10) ids.add("h-double-10");
  if (words.size >= 1000) ids.add("h-lexicon");
  if (clearedZoromeCount(countableGames) >= 10) ids.add("h-zorome");
  if (maxHistoricalDailyStreak(dailyClears) >= 7) ids.add("daily-7");
  for (const id of calendarAndCountIds(games)) ids.add(id);
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
  const history = getHistory();
  const countableHistory = achievementCountableRecords(history);
  // 同日・同問題の再プレイか（achievementCountableRecords と同じ「その日の初回だけ」基準）。
  // 答えを知った再プレイでチャレンジ系の隠し実績を稼げないよう、隠し実績は初回プレイだけ判定する。
  const countablePlay = (() => {
    const day = localDayKey(record);
    if (day === null || pid === null || pid === undefined || pid === "") return true;
    return !history.some(
      (g) =>
        g !== record &&
        Array.isArray(g?.guessWord) &&
        g.guessWord.length > 0 &&
        Number(g.startTime) < Number(record.startTime) &&
        String(g.problemID) === String(pid) &&
        localDayKey(g) === day
    );
  })();

  unlock("first-play", newly);
  if (countableHistory.length >= 100) unlock("plays-100", newly);

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
    if (countablePlay && greens === 5 && !logic.isGameClear(record.guessWord[t])) unlock("h-phantom", newly);
  }

  // 隠し: Guess の単語そのものに関するもの（勝敗不問・初回プレイのみ）
  if (countablePlay) {
    for (let t = 0; t < record.guessWord.length; t++) {
      const w = record.guessWord[t];
      if (isPalindrome(w)) unlock("h-mirror", newly);
      if (t > 0 && isAnagram(record.guessWord[t - 1], w)) unlock("h-anagram", newly);
    }
  }
  const lettersUsed = new Set(record.guessWord.join(""));
  if (lettersUsed.size >= 26) unlock("all-letters", newly);
  if (countablePlay && isUso && Array.isArray(record.usoResults)) {
    if (record.usoResults.some((row) => row.every((s) => s === CELL.CORRECT))) {
      unlock("h-uso-green", newly);
    }
  }
  // 隠し: 通算 1000 種類の単語（全モード・移行分も含む）
  {
    const words = new Set();
    for (const g of countableHistory) for (const w of g.guessWord) words.add(w);
    if (words.size >= 1000) unlock("h-lexicon", newly);
  }

  if (record.clear) {
    unlock("first-clear", newly);
    if (isDailyPID(pid)) unlock("daily-clear", newly);
    if (!isUso && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX) unlock("extreme-clear", newly);
    if (!isUso && pid >= PID.LEVEL_MIN && pid <= PID.LEVEL_MAX) unlock("level-clear", newly);
    if (isUso) {
      unlock("uso-clear", newly);
      if (countedWins(history, "uso") >= 5) unlock("uso-5", newly);
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
    const dailyClearPids = countableHistory
      .filter((game) => game.clear && isDailyPID(game.problemID))
      .map((game) => game.problemID);
    if (maxHistoricalDailyStreak(dailyClearPids) >= 7) unlock("daily-7", newly);

    const streak = countedCurrentWinStreak(history, record.gameMode);
    if (streak >= 3) unlock("streak-3", newly);
    if (streak >= 5) unlock("streak-5", newly);
    if (streak >= 10) unlock("streak-10", newly);

    const wins = countedWins(history);
    if (wins >= 10) unlock("wins-10", newly);
    if (wins >= 50) unlock("wins-50", newly);
    if (wins >= 100) unlock("wins-100", newly);

    // 隠し（クリア時のみ）。1 局の内容で決まるものは初回プレイのみ判定
    if (clearedZoromeCount(countableHistory) >= 10) unlock("h-zorome", newly);
    if (countablePlay) {
      if (isGuessWordChain(record.guessWord)) unlock("h-alphabet", newly);
      if (!isUso && pid >= PID.HARD_MIN && pid <= PID.HARD_MAX && guesses <= 4) unlock("h-abyss", newly);
      if (guesses >= 3 && durationSec <= 10) unlock("h-lightning", newly);
      if (guesses >= 3 && lettersUsed.size === guesses * 5) unlock("h-noreuse", newly);
    }

    // EXTRA SHOT（DOUBLE CLEAR）。答えを知った再プレイでの稼ぎ防止で初回プレイのみ判定
    if (countablePlay && getExtraShot(record)?.success) {
      unlock("h-double-clear", newly);
      if (isUso) unlock("h-double-uso", newly);
      if (guesses === 1) unlock("h-double-oneshot", newly);
    }
    if (countableHistory.filter((g) => g.clear && getExtraShot(g)?.success).length >= 10) {
      unlock("h-double-10", newly);
    }
  }

  // 日付・回数系（record は履歴に保存済みなので、現在のゲームも集計に含まれる）
  for (const id of calendarAndCountIds(getHistory())) unlock(id, newly);

  return finalize(newly);
}

// type: "analysis" | "migrate"
export function checkOnEvent(type) {
  const newly = [];
  if (type === "analysis") unlock("analyst", newly);
  if (type === "migrate") unlock("migrator", newly);
  return finalize(newly);
}
