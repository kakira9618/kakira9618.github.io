// EXTRA SHOT モード（やり込み向けの追加推理タイム）の解放条件と状態。
//
// - 10 回プレイ（countPlays 基準。タイトルメニューの段階解放と同じ数え方）で解放。
//   デバッグモード中は一時的に解放される（リロードで元に戻る）。
// - 解放時は一度だけ「設定に追加されました」ダイアログで通知する
//   （claimExtraShotUnlockNotice が通知済みフラグを管理する）。
// - 有効/無効は設定 extraShot で切り替え、DWORDle / DWORDlie の両方に適用される。
// - 旧 finalAnswerUnlockSeen / finalAnswer 設定は互換移行する。

import { countPlays } from "./records.js?v=20260723-fa";
import { isDebugMode } from "./debug.js?v=20260723-fa";
import { getSettings } from "./settings.js?v=20260723-fa";
import { loadJSON, saveJSON } from "./store.js?v=20260723-fa";

export const EXTRA_SHOT_UNLOCK_PLAYS = 10;

export function isExtraShotUnlocked() {
  return isDebugMode() || countPlays() >= EXTRA_SHOT_UNLOCK_PLAYS;
}

// 解放までの残りプレイ回数（解放済みなら 0）
export function extraShotRemainingPlays() {
  return Math.max(0, EXTRA_SHOT_UNLOCK_PLAYS - countPlays());
}

// ゲーム中に追加推理タイムへ入るか（解放済み かつ 設定 ON）
export function isExtraShotEnabled() {
  return isExtraShotUnlocked() && Boolean(getSettings().extraShot);
}

// 解放通知をまだ出していなければ true を返し、出したことを記録する。
// デバッグモードの一時解放では通知しない（実プレイ数の到達だけが対象）。
export function claimExtraShotUnlockNotice() {
  if (countPlays() < EXTRA_SHOT_UNLOCK_PLAYS) return false;
  if (loadJSON("extraShotUnlockSeen", false)) return false;
  if (loadJSON("finalAnswerUnlockSeen", false)) {
    saveJSON("extraShotUnlockSeen", true);
    return false;
  }
  saveJSON("extraShotUnlockSeen", true);
  return true;
}
