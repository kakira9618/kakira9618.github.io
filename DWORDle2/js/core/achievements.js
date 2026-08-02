// 実績システム。通常 50 種 + 隠し 20 種。
//
// 同日・同問題の再プレイ（achievementCountableRecords のカウント対象外）では、
// カウント系実績に加えて隠し実績と、1 手/2 手クリア・幻の正解のように答えを知っていれば
// 狙える実績も判定しない（答えを知った再プレイでの稼ぎ防止）。
// 途中で破棄したゲームは一切の実績判定から除外し、その日の同じ問題の後続プレイも
// すべての実績判定から除外する。
//
// 解放判定はイベント駆動:
//   - checkOnGameFinish(ctx): ゲーム終了時（ctx はこのファイル冒頭のコメント参照）
//   - checkOnEvent(type): 分析モード使用・履歴移行などの単発イベント
// 新規解放された実績の配列を返すので、呼び出し側がトースト表示する。
//
// 隠し実績は「何個あるか」もプレイヤーには伏せる。実績画面には解放済みの隠し実績だけを並べ、
// 進捗表示は通常実績の「15 / 50」に解放済みの隠し実績を「+ 3」として添える
// （achievementProgress() 参照）。
//
// icon は js/ui/icons.js のアイコン名、color はバッジのアクセント色。
// 同じアイコンを共有する系列（嘘系の仮面、やり込みの本など）は、色相を変えて見分けられる
// ようにする。系列の最下位と最上位だけは元の色で揃え、最上位には glow: true を付けて
// バッジを光らせる（解除後のみ光る）。
// hidden: true の実績は、解放するまで名前・説明が「？？？」表示になる。
// 隠し実績の名前と条件は、ソースの全文検索で条件が割れないよう reveal() で包んで持つ
// （符号化は `node tools/make-secret.mjs encode "<文章>"`。js/core/secret.js 参照）。
//
// ctx = {
//   record,        // 終了したゲームレコード（clear 済みフィールド付き）
//   results,       // 真の判定履歴 [["correct",...], ...]
//   durationSec,   // プレイ時間（秒）
//   endDate,       // 終了時刻の Date
//   maxGuess,      // そのモードの最大手数
//   hadLostBefore, // この問題で過去に敗北していたか
// }

import { loadJSON, saveJSON, onExternalChange } from "./store.js?v=20260803-b";
import { isClassicPID, isDailyPID, NEW_ERA, PID, problemNumber } from "./problems.js?v=20260803-b";
import { getHistory, getExtraShot, MODES } from "./records.js?v=20260803-b";
import { CELL, Logic } from "./logic.js?v=20260803-b";
import { isDebugMode } from "./debug.js?v=20260803-b";
import { reveal } from "./secret.js?v=20260803-b";
import { MARK, signAchievement, verifyAchievementMark } from "./achievement-mark.js?v=20260803-b";

