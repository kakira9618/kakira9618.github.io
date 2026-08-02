// 設定管理。変更は即 localStorage に保存され、リスナーに通知される。

import { loadJSON, saveJSON } from "./store.js?v=20260803-e";

export const DEFAULT_SETTINGS = {
  theme: "cyber", // "cyber"（ネオン3D演出）| "classic"（原作風フラット表示）| "pop"（隠し: キャンディポップ）
  sfx: true, // 効果音
  // 音量は 0〜100 で、AUDIO.volumeUnityPercent (50) が従来の音量。
  // 100 まで上げると 2 倍まで大きくできる。
  sfxVolume: 50, // 効果音の音量（0〜100）
  bgm: true, // BGM（最初のユーザー操作後に再生開始）
  bgmVolume: 50, // BGM の音量（0〜100）
  bgmTrack: "auto", // "auto"（モード・テーマ連動）または BGM_TRACKS のトラック id
  language: "system", // "system"（ブラウザの言語に連動。日本語なら ja、それ以外は en）| "ja" | "en"
  highContrast: false, // 色覚特性向け: 全テーマの判定色を 緑→オレンジ / 黄→青 に置き換える
  // 色だけに頼らない判定表示 (WCAG 2.1「1.4.1 色の使用」対応)。
  // ON にすると盤面タイルの右下に 正解=● / 位置違い=△ / 不使用=× を重ねる。
  stateSymbols: false,
  // 音量の保存スケールの版数（ユーザー設定ではない）。1 = 旧「100% = 等倍」、
  // 2 = 現行「AUDIO.volumeUnityPercent (50%) = 等倍」。下の移行処理が参照する。
  volumeScale: 2,
  // ON にするとピンチ / ダブルタップでの拡大を封じる（プレイ中の誤操作防止）。
  // 既定は OFF = ズーム可。viewport メタと touch-action の両方を切り替える。
  lockZoom: false,
  keyboardHints: true, // DWORDle のキーボードを判定色で塗り分ける
  reduceFx: false, // 3D 効果やアニメーションを抑える
  randomLevel: 1, // ランダムプレイで前回選んだレベル
  // EXTRA SHOT モード（10 回プレイで解放）。ON だとクリア後に追加推理タイムが入り、
  // もう一つの答えを 1 回だけ推理できる（成功で DOUBLE CLEAR）。DWORDle / DWORDlie 共通。
  extraShot: false,
};

// 実績で解放される隠しテーマ。設定画面では解放まで「???」表示になる。
export const HIDDEN_THEMES = [
  {
    id: "pop",
    name: "ポップ",
    nameEn: "Pop",
    desc: "キャンディみたいにポップで楽しいテーマ",
    descEn: "A fun, candy-bright pop theme",
    unlockAchievement: "rainbow",
    unlockLabel: "三色盛り",
    unlockLabelEn: "Three Colors",
  },
];

export function hiddenThemesUnlockedBy(achievements) {
  const ids = new Set(achievements.map((achievement) => achievement.id));
  return HIDDEN_THEMES.filter((theme) => theme.unlockAchievement && ids.has(theme.unlockAchievement));
}

const VOLUME_SCALE_VERSION = DEFAULT_SETTINGS.volumeScale;

export function normalizeVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.sfxVolume;
  return Math.round(Math.min(100, Math.max(0, numeric)));
}

const storedSettings = loadJSON("settings", {});
const hadLegacyFinalAnswer = Object.prototype.hasOwnProperty.call(storedSettings, "finalAnswer");
if (storedSettings.extraShot === undefined && hadLegacyFinalAnswer) {
  storedSettings.extraShot = Boolean(storedSettings.finalAnswer);
}
delete storedSettings.finalAnswer;
// 音量スライダーは「100% = 等倍」から「50% = 従来の音量・100% で 2 倍」へ変更した。
// 旧スケールで保存された値は、聞こえ方が変わらないよう半分にして引き継ぐ（1 度だけ）。
// 何か保存されている = 旧版でプレイ済みなので、volumeScale が無ければ旧スケール。
// 新スケールでの保存には volumeScale が必ず入る（DEFAULT_SETTINGS 経由）ので、
// 2 度目の起動で二重に半分にすることはない。
const rescaledVolumeKeys =
  Object.keys(storedSettings).length > 0 && (storedSettings.volumeScale ?? 1) < VOLUME_SCALE_VERSION
    ? ["sfxVolume", "bgmVolume"].filter((key) => storedSettings[key] !== undefined)
    : [];
for (const key of rescaledVolumeKeys) {
  storedSettings[key] = normalizeVolume(Number(storedSettings[key]) / 2);
}
let settings = { ...DEFAULT_SETTINGS, ...storedSettings };
settings.sfxVolume = normalizeVolume(settings.sfxVolume);
settings.bgmVolume = normalizeVolume(settings.bgmVolume);
if (hadLegacyFinalAnswer || rescaledVolumeKeys.length) saveJSON("settings", settings);
const listeners = new Set();

export function getSettings() {
  // finalAnswer は旧コード向けの読取専用互換エイリアス。保存は extraShot のみ。
  return { ...settings, finalAnswer: settings.extraShot };
}

export function setSetting(key, value) {
  if (key === "finalAnswer") key = "extraShot";
  if (key === "sfxVolume" || key === "bgmVolume") value = normalizeVolume(value);
  if (settings[key] === value) return;
  settings = { ...settings, [key]: value };
  saveJSON("settings", settings);
  for (const fn of listeners) fn(settings, key);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
