// Google Analytics 4（G-JKQEWRGDSM）。
//
// 方針:
// - 起動を遅くしない: gtag.js は静的に読み込まず、扉絵を抜けたあとのアイドル時間に注入する。
// - オフラインでも壊さない: 取得に失敗しても何もしない（dataLayer に積むだけで例外は出ない）。
//   PWA のプリキャッシュにも入れないので、オフライン起動でネットワークを待つことはない。
// - 個人を特定する値は送らない: プレイヤー名・入力単語・問題の答えなどは対象外。
//   送るのは画面名とゲーム結果の統計値だけ。
// - 広告系のシグナルは使わない: Consent Mode で ad_storage / ad_user_data /
//   ad_personalization をどの地域でも既定で denied にする。
// - EEA / 英国 / スイスからのアクセスは、同意があるまで analytics_storage も denied。
//   Google が IP から地域を判定するので（region 付き default）、こちらの推定が外れても
//   EEA のユーザーが勝手に Cookie を持たされることはない。同意 UI は
//   js/ui/consent-banner.js が出し、同意されたら consent update で granted にする。
// - Do Not Track を送っているブラウザでは、そもそも読み込まない。
// - 本番ドメイン以外（localhost やテスト）では読み込まない。

import { loadJSON, saveJSON } from "./store.js?v=20260725-b";

const MEASUREMENT_ID = "G-JKQEWRGDSM";
const PRODUCTION_HOSTS = new Set(["kakira9618.github.io"]);
const SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
const CONSENT_KEY = "analyticsConsent"; // "granted" | "denied"

// 同意が要る地域（EU 27 + EEA + 英国 + スイス）。Google 側で IP から判定される。
const CONSENT_REQUIRED_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB", "CH",
];

// 同意バナーを出すかどうかのクライアント側推定に使うタイムゾーン。
// 判定を誤っても、実際の計測可否は上の region 付き default（Google の IP 判定）が決める。
const CONSENT_REGION_ZONE_PREFIXES = ["Europe/"];
const CONSENT_REGION_ZONES = new Set([
  "Atlantic/Canary", "Atlantic/Azores", "Atlantic/Madeira", "Atlantic/Reykjavik", "Atlantic/Faroe",
  "Indian/Reunion", "Indian/Mayotte", "America/Guadeloupe", "America/Martinique", "America/Cayenne",
]);

let started = false;
let enabled = false;

function doNotTrack() {
  const flags = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
  return flags.some((flag) => flag === "1" || flag === "yes");
}

// 計測してよい状況か（本番ドメイン・DNT 無効）
export function analyticsAllowed() {
  try {
    if (doNotTrack()) return false;
    return PRODUCTION_HOSTS.has(location.hostname);
  } catch {
    return false;
  }
}

export function getStoredConsent() {
  const value = loadJSON(CONSENT_KEY, null);
  return value === "granted" || value === "denied" ? value : null;
}

// 端末のタイムゾーンから「同意が要る地域にいそうか」を見る（バナー表示の判断だけに使う）
export function inConsentRegion() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    return CONSENT_REGION_ZONE_PREFIXES.some((prefix) => zone.startsWith(prefix)) || CONSENT_REGION_ZONES.has(zone);
  } catch {
    return false;
  }
}

// 同意バナーを出すべきか（計測する状況 + 同意が要る地域 + まだ選んでいない）
export function needsConsentPrompt() {
  return analyticsAllowed() && inConsentRegion() && getStoredConsent() === null;
}

function gtag() {
  window.dataLayer.push(arguments);
}

// 同意バナーの選択を反映する。granted なら以後 Cookie 付きの計測になる。
export function setAnalyticsConsent(granted) {
  saveJSON(CONSENT_KEY, granted ? "granted" : "denied");
  if (!enabled) return;
  gtag("consent", "update", { analytics_storage: granted ? "granted" : "denied" });
}

// 扉絵を抜けたあとに呼ぶ。実際の読み込みはアイドル時間まで遅らせる。
export function initAnalytics() {
  if (started) return;
  started = true;
  enabled = analyticsAllowed();
  if (!enabled) return;

  window.dataLayer = window.dataLayer ?? [];
  // 広告系はどこでも拒否。計測ストレージは EEA 等だけ既定で拒否し、他地域は許可する。
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    region: CONSENT_REQUIRED_REGIONS,
    wait_for_update: 500,
  });
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  // 同意済みの端末は、その場で許可へ更新する（地域を問わない）
  if (getStoredConsent() === "granted") gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  // ハッシュルーティングなので、ページビューは画面遷移で自前に送る
  gtag("config", MEASUREMENT_ID, { send_page_view: false });

  const load = () => {
    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT_URL;
    // オフラインや広告ブロックで失敗しても、握りつぶすだけで何も起きない
    script.addEventListener("error", () => {});
    document.head.append(script);
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 1200);
}

// 画面遷移。ハッシュそのものではなく画面名を送る（結果画面の startTime などは送らない）
export function trackPageView(screenName) {
  if (!enabled) return;
  gtag("event", "page_view", {
    page_title: screenName,
    page_location: `${location.origin}${location.pathname}#/${screenName}`,
  });
}

// 任意のイベント。値は数値・真偽・短い識別子だけにすること。
export function trackEvent(name, params = {}) {
  if (!enabled) return;
  gtag("event", name, params);
}