// v7: 月間皆勤（30 日）→ 二週間皆勤（14 日）の緩和を既存履歴にも適用する
// v8: 無限の探求の緩和（5000 → 1000 回）と、新設した DOUBLE CLEAR 系実績を既存履歴に適用する
const RECONCILE_VERSION = 8;
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
  { id: "wins-200", glow: true, cat: "wins", icon: "trophy", color: "#ffb860", name: "生ける伝説", desc: "通算 200 勝する" },
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
  { id: "play-streak-3", cat: "habit", icon: "footprints", color: "#ffb088", name: "三日坊主卒業", desc: "3 日連続でプレイする" },
  { id: "play-streak-7", cat: "habit", icon: "calendar", color: "#ffc857", name: "一週間の習慣", desc: "7 日連続でプレイする" },
  { id: "play-streak-14", cat: "habit", icon: "flame", color: "#e08cff", name: "二週間の熱中", desc: "14 日連続でプレイする" },
  { id: "daily-7", cat: "habit", icon: "flag", color: "#8fd88f", name: "週間皆勤", desc: "デイリー問題を 7 日連続でクリアする" },
  { id: "daily-streak-14", glow: true, cat: "habit", icon: "flag", color: "#8fd88f", name: "二週間皆勤", desc: "デイリー問題を 14 日連続でクリアする" },
  { id: "daily-30", glow: true, cat: "habit", icon: "calendar", color: "#7bd88f", name: "デイリー常連", desc: "デイリー問題を通算 30 回クリアする" },
  { id: "play-days-30", cat: "habit", icon: "footprints", color: "#c8ffb0", name: "継続は力なり", desc: "通算 30 日プレイする" },
  { id: "play-days-100", glow: true, cat: "habit", icon: "footprints", color: "#c8ffb0", name: "百日の歩み", desc: "通算 100 日プレイする" },
  // --- やり込み ---
  { id: "plays-30", cat: "volume", icon: "book", color: "#e6d2a8", name: "だんだん慣れてきた", desc: "通算 30 回プレイする" },
  { id: "plays-100", cat: "volume", icon: "book", color: "#8fd3ff", name: "習うより慣れろ", desc: "通算 100 回プレイする" },
  { id: "plays-300", cat: "volume", icon: "book", color: "#b8a0ff", name: "盤上の住人", desc: "通算 300 回プレイする" },
  { id: "plays-500", glow: true, cat: "volume", icon: "book", color: "#e6d2a8", name: "盤上の主", desc: "通算 500 回プレイする" },
  { id: "guesses-1000", cat: "volume", icon: "type", color: "#b8d8ff", name: "千語の探求者", desc: "通算 1000 回 Guess する" },
  { id: "guesses-3000", glow: true, cat: "volume", icon: "type", color: "#b8d8ff", name: "三千語の探求者", desc: "通算 3000 回 Guess する" },
  { id: "same-day-5", cat: "volume", icon: "layers", color: "#ffcf80", name: "今日は絶好調", desc: "同じ日に 5 回クリアする" },
  // --- 盤面の模様 ---
  { id: "all-gray", cat: "board", icon: "cloud", color: "#a8b0bd", name: "完全なる空振り", desc: "1 回の Guess で 5 文字すべて灰色になる" },
  { id: "rainbow", cat: "board", icon: "palette", color: "#ffb3de", name: "三色盛り", desc: "1 回の Guess で緑・黄・灰をすべて出す" },
  { id: "green-start", cat: "board", icon: "rocket", color: "#8fffb0", name: "ロケットスタート", desc: "初手で緑を 3 つ以上出す" },
  { id: "green-zero", cat: "board", icon: "moon", color: "#b8c4ff", name: "大逆転", desc: "3 手以上で、最終手より前に緑を 1 つも出さずにクリアする" },
  { id: "h-phantom", cat: "board", icon: "ghost", color: "#baffc9", name: "幻の正解", desc: "正解ではない単語を Guess して、全部緑を出す" },
  // --- モード・難易度 ---
  { id: "uso-clear", cat: "modes", icon: "mask", color: "#ff5f8f", name: "嘘を見抜く", desc: "裏モード DWORDlie をクリアする" },
  { id: "uso-5", cat: "modes", icon: "mask", color: "#ffc857", name: "嘘マスター", desc: "裏モード DWORDlie で通算 5 勝する" },
  { id: "uso-20", cat: "modes", icon: "mask", color: "#7cd7ff", name: "嘘発見器", desc: "裏モード DWORDlie で通算 20 勝する" },
  { id: "extreme-clear", cat: "modes", icon: "mountain", color: "#ff8c66", name: "語彙の深淵", desc: "極 (No.10000-19999) の問題を 1 問クリアする" },
  { id: "level-clear", cat: "modes", icon: "compass", color: "#66e0d5", name: "開拓者", desc: "レベル問題 (No.20000-39999) を 1 問クリアする" },
  // --- 時の記念 ---
  { id: "night-owl", cat: "calendar", icon: "nightMoon", color: "#9a8fff", name: "真夜中のDWORDler", desc: "深夜 0:00〜3:59 にクリアする" },
  { id: "early-bird", cat: "calendar", icon: "sun", color: "#ffd280", name: "早起きDWORDler", desc: "朝 5:00〜7:59 にクリアする" },
  { id: "new-year", cat: "calendar", icon: "sunrise", color: "#ffb3a0", name: "初日の出DWORDler", desc: "1 月 1 日にクリアする" },
  { id: "christmas", cat: "calendar", icon: "gift", color: "#ff8f8f", name: "聖夜の贈り物", desc: "12 月 25 日にクリアする" },
  { id: "weekend", cat: "calendar", icon: "calendar", color: "#a0d8ff", name: "週末DWORDler", desc: "土曜日と日曜日の両方でクリアする（別の週でもOK）" },
  // --- その他 ---
  { id: "analyst", cat: "misc", icon: "flask", color: "#66ffc2", name: "アナリスト", desc: "分析モードを使う" },
  { id: "migrator", cat: "misc", icon: "box", color: "#d0a878", name: "引っ越し完了", desc: "プレイ履歴をインポート（移行）する" },
  { id: "collector", cat: "misc", icon: "medal", color: "#ffcf5c", name: "実績ハンター", desc: "実績を 30 個解除する" },

  // --- 隠し実績（解放するまで内容非公開）---
  { id: "h-mirror", hidden: true, icon: "mirror", color: "#c0e8ff", name: reveal("0vLzSpdqgDm7lcMg"), desc: reveal("3ubMT4BDixCQntMD9UXLcrrbsSiSJ+oa3vDKQbxaixOpXRXcc7cbsdj8y0qUTw==") },
  { id: "all-letters", hidden: true, icon: "type", color: "#ffd0e8", name: reveal("2P/wSpVvixKuntAI9Ufxcrj+sSqeIeAn09vV"), desc: reveal("Cl2xK6Qn6y3Y/vJKl2pI1k4YIdo2J+k2GzxySpdPixOyXQiJ9UXWcrratyy+J+k32Pz8T4BDjTysntA78nnXcrr7") },
  { id: "h-anagram", hidden: true, icon: "shuffle", color: "#ffd8a0", name: reveal("38X0Spd9jgqEntMh9UXGdJ3k"), desc: reveal("3ObmTJ9JixCVXRXcc7cbsdj8/EqUZosSsZ7QGfVHwXK43b0VniH4Hdj8yk+AQ408rJv1IvBM+HK607chsyHlCdPXzEaqTYsTqV0V3HO3G7HY/MtKlE8=") },
  { id: "h-alphabet", hidden: true, icon: "type", color: "#d0a0ff", name: reveal("2P/wSpVvixKuntAI9Ufxcrj+sSqeJ+sP2P77SpR5ixKI"), desc: reveal("2PzLSpd9ixCdntMHNoMd9EgOckqUVosQrJ7QI/VFwHK597EosSfpNdj8+EqXSosRukhyT59PjCqemeoj9UXPcrnSsSq8J+oz2PzLSpRP") },
  { id: "h-noreuse", hidden: true, icon: "ban", color: "#e8c0ff", name: reveal("3cDGTo9Sjwa8"), desc: reveal("CF20IJ0g0zTfxdhKl2qLE5Se0QP1RspyutqxKZch7TkbOifMZbdIcrnvuymMJ+kG2Pz0TIZIixCjm8Qu82n/crnvcps2IdI338DtSpRLixCRntMt") },
  { id: "h-zorome", hidden: true, icon: "dice", color: "#ffe8a0", name: reveal("2P/sSpVpjwqVntAa9UfEcrnSsSupJ+st"), desc: reveal("CF20CJcg0zTfxdhKl2qLE4We0QTxX8axdRJ8ifVG+rEKTXJOvmqBMKWe0Ab1R8Jyud+xKI8n6ho=") },
  { id: "h-uso-green", hidden: true, icon: "sparkle", color: "#8fffd0", name: reveal("3vj6TqFVixCVmMox"), desc: reveal("fyod+1KoAfQbntMO/mXAdp/HsSia5F2x2Pz2SpdsixO5muU49UXDcrrXsSud5C/kXg4hifVG+nS8x7Eojw==") },
  { id: "h-abyss", hidden: true, icon: "skull", color: "#ff9090", name: reveal("3crjT6FxixOpmeop8Fbr"), desc: reveal("3djniT6KB78KTWKZJulZqAJEa4A2J+oDG0lyT59PjCqemNQs9UXDcrnSsSq8J+oz2PzLSpRP") },
  { id: "h-lightning", hidden: true, icon: "bolt", color: "#b0ffd0", name: reveal("0ubpTJNNjw6ImtMC"), desc: reveal("CF20IJ0g0zTfxdhKl2OLEbqUxCLzY+NyuvaxK5/kWaEbmvU78n/NdL34sSi9J+o+2P74SpRmixCintAi") },
  { id: "h-lexicon", hidden: true, icon: "book", color: "#c0ffd8", name: reveal("09fMTKtdixCVm+Eg"), desc: reveal("0v3ITrhTSKALTWKJ8WzGeJrjsSi4I/0h2Pz4SpRPjRyjlfg39Ub6sXwIN9pl5IsQop7QIg==") },
  { id: "h-plays-1000", hidden: true, icon: "layers", color: "#d8b8ff", name: reveal("3PnzQI9UixCVm9wL8HXq"), desc: reveal("0v3ITrhTSKALTWKJ81/2crjqsSq6J+o12PzLSpRP") },
  { id: "h-uso-800", glow: true, hidden: true, icon: "mask", color: "#ff5f8f", name: reveal("3uXKTJNvjwiF"), desc: reveal("097dSpVmixKHntEgNoA/3mk5PsBz5IsQnJTSM/Fq/7EDTWKJ80/1crrksSud") },
  { id: "h-play-days-365", hidden: true, icon: "starTrail", color: "#c0ffe0", name: reveal("CEtnT4FhixCVmPcu/nPJ"), desc: reveal("0v3ITrhTSKINSHJPgWGLEqye0QX1RsxyuuSxK50=") },
  { id: "h-play-streak-30", hidden: true, icon: "sunrise", color: "#ffd890", name: reveal("38XSSpVyjg2zntMH/m77crr5"), desc: reveal("CE1yT4FhgRGYmuQz9UXPcrjqsSq6J+o12PzLSpRP") },
  // EXTRA SHOT モード（クリア後の追加推理）関連
  { id: "h-double-clear", hidden: true, icon: "target", color: "#ffd166", name: reveal("38XzT59PixCQldgY"), desc: reveal("fiUG+1fkO9l0KXJKl2+OGauY2Db1Rf9yutty7VmRKt1+XRHlU4U6sdj8y0qUTw==") },
  { id: "h-double-uso", hidden: true, icon: "eye", color: "#ff9ad0", name: reveal("2PzLSpd9ixCdntMj/mLjeLvnsSiB"), desc: reveal("fyod+1KoAfQbntMONoAnxHkxF4lViC3QaV2xKI8n6hrUwdpMjlyLEJWY2g3zavJyut2xKIcn6RrY/9tNrmWOB4Ke0wfxafxyuvWxK4Qszhrd985Kl0uHLbI=") },
  { id: "h-double-oneshot", hidden: true, icon: "bolt", color: "#8fe3ff", name: reveal("3NjMSpdqjCu3m9si"), desc: reveal("Cl20IJ0n6j7Y/vhKlGaLELCe0CA2gCfEeTEXiVWILdBpXbEojyfqGtTB2kyGTIA5s11gifBN43K62rYRtyL+KNj8/E67UIsQs57QO/N5+3K627ErnSvUGA==") },
  { id: "h-double-10", glow: true, hidden: true, icon: "crown", color: "#ffd166", name: reveal("38feTJNKixOpmOw+9Ubjebv4"), desc: reveal("fzIH61qBSNJ3OBP7NifqA9L9yE64U0igC123Mogt6QXd9cJKl12LE7A=") },
  { id: "h-double-abyss", hidden: true, icon: "deepGem", color: "#a0d8e8", name: reveal("3crjT6FxixCVmeoI80v+crn3"), desc: reveal("3djniT6KB78KTWKZJulZqAJEa4A2J+k2Gzkd/FSILbF4MRfoROSLEKKe0CI=") },
  { id: "h-double-streak-3", hidden: true, icon: "chain", color: "#ffb0e0", name: reveal("3vLeToRjixCVlNIK/0r+"), desc: reveal("CF2xK6Qn6y3Y/vJAlmePJ6Ge0w42gCfEeTEXiVWILdBpXbEojyfqGg==") },
];

