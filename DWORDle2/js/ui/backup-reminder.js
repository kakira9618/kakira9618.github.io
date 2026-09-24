// 手元への書き出し（エクスポート JSON の保存）と、それを促すダイアログ。
// ブラウザのデータを消すと端末内の保存はすべて消えるので、ブラウザの外へ出すのが唯一の予備。
// 判定は js/core/backup.js（shouldShowExportReminder）。

import { el } from "./dom.js?v=20260806-a";
import { showModal } from "./modal.js?v=20260806-a";
import { toast } from "./toast.js?v=20260806-a";
import { exportJSON } from "../core/records.js?v=20260806-a";
import { tr } from "../core/i18n.js?v=20260806-a";
import { markExported, remoteBackupStatus, shouldShowExportReminder, snoozeExportReminder } from "../core/backup.js?v=20260806-a";
import { BACKUP } from "../config.js?v=20260806-a";

const exportFileName = () => `dwordle2_history_${Date.now()}.json`;

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  el("a", { href: url, download: name }).click();
  // ダウンロード開始後に解放する（エクスポート連打で Blob が溜まらないように）
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// スマホは共有シート（ファイル・Drive・メッセージ等へ送れる）、それ以外はダウンロード。
// 保存できたら true。共有シートを閉じただけなら false（書き出し済みにしない）。
export async function saveExportFile({ preferShare = false } = {}) {
  const text = await exportJSON();
  const name = exportFileName();
  const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
  if (preferShare && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "DWORDle 2" });
      markExported();
      toast(tr("プレイ履歴を保存しました", "Play history saved"));
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      // 共有に失敗した環境はダウンロードへ切り替える
    }
  }
  download(text, name);
  markExported();
  toast(tr("プレイ履歴をダウンロードしました", "Play history downloaded"));
  return true;
}

const isTouchDevice = () => globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;

// ほかのダイアログ（初回案内・実績解除の演出・解放通知など）が開いているか
const otherDialogOpen = () => Boolean(document.querySelector('[aria-modal="true"]'));

// タイトル画面から呼ぶ。ほかのダイアログが開いていれば、閉じるまで待ってから出す。
export function maybeShowExportReminder(isStillOnScreen) {
  if (!shouldShowExportReminder()) return;
  let waited = 0;
  const tryShow = () => {
    if (!isStillOnScreen() || !shouldShowExportReminder()) return;
    if (otherDialogOpen()) {
      waited += BACKUP.reminder.retryMs;
      if (waited <= BACKUP.reminder.maxWaitMs) setTimeout(tryShow, BACKUP.reminder.retryMs);
      return;
    }
    showModal({
      title: tr("プレイ履歴のバックアップ", "Back up your play history"),
      body: [
        el(
          "p",
          {},
          remoteBackupStatus() === "on"
            ? tr(
                "プレイ履歴と実績は自動でバックアップされていますが、手元のファイルにも保存しておくとより安心です。",
                "Your play history and achievements are backed up automatically, but keeping a copy in a file is even safer."
              )
            : tr(
                "プレイ履歴と実績はこのブラウザの中にだけ保存されています。ブラウザのデータを削除すると消えてしまうので、ファイルに保存しておきませんか？",
                "Your play history and achievements are stored only in this browser. Clearing browser data erases them, so why not save a copy to a file?"
              )
        ),
        el(
          "p",
          { class: "hint" },
          tr(
            "保存したファイルは、設定 → データ →「プレイ履歴をインポート」から戻せます。",
            "You can restore the file from Settings → Data → Import play history."
          )
        ),
      ],
      actions: [
        { label: tr("あとで", "Later"), onClick: () => snoozeExportReminder() },
        {
          label: tr("ファイルに保存", "Save to file"),
          primary: true,
          onClick: async () => {
            if (!(await saveExportFile({ preferShare: isTouchDevice() }))) snoozeExportReminder();
          },
        },
      ],
      // 背景タップ・Esc で閉じたときも「あとで」と同じ扱い（すぐまた出さない）
      onClose: () => {
        if (shouldShowExportReminder()) snoozeExportReminder();
      },
    });
  };
  setTimeout(tryShow, BACKUP.reminder.delayMs);
}
