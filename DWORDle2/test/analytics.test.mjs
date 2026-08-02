// Google Analytics の Basic Consent Mode と送信内容のテスト。
// 実際の gtag.js は読み込まず、script 注入・dataLayer・Cookie 削除を確認する。
import assert from "node:assert/strict";

function currentConsent(state) {
  return { state, updatedAt: "2026-07-26T00:00:00.000Z", policyVersion: 1 };
}

// ブラウザ環境の最小モック。localStorage は store.js と同じ prefix で持つ。
function setupDom({ hostname = "kakira9618.github.io", doNotTrack = null, stored = {}, immediateIdle = true } = {}) {
  const scripts = [];
  const cookieWrites = [];
  const idleCallbacks = [];
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
  global.location = {
    hostname,
    origin: `https://${hostname}`,
    pathname: "/DWORDle2/",
    hash: "#/settings",
  };
  Object.defineProperty(global, "navigator", { value: { doNotTrack }, configurable: true, writable: true });
  global.document = {
    head,
    createElement: () => ({
      async: false,
      addEventListener() {},
      set src(value) { this._src = value; },
      get src() { return this._src; },
    }),
    get cookie() { return "_ga=client; _ga_JKQEWRGDSM=session; unrelated=keep"; },
    set cookie(value) { cookieWrites.push(value); },
  };
  global.requestIdleCallback = (callback) => {
    if (immediateIdle) callback();
    else idleCallbacks.push(callback);
  };
  const storage = new Map(Object.entries(stored).map(([key, value]) => [`dwordle2.${key}`, JSON.stringify(value)]));
  global.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  return { scripts, storage, cookieWrites, idleCallbacks };
}

// 未選択: 地域を問わずバナー対象だが、タグも dataLayer も作らない。
{
  const { scripts } = setupDom();
  const analytics = await import(`../js/core/analytics.js?case=unselected&v=20260803-a`);
  assert.equal(analytics.analyticsAllowed(), true);
  assert.equal(analytics.needsConsentPrompt(), true);
  analytics.initAnalytics();
  analytics.trackPageView("history");
  analytics.trackEvent("game_finish", { result: "clear" });
  assert.equal(scripts.length, 0, "同意前は gtag.js を読み込まない");
  assert.equal(window.dataLayer, undefined, "同意前は拒否 ping 用の dataLayer も作らない");
}

