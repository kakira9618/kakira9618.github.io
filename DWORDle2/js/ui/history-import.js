// 履歴インポート後のキャッシュ更新・実績復元・通知を各画面で共通化する。

import { _reload } from "../core/records.js";
import { checkOnEvent, reconcileAchievementsFromHistory } from "../core/achievements.js?v=20260722-unlock-analysis";
import { bgmTracksUnlockedBy } from "../audio/sound.js?v=20260722-unlock-analysis";
import { hiddenThemesUnlockedBy } from "../core/settings.js?v=20260722-unlock-analysis";
import { toast, achievementCelebration, bgmUnlockCelebration, themeUnlockCelebration } from "./toast.js?v=20260722-unlock-analysis";
import { tr } from "../core/i18n.js?v=20260722-unlock-analysis";

export function finishHistoryImport(added) {
  _reload();
  const newly = reconcileAchievementsFromHistory();
  if (added > 0) newly.push(...checkOnEvent("migrate"));

  if (added > 0) {
    toast(tr(`${added} 件のプレイ履歴をマージしました`, `Merged ${added} play ${added === 1 ? "record" : "records"}`));
  } else if (newly.length > 0) {
    toast(
      tr(
        `既存の履歴から ${newly.length} 件の実績を復元しました`,
        `Restored ${newly.length} ${newly.length === 1 ? "achievement" : "achievements"} from existing history`
      )
    );
  } else {
    toast(tr("新しくマージできる履歴は見つかりませんでした", "No new play records were found to merge"));
  }

  if (newly.length) {
    achievementCelebration(newly);
    const bgmUnlocks = bgmTracksUnlockedBy(newly);
    if (bgmUnlocks.length) bgmUnlockCelebration(bgmUnlocks);
    hiddenThemesUnlockedBy(newly).forEach(themeUnlockCelebration);
  }
  return newly;
}
