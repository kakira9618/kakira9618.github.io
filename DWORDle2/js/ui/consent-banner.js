// Google Analytics の同意バナー。計測可能な全地域で、未選択時に出す。
// 選ぶまで Google タグ自体を読み込まない Basic Consent Mode のため、拒否した場合も
// 同意状態を含めて Google へ何も送信しない。
// 画面を覆わない下部のバーにして、ゲームの操作は同意前でも普通に続けられるようにする。

import { el } from "./dom.js?v=20260725-b";
import { needsConsentPrompt, setAnalyticsConsent } from "../core/analytics.js?v=20260725-b";
import { tr } from "../core/i18n.js?v=20260725-b";

let banner = null;

function close() {
  banner?.remove();
  banner = null;
}

export function dismissConsentBanner() {
  close();
}

// 条件を無視して出す（プレビュー・テスト用）
export function showConsentBanner() {
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

// 計測可能な環境で、まだ選んでいないときだけ出す。
export function maybeShowConsentBanner() {
  if (!needsConsentPrompt()) return false;
  showConsentBanner();
  return true;
}
