// エントリポイント。画面登録・ルータ起動・3D 背景・音声の初期化。
//
// 起動性能のための重要な約束: このファイルの静的 import は「扉絵を出すのに必要なもの」だけ。
// ES Modules は依存グラフ全体を取得し終えるまで一行も実行しないため、ここに画面モジュールを
// 静的 import すると、扉絵の描画がアプリ全体（242KB gz / 45 モジュール）の到着待ちになる。
// 画面・実績・トーストは扉絵を出したあとに appReady が動的 import する
// （扉絵到達 70KB gz / 19 モジュール。中位 Android 相当で約 1 秒短縮）。

import { startRouter, initAppMode } from "./ui/app.js?v=20260728-a";
import { initEffects } from "./fx/effects.js?v=20260728-a";
import { initPopBackground } from "./fx/pop-background.js?v=20260728-a";
import { audioNeedsRecovery, bgmTracksUnlockedBy, restartBgmIfReady, scheduleAudioRecovery, stopBgm, unlockAudio } from "./audio/sound.js?v=20260728-a";
import { getSettings, onSettingsChange, hiddenThemesUnlockedBy } from "./core/settings.js?v=20260728-a";
import { onMotionPreferenceChange, shouldReduceMotion } from "./core/motion.js?v=20260728-a";
import { syncDocumentLanguage, tr } from "./core/i18n.js?v=20260728-a";
import { initActivity } from "./core/activity.js?v=20260728-a";
import { initAnalytics } from "./core/analytics.js?v=20260728-a";
import { maybeShowConsentBanner } from "./ui/consent-banner.js?v=20260728-a";
import { onSaveError } from "./core/store.js?v=20260728-a";
import { showEntryGate } from "./ui/gate.js?v=20260728-a";
import { VIEWPORT } from "./config.js?v=20260728-a";

// トーストは扉絵の critical path から外してある（保存エラー・SW 更新は稀で、即時性も要らない）
function notify(message) {
  void import("./ui/toast.js?v=20260728-a")
    .then((m) => m.toast(message))
    .catch(() => {});
}

// 扉絵の裏でアプリ本体を読み込む。解決値は「履歴から復元された実績」。
// 画面モジュールは import するだけで registerScreen される。
const appReady = (async () => {
  await Promise.all([
    import("./ui/title-screen.js?v=20260728-a"),
    import("./ui/game-screen.js?v=20260728-a"),
    import("./ui/result-screen.js?v=20260728-a"),
    import("./ui/history-screen.js?v=20260728-a"),
    import("./ui/problems-screen.js?v=20260728-a"),
    import("./ui/achievements-screen.js?v=20260728-a"),
    import("./ui/player-card.js?v=20260728-a"),
    import("./ui/analysis-screen.js?v=20260728-a"),
    import("./ui/settings-screen.js?v=20260728-a"),
  ]);
  // 物理キーボード（ゲーム画面が読み込まれてから登録する。扉絵の間は入力を受けない）
  const { handlePhysicalKey, handlePhysicalKeyUp, releaseKeyboardPresses } =
    await import("./ui/game-screen.js?v=20260728-a");
  addEventListener("keydown", handlePhysicalKey);
  addEventListener("keyup", handlePhysicalKeyUp);
  addEventListener("blur", releaseKeyboardPresses);
  // 履歴からの実績復元。重いのは初回（RECONCILE_VERSION 更新後）だけで、
  // ここに置くことで扉絵の描画を塞がなくなる。
  const { reconcileAchievementsOnce } = await import("./core/achievements.js?v=20260728-a");
  return reconcileAchievementsOnce();
})();
// 失敗の扱いは扉絵側（再読み込みを促して閉じない）。ここでは未処理リジェクト警告だけ抑える。
appReady.catch(() => {});

// 古い Android Chrome は dvh に未対応のため、実際の表示領域を CSS 変数で補う。
// 対応ブラウザでは CSS 側の 100dvh が優先される。
function syncAppViewportHeight() {
  // ピンチズーム中は更新しない。iOS Safari の innerHeight は拡大すると「見えている高さ」に
  // 縮むため、そのまま反映すると UI 全体が縮んでしまう（レイアウトの高さは本来変わらない）。
  if ((window.visualViewport?.scale ?? 1) > 1.01) return;
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}
syncAppViewportHeight();
addEventListener("resize", syncAppViewportHeight);
addEventListener("orientationchange", syncAppViewportHeight);
window.visualViewport?.addEventListener("resize", syncAppViewportHeight);