let unlocked = loadJSON("achievements", {}); // { id: unlockedAt(sec) }

// 別タブで解放された実績を取り込み、こちらの保存で巻き戻さないようにする
onExternalChange("achievements", () => {
  unlocked = { ...loadJSON("achievements", {}), ...unlocked };
});

// 旧バージョンで長期 Streak 実績を解除済みなら、後継の実績へ引き継ぐ。
// h-play-streak-365（一年の誓い）は難しすぎたため 30 日連続（一ヶ月の誓い）へ緩和。
// h-plays-5000（無限の探求）は 1000 回へ緩和したので、解除済みならそのまま引き継ぐ。
// 千日修行・五年の伝説（h-play-days-1095 / 1825）は廃止し、DOUBLE CLEAR 系の実績に差し替えた。
const achievementIdMigrations = {
  "daily-streak-30": "daily-streak-14",
  "h-play-streak-365": "h-play-streak-30",
  "h-plays-5000": "h-plays-1000",
};
const knownAchievementIds = new Set(ACHIEVEMENTS.map((achievement) => achievement.id));
let migratedAchievementIds = false;
for (const [oldId, newId] of Object.entries(achievementIdMigrations)) {
  if (unlocked[oldId] === undefined) continue;
  if (unlocked[newId] === undefined) unlocked[newId] = unlocked[oldId];
  delete unlocked[oldId];
  migratedAchievementIds = true;
}
if (migratedAchievementIds) saveJSON("achievements", unlocked);

