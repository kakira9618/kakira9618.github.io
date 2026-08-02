// 開発確認用の一時デバッグモード。
// 状態はメモリだけに持ち、リロードすると必ず解除される。
//
// キーワードそのものはソースに置かず、指紋（js/core/secret.js の fingerprint）だけを持つ。
// 値の作り直しは `node tools/make-secret.mjs fingerprint "<キーワード>"`。

import { fingerprint } from "./secret.js?v=20260803-d";

const DEBUG_KEYWORD_FINGERPRINT = "1f0qpte.bdnro";

let debugMode = false;

export function isDebugMode() {
  return debugMode;
}

export function tryEnableDebugMode(keyword) {
  const normalized = String(keyword ?? "").trim().toUpperCase();
  if (normalized === "" || fingerprint(normalized) !== DEBUG_KEYWORD_FINGERPRINT) return false;
  debugMode = true;
  return true;
}
