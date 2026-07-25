// Google Analytics 4（G-JKQEWRGDSM）。
//
// 方針:
// - 起動を遅くしない: gtag.js は静的に読み込まず、扉絵を抜けたあとのアイドル時間に注入する。
// - オフラインでも壊さない: 取得に失敗しても何もしない（dataLayer に積むだけで例外は出ない）。
//   PWA のプリキャッシュにも入れないので、オフライン起動でネットワークを待つことはない。
// - 個人を特定する値は送らない: プレイヤー名・入力単語・問題の答えなどは対象外。
//   送るのは画面名とゲーム結果の統計値だけ。
// - 広告系のシグナルは使わない: Consent Mode で ad_storage / ad_user_data /
//   ad_personalization を既定で denied にし、計測 Cookie 以外は持たせない。
// - Do Not Track を送っているブラウザでは、そもそも読み込まない。
// - 本番ドメイン以外（localhost やテスト）では読み込まない。

const MEASUREMENT_ID = "G-JKQEWRGDSM";
const PRODUCTION_HOSTS = new Set(["kakira9618.github.io"]);
const SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;

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

function gtag() {
  window.dataLayer.push(arguments);
}

// 扉絵を抜けたあとに呼ぶ。実際の読み込みはアイドル時間まで遅らせる。
export function initAnalytics() {
  if (started) return;
  started = true;
  enabled = analyticsAllowed();
  if (!enabled) return;

  window.dataLayer = window.dataLayer ?? [];
  // 広告系は使わないので既定で拒否。計測だけ許可する。
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
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
