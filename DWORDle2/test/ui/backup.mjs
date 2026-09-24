// プレイデータのバックアップ: カード発行済みなら起動時に暗号化して送る・未発行なら送らない・
// 失敗しても黙って次の機会へ回す・設定画面の表示と停止・書き出しの促し
import assert from "node:assert/strict";
import { decryptBackup } from "../../js/core/backup-crypto.js?v=20260806-a";
import { BACKUP } from "../../js/config.js?v=20260806-a";
import { assertNoSeriousA11yViolations, openApp, goHash, toast, TEST_BACKUP_ENDPOINT, useTestBackupEndpoint } from "./harness.mjs";

const PLAYER_ID = "1A2B3C4D";
const games = (count) => Array.from({ length: count }, (_, i) => ({
  gameMode: "normal", problemID: 200 + i, startTime: 1750000000 + i * 86400, endTime: 1750000300 + i * 86400, guessWord: ["about", "crane"], clear: i % 2 === 0,
}));
const issued = {
  "dwordle2.playerId": PLAYER_ID,
  "dwordle2.playerCard": { name: "テスト", issuedAt: 1750000000 },
  "dwordle2.history": games(3),
};

const isBackupRequest = (url) => url.href === `${TEST_BACKUP_ENDPOINT}/backup`;

// 送られた封筒を受け取って返す
function captureBackups(page, { status = 200 } = {}) {
  const bodies = [];
  const ready = page.route(isBackupRequest, async (route) => {
    bodies.push(route.request().postData());
    await route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  });
  return { bodies, ready };
}

const backupState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.backup") ?? "null"));
const runBackup = (page) => page.evaluate(async () => (await import("./js/core/backup.js?v=20260806-a")).maybeBackup());