// ---- 達成状況の署名（achievement-mark.js）----
//
// 1 局の内容で決まる実績には、「その問題を遊ぶのが初めてだったか」を署名にして残す。
// 通算回数・連勝などのカウント系と、分析モード利用のようなイベント系には付けない
// （1 局に紐付かないので、初見かどうかを言えない）。
const PLAY_ACHIEVEMENT_IDS = new Set([
  // 入門・モード・難易度（その 1 局でクリアしたことが条件）
  "first-play", "first-clear", "daily-clear", "uso-clear", "extreme-clear", "level-clear",
  // 手数・スピード
  "one-shot", "two-shot", "within-4", "last-gasp", "speed-60", "slow-10",
  // 盤面の模様
  "all-gray", "rainbow", "green-start", "green-zero", "h-phantom",
  // 深夜のクリア（現在のゲームの終了時刻で判定する）
  "night-owl",
  // 一度負けた問題のクリア（定義上つねに再プレイになる）
  "revenge",
  // Guess の単語そのものが条件の隠し実績
  "h-mirror", "h-anagram", "h-alphabet", "h-noreuse", "all-letters", "h-uso-green",
  // 1 局の難度・速さが条件の隠し実績
  "h-abyss", "h-lightning",
  // EXTRA SHOT（DOUBLE CLEAR）
  "h-double-clear", "h-double-uso", "h-double-oneshot", "h-double-abyss",
]);

