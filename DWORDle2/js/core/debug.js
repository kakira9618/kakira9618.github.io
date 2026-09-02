// 開発確認用の一時デバッグモード。
// 状態はメモリだけに持ち、リロードすると必ず解除される。
//
// キーワードそのものはソースに置かず、指紋（js/core/secret.js の fingerprint）だけを持つ。
// 値の作り直しは `node tools/make-secret.mjs fingerprint "<キーワード>"`。

import { fingerprint } from "./secret.js?v=20260806-a";

const DEBUG_KEYWORD_FINGERPRINT = "1f0qpte.bdnro";
// カード更新プレビューの合言葉（デバッグキーワードとは別）。
// 値の作り直しは `node tools/make-secret.mjs fingerprint "<キーワード>"`。
const CARD_NEWS_KEYWORD_FINGERPRINT = "fj9wr6.1hy231y";

let debugMode = false;
let cardNewsPreviewArmed = false;

function matchesKeyword(keyword, expectedFingerprint) {
  const normalized = String(keyword ?? "").trim().toUpperCase();
  return normalized !== "" && fingerprint(normalized) === expectedFingerprint;
}

export function isDebugMode() {
  return debugMode;
}

export function tryEnableDebugMode(keyword) {
  if (!matchesKeyword(keyword, DEBUG_KEYWORD_FINGERPRINT)) return false;
  debugMode = true;
  return true;
}

// カード更新プレビュー: 1 回ぶん「未読のカード更新」を偽装する。
// タイトルの NEW バッジ → カードを開くと昇格演出 → 既読で消える、の一巡を
// 実データを動かさずに確認できる。状態はメモリだけに持ち、リロードで解除される。
export function tryEnableCardNewsPreview(keyword) {
  if (!matchesKeyword(keyword, CARD_NEWS_KEYWORD_FINGERPRINT)) return false;
  cardNewsPreviewArmed = true;
  return true;
}

export function isCardNewsPreviewArmed() {
  return cardNewsPreviewArmed;
}

// カード画面が昇格演出を出すときに 1 回だけ消費する
export function claimCardNewsPreview() {
  const armed = cardNewsPreviewArmed;
  cardNewsPreviewArmed = false;
  return armed;
}
