// デバッグモードの合言葉: 実績と隠し要素を一時的に全開放し、リロードで元に戻る（保存しない）
import assert from "node:assert/strict";
import { ACHIEVEMENTS, HIDDEN_ACHIEVEMENTS, NORMAL_ACHIEVEMENTS } from "../../js/core/achievements.js?v=20260806-a";
import { reveal } from "../../js/core/secret.js?v=20260806-a";
import { goHash, openApp, passGate, toast } from "./harness.mjs";

export default [
  {
    name: "debug",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/settings" });
      for (let i = 0; i < 5; i++) await page.locator(".debug-entry").click();
      const secretInput = page.getByRole("dialog", { name: "シークレット" }).getByLabel("秘密のキーワード");
      await secretInput.fill("WRONG");
      await secretInput.press("Enter");
      assert.equal(await toast(page, "キーワードが違います").count(), 1, "an incorrect secret should show one verdict");
      await secretInput.fill(reveal("fyod+1KILcM="));
      await secretInput.press("Enter");
      await page.getByText("DEBUG ON", { exact: true }).waitFor();
      const pop = page.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "ポップ" });
      assert.equal(await pop.getAttribute("aria-disabled"), "false", "debug mode should unlock the hidden theme");
      await pop.click();
      await page.getByRole("tab", { name: "サウンド" }).click();
      const finale = page.getByRole("radio", { name: "Grand Finale" });
      assert.equal(await finale.getAttribute("aria-disabled"), "false", "debug mode should unlock hidden BGM");
      await finale.click();

      // 進捗は「通常実績 / 総数 + 解放した隠し実績」。デバッグモードでは全解放なので隠し実績も全部並ぶ
      await goHash(page, "#/achievements");
      await page.locator("#screen-achievements .header .sub").filter({ hasText: `${NORMAL_ACHIEVEMENTS.length} / ${NORMAL_ACHIEVEMENTS.length} + ${HIDDEN_ACHIEVEMENTS.length}` }).waitFor();
      assert.equal(await page.locator("#screen-achievements .ach-card").count(), ACHIEVEMENTS.length, "debug mode should list every achievement");
      assert.equal(await page.locator("#screen-achievements .header .debug-status").count(), 1, "the DEBUG badge should show while debug mode is on");
      await goHash(page, "#/card");
      assert.equal(await page.locator("#screen-card .header .debug-status").count(), 1, "the player card screen should carry the DEBUG badge too");

      // リロードで解除され、デバッグ中の選択は保存されていない
      await goHash(page, "#/achievements");
      await page.reload({ waitUntil: "load" });
      await passGate(page);
      await page.locator("#screen-achievements .header .sub").filter({ hasText: `0 / ${NORMAL_ACHIEVEMENTS.length} + 0` }).waitFor();
      // 未解放の隠し実績は「？？？」の枠すら出さず、個数も伏せる
      assert.equal(await page.locator("#screen-achievements .ach-card").count(), NORMAL_ACHIEVEMENTS.length, "locked secret achievements must not appear");
      await page.locator("#screen-achievements .ach-hidden-empty").waitFor();
      await goHash(page, "#/settings");
      assert.equal(await page.locator(".debug-status").count(), 0, "reload should turn debug mode off");
      assert.equal(await page.getByRole("radiogroup", { name: "テーマ" }).getByRole("radio", { name: "???" }).getAttribute("aria-disabled"), "true");
      assert.equal(await page.locator("body.theme-classic").count(), 1, "debug-only theme selection must not persist");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.settings")).bgmTrack), "auto", "debug-only BGM selection must not persist");
    },
  },
];
