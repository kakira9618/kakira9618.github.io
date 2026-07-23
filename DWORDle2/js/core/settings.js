// 設定管理。変更は即 localStorage に保存され、リスナーに通知される。

import { loadJSON, saveJSON } from "./store.js";

export const DEFAULT_SETTINGS = {
  theme: "cyber", // "cyber"（ネオン3D演出）| "classic"（原作風フラット表示）| "pop"（隠し: キャンディポップ）
  sfx: true, // 効果音
  sfxVolume: 100, // 効果音の音量（0〜100）
  bgm: true, // BGM（最初のユーザー操作後に再生開始）
  bgmVolume: 100, // BGM の音量（0〜100）
  bgmTrack: "auto", // "auto"（モード・テーマ連動）または BGM_TRACKS のトラック id
  language: "system", // "system"（ブラウザの言語に連動。日本語なら ja、それ以外は en）| "ja" | "en"
  highContrast: false, // 色覚特性向け: 全テーマの判定色を 緑→オレンジ / 黄→青 に置き換える
  keyboardHints: true, // DWORDle のキーボードを判定色で塗り分ける
  reduceFx: false, // 演出を軽くする（パーティクルを完全にオフ）
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

export function normalizeVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.round(Math.min(100, Math.max(0, numeric)));
}

const storedSettings = loadJSON("settings", {});
const hadLegacyFinalAnswer = Object.prototype.hasOwnProperty.call(storedSettings, "finalAnswer");
if (storedSettings.extraShot === undefined && hadLegacyFinalAnswer) {
  storedSettings.extraShot = Boolean(storedSettings.finalAnswer);
}
delete storedSettings.finalAnswer;
let settings = { ...DEFAULT_SETTINGS, ...storedSettings };
settings.sfxVolume = normalizeVolume(settings.sfxVolume);
settings.bgmVolume = normalizeVolume(settings.bgmVolume);
if (hadLegacyFinalAnswer) saveJSON("settings", settings);
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