let marks = loadJSON("achievements.sig", {}); // { id: signature }
// ゲーム終了時の判定中だけ MARK.FRESH / MARK.REPLAY が入る。それ以外の経路（履歴からの
// 復元・インポート）は 1 局に紐付かないので MARK.RESTORED になる。
let currentPlayMark = null;
let marksDirty = false;

onExternalChange("achievements.sig", () => {
  marks = { ...loadJSON("achievements.sig", {}), ...marks };
});

// この機能を入れる前から遊んでいた人の解除済み実績は、すべて「初見で達成」とみなして
// 署名を付ける（あとから初見だったかを言い当てられないため）。一度だけ実行する。
const MARK_BACKFILL_VERSION = 1;
// 解除済みが 1 つも無いうち（新規プレイヤー）は何もしない。
// 以降の解除はすべて unlock() が署名を付けるので、後から走っても対象は残らない。
if (Object.keys(unlocked).length > 0 && loadJSON("achievements.sigVersion", 0) < MARK_BACKFILL_VERSION) {
  for (const id of PLAY_ACHIEVEMENT_IDS) {
    if (unlocked[id] === undefined || marks[id] !== undefined) continue;
    marks[id] = signAchievement(id, MARK.FRESH, unlocked[id]);
    marksDirty = true;
  }
  if (marksDirty) saveJSON("achievements.sig", marks);
  saveJSON("achievements.sigVersion", MARK_BACKFILL_VERSION);
  marksDirty = false;
}

// 実績ごとの署名（そのままエクスポートに載せる。中身は verifyAchievementMark で読む）
export function getAchievementMarks() {
  return { ...marks };
}

// 署名がどの状態を指しているか。付いていない / 合わなければ null
export function achievementMarkState(id) {
  return verifyAchievementMark(id, marks[id], unlocked[id]);
}

export function getUnlocked() {
  if (isDebugMode()) {
    const debugUnlockedAt = Math.floor(Date.now() / 1000);
    return Object.fromEntries(ACHIEVEMENTS.map((achievement) => [achievement.id, unlocked[achievement.id] ?? debugUnlockedAt]));
  }
  // 新旧バージョンのタブが混在しても将来の実績記録を消さない。現在の画面や集計には、
  // このバージョンが知っている実績だけを公開する。
  return Object.fromEntries(
    ACHIEVEMENTS
      .filter((achievement) => unlocked[achievement.id] !== undefined)
      .map((achievement) => [achievement.id, unlocked[achievement.id]])
  );
}

export function isUnlocked(id) {
  return isDebugMode() || (knownAchievementIds.has(id) && unlocked[id] !== undefined);
}

export const NORMAL_ACHIEVEMENTS = ACHIEVEMENTS.filter((achievement) => !achievement.hidden);
export const HIDDEN_ACHIEVEMENTS = ACHIEVEMENTS.filter((achievement) => achievement.hidden);

// 実績の進捗。隠し実績は総数を伏せる方針なので、表示に使うのは解放済みの個数だけ。
// hiddenTotal はバッジ判定など内部用（画面には出さない）。
export function achievementProgress(unlockedMap = getUnlocked()) {
  const countUnlocked = (list) => list.filter((achievement) => unlockedMap[achievement.id] !== undefined).length;
  const normalUnlocked = countUnlocked(NORMAL_ACHIEVEMENTS);
  const hiddenUnlocked = countUnlocked(HIDDEN_ACHIEVEMENTS);
  return {
    normalUnlocked,
    normalTotal: NORMAL_ACHIEVEMENTS.length,
    hiddenUnlocked,
    hiddenTotal: HIDDEN_ACHIEVEMENTS.length,
    // 「実績を全部解除したか」の判定（プレイヤーカードの MASTER / KING ランク）
    allUnlocked: normalUnlocked + hiddenUnlocked >= ACHIEVEMENTS.length,
  };
}

