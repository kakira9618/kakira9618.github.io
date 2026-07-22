// エントリポイント。画面登録・ルータ起動・3D 背景・音声の初期化。

import { startRouter, initAppMode } from "./ui/app.js?v=20260722-card-polish";
import { initEffects } from "./fx/effects.js?v=20260722-card-polish";
import { initPopBackground } from "./fx/pop-background.js?v=20260722-card-polish";
import { audioNeedsRecovery, bgmTracksUnlockedBy, restartBgmIfReady, stopBgm, unlockAudio } from "./audio/sound.js?v=20260722-card-polish";
import { getSettings, onSettingsChange } from "./core/settings.js?v=20260722-card-polish";
import { onMotionPreferenceChange, shouldReduceMotion } from "./core/motion.js?v=20260722-card-polish";
import { syncDocumentLanguage, tr } from "./core/i18n.js?v=20260722-card-polish";
import { reconcileAchievementsOnce } from "./core/achievements.js?v=20260722-card-polish";
import { handlePhysicalKey, handlePhysicalKeyUp, releaseKeyboardPresses } from "./ui/game-screen.js?v=20260722-card-polish";
import { onSaveError } from "./core/store.js";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } from "./ui/toast.js?v=20260722-card-polish";
import { hiddenThemesUnlockedBy } from "./core/settings.js?v=20260722-card-polish";

// 画面モジュール（import するだけで registerScreen される）
import "./ui/title-screen.js?v=20260722-card-polish";
import "./ui/game-screen.js?v=20260722-card-polish";
import "./ui/result-screen.js?v=20260722-card-polish";
import "./ui/history-screen.js?v=20260722-card-polish";
import "./ui/problems-screen.js?v=20260722-card-polish";
import "./ui/achievements-screen.js?v=20260722-card-polish";
import "./ui/player-card.js?v=20260722-card-polish";
import "./ui/analysis-screen.js?v=20260722-card-polish";
import "./ui/settings-screen.js?v=20260722-card-polish";

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
  document.body.classList.toggle("reduce-motion", shouldReduceMotion(settings));
}
syncDisplayClasses();
syncDocumentLanguage();
onSettingsChange((settings, key) => {
  if (key === "theme" || key === "reduceFx") syncDisplayClasses(settings);
  if (key === "language") syncDocumentLanguage(settings.language);
});
onMotionPreferenceChange(() => syncDisplayClasses());

initAppMode();
void initEffects();
initPopBackground();

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
  if (!audioNeedsRecovery()) return;
  // リロード直後は、設定値を変えずに内部だけ停止→再生して音源スケジュールを作り直す。
  unlockAudio({ restartBgm: true });
};
// Safari は前面表示中にも AudioContext を中断することがあるため、監視は解除しない。
// running 中は上の状態確認だけで終了する。
addEventListener("pointerdown", unlock);
addEventListener("keydown", unlock);

// ダブルタップによる意図しない拡大だけを抑止する。
// ピンチズームは弱視ユーザーが利用できるようブラウザ標準のまま許可する。
document.addEventListener("dblclick", (event) => event.preventDefault(), { passive: false });

// バックグラウンド復帰時は、状態に応じて即時再生または次の操作で再接続する。
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopBgm();
  } else {
    restartBgmIfReady();
  }
});

const recoveredAchievements = reconcileAchievementsOnce();
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
