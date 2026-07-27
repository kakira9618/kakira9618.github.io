// Google Analytics 4（G-JKQEWRGDSM）。
//
// プライバシー方針:
// - Basic Consent Mode: 明示的な同意を得るまで Google タグ自体を読み込まず、
//   同意状態を含めて Google へ何も送信しない。
// - 拒否後もゲームの全機能を利用できる。選択は設定からいつでも変更できる。
// - 個人を直接特定する値、プレイヤー名、入力単語、問題の答え、端末内の履歴は送らない。
//   送るのは画面名とゲーム結果の統計値だけ。
// - 広告系の保存・シグナルは常に拒否する。
// - Do Not Track を送っているブラウザ、本番ドメイン以外では読み込まない。
// - gtag.js は同意後もアイドル時間まで遅延し、オフラインやブロック時は何もしない。

import { loadJSON, saveJSON } from "./store.js?v=20260728-a";

const MEASUREMENT_ID = "G-JKQEWRGDSM";
const PRODUCTION_HOSTS = new Set(["kakira9618.github.io"]);
const SCRIPT_URL = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
const CONSENT_KEY = "analyticsConsent";
export const ANALYTICS_POLICY_VERSION = 1;

let initialized = false;
let allowed = false;
let tagInitialized = false;
let measurementActive = false;
let tagLoadScheduled = false;
let tagAppended = false;

function doNotTrack() {
  const flags = [navigator.doNotTrack, window.doNotTrack, navigator.msDoNotTrack];
  return flags.some((flag) => flag === "1" || flag === "yes");
}

// 計測機能を提供する環境か（本番ドメイン・DNT 無効）。
export function analyticsAllowed() {
  try {
    if (doNotTrack()) return false;
    return PRODUCTION_HOSTS.has(location.hostname);
  } catch {
    return false;
  }
}

export function getAnalyticsConsentRecord() {
  const value = loadJSON(CONSENT_KEY, null);
  if (
    value
    && typeof value === "object"
    && (value.state === "granted" || value.state === "denied")
    && value.policyVersion === ANALYTICS_POLICY_VERSION
  ) {
    return value;
  }
  // 旧実装の拒否はそのまま尊重する。同意は当時の地域限定・Advanced Consent の
  // 説明に対するものなので、新しい全地域共通ポリシーでは改めて確認する。
  if (value === "denied") {
    return { state: "denied", updatedAt: null, policyVersion: 0 };
  }
  return null;
}

export function getStoredConsent() {
  return getAnalyticsConsentRecord()?.state ?? null;
}

// 計測可能な環境で、現行ポリシーへの選択がまだ無い場合だけ表示する。
export function needsConsentPrompt() {
  return analyticsAllowed() && getStoredConsent() === null;
}

function gtag() {
  window.dataLayer.push(arguments);
}

function currentScreenName() {
  try {
    return location.hash.replace(/^#\/?/, "").split("/").filter(Boolean)[0] || "title";
  } catch {
    return "title";
  }
}

function scheduleTagLoad() {
  if (tagLoadScheduled || tagAppended) return;
  tagLoadScheduled = true;
  const load = () => {
    tagLoadScheduled = false;
    // 同意から実際のアイドル読み込みまでに撤回された場合もタグを取得しない。
    if (!measurementActive || getStoredConsent() !== "granted") return;
    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT_URL;
    script.addEventListener("error", () => {});
    document.head.append(script);
    tagAppended = true;
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 1200);
}

function startMeasurement() {
  if (!allowed || measurementActive) return;
  measurementActive = true;

  // 一度読み込んだタブで拒否→再許可された場合は、既存タグへ許可だけを伝える。
  if (tagInitialized) {
    gtag("consent", "update", { analytics_storage: "granted" });
    trackPageView(currentScreenName());
    scheduleTagLoad();
    return;
  }

  tagInitialized = true;
  window.dataLayer = window.dataLayer ?? [];
  // Basic Consent Mode の順序に合わせ、同意後に初めて default → update → tag load を行う。
  // 広告関連はユーザーの選択にかかわらず常に denied。
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  // ハッシュルーティングなので、ページビューは画面遷移で自前に送る。
  gtag("config", MEASUREMENT_ID, { send_page_view: false });
  trackPageView(currentScreenName());
  scheduleTagLoad();
}

// _ga / _ga_<container> はファーストパーティ Cookie なので、このオリジンから削除できる。
export function deleteAnalyticsCookies() {
  try {
    const names = document.cookie
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter((name) => name === "_ga" || name.startsWith("_ga_"));
    const hostname = location.hostname;
    const domains = [null, hostname, `.${hostname}`];
    const paths = ["/", location.pathname.replace(/[^/]*$/, "") || "/"];
    for (const name of new Set(names)) {
      for (const domain of domains) {
        for (const path of new Set(paths)) {
          const domainPart = domain ? `; Domain=${domain}` : "";
          document.cookie = `${name}=; Max-Age=0; Path=${path}${domainPart}; SameSite=Lax`;
        }
      }
    }
  } catch {
    // Cookie が無効・document が無い環境では何もしない。
  }
}

// 選択が変わったことを知りたい画面（設定画面の表示）に伝える。
// バナーで選んでも設定画面がその場で追随するように、保存経路をここ 1 つにまとめている。
const consentListeners = new Set();

export function onAnalyticsConsentChange(listener) {
  consentListeners.add(listener);
  return () => consentListeners.delete(listener);
}

// 同意バナー／設定の選択を保存し、その場で計測状態へ反映する。
export function setAnalyticsConsent(granted) {
  saveJSON(CONSENT_KEY, {
    state: granted ? "granted" : "denied",
    updatedAt: new Date().toISOString(),
    policyVersion: ANALYTICS_POLICY_VERSION,
  });
  // 計測の開始・停止より先に通知する（表示の更新は保存済みの選択だけで決まる）
  for (const listener of consentListeners) listener(granted ? "granted" : "denied");

  if (granted) {
    if (!initialized) {
      initialized = true;
      allowed = analyticsAllowed();
    }
    startMeasurement();
    return;
  }

  // 初回拒否時はタグも dataLayer も存在しないため、Google への拒否 ping も発生しない。
  // 過去に許可してタグが動いていた場合だけ撤回を伝え、以後のイベントを止める。
  if (tagInitialized) gtag("consent", "update", { analytics_storage: "denied" });
  measurementActive = false;
  deleteAnalyticsCookies();
}

// 扉絵を抜けたあとに呼ぶ。同意済みの場合だけ計測を準備する。
export function initAnalytics() {
  if (initialized) return;
  initialized = true;
  allowed = analyticsAllowed();
  if (!allowed || getStoredConsent() !== "granted") return;
  startMeasurement();
}

// 画面遷移。結果画面の startTime などを含むハッシュは送らない。
export function trackPageView(screenName) {
  if (!measurementActive) return;
  gtag("event", "page_view", {
    page_title: screenName,
    page_location: `${location.origin}${location.pathname}#/${screenName}`,
  });
}

// 任意のイベント。値は数値・真偽・短い識別子だけにすること。
export function trackEvent(name, params = {}) {
  if (!measurementActive) return;
  gtag("event", name, params);
}
