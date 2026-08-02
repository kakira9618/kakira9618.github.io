// Google Analytics の同意バナー。計測可能な全地域で、未選択時に出す。
// 選ぶまで Google タグ自体を読み込まない Basic Consent Mode のため、拒否した場合も
// 同意状態を含めて Google へ何も送信しない。
// 画面を覆わない下部のバーにして、ゲームの操作は同意前でも普通に続けられるようにする。

import { el } from "./dom.js?v=20260803-b";
import { needsConsentPrompt, setAnalyticsConsent } from "../core/analytics.js?v=20260803-b";
import { tr } from "../core/i18n.js?v=20260803-b";

let banner = null;
let cancelDeferredShow = null;

function cancelPendingShow() {
  cancelDeferredShow?.();
  cancelDeferredShow = null;
}

function close() {
  banner?.remove();
  banner = null;
}

export function dismissConsentBanner() {
  cancelPendingShow();
  close();
}

// 条件を無視して出す（プレビュー・テスト用）
export function showConsentBanner() {
  cancelPendingShow();
  if (banner) return banner;
  const choose = (granted) => {
    setAnalyticsConsent(granted);
    close();
  };
  banner = el(
    "div",
    { class: "consent-banner", role: "region", "aria-label": tr("Cookie の設定", "Cookie settings") },
    el(
      "p",
      { class: "consent-banner-text" },
      tr(
        "利用状況の把握のため Google アナリティクスを使用してよろしいですか？同意するまで Google への送信は行いません。プレイ履歴や入力した単語は送信しません。",
        "May we use Google Analytics to understand how the game is used? Nothing is sent to Google until you consent. Your play history and the words you type are never sent."
      ),
      " ",
      el(
        "a",
        { href: "privacy.html", target: "_blank", rel: "noopener noreferrer" },
        tr("プライバシーポリシー", "Privacy policy")
      )
    ),
    el(
      "div",
      { class: "consent-banner-actions" },
      el("button", { class: "btn", onclick: () => choose(false) }, tr("拒否する", "Decline")),
      el("button", { class: "btn", onclick: () => choose(true) }, tr("同意する", "Accept"))
    )
  );
  document.body.append(banner);
  return banner;
}

// 初回ルールや履歴移行などのモーダルが開いている間は同意バナーを重ねない。
// モーダルが閉じた直後に次のモーダルが連鎖する場合があるため、DOM が空になっても
// 1 タスク待ってから再確認し、すべての案内が終わった時点で表示する。
function deferUntilModalsClose(shouldShow) {
  if (banner || cancelDeferredShow) return;
  const layer = document.getElementById("modal-layer");
  let timer = null;
  let observer = null;
  const hasOpenModal = () => Boolean(layer?.querySelector(".modal-backdrop"));
  const cleanup = () => {
    if (timer !== null) clearTimeout(timer);
    observer?.disconnect();
    timer = null;
    observer = null;
    cancelDeferredShow = null;
  };
  const check = () => {
    if (hasOpenModal()) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (hasOpenModal()) return;
      if (!shouldShow()) {
        cleanup();
        return;
      }
      cleanup();
      showConsentBanner();
    }, 0);
  };
  cancelDeferredShow = cleanup;
  observer = new MutationObserver(check);
  if (layer) observer.observe(layer, { childList: true });
  check();
}

// UI テスト・プレビュー用。条件を無視する点は showConsentBanner と同じだが、
// 初回モーダルとの表示順を本番と同じ方法で制御する。
export function showConsentBannerAfterModals() {
  deferUntilModalsClose(() => true);
}

// 計測可能な環境で、まだ選んでいないときだけ出す。
export function maybeShowConsentBanner() {
  if (!needsConsentPrompt()) return false;
  // 待機中に設定画面から選択された場合も、表示直前に条件を再確認する。
  deferUntilModalsClose(needsConsentPrompt);
  return true;
}
