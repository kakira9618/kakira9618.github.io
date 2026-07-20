// 設定管理。変更は即 localStorage に保存され、リスナーに通知される。

import { loadJSON, saveJSON } from "./store.js";

export const DEFAULT_SETTINGS = {
  theme: "cyber", // "cyber"（ネオン3D演出）| "classic"（原作風フラット表示）
  sfx: true, // 効果音
  bgm: true, // BGM（最初のユーザー操作後に再生開始）
  bgmTrack: "auto", // "auto" | "normal" | "uso" | "gentle" | "classic"
  language: "ja", // "ja" | "en"
  reduceFx: false, // 演出を軽くする（パーティクルを完全にオフ）
  randomLevel: 1, // ランダムプレイで前回選んだレベル
};

let settings = { ...DEFAULT_SETTINGS, ...loadJSON("settings", {}) };
const listeners = new Set();

export function getSettings() {
  return { ...settings };
}

export function setSetting(key, value) {
  if (settings[key] === value) return;
  settings = { ...settings, [key]: value };
  saveJSON("settings", settings);
  for (const fn of listeners) fn(settings, key);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
