// 自動生成ファイル。tools/make-source-hash.mjs が書き出す（手で編集しない）。
// DWORDle 2 の Service Worker。全資産をインストール時に事前キャッシュし、
// オフラインでも完全動作させる（キャッシュ優先 + ネットワークフォールバック）。
// キャッシュ名はソースハッシュ入りで、デプロイのたびに新しいキャッシュへ入れ替わる。
const CACHE_NAME = "dwordle2-407edaff";
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "favicon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-192.png",
  "icon-maskable-512.png",
  "css/style.css",
  "js/audio/sound.js",
  "js/config.js",
  "js/core/achievements.js",
  "js/core/activity.js",
  "js/core/analysis-core.js",
  "js/core/analysis.worker.js",
  "js/core/debug.js",
  "js/core/i18n.js",
  "js/core/logic.js",
  "js/core/migrate.js",
  "js/core/motion.js",
  "js/core/problems.js",
  "js/core/records.js",
  "js/core/settings.js",
  "js/core/store.js",
  "js/data/levels.js",
  "js/data/words.js",
  "js/fx/background.js",
  "js/fx/bursts.js",
  "js/fx/effects.js",
  "js/fx/pop-background.js",
  "js/main.js",
  "js/ui/a11y.js",
  "js/ui/achievements-screen.js",
  "js/ui/analysis-screen.js",
  "js/ui/app.js",
  "js/ui/dom.js",
  "js/ui/game-screen.js",
  "js/ui/gate.js",
  "js/ui/help.js",
  "js/ui/history-import.js",
  "js/ui/history-screen.js",
  "js/ui/icons.js",
  "js/ui/modal.js",
  "js/ui/player-card.js",
  "js/ui/problems-screen.js",
  "js/ui/result-screen.js",
  "js/ui/settings-screen.js",
  "js/ui/snapshot.js",
  "js/ui/sound-toggle.js",
  "js/ui/title-screen.js",
  "js/ui/toast.js",
  "js/version.js",
  "vendor/three-LICENSE.md",
  "vendor/three.module.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // GitHub Pages は max-age=600 なので、素の URL で取ると直近の訪問で残った
    // ブラウザ HTTP キャッシュの旧ファイルが新キャッシュに混入し、次のデプロイまで
    // 直らない。必ずサーバで再検証（If-Modified-Since）してから保存する。
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "no-cache" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// キャッシュ優先。?v= のキャッシュバスターはクエリを無視して照合する。
// キャッシュにない同一オリジンの GET はネットワークから取り、次回のために保存する。
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        const fallback = await cache.match("index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
