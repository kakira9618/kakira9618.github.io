// Google アナリティクスの読み込み条件と送信内容のテスト。
// 実際の gtag.js は読み込まず、dataLayer に何が積まれるかだけを見る。
import assert from "node:assert/strict";

// ブラウザ環境の最小モック。location と navigator を差し替えて読み込み条件を試す
function setupDom({ hostname = "kakira9618.github.io", doNotTrack = null } = {}) {
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
  return { scripts };
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
  const consent = pushed.find((entry) => entry[0] === "consent");
  assert.deepEqual(consent[2], {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  }, "広告系のストレージは既定で拒否する");
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

console.log("アナリティクステスト: OK");