// 初回拒否: Google には何も積まず、構造化した選択と時刻を端末に保存する。
{
  const { scripts, storage, cookieWrites } = setupDom();
  const analytics = await import(`../js/core/analytics.js?case=decline&v=20260803-a`);
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(false);
  assert.equal(scripts.length, 0);
  assert.equal(window.dataLayer, undefined, "初回拒否では consent ping も送らない");
  const stored = JSON.parse(storage.get("dwordle2.analyticsConsent"));
  assert.equal(stored.state, "denied");
  assert.equal(stored.policyVersion, analytics.ANALYTICS_POLICY_VERSION);
  assert.match(stored.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(analytics.needsConsentPrompt(), false);
  assert.ok(cookieWrites.some((value) => value.startsWith("_ga=; Max-Age=0")), "拒否時は既存 _ga Cookie も消す");
  assert.ok(cookieWrites.some((value) => value.startsWith("_ga_JKQEWRGDSM=; Max-Age=0")), "コンテナ Cookie も消す");
  assert.equal(cookieWrites.some((value) => value.startsWith("unrelated=")), false, "無関係な Cookie は消さない");
}

// 明示同意: default denied → analytics granted の順に積み、初めてタグとイベントを準備する。
{
  const { scripts, storage } = setupDom();
  const analytics = await import(`../js/core/analytics.js?case=accept&v=20260803-a`);
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(true);
  assert.equal(scripts.length, 1, "同意後にだけ gtag.js を読み込む");
  assert.match(scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-JKQEWRGDSM$/);

  const pushed = window.dataLayer.map((args) => [...args]);
  const consents = pushed.filter((entry) => entry[0] === "consent");
  assert.deepEqual(consents[0].slice(0, 2), ["consent", "default"]);
  assert.deepEqual(consents[0][2], {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  assert.deepEqual(consents[1], ["consent", "update", { analytics_storage: "granted" }]);
  const config = pushed.find((entry) => entry[0] === "config");
  assert.deepEqual(config, ["config", "G-JKQEWRGDSM", { send_page_view: false }]);
  const initialPageView = pushed.find((entry) => entry[0] === "event" && entry[1] === "page_view");
  assert.equal(initialPageView[2].page_title, "settings", "同意時の現在画面を最初のページビューにする");
  assert.equal(JSON.parse(storage.get("dwordle2.analyticsConsent")).state, "granted");

  analytics.trackEvent("game_finish", { game_mode: "uso", result: "clear", guesses: 4, daily: false });
  const finish = window.dataLayer.map((args) => [...args]).find((entry) => entry[1] === "game_finish");
  assert.deepEqual(finish[2], { game_mode: "uso", result: "clear", guesses: 4, daily: false });
}

// 現行ポリシーへ同意済みなら、起動時にタグを読み込む。
{
  const { scripts } = setupDom({ stored: { analyticsConsent: currentConsent("granted") } });
  const analytics = await import(`../js/core/analytics.js?case=current-grant&v=20260803-a`);
  assert.equal(analytics.needsConsentPrompt(), false);
  analytics.initAnalytics();
  assert.equal(scripts.length, 1);
}

// 旧実装の granted は新しい全地域共通ポリシーへの同意ではないため、再確認する。
{
  const { scripts } = setupDom({ stored: { analyticsConsent: "granted" } });
  const analytics = await import(`../js/core/analytics.js?case=legacy-grant&v=20260803-a`);
  assert.equal(analytics.getStoredConsent(), null);
  assert.equal(analytics.needsConsentPrompt(), true);
  analytics.initAnalytics();
  assert.equal(scripts.length, 0);
}

// 旧実装の denied は尊重し、勝手に再確認・計測しない。
{
  const { scripts } = setupDom({ stored: { analyticsConsent: "denied" } });
  const analytics = await import(`../js/core/analytics.js?case=legacy-denied&v=20260803-a`);
  assert.equal(analytics.getStoredConsent(), "denied");
  assert.equal(analytics.needsConsentPrompt(), false);
  analytics.initAnalytics();
  assert.equal(scripts.length, 0);
}

// 同意後の撤回: denied をタグへ伝え、Cookie を消し、以後のゲームイベントを止める。
{
  const { cookieWrites } = setupDom();
  const analytics = await import(`../js/core/analytics.js?case=withdraw&v=20260803-a`);
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(true);
  const before = window.dataLayer.length;
  analytics.setAnalyticsConsent(false);
  analytics.trackEvent("game_finish", { result: "clear" });
  assert.equal(window.dataLayer.length, before + 1, "撤回の consent update 以外は積まない");
  assert.deepEqual([...window.dataLayer.at(-1)], ["consent", "update", { analytics_storage: "denied" }]);
  assert.ok(cookieWrites.length > 0);
}

// 同意直後、アイドル読み込み前に撤回した場合もタグを取得しない。再許可時は読み込める。
{
  const { scripts, idleCallbacks } = setupDom({ immediateIdle: false });
  const analytics = await import(`../js/core/analytics.js?case=idle-race&v=20260803-a`);
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(true);
  analytics.setAnalyticsConsent(false);
  idleCallbacks.shift()();
  assert.equal(scripts.length, 0, "アイドル待ち中の撤回を尊重する");
  analytics.setAnalyticsConsent(true);
  idleCallbacks.shift()();
  assert.equal(scripts.length, 1, "再許可後はタグ読み込みを再予約する");
}

// localhost と Do Not Track では、選択を求めずタグも読み込まない。
for (const [name, options] of [
  ["localhost", { hostname: "localhost" }],
  ["dnt", { doNotTrack: "1" }],
]) {
  const { scripts } = setupDom(options);
  const analytics = await import(`../js/core/analytics.js?case=${name}&v=20260803-a`);
  assert.equal(analytics.analyticsAllowed(), false);
  assert.equal(analytics.needsConsentPrompt(), false);
  analytics.initAnalytics();
  analytics.setAnalyticsConsent(true);
  assert.equal(scripts.length, 0);
  assert.equal(window.dataLayer, undefined);
}

console.log("アナリティクステスト: OK");
