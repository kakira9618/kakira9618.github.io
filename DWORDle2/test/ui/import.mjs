// 履歴インポート: 「実績も解除する」の選択、貼り付け取り込みの制限、署名の照合
import assert from "node:assert/strict";
import { goHash, openApp, passGate, toast } from "./harness.mjs";

export default [
  {
    name: "opt-out-and-signature",
    fresh: true,
    storage: {
      "dwordle2.tutorialSeen": true, "dwordle2.helpSeen": true, "dwordle2.helpSeenUso": true,
      "dwordle2.legacyImportPrompted": true, // 自動提案は出さず、設定から入る
      "tonyu-legacy-history": {
        version: 1,
        1700000100: { startTime: 1700000100, endTime: 1700000130, gameMode: "normal", problemID: 2, guessWord: ["point"], complete: true },
      },
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "設定", exact: true }).click();
      await page.getByRole("tab", { name: "データ" }).click();
      await page.getByRole("button", { name: "履歴をインポート（移行）" }).click();
      const dialog = page.getByRole("dialog", { name: "履歴のインポート（移行）" });
      await dialog.getByRole("checkbox").uncheck();
      await dialog.getByRole("button", { name: "DWORDle / DWORDlie を自動検出" }).click();
      await toast(page, "件のプレイ履歴をマージしました").waitFor();
      // withAchievements を渡し忘れるとレコードに noAchievements が付かず、
      // 後の再集計（RECONCILE_VERSION 更新後の初回起動）で断ったはずの実績が解除されてしまう
      const state = await page.evaluate(() => ({
        history: JSON.parse(localStorage.getItem("dwordle2.history") ?? "[]"),
        achievements: Object.keys(JSON.parse(localStorage.getItem("dwordle2.achievements") ?? "{}")),
      }));
      assert.equal(state.history.length, 1, "the record should still be imported");
      assert.equal(state.history[0].noAchievements, true, "auto-detect must honour the unchecked achievements box");
      assert.deepEqual(state.achievements, [], "no achievement should be unlocked by the opt-out import");
      // 将来のリリースでの再集計を再現する（reconcileVersion を消して再起動）
      await page.evaluate(() => localStorage.removeItem("dwordle2.achievements.reconcileVersion"));
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await page.waitForTimeout(800);
      assert.deepEqual(
        await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("dwordle2.achievements") ?? "{}"))),
        [],
        "a later reconcile must not unlock achievements the player declined"
      );

      // 貼り付けからの取り込みは本作のエクスポート専用。旧作の履歴は自動検出へ案内する
      await goHash(page, "#/settings");
      await page.getByRole("tab", { name: "データ" }).click();
      await page.getByRole("button", { name: "プレイ履歴をインポート（移行）", exact: true }).click();
      const pasteDialog = page.getByRole("dialog", { name: "履歴のインポート（移行）" });
      await pasteDialog.getByText("JSONから手動で取り込む").click();
      const pasteBox = pasteDialog.locator("textarea");
      await pasteBox.fill(JSON.stringify({
        version: 1,
        1700000900: { startTime: 1700000900, endTime: 1700000930, gameMode: "normal", problemID: 3, guessWord: ["point"], complete: true },
      }));
      await pasteDialog.getByRole("button", { name: "JSONを取り込む" }).click();
      await toast(page, "旧 DWORDle / DWORDlie の履歴は「自動検出」から取り込んでください").waitFor();

      // 署名の合わない JSON は 1 件も取り込まない（実績も解除しない）
      const exported = JSON.parse(await page.evaluate(async () => (await import("./js/core/records.js?v=20260806-a")).exportJSON()));
      assert.match(exported.signature, /^[0-9a-f]{64}$/, "the export should carry a signature");
      const before = await page.evaluate(() => ({ history: localStorage.getItem("dwordle2.history"), achievements: localStorage.getItem("dwordle2.achievements") }));
      await pasteBox.fill(JSON.stringify({
        ...exported,
        // 実績が付くように仕立てた偽レコード（1 手クリア）を足す
        history: [...exported.history, { startTime: 1700009000, endTime: 1700009010, gameMode: "normal", problemID: 4, guessWord: ["point"], clear: true }],
      }));
      await pasteDialog.getByRole("button", { name: "JSONを取り込む" }).click();
      await toast(page, "JSON が書き出したときと違います").waitFor();
      assert.deepEqual(
        await page.evaluate(() => ({ history: localStorage.getItem("dwordle2.history"), achievements: localStorage.getItem("dwordle2.achievements") })),
        before,
        "an edited export must change neither the history nor the achievements"
      );
    },
  },
];
