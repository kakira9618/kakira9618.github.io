// localStorage の薄いラッパ。キーは全て "dwordle2." プレフィックスで名前空間を切る。

import { isDebugMode } from "./debug.js";

const PREFIX = "dwordle2.";

// 保存失敗（容量超過・プライベートモード等）はデータ消失に直結するため、
// UI 側（main.js）が登録するハンドラで必ずユーザーへ知らせる。
let saveErrorHandler = null;

export function onSaveError(handler) {
  saveErrorHandler = handler;
}

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  // デバッグ中のプレイや設定変更はセッション内だけに留める。
  if (isDebugMode()) return true;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("saveJSON failed:", key, e);
    saveErrorHandler?.(key, e);
    return false;
  }
}

export function removeKey(key) {
  localStorage.removeItem(PREFIX + key);
}
