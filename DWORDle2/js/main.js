// エントリポイント。画面登録・ルータ起動・3D 背景・音声の初期化。

import { startRouter, initAppMode } from "./ui/app.js?v=20260723-gate-silent";
import { initEffects } from "./fx/effects.js?v=20260723-gate-silent";
import { initPopBackground } from "./fx/pop-background.js?v=20260723-gate-silent";
import { audioNeedsRecovery, bgmTracksUnlockedBy, restartBgmIfReady, stopBgm, unlockAudio } from "./audio/sound.js?v=20260723-gate-silent";
import { getSettings, onSettingsChange } from "./core/settings.js?v=20260723-gate-silent";
import { onMotionPreferenceChange, shouldReduceMotion } from "./core/motion.js?v=20260723-gate-silent";
import { syncDocumentLanguage, tr } from "./core/i18n.js?v=20260723-gate-silent";
import { reconcileAchievementsOnce } from "./core/achievements.js?v=20260723-gate-silent";
import { initActivity } from "./core/activity.js?v=20260723-gate-silent";
import { handlePhysicalKey, handlePhysicalKeyUp, releaseKeyboardPresses } from "./ui/game-screen.js?v=20260723-gate-silent";
import { onSaveError } from "./core/store.js";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } from "./ui/toast.js?v=20260723-gate-silent";
import { hiddenThemesUnlockedBy } from "./core/settings.js?v=20260723-gate-silent";
import { showEntryGate } from "./ui/gate.js?v=20260723-gate-silent";

// 画面モジュール（import するだけで registerScreen される）
import "./ui/title-screen.js?v=20260723-gate-silent";
import "./ui/game-screen.js?v=20260723-gate-silent";
import "./ui/result-screen.js?v=20260723-gate-silent";
import "./ui/history-screen.js?v=20260723-gate-silent";
import "./ui/problems-screen.js?v=20260723-gate-silent";
import "./ui/achievements-screen.js?v=20260723-gate-silent";
import "./ui/player-card.js?v=20260723-gate-silent";
import "./ui/analysis-screen.js?v=20260723-gate-silent";
import "./ui/settings-screen.js?v=20260723-gate-silent";

// 古い Android Chrome は dvh に未対応のため、実際の表示領域を CSS 変数で補う。
// 対応ブラウザでは CSS 側の 100dvh が優先される。
function syncAppViewportHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
}
syncAppViewportHeight();
addEventListener("resize", syncAppViewportHeight);
addEventListener("orientationchange", syncAppViewportHeight);
window.visualViewport?.addEventListener("resize", syncAppViewportHeight);

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
});
onMotionPreferenceChange(() => syncDisplayClasses());

initAppMode();
void initEffects();
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
// 「開始」タップが最初のユーザー操作になるため、上の pointerdown リスナで
// AudioContext が解錠され、BGM を最初から鳴らせる。
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
