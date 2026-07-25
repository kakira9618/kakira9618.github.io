// Google アナリティクスの読み込み条件と送信内容のテスト。
// 実際の gtag.js は読み込まず、dataLayer に何が積まれるかだけを見る。
import assert from "node:assert/strict";

// ブラウザ環境の最小モック。location と navigator を差し替えて読み込み条件を試す
function setupDom({ hostname = "kakira9618.github.io", doNotTrack = null, timeZone = "Asia/Tokyo", stored = {} } = {}) {
  const scripts = [];
  const head = {
    append(node) {
      scripts.push(node);
    },
  };
  global.window = {
    dataLayer: undefined,
    doNotTrack: null,
    addEventListener() {},
  };
  global.location = { hostname, origin: `https://${hostname}`, pathname: "/DWORDle2/" };
  // Node 24 の navigator は getter のみなので defineProperty で差し替える
  Object.defineProperty(global, "navigator", { value: { doNotTrack }, configurable: true, writable: true });
  global.document = {
    head,
    createElement: () => ({ addEventListener() {}, set src(value) { this._src = value; }, get src() { return this._src; } }),
  };
  global.requestIdleCallback = (callback) => callback();
  // store.js が使う localStorage の最小モック
  const storage = new Map(Object.entries(stored).map(([key, value]) => [`dwordle2.${key}`, JSON.stringify(value)]));
  global.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  global.Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) };
  return { scripts, storage };
}

// 本番ドメイン: 読み込まれ、広告シグナルは既定で拒否される
{
  const { scripts } = setupDom();
  const analytics = await import(`../js/core/analytics.js?case=production&v=20260725-b`);
  assert.equal(analytics.analyticsAllowed(), true);
  analytics.initAnalytics();
  assert.equal(scripts.length, 1, "本番ドメインでは gtag.js を読み込む");
  assert.match(scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-JKQEWRGDSM$/);

  const pushed = window.dataLayer.map((args) => [...args]);
  const consents = pushed.filter((entry) => entry[0] === "consent");
  assert.equal(consents[0][2].region.includes("DE"), true, "EEA には region 付きの既定を置く");
  assert.equal(consents[0][2].analytics_storage, "denied", "EEA は同意まで計測ストレージを拒否する");
  assert.deepEqual(consents[1][2], {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  }, "対象地域以外は計測のみ許可・広告系は拒否");
  const config = pushed.find((entry) => entry[0] === "config");
  assert.equal(config[1], "G-JKQEWRGDSM");
  assert.deepEqual(config[2], { send_page_view: false }, "ページビューはハッシュ遷移で自前に送る");

  analytics.trackPageView("achievements");
  analytics.trackEvent("game_finish", { game_mode: "uso", result: "clear", guesses: 4, daily: false });
  const events = window.dataLayer.map((args) => [...args]).filter((entry) => entry[0] === "event");
  assert.equal(events[0][1], "page_view");
  assert.equal(events[0][2].page_title, "achievements");
  assert.equal(events[1][1], "game_finish");
  assert.deepEqual(events[1][2], { game_mode: "uso", result: "clear", guesses: 4, daily: false });
}

// localhost（開発・テスト）では読み込まない
{
  const { scripts } = setupDom({ hostname: "localhost" });
  const analytics = await import(`../js/core/analytics.js?case=localhost&v=20260725-b`);
  assert.equal(analytics.analyticsAllowed(), false);
  analytics.initAnalytics();
  analytics.trackEvent("game_finish", { result: "clear" });
  assert.equal(scripts.length, 0, "本番ドメイン以外では読み込まない");
  assert.equal(window.dataLayer, undefined, "計測しないときは dataLayer も作らない");
}

// Do Not Track を送っているブラウザでは読み込まない
{
  const { scripts } = setupDom({ doNotTrack: "1" });
  const analytics = await import(`../js/core/analytics.js?case=dnt&v=20260725-b`);
  assert.equal(analytics.analyticsAllowed(), false);
  analytics.initAnalytics();
  assert.equal(scripts.length, 0, "DNT のときは読み込まない");
}


// 同意バナーの表示条件と、同意後の consent update
{
  const { storage } = setupDom({ timeZone: "Europe/Berlin" });
  const analytics = await import(`../js/core/analytics.js?case=eea&v=20260725-b`);
  assert.equal(analytics.inConsentRegion(), true, "欧州のタイムゾーンは同意が必要な地域とみなす");
  assert.equal(analytics.needsConsentPrompt(), true, "未選択ならバナーを出す");
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(true);
  const updates = window.dataLayer.map((args) => [...args]).filter((entry) => entry[0] === "consent" && entry[1] === "update");
  assert.deepEqual(updates.at(-1)[2], { analytics_storage: "granted" }, "同意すると計測ストレージを許可する");
  assert.equal(storage.get("dwordle2.analyticsConsent"), '"granted"', "選択は端末に保存する");
  assert.equal(analytics.needsConsentPrompt(), false, "一度選んだら再表示しない");
}

// 日本など対象外の地域ではバナーを出さない
{
  setupDom({ timeZone: "Asia/Tokyo" });
  const analytics = await import(`../js/core/analytics.js?case=jp&v=20260725-b`);
  assert.equal(analytics.inConsentRegion(), false);
  assert.equal(analytics.needsConsentPrompt(), false, "対象外の地域にはバナーを出さない");
}

// 同意済みの端末は、起動時にそのまま granted へ更新する
{
  setupDom({ timeZone: "Europe/Paris", stored: { analyticsConsent: "granted" } });
  const analytics = await import(`../js/core/analytics.js?case=eea-granted&v=20260725-b`);
  assert.equal(analytics.needsConsentPrompt(), false);
  analytics.initAnalytics();
  const updates = window.dataLayer.map((args) => [...args]).filter((entry) => entry[0] === "consent" && entry[1] === "update");
  assert.deepEqual(updates[0][2], { analytics_storage: "granted" });
}

console.log("アナリティクステスト: OK");