// 進捗の表示文字列。「15 / 50 + 3」（+ の後ろは解放済みの隠し実績の数）
export function formatAchievementProgress(progress, { spaced = true } = {}) {
  const slash = spaced ? " / " : "/";
  return `${progress.normalUnlocked}${slash}${progress.normalTotal} + ${progress.hiddenUnlocked}`;
}

function unlock(id, newly) {
  if (isDebugMode()) return;
  if (unlocked[id] !== undefined) return;
  unlocked[id] = Math.floor(Date.now() / 1000);
  // 1 局で決まる実績には、その 1 局が初見の問題だったかを署名で残す
  if (PLAY_ACHIEVEMENT_IDS.has(id)) {
    marks[id] = signAchievement(id, currentPlayMark ?? MARK.RESTORED, unlocked[id]);
    marksDirty = true;
  }
  newly.push(ACHIEVEMENTS.find((a) => a.id === id));
}

// collector（メタ実績）を最後に判定して保存する
function finalize(newly) {
  const knownUnlockedCount = ACHIEVEMENTS.filter((achievement) => unlocked[achievement.id] !== undefined).length;
  if (knownUnlockedCount >= COLLECTOR_REQUIREMENT) unlock("collector", newly);
  if (newly.length > 0) saveJSON("achievements", unlocked);
  if (marksDirty) {
    saveJSON("achievements.sig", marks);
    marksDirty = false;
  }
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

// 帯・ゾロ目の判定は、内部 PID ではなく表示上の番号で行う
// （新出題の内部 PID には NEW_OFFSET が乗っているため）。
function inNumberRange(pid, min, max) {
  const number = problemNumber(pid);
  return !isDailyPID(pid) && number >= min && number <= max;
}

function isExtremeProblem(pid) {
  return inNumberRange(pid, PID.HARD_MIN, PID.HARD_MAX);
}

function isLevelProblem(pid) {
  return inNumberRange(pid, PID.LEVEL_MIN, PID.LEVEL_MAX);
}

function isZorome(pid) {
  const s = String(problemNumber(pid));
  return s.length >= 3 && [...s].every((c) => c === s[0]);
}

// DOUBLE CLEAR が何ゲーム連続したかの最長記録（モードは問わない）
function maxDoubleClearStreak(records) {
  let best = 0;
  let streak = 0;
  for (const record of records) {
    streak = record?.clear && getExtraShot(record)?.success ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return best;
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

function achievementDayProblemKey(record) {
  const day = localDayKey(record);
  const pid = record?.problemID;
  if (day === null || pid === null || pid === undefined || pid === "") return null;
  return `${day}:${pid}`;
}

// 出題の内容に関わる実績の対象になるプレイか。
// Cls.（旧出題）は原作互換の偏った抽選で作られているので、新出題へ切り替えた
// 2026-08-01 以降のプレイは実績に数えない。切り替え前のプレイ（リリース済みの履歴）は
// そのまま有効なので、既に解除した実績が取り消されることはない。
// 完了時刻の分からない移行レコードは、必ず切り替え前のものなので数える。
export function isScoredRecord(record) {
  if (!isClassicPID(record?.problemID)) return true;
  const at = completedAtSec(record);
  return at === null || at < NEW_ERA.achievementCutoffSec;
}

// 破棄レコード自体と、その後に同じローカル日付・問題 No. で行われたプレイを、
// モードを問わずすべての実績判定から除外する。破棄より前に完了していたプレイまでは
// 遡って無効にしないため、既に解除した実績との整合性も保たれる。
//
// 「通算プレイ日数」「連続プレイ」のように遊んだ事実だけが条件の実績は、Cls. のプレイも
// 数えるのでこちらを使う（Cls. だけ遊んだ日で連続記録が途切れないようにする）。
export function habitEligibleRecords(records) {
  const blocked = new Set();
  return records
    .filter((record) => Array.isArray(record?.guessWord) && record.guessWord.length > 0)
    .slice()
    .sort((a, b) => Number(a.startTime) - Number(b.startTime))
    .filter((record) => {
      const key = achievementDayProblemKey(record);
      if (record.discarded) {
        if (key !== null) blocked.add(key);
        return false;
      }
      return key === null || !blocked.has(key);
    });
}

// 上に加えて、切り替え後の Cls. プレイを除いたもの。継続系以外はすべてこちらで判定する。
export function achievementEligibleRecords(records) {
  return habitEligibleRecords(records).filter(isScoredRecord);
}

// 同じローカル日付・問題 No. の再プレイをモードを問わず除外する。
// 日付や問題 No. を判定できない移行レコードは、誤ってまとめないよう個別に数える。
function dedupeByDayProblem(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = achievementDayProblemKey(record);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// カウント系実績の母数。
export function achievementCountableRecords(records) {
  return dedupeByDayProblem(achievementEligibleRecords(records));
}

// 継続系実績の母数（Cls. のプレイも数える）。
function habitCountableRecords(records) {
  return dedupeByDayProblem(habitEligibleRecords(records));
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

  const eligibleRecords = achievementEligibleRecords(records);

  // 日時そのものが条件の実績は、カウント対象外の再プレイでも判定する。
  for (const record of eligibleRecords) {
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

  // 遊んだ日そのものが条件の実績は Cls. のプレイも数える（実績の対象外なのは出題の内容に
  // 関わるものだけで、遊んだ事実まで無かったことにはしない）
  for (const record of habitCountableRecords(records)) {
    const at = completedAtSec(record);
    if (at === null) continue;
    const date = new Date(at * 1000);
    playDays.add(Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000));
  }

  const countableRecords = achievementCountableRecords(eligibleRecords);
  for (const record of countableRecords) {
    if (!Array.isArray(record?.guessWord) || record.guessWord.length === 0) continue;
    games++;
    guessTotal += record.guessWord.length;
    const at = completedAtSec(record);
    const date = at === null ? null : new Date(at * 1000);
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
  const playStreak = maxConsecutiveDays(playDays);
  if (playStreak >= 3) ids.add("play-streak-3");
  if (playStreak >= 7) ids.add("play-streak-7");
  if (playStreak >= 14) ids.add("play-streak-14");
  if (playStreak >= 30) ids.add("h-play-streak-30");
  if (dailyClearPids.length >= 30) ids.add("daily-30");
  if (maxHistoricalDailyStreak(dailyClearPids) >= 14) ids.add("daily-streak-14");
  if (games >= 30) ids.add("plays-30");
  if (games >= 300) ids.add("plays-300");
  if (games >= 500) ids.add("plays-500");
  if (games >= 1000) ids.add("h-plays-1000");
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
  const source = records.filter((record) => !record?.noAchievements);
  const games = achievementEligibleRecords(source);
  const ids = new Set();
  // 実績の対象になるプレイが 1 つも無くても、Cls. だけを遊んだ日は継続系に効く
  if (games.length === 0) {
    for (const id of calendarAndCountIds(source)) ids.add(id);
    return ids;
  }
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
      // 幻の正解などは同日・同問題の再プレイ（カウント対象外）では判定しない
      if (countable && greens === 5 && logic && !logic.isGameClear(record.guessWord[turn])) ids.add("h-phantom");
    }

    if (countable) {
      for (let turn = 0; turn < record.guessWord.length; turn++) {
        const word = record.guessWord[turn];
        if (word && isPalindrome(word)) ids.add("h-mirror");
        if (turn > 0 && isAnagram(record.guessWord[turn - 1], word)) ids.add("h-anagram");
      }
    }
    if (countable && lettersUsed.size >= 26) ids.add("all-letters");
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
    if (mode === "normal" && isExtremeProblem(pid)) {
      ids.add("extreme-clear");
      if (countable && guesses <= 4) ids.add("h-abyss");
    }
    if (mode === "normal" && isLevelProblem(pid)) ids.add("level-clear");

    // 1 手・2 手クリアは答えを知っていれば狙えるので、初回プレイ（カウント対象）だけ判定する
    if (countable && guesses === 1) ids.add("one-shot");
    if (countable && guesses <= 2) ids.add("two-shot");
    if (guesses <= 4) ids.add("within-4");
    // 最大手数は MODES から引く（checkOnGameFinish 側の maxGuess と定義を分けない）
    if (guesses === MODES[mode].maxGuess) ids.add("last-gasp");
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
      if (isExtremeProblem(pid)) ids.add("h-double-abyss");
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
  if (maxDoubleClearStreak(countableGames) >= 3) ids.add("h-double-streak-3");
  if (words.size >= 1000) ids.add("h-lexicon");
  if (clearedZoromeCount(countableGames) >= 10) ids.add("h-zorome");
  if (maxHistoricalDailyStreak(dailyClears) >= 7) ids.add("daily-7");
  // 継続系のために、Cls. を除く前の履歴を渡す（内部で対象を選び分ける）
  for (const id of calendarAndCountIds(source)) ids.add(id);
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
  try {
    return checkOnGameFinishInner(ctx);
  } finally {
    currentPlayMark = null; // 1 局に紐付く署名は、この判定の中だけで付ける
  }
}

function checkOnGameFinishInner(ctx) {
  const newly = [];
  const { record, results, durationSec, endDate, maxGuess, hadLostBefore } = ctx;
  const pid = record.problemID;
  const isUso = record.gameMode === "uso";
  const guesses = record.guessWord.length;
  const logic = new Logic(pid);
  const history = getHistory();
  const habitHistory = habitEligibleRecords(history);
  const isThisPlay = (game) =>
    Number(game.startTime) === Number(record.startTime) && game.gameMode === record.gameMode;
  // 先に破棄した同日・同問題の再挑戦は、盤面・日時・勝敗を含む全実績の対象外。
  if (!habitHistory.some(isThisPlay)) return [];
  // Cls.（旧出題）のプレイは、遊んだ日として継続系だけ数え、他はいっさい解除しない。
  if (!isScoredRecord(record)) {
    const habitOnly = [];
    for (const id of calendarAndCountIds(history)) unlock(id, habitOnly);
    return finalize(habitOnly);
  }
  const eligibleHistory = habitHistory.filter(isScoredRecord);
  const countableHistory = achievementCountableRecords(eligibleHistory);
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

  // その問題を遊ぶのが初めてのプレイか（モードは問わない。答えは表裏で共通なので、
  // 片方で遊んだ時点で以降は初見ではない）。1 局で決まる実績の署名に使う。
  const firstSightPlay = !history.some(
    (game) =>
      game !== record &&
      Array.isArray(game?.guessWord) &&
      game.guessWord.length > 0 &&
      Number(game.startTime) < Number(record.startTime) &&
      String(game.problemID) === String(pid)
  );
  currentPlayMark = firstSightPlay ? MARK.FRESH : MARK.REPLAY;

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
    // 幻の正解: 2 語の文字を位置ごとに組み合わせて全緑になったが、正解語そのものではない。
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
  if (countablePlay && lettersUsed.size >= 26) unlock("all-letters", newly);
  if (countablePlay && isUso && Array.isArray(record.usoResults)) {
    // 行そのものが配列かも見る（履歴側 achievementIdsFromHistory と同じガード）
    if (record.usoResults.some((row) => Array.isArray(row) && row.every((s) => s === CELL.CORRECT))) {
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
    if (!isUso && isExtremeProblem(pid)) unlock("extreme-clear", newly);
    if (!isUso && isLevelProblem(pid)) unlock("level-clear", newly);
    if (isUso) {
      unlock("uso-clear", newly);
      if (countedWins(history, "uso") >= 5) unlock("uso-5", newly);
    }

    // 1 手・2 手クリアは答えを知っていれば狙えるので、初回プレイだけ判定する
    if (countablePlay && guesses === 1) unlock("one-shot", newly);
    if (countablePlay && guesses <= 2) unlock("two-shot", newly);
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
      if (!isUso && isExtremeProblem(pid) && guesses <= 4) unlock("h-abyss", newly);
      if (guesses >= 3 && durationSec <= 10) unlock("h-lightning", newly);
      if (guesses >= 3 && lettersUsed.size === guesses * 5) unlock("h-noreuse", newly);
    }

    // EXTRA SHOT（DOUBLE CLEAR）。答えを知った再プレイでの稼ぎ防止で初回プレイのみ判定
    if (countablePlay && getExtraShot(record)?.success) {
      unlock("h-double-clear", newly);
      if (isUso) unlock("h-double-uso", newly);
      if (guesses === 1) unlock("h-double-oneshot", newly);
      if (isExtremeProblem(pid)) unlock("h-double-abyss", newly);
    }
    if (countableHistory.filter((g) => g.clear && getExtraShot(g)?.success).length >= 10) {
      unlock("h-double-10", newly);
    }
    if (maxDoubleClearStreak(countableHistory) >= 3) unlock("h-double-streak-3", newly);
  }

  // 日付・回数系（record は履歴に保存済みなので、現在のゲームも集計に含まれる）
  for (const id of calendarAndCountIds(history)) unlock(id, newly);

  return finalize(newly);
}

// type: "analysis" | "migrate"
export function checkOnEvent(type) {
  const newly = [];
  if (type === "analysis") unlock("analyst", newly);
  if (type === "migrate") unlock("migrator", newly);
  return finalize(newly);
}
