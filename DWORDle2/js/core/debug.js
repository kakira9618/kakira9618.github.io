// 開発確認用の一時デバッグモード。
// 状態はメモリだけに持ち、リロードすると必ず解除される。

const DEBUG_KEYWORD = "DWORDLER";

let debugMode = false;

export function isDebugMode() {
  return debugMode;
}

export function tryEnableDebugMode(keyword) {
  if (String(keyword ?? "").trim().toUpperCase() !== DEBUG_KEYWORD) return false;
  debugMode = true;
  return true;
}
