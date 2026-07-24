// エントリポイント。画面登録・ルータ起動・3D 背景・音声の初期化。

import { startRouter, initAppMode } from "./ui/app.js?v=20260723-fa";
import { initEffects } from "./fx/effects.js?v=20260723-fa";
import { initPopBackground } from "./fx/pop-background.js?v=20260723-fa";
import { audioNeedsRecovery, bgmTracksUnlockedBy, restartBgmIfReady, stopBgm, unlockAudio } from "./audio/sound.js?v=20260723-fa";
import { getSettings, onSettingsChange } from "./core/settings.js?v=20260723-fa";
import { onMotionPreferenceChange, shouldReduceMotion } from "./core/motion.js?v=20260723-fa";
import { syncDocumentLanguage, tr } from "./core/i18n.js?v=20260723-fa";
import { reconcileAchievementsOnce } from "./core/achievements.js?v=20260723-fa";
import { initActivity } from "./core/activity.js?v=20260723-fa";
import { handlePhysicalKey, handlePhysicalKeyUp, releaseKeyboardPresses } from "./ui/game-screen.js?v=20260723-fa";
import { onSaveError } from "./core/store.js?v=20260723-fa";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } from "./ui/toast.js?v=20260723-fa";
import { hiddenThemesUnlockedBy } from "./core/settings.js?v=20260723-fa";
import { showEntryGate } from "./ui/gate.js?v=20260723-fa";

// 画面モジュール（import するだけで registerScreen される）
import "./ui/title-screen.js?v=20260723-fa";
import "./ui/game-screen.js?v=20260723-fa";
import "./ui/result-screen.js?v=20260723-fa";
import "./ui/history-screen.js?v=20260723-fa";
import "./ui/problems-screen.js?v=20260723-fa";
import "./ui/achievements-screen.js?v=20260723-fa";
import "./ui/player-card.js?v=20260723-fa";
import "./ui/analysis-screen.js?v=20260723-fa";
import "./ui/settings-screen.js?v=20260723-fa";

// 古い Android Chrome は dvh に未対応のため、実際の表示領域を CSS 変数で補う。
// 対応ブラウザでは CSS 側の 100dvh が優先される。
function syncAppViewportHeight() {
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
        toast(tr("新しいバージョンがあります。再読み込みで最新になります", "A new version is available. Reload to get the latest."));
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
syncDisplayClasses();
syncDocumentLanguage();
onSettingsChange((settings, key) => {
  if (key === "theme" || key === "reduceFx" || key === "highContrast") syncDisplayClasses(settings);
  if (key === "language") syncDocumentLanguage(settings.language);
  if (key === "theme" && settings.theme === "cyber") void initEffects(); // 後から cyber に切り替えたら遅延初期化
});
onMotionPreferenceChange(() => syncDisplayClasses());

initAppMode();
// Three.js は cyber テーマでしか使わないので、そのときだけ読み込む
// （classic / pop では 680KB のダウンロードとパースを丸ごと省ける）
if (getSettings().theme === "cyber") void initEffects();
initPopBackground();
initActivity(); // 行動ログ（クリック・画面滞在・打鍵などを端末内に記録）

// 保存失敗（容量超過・プライベートモード等）はリロードでデータが消えるため必ず知らせる。
// 1 ゲーム中は保存が連続するので、トーストは 10 秒に 1 回に抑える。
let lastSaveErrorToastAt = 0;
onSaveError(() => {
  const now = Date.now();
  if (now - lastSaveErrorToastAt < 10000) return;
  lastSaveErrorToastAt = now;
  toast(
    tr(
      "データを保存できませんでした。ブラウザの保存領域を確認してください",
      "Could not save your data. Please check the browser's storage."
    )
  );
});

// 物理キーボード
addEventListener("keydown", handlePhysicalKey);
addEventListener("keyup", handlePhysicalKeyUp);
addEventListener("blur", releaseKeyboardPresses);

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

// ズームは全面禁止（viewport の user-scalable=no + CSS touch-action: pan-x pan-y）。
// これはそれらが効かない環境向けの保険として、ダブルタップ拡大も直接抑止する。
document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });

// バックグラウンド復帰時は、状態に応じて即時再生または次の操作で再接続する。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopBgm();
  } else {
    restartBgmIfReady();
  }
});

// エントリーゲート（扉絵）を通ってから本来の画面へ入る。
// 扉絵の間はグローバル解錠を止めており（上の unlock 参照）、
// 「開始」タップのユーザー操作スタック内で gate.js が明示的に解錠して BGM を鳴らす。
// 解放セレブレーションもゲート通過後に出す（ゲートの上に被せない・無音で流さない）。
const recoveredAchievements = reconcileAchievementsOnce();
showEntryGate(() => {
  startRouter();
  if (recoveredAchievements.length) {
    setTimeout(() => {
      achievementCelebration(recoveredAchievements);
      const bgmUnlocks = bgmTracksUnlockedBy(recoveredAchievements);
      if (bgmUnlocks.length) {
        bgmUnlockCelebration(bgmUnlocks);
      }
      hiddenThemesUnlockedBy(recoveredAchievements).forEach(themeUnlockCelebration);
    }, 350);
  }
});
