// 判定タイルを色だけに依存せず読み上げるための共通ラベル。

import { tr } from "../core/i18n.js?v=20260722-pop-locale-scale";

export function feedbackName(state) {
  const names = {
    correct: tr("緑、位置一致", "green, exact position"),
    used: tr("黄、文字あり", "yellow, present"),
    unused: tr("灰、文字なし", "gray, absent"),
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