export default [
  {
    // 起動から少し待って送る。中身はプレイヤー ID で復号でき、ID そのものは載っていない
    name: "remote",
    storage: issued,
    async run({ page, baseUrl }) {
      const { bodies, ready } = captureBackups(page);
      await ready;
      await openApp(page, baseUrl);
      await useTestBackupEndpoint(page);
      await page.waitForFunction(() => localStorage.getItem("dwordle2.backup")?.includes("lastSuccessAt"), null, { timeout: BACKUP.startupDelayMs + 8000 });
      assert.equal(bodies.length, 1);
      assert.ok(!bodies[0].includes(PLAYER_ID), "the player ID itself must not be sent");
      const restored = JSON.parse(await decryptBackup(PLAYER_ID, JSON.parse(bodies[0])));
      assert.equal(restored.app, "dwordle2");
      assert.equal(restored.history.length, 3, "the backup must hold the same content as an export");
      // 中身が変わっていなければ送り直さない
      assert.equal(await runBackup(page), "skipped");
      assert.equal(bodies.length, 1);

      // 設定: 状態とプレイヤー ID を出し、OFF にできる
      await goHash(page, "#/settings");
      await page.getByRole("tab", { name: "データ" }).click();
      const panel = page.getByRole("tabpanel");
      await panel.getByText(/最終バックアップ: \d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}/).waitFor();
      // プレイヤー ID はタップでコピーできる
      await page.evaluate(() => {
        navigator.clipboard.writeText = (text) => {
          window.__copiedText = text;
          return Promise.resolve();
        };
      });
      await panel.getByRole("button", { name: `プレイヤー ID ${PLAYER_ID} をコピー` }).click();
      await toast(page, "クリップボードにコピーしました").waitFor();
      assert.equal(await page.evaluate(() => window.__copiedText), PLAYER_ID);
      await assertNoSeriousA11yViolations(page, "Settings data tab with backup");
      await panel.getByRole("switch", { name: "自動バックアップ" }).click();
      await panel.getByText("オフ", { exact: true }).waitFor();
      const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.settings")));
      assert.equal(settings.autoBackup, false);
    },
  },
  {
    // カード未発行なら ID を作らず、何も送らない
    name: "no-card",
    storage: { "dwordle2.history": games(3) },
    async run({ page, baseUrl }) {
      const { bodies, ready } = captureBackups(page);
      await ready;
      await openApp(page, baseUrl);
      await useTestBackupEndpoint(page);
      assert.equal(await runBackup(page), "skipped");
      assert.equal(bodies.length, 0);
      assert.equal(await page.evaluate(() => localStorage.getItem("dwordle2.playerId")), null, "must not issue a player ID just to back up");
      await goHash(page, "#/settings");
      await page.getByRole("tab", { name: "データ" }).click();
      await page.getByRole("tabpanel").getByText("プレイヤーカードを発行すると有効になります").waitFor();
    },
  },
  {
    // サーバーが落ちていても画面には何も出さず、少し間を置いてから再挑戦する
    name: "failure",
    storage: issued,
    async run({ page, baseUrl, errors }) {
      const { bodies, ready } = captureBackups(page, { status: 503 });
      await ready;
      await openApp(page, baseUrl);
      await useTestBackupEndpoint(page);
      assert.equal(await runBackup(page), "failed");
      assert.equal(bodies.length, 1);
      const state = await backupState(page);
      assert.ok(state.lastAttemptAt > 0 && !state.lastSuccessAt);
      assert.equal(await runBackup(page), "skipped", "must wait before retrying");
      assert.equal(await page.locator("#toast-layer .toast").count(), 0, "a failed backup must stay silent");
      // 503 のリソース読み込みエラーはブラウザが出すもの（アプリの例外ではない）
      errors.splice(0, errors.length, ...errors.filter((e) => !e.includes("503")));
    },
  },
  {
    // 遊び込んだのに一度も書き出していなければ、タイトルでファイル保存を促す。
    // 保存すれば次からは出ない。
    name: "export-reminder",
    storage: { "dwordle2.history": games(BACKUP.reminder.minPlays), "dwordle2.exportReminder": null },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const dialog = page.getByRole("dialog", { name: "プレイ履歴のバックアップ" });
      await dialog.waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog.getByRole("button", { name: "ファイルに保存" }).click(),
      ]);
      assert.match(download.suggestedFilename(), /^dwordle2_history_\d+\.json$/);
      await dialog.waitFor({ state: "detached" });
      await page.reload();
      await page.locator("#entry-gate .entry-gate-start").click();
      await page.waitForTimeout(BACKUP.reminder.delayMs + 500);
      assert.equal(await dialog.count(), 0, "must not ask again right after saving");
    },
  },
  {
    // 「あとで」でも、しばらくは出さない
    name: "export-reminder-later",
    storage: { "dwordle2.history": games(BACKUP.reminder.minPlays), "dwordle2.exportReminder": null },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const dialog = page.getByRole("dialog", { name: "プレイ履歴のバックアップ" });
      await dialog.getByRole("button", { name: "あとで" }).click();
      await page.reload();
      await page.locator("#entry-gate .entry-gate-start").click();
      await page.waitForTimeout(BACKUP.reminder.delayMs + 500);
      assert.equal(await dialog.count(), 0);
    },
  },
  {
    // 起動時の実績解除の演出と重ならない（閉じてから出る）。実際に重なって出ていた回帰
    name: "export-reminder-after-celebration",
    storage: {
      "dwordle2.history": games(BACKUP.reminder.minPlays),
      "dwordle2.exportReminder": null,
      "dwordle2.achievements.reconcileVersion": null,
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const reminder = page.getByRole("dialog", { name: "プレイ履歴のバックアップ" });
      const celebration = page.locator('[aria-modal="true"]').filter({ hasText: "実績" }).first();
      await celebration.waitFor();
      await page.waitForTimeout(BACKUP.reminder.delayMs + 500);
      assert.equal(await reminder.count(), 0, "must wait while another dialog is open");
      // 解除演出は続けて出る（実績 → BGM 解放など）。すべて閉じたら出る
      const other = page.locator('[aria-modal="true"]:not(#entry-gate)');
      for (let i = 0; i < 10 && (await reminder.count()) === 0; i++) {
        if ((await other.count()) > 0) await other.first().getByRole("button").last().click();
        await page.waitForTimeout(BACKUP.reminder.retryMs + 200);
      }
      await reminder.waitFor();
    },
  },
];
