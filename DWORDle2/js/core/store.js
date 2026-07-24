// localStorage の薄いラッパ。キーは全て "dwordle2." プレフィックスで名前空間を切る。

import { isDebugMode } from "./debug.js?v=20260723-fa";

const PREFIX = "dwordle2.";

// 保存失敗（容量超過・プライベートモード等）はデータ消失に直結するため、
// UI 側（main.js）が登録するハンドラで必ずユーザーへ知らせる。
let saveErrorHandler = null;

export function onSaveError(handler) {
  saveErrorHandler = handler;
}

// デバッグモード中の書き込み先（セッション限りのメモリオーバーレイ）。
// 実データ（localStorage）は汚さず、読み出しはオーバーレイを優先する。
// 単に保存を捨てると「保存 → 直後に読み出し」で成立している流れ
// （進行中ゲームの保存 → ゲーム画面の再開読み込みなど）が壊れ、
// デバッグ中にゲームを開始した瞬間タイトルへ戻される。
// localStorage と同じ値渡しの意味論を保つため、JSON 文字列のまま持つ。
// デバッグモードはリロードで解除されるので、オーバーレイも自然に消える。
const debugOverlay = new Map();

export function loadJSON(key, fallback) {
  try {
    // オーバーレイはデバッグ中にしか書かれないので、有無の確認だけでよい
    const raw = debugOverlay.has(key) ? debugOverlay.get(key) : localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  // デバッグ中のプレイや設定変更はセッション内（オーバーレイ）だけに留める。
  if (isDebugMode()) {
    debugOverlay.set(key, JSON.stringify(value));
    return true;
  }
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
  // 全データ削除は明示操作なので、デバッグ中でも実データごと消す
  debugOverlay.delete(key);
  localStorage.removeItem(PREFIX + key);
}

// 別タブによる書き換えの監視。storage イベントは他タブでの変更時にのみ発火するので、
// インメモリキャッシュを持つモジュールはこれで無効化し、read-modify-write の
// 上書きで他タブの保存内容が消えるのを防ぐ。
export function onExternalChange(key, handler) {
  if (typeof addEventListener !== "function") return;
  addEventListener("storage", (event) => {
    if (event.key === PREFIX + key) handler();
  });
}
