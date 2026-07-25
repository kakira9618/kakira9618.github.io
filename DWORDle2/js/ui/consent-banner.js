// Cookie 同意バナー。EEA / 英国 / スイスからのアクセスにだけ出す。
//
// 表示条件は analytics.js の needsConsentPrompt()（本番ドメイン・DNT 無効・
// タイムゾーンが対象地域・未選択）。それ以外の地域には一切出さない。
// 選ぶまで analytics_storage は denied のままなので、待たせても計測が壊れることはない。
// 画面を覆わない下部のバーにして、ゲームの操作は同意前でも普通に続けられるようにする。

import { el } from "./dom.js?v=20260725-b";
import { needsConsentPrompt, setAnalyticsConsent } from "../core/analytics.js?v=20260725-b";
import { tr } from "../core/i18n.js?v=20260725-b";

let banner = null;

function close() {
  banner?.remove();
  banner = null;
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
        "利用状況の把握のため Google アナリティクスの Cookie を使ってよろしいですか？プレイ履歴や入力した単語は送信しません。",
        "May we use Google Analytics cookies to understand how the game is used? Your play history and the words you type are never sent."
      ),
      " ",
      // 同意を求める場では、その場から詳細（Google のデータ利用）へ辿れるようにする
      el(
        "a",
        { href: "https://policies.google.com/technologies/partner-sites", target: "_blank", rel: "noopener noreferrer" },
        tr("詳細", "Details")
      )
    ),
    el(
      "div",
      { class: "consent-banner-actions" },
      el("button", { class: "btn", onclick: () => choose(false) }, tr("拒否する", "Decline")),
      el("button", { class: "btn btn-primary", onclick: () => choose(true) }, tr("同意する", "Accept"))
    )
  );
  document.body.append(banner);
  return banner;
}

// 対象地域でまだ選んでいないときだけ出す
export function maybeShowConsentBanner() {
  if (!needsConsentPrompt()) return false;
  showConsentBanner();
  return true;
}
