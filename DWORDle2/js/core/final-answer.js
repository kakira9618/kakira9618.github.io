// FINAL ANSWER モード（やり込み向けの追加推理タイム）の解放条件と状態。
//
// - 50 回プレイ（countPlays 基準。タイトルメニューの段階解放と同じ数え方）で解放。
//   デバッグモード中は一時的に解放される（リロードで元に戻る）。
// - 解放時は一度だけ「設定に追加されました」ダイアログで通知する
//   （claimFinalAnswerUnlockNotice が通知済みフラグを管理する）。
// - 有効/無効は設定 finalAnswer で切り替え、DWORDle / DWORDlie の両方に適用される。

import { countPlays } from "./records.js";
import { isDebugMode } from "./debug.js";
import { getSettings } from "./settings.js?v=20260723-fa";
import { loadJSON, saveJSON } from "./store.js";

export const FINAL_ANSWER_UNLOCK_PLAYS = 50;

export function isFinalAnswerUnlocked() {
  return isDebugMode() || countPlays() >= FINAL_ANSWER_UNLOCK_PLAYS;
}

// 解放までの残りプレイ回数（解放済みなら 0）
export function finalAnswerRemainingPlays() {
  return Math.max(0, FINAL_ANSWER_UNLOCK_PLAYS - countPlays());
}

// ゲーム中に追加推理タイムへ入るか（解放済み かつ 設定 ON）
export function isFinalAnswerEnabled() {
  return isFinalAnswerUnlocked() && Boolean(getSettings().finalAnswer);
}

// 解放通知をまだ出していなければ true を返し、出したことを記録する。
// デバッグモードの一時解放では通知しない（実プレイ数の到達だけが対象）。
export function claimFinalAnswerUnlockNotice() {
  if (countPlays() < FINAL_ANSWER_UNLOCK_PLAYS) return false;
  if (loadJSON("finalAnswerUnlockSeen", false)) return false;
  saveJSON("finalAnswerUnlockSeen", true);
  return true;
}
