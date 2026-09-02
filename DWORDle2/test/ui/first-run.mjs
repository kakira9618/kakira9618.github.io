// 初回起動と段階解放: 案内の順番、メニューの鍵、遊び方の自動表示、裏モード解放
import assert from "node:assert/strict";
import { goHash, openApp, passGate, toast } from "./harness.mjs";

const legacyHistory = {
  version: 1,
  1700000100: { startTime: 1700000100, endTime: 1700000130, gameMode: "normal", problemID: 2, guessWord: ["point"], complete: true },
  1700000200: { startTime: 1700000200, endTime: 1700000230, gameMode: "normal", problemID: 3, guessWord: ["about"], complete: true },
};
const muted = { theme: "classic", sfx: false, sfxVolume: 0, bgm: false, bgmVolume: 0, language: "ja", reduceFx: true };

export default [
  {
    // 初回案内は基本ルール → 旧作の移行 → 同意バナーの順。0 プレイでは基本項目以外がロックされている
    name: "onboarding",
    fresh: true,
    storage: { "dwordle2.settings": muted, "tonyu-legacy-history": legacyHistory },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      // 本番の GA 条件はローカルでは無効なので、表示待機だけを明示的に開始する
      await page.evaluate(async () => (await import("./js/ui/consent-banner.js?v=20260806-a")).showConsentBannerAfterModals());
      const consent = page.getByRole("region", { name: "Cookie の設定" });
      const importDialog = page.getByRole("dialog", { name: "旧作のプレイ履歴が見つかりました" });
      const tutorial = page.getByRole("dialog", { name: "基本ルール | DWORDle" });
      await tutorial.waitFor();
      assert.equal(await consent.count(), 0, "analytics consent must not overlap the first tutorial");
      assert.equal(await importDialog.count(), 0, "legacy import must wait until the first tutorial closes");
      await tutorial.getByRole("button", { name: "わかった" }).click();
      await importDialog.waitFor();
      assert.equal(await consent.count(), 0, "analytics consent must not overlap the legacy import dialog");
      await importDialog.getByRole("button", { name: "スキップ" }).click();
      await consent.getByRole("button", { name: "拒否する" }).click();

      // タイトルメニューの段階解放。施錠中の項目は aria-disabled で、タップしても実行されない
      const lockedRandom = page.getByRole("button", { name: "ランダム（難しさを選択）（あと1回プレイで解放）", exact: true });
      await lockedRandom.waitFor();
      assert.equal(await lockedRandom.getAttribute("aria-disabled"), "true");
      await lockedRandom.click({ force: true }); // aria-disabled は actionability 待ちに掛かるので force
      assert.equal(await page.getByRole("dialog", { name: "ランダム（難しさを選択）" }).count(), 0, "a locked menu item must not run its action when tapped");
      await page.getByRole("button", { name: "裏モード（あと2回プレイで解放）", exact: true }).waitFor();
      await page.getByRole("button", { name: "プレイ履歴（あと1回プレイで解放）", exact: true }).waitFor();
      // 設定の隠し要素も施錠されている
      await page.getByRole("button", { name: "設定" }).click();
      await page.waitForURL(/#\/settings$/);
      assert.equal(await page.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "???" }).getAttribute("aria-disabled"), "true");
      await page.getByRole("tab", { name: "サウンド" }).click();
      assert.equal(await page.getByRole("radio", { name: "Grand Finale" }).getAttribute("aria-disabled"), "true");
    },
  },
  {
    // 遊び方を一度も開いていないモードは、盤面に入った時点で自動で開く（モード別に 1 回）
    name: "first-guide",
    storage: { "dwordle2.helpSeen": null, "dwordle2.helpSeenUso": null },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "本日の問題", exact: true }).click();
      await page.waitForURL(/#\/game$/);
      const guide = page.getByRole("dialog", { name: "DWORDle 遊び方" });
      await guide.waitFor();
      await guide.locator(".modal-actions").getByRole("button", { name: "閉じる" }).click();
      await guide.waitFor({ state: "detached" });
      // 一度開いたら、次に盤面へ入っても勝手には開かない
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await page.locator("#screen-game.active .row").last().waitFor();
      assert.equal(await guide.count(), 0, "the guide must not reopen once it has been read");
      // DWORDlie は別カウント
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await page.waitForURL(/#\/$/);
      await page.getByRole("button", { name: "裏モードへ" }).click();
      await page.getByRole("button", { name: "本日の問題", exact: true }).click();
      await page.waitForURL(/#\/game$/);
      await page.getByRole("dialog", { name: "DWORDlie 遊び方" }).waitFor();
    },
  },
  {
    // タイトルの基本ルールを読んだ人には詳しい遊び方を強制しない（説明の二重表示を防ぐ）
    name: "tutorial-first",
    storage: { "dwordle2.tutorialSeen": null, "dwordle2.helpSeen": null },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const basicRules = page.getByRole("dialog", { name: "基本ルール | DWORDle" });
      await basicRules.getByRole("button", { name: "わかった" }).click();
      await basicRules.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "本日の問題", exact: true }).click();
      await page.waitForURL(/#\/game$/);
      await page.locator("#screen-game.active .row").last().waitFor();
      assert.equal(await page.getByRole("dialog", { name: "DWORDle 遊び方" }).count(), 0, "the full guide must not be forced after the basic rules were acknowledged");
      await page.getByRole("button", { name: "遊び方" }).click();
      await page.getByRole("dialog", { name: "DWORDle 遊び方" }).waitFor();
    },
  },
  {
    // DWORDlie 解放の瞬間（seenPlays 1 → plays 2）はモーダルで案内し、そのまま裏モードへ切り替えられる
    name: "uso-unlock",
    fresh: true,
    storage: {
      "dwordle2.tutorialSeen": true, "dwordle2.tutorialSeenUso": true, "dwordle2.helpSeen": true, "dwordle2.helpSeenUso": true,
      "dwordle2.legacyImportPrompted": true, "dwordle2.playCount": 2, "dwordle2.menuUnlockSeen": 1,
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const dialog = page.getByRole("dialog", { name: "裏モード解放！" });
      await dialog.waitFor();
      // モーダル中は切り替えボタンの複製が暗幕の上に重なり、矢印が場所を指す
      await page.locator(".unlock-spotlight").waitFor();
      assert.equal(await page.locator(".unlock-arrow").count(), 1, "the guide arrow should point at the toggle");
      await dialog.getByRole("button", { name: "DWORDlie で遊ぶ" }).click();
      await page.locator(".logo").filter({ hasText: "DWORDlie" }).waitFor();
      await page.locator(".unlock-spotlight").waitFor({ state: "detached" });
      // 案内は解放の描画 1 回きり。リロード後は出ない
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await page.waitForTimeout(1200);
      assert.equal(await dialog.count(), 0, "the DWORDlie unlock modal must appear only once");
    },
  },
  {
    // 履歴インポートは機能の鍵（メニュー段階解放）に影響しない。鍵は実プレイ回数のみで開く
    name: "import-keeps-locks",
    fresh: true,
    storage: { "dwordle2.tutorialSeen": true, "dwordle2.helpSeen": true, "dwordle2.helpSeenUso": true, "tonyu-legacy-history": legacyHistory },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const importDialog = page.getByRole("dialog", { name: "旧作のプレイ履歴が見つかりました" });
      assert.equal(await importDialog.getByRole("checkbox").isChecked(), true, "the achievements checkbox should default to ON");
      await importDialog.getByRole("button", { name: "インポート" }).click();
      await toast(page, "件のプレイ履歴をマージしました").waitFor();
      await page.getByRole("button", { name: "ランダム（難しさを選択）（あと1回プレイで解放）", exact: true }).waitFor();
      await page.getByRole("button", { name: "裏モード（あと2回プレイで解放）", exact: true }).waitFor();
      assert.equal(await page.getByRole("dialog", { name: "裏モード解放！" }).count(), 0, "importing history must not open the DWORDlie unlock modal");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.playCount") ?? "null")), 0, "imported records must not increase the play count");
    },
  },
];
