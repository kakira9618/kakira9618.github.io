// 判定タイルを色だけに依存せず読み上げるための共通ラベル。

import { tr } from "../core/i18n.js?v=20260723-swup";
import { getSettings } from "../core/settings.js?v=20260723-swup";

// 判定色の呼び名。ハイコントラスト設定では 緑→オレンジ / 黄→青 と読む
export function feedbackColorName(state) {
  const highContrast = getSettings().highContrast;
  const names = {
    correct: highContrast ? tr("オレンジ", "orange") : tr("緑", "green"),
    used: highContrast ? tr("青", "blue") : tr("黄", "yellow"),
    unused: tr("灰", "gray"),
  };
  return names[state] ?? "";
}

export function feedbackName(state) {
  const names = {
    correct: tr(`${feedbackColorName("correct")}、位置一致`, `${feedbackColorName("correct")}, exact position`),
    used: tr(`${feedbackColorName("used")}、文字あり`, `${feedbackColorName("used")}, present`),
    unused: tr(`${feedbackColorName("unused")}、文字なし`, `${feedbackColorName("unused")}, absent`),
    guessing: tr("未判定", "not checked"),
  };
  return names[state] ?? tr("未判定", "not checked");
}

export function tileAriaLabel(char, state = "guessing") {
  const letter = String(char ?? "").trim().toUpperCase();
  if (!letter) return tr("空のタイル", "Empty tile");
  if (!state || state === "guessing") return tr(`文字 ${letter}`, `Letter ${letter}`);
  return tr(`${letter}、${feedbackName(state)}`, `${letter}, ${feedbackName(state)}`);
}

export function rowAriaLabel(word, states) {
  const upper = String(word ?? "").toUpperCase();
  const feedback = states.map(feedbackName).join(tr("、", ", "));
  return tr(`${upper} の判定：${feedback}`, `${upper} feedback: ${feedback}`);
}

// 判定結果などをスクリーンリーダーへ自動で読み上げる（#sr-announcer は aria-live=polite）。
// タイルの aria-label 更新だけでは announce されないため、専用のライブリージョンに流す。
let announceTimer = null;

export function announce(message) {
  const node = document.getElementById("sr-announcer");
  if (!node) return;
  // 同じ文言が連続しても読み上げられるよう、一度空にしてから入れ直す
  node.textContent = "";
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    node.textContent = message;
  }, 50);
}