// Android は --font-display の Avenir Next 等を持たず Roboto の細字にフォールバックして
// 全体が細く見えるため、iPhone / Safari を基準に sans-serif-medium へ寄せる（CSS 側で上書き）
if (/Android/i.test(navigator.userAgent)) document.body.classList.add("android-font");

// PWA: Service Worker（sw.js は tools/make-source-hash.mjs が生成）が全資産を
// 事前キャッシュし、オフラインでも完全動作する。
// ローカル開発・テストでは通常は登録しない（?sw=1 で明示的に有効化。オフラインのテストが使う）
{
  const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator && (!isLocalHost || new URLSearchParams(location.search).has("sw"))) {
    // ブラウザ任せの更新チェックはナビゲーション時に走るとは限らず（検証で未検知を確認）、
    // 常駐した PWA は新デプロイに気づけない。起動直後・前面復帰時・一定間隔で明示的に確認する。
    const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
    navigator.serviceWorker.register("sw.js").then((registration) => {
      const checkForUpdate = () => registration.update().catch(() => {});
      checkForUpdate();
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkForUpdate();
      });
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
    }).catch(() => {});
    // 緊急フラグ付きのデプロイ（`npm run hash -- --force-reload`）だけは、プレイ中でも
    // 強制的に最新版へ載せ替える。安全な瞬間まで待つ・同じ版で繰り返さないの 2 点は
    // critical-update.js が持つ。
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "critical-update") return;
      void import("./core/critical-update.js?v=20260728-a").then((m) => {
        m.requestCriticalReload(event.data.hash, {
          notify: () =>
            notify(
              tr(
                "重要な更新があります。まもなく自動で再読み込みします",
                "An important update is ready. The page will reload shortly."
              )
            ),
        });
      });
    });
    // activate 時の通知は、この listener を付ける前に飛んでいることがある
    // （旧キャッシュから開いた直後に新 SW が有効化された場合）。取りこぼしを自分から拾う。
    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({ type: "query-critical-update" });
    }).catch(() => {});

    // 新しい SW への切替 = 新デプロイの事前キャッシュ完了。扉絵の間なら再読み込みだけで
    // 最新版になるので自動で行い、プレイが始まっていたらトーストで知らせるに留める。
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadedForUpdate) return; // 初回インストール時は何もしない
      reloadedForUpdate = true;
      if (document.getElementById("entry-gate")) {
        location.reload();
      } else {
        notify(tr("新しいバージョンがあります。再読み込みで最新になります", "A new version is available. Reload to get the latest."));
      }
    });
  }
}

// テーマの初期反映
function syncDisplayClasses(settings = getSettings()) {
  document.body.classList.toggle("theme-cyber", settings.theme === "cyber");
  document.body.classList.toggle("theme-classic", settings.theme === "classic");
  document.body.classList.toggle("theme-pop", settings.theme === "pop");
  document.body.classList.toggle("high-contrast", Boolean(settings.highContrast));
  document.body.classList.toggle("reduce-motion", shouldReduceMotion(settings));
}

// 設定「ズーム固定」。既定はズーム可で、ON のときだけ viewport メタと
// touch-action（body.zoom-locked → CSS 変数）の二段構えで拡大を封じる。
function syncZoomLock(settings = getSettings()) {
  const locked = Boolean(settings.lockZoom);
  document.body.classList.toggle("zoom-locked", locked);
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", locked ? VIEWPORT.locked : VIEWPORT.base);
}
syncDisplayClasses();
syncZoomLock();
syncDocumentLanguage();
onSettingsChange((settings, key) => {
  if (key === "theme" || key === "reduceFx" || key === "highContrast") syncDisplayClasses(settings);
  if (key === "lockZoom") syncZoomLock(settings);
  if (key === "language") syncDocumentLanguage(settings.language);
  if (key === "theme" && settings.theme === "cyber") void initEffects(); // 後から cyber に切り替えたら遅延初期化
});
onMotionPreferenceChange(() => syncDisplayClasses());

