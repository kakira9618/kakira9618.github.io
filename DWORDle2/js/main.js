// エントリポイント。画面登録・ルータ起動・3D 背景・音声の初期化。

import { startRouter, initAppMode } from "./ui/app.js";
import { initBackground } from "./fx/background.js";
import { initBursts } from "./fx/bursts.js";
import { bgmTracksUnlockedBy, unlockAudio } from "./audio/sound.js";
import { getSettings, onSettingsChange } from "./core/settings.js";
import { syncDocumentLanguage } from "./core/i18n.js";
import { reconcileAchievementsOnce } from "./core/achievements.js";
import { handlePhysicalKey, handlePhysicalKeyUp, releaseKeyboardPresses } from "./ui/game-screen.js";
import { achievementToast, bgmUnlockCelebration } from "./ui/toast.js";

// 画面モジュール（import するだけで registerScreen される）
import "./ui/title-screen.js";
import "./ui/game-screen.js";
import "./ui/result-screen.js";
import "./ui/history-screen.js";
import "./ui/problems-screen.js";
import "./ui/achievements-screen.js";
import "./ui/analysis-screen.js";
import "./ui/settings-screen.js";

// テーマの初期反映
const theme = getSettings().theme;
document.body.classList.toggle("theme-cyber", theme === "cyber");
document.body.classList.toggle("theme-classic", theme === "classic");
syncDocumentLanguage();
onSettingsChange((settings, key) => {
  if (key === "language") syncDocumentLanguage(settings.language);
});

initAppMode();
initBackground();
initBursts();

// 物理キーボード
addEventListener("keydown", handlePhysicalKey);
addEventListener("keyup", handlePhysicalKeyUp);
addEventListener("blur", releaseKeyboardPresses);

// 最初のユーザー操作で AudioContext を解錠（ブラウザの自動再生制限対策）
const unlock = () => {
  unlockAudio().then((isReady) => {
    if (!isReady) return;
    removeEventListener("pointerdown", unlock);
    removeEventListener("keydown", unlock);
  });
};
addEventListener("pointerdown", unlock);
addEventListener("keydown", unlock);

const recoveredAchievements = reconcileAchievementsOnce();
startRouter();
if (recoveredAchievements.length) {
  setTimeout(() => {
    achievementToast(recoveredAchievements);
    const bgmUnlocks = bgmTracksUnlockedBy(recoveredAchievements);
    if (bgmUnlocks.length) {
      bgmUnlockCelebration(bgmUnlocks, recoveredAchievements.length * 700 + 3400);
    }
  }, 350);
}
