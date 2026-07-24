// EXTRA SHOT の演出（突入カットイン / DOUBLE CLEAR セレブレーション）。
// DOM オーバーレイ + CSS アニメーションで構成し、テーマ×モード
// （cyber / classic / pop × DWORDle / DWORDlie）ごとの見た目の差は
// style.css の「EXTRA SHOT」セクションが body.theme-* / body.mode-uso で出し分ける。
// 表示時間は config.js の FX.extraShot にまとまっている（CSS と同期）。

import { el } from "./dom.js?v=20260723-fa";
import { FX } from "../config.js?v=20260723-fa";
import { shouldReduceMotion } from "../core/motion.js?v=20260723-fa";
import { tr } from "../core/i18n.js?v=20260723-fa";

let activeOverlay = null;
let activeTimer = null;
let activeResolve = null;

function finishActive() {
  clearTimeout(activeTimer);
  activeTimer = null;
  activeOverlay?.remove();
  activeOverlay = null;
  const resolve = activeResolve;
  activeResolve = null;
  resolve?.();
}

// 画面離脱時の後始末。表示中のオーバーレイを消し、待機中の Promise も解決する
// （呼び出し側は gatherSession で古い続きが走らないようガードしている）。
export function cancelExtraShotFx() {
  if (activeOverlay || activeResolve) finishActive();
}

function showOverlay(node, durationMs, resolve) {
  cancelExtraShotFx();
  activeOverlay = node;
  activeResolve = resolve ?? null;
  document.body.append(node);
  activeTimer = setTimeout(finishActive, durationMs);
}

// 突入カットイン。「EXTRA SHOT」の帯が画面を横切り、入力可能になるタイミングで resolve する。
export function playExtraShotCutin(isUso) {
  return new Promise((resolve) => {
    if (shouldReduceMotion()) {
      setTimeout(resolve, FX.extraShot.cutinReducedMs);
      return;
    }
    const sub = isUso
      ? tr("嘘を貫け。残る答えは 1 つ。チャンスは 1 回。", "See through the lies. One answer left. One chance.")
      : tr("残る答えは 1 つ。チャンスは 1 回。", "One answer left. One chance.");
    const overlay = el(
      "div",
      { class: "fa-cutin", "aria-hidden": "true" },
      el("div", { class: "fa-cutin-flash" }),
      el(
        "div",
        { class: "fa-cutin-band" },
        el("div", { class: "fa-cutin-streaks" }),
        el(
          "div",
          { class: "fa-cutin-inner" },
          el("div", { class: "fa-cutin-text" }, "EXTRA SHOT"),
          el("div", { class: "fa-cutin-sub" }, sub)
        )
      )
    );
    showOverlay(overlay, FX.extraShot.cutinMs, resolve);
  });
}

// DOUBLE CLEAR セレブレーション。金色の光背とリング、グラデーション文字で大成功を祝う。
// 表示しっぱなしにせず doubleClearMs で自動的に消える（結果画面への遷移が続く）。
export function playDoubleClearCutin() {
  if (shouldReduceMotion()) return;
  const overlay = el(
    "div",
    { class: "fa-double", "aria-hidden": "true" },
    el("div", { class: "fa-double-rays" }),
    el("div", { class: "fa-double-ring" }),
    el(
      "div",
      { class: "fa-double-inner" },
      el("div", { class: "fa-double-text" }, "DOUBLE CLEAR!!"),
      el("div", { class: "fa-double-sub" }, tr("2 つの答えを完全制覇！", "Both answers conquered!"))
    )
  );
  showOverlay(overlay, FX.extraShot.doubleClearMs);
}