initAppMode();
// Three.js は cyber テーマでしか使わないので、そのときだけ読み込む
// （classic / pop では 680KB のダウンロードとパースを丸ごと省ける）。
// さらに、取得を初回描画のあとまで遅らせる: 682KB のパース / WebGLRenderer の初期化は
// メインスレッドを塞ぐため、即座に始めると扉絵の描画が約 700ms 後ろへずれる。
// rAF 2 回で「最初のフレームを描き終えた次のフレーム」まで待つ。
// requestIdleCallback への置き換えも試したが、扉絵の描画直後にメインスレッドが空くため
// three.js の取得開始は約 1790ms で同じになり、FCP / LCP / TBT のいずれも変わらなかった
// （CPU 4 倍 + Slow 4G で 5 回ずつ実測）。効果が無いぶん単純なこちらを使う。
if (getSettings().theme === "cyber") {
  requestAnimationFrame(() => requestAnimationFrame(() => void initEffects()));
}
initPopBackground();
initActivity(); // 行動ログ（クリック・画面滞在・打鍵などを端末内に記録）

// 保存失敗（容量超過・プライベートモード等）はリロードでデータが消えるため必ず知らせる。
// 1 ゲーム中は保存が連続するので、トーストは 10 秒に 1 回に抑える。
let lastSaveErrorToastAt = 0;
onSaveError(() => {
  const now = Date.now();
  if (now - lastSaveErrorToastAt < 10000) return;
  lastSaveErrorToastAt = now;
  notify(
    tr(
      "データを保存できませんでした。ブラウザの保存領域を確認してください",
      "Could not save your data. Please check the browser's storage."
    )
  );
});

// 最初のユーザー操作で AudioContext を解錠（ブラウザの自動再生制限対策）
const unlock = () => {
  // 扉絵の表示中は解錠しない（ボタン以外のタップで音が鳴らないように）。
  // 扉絵の「開始」ボタンが gate.js 内で明示的に unlockAudio する。
  if (document.getElementById("entry-gate")) return;
  if (!audioNeedsRecovery()) return;
  // リロード直後は、設定値を変えずに内部だけ停止→再生して音源スケジュールを作り直す。
  unlockAudio({ restartBgm: true });
};
// Safari は前面表示中にも AudioContext を中断することがあるため、監視は解除しない。
// running 中は上の状態確認だけで終了する。
addEventListener("pointerdown", unlock);
addEventListener("keydown", unlock);

// ズーム固定のときだけ、viewport / touch-action が効かない環境向けの保険として
// ダブルタップ拡大も直接抑止する（既定のズーム可では何もしない）。
document.addEventListener(
  "dblclick",
  (event) => {
    if (getSettings().lockZoom) event.preventDefault();
  },
  { passive: false }
);

// バックグラウンド復帰時は、そのまま再生できるならすぐ鳴らし、
// AudioContext が中断されていたら操作を待たずに復帰を試みる（数回リトライ）。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopBgm();
  } else if (!restartBgmIfReady()) {
    scheduleAudioRecovery({ userReturn: true });
  }
});
// スリープ復帰やウィンドウ切替は visibilitychange を伴わないことがあるため、
// フォーカスが戻ったときにも確認する（鳴っていれば scheduleAudioRecovery は何もしない）。
// userReturn: 戻ってきた合図なので、自動復帰の打ち切り回数をここでリセットする。
addEventListener("focus", () => scheduleAudioRecovery({ userReturn: true }));
addEventListener("pageshow", () => scheduleAudioRecovery({ userReturn: true }));

// エントリーゲート（扉絵）を通ってから本来の画面へ入る。
// 扉絵の間はグローバル解錠を止めており（上の unlock 参照）、
// 「開始」タップのユーザー操作スタック内で gate.js が明示的に解錠して BGM を鳴らす。
// 解放セレブレーションもゲート通過後に出す（ゲートの上に被せない・無音で流さない）。
// ready を渡すと、扉絵は本体の読み込みが終わるまで退場を待つ（未完了なら読込表示になる）。
showEntryGate(
  async () => {
    const recoveredAchievements = await appReady;
    startRouter();
    initAnalytics(); // Google Analytics（明示同意済みの場合だけ、アイドル時間に読み込む）
    // 本番で未選択の場合に表示。初回ルール・履歴移行のモーダルがある間は待ち、
    // すべて閉じた後でバナーを出す。拒否してもゲーム機能は変わらない。
    maybeShowConsentBanner();
    if (recoveredAchievements.length) {
      setTimeout(async () => {
        const { achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } =
          await import("./ui/toast.js?v=20260728-a");
        achievementCelebration(recoveredAchievements);
        const bgmUnlocks = bgmTracksUnlockedBy(recoveredAchievements);
        if (bgmUnlocks.length) {
          bgmUnlockCelebration(bgmUnlocks);
        }
        hiddenThemesUnlockedBy(recoveredAchievements).forEach(themeUnlockCelebration);
      }, 350);
    }
  },
  { ready: appReady }
);
