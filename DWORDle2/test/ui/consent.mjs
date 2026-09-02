// 計測の同意バナーと設定画面の連動、全データ削除
import assert from "node:assert/strict";
import { PRODUCTION_HOST, goHash, launchBrowser, openApp, openPage, passGate } from "./harness.mjs";

export default [
  {
    name: "banner-and-delete",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      // バナーは本番ドメインだけ自動表示されるため、ローカルでは明示表示する
      await page.evaluate(async () => (await import("./js/ui/consent-banner.js?v=20260806-a")).showConsentBanner());
      const banner = page.getByRole("region", { name: "Cookie の設定" });
      await banner.getByRole("link", { name: "プライバシーポリシー" }).waitFor();
      await banner.getByRole("button", { name: "拒否する" }).click();
      const denied = await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.analyticsConsent")));
      assert.equal(denied.state, "denied");

      await goHash(page, "#/settings");
      await page.getByRole("tab", { name: "データ" }).click();
      await page.getByText("この環境では Google アナリティクスを読み込みません。", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "計測を停止" }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "計測を許可" }).isDisabled(), true);

      // 全データ削除: プレイヤーカード・同意・GA の Cookie まで消え、扉絵から始まる
      await page.evaluate(() => {
        localStorage.setItem("dwordle2.playerCard", JSON.stringify({ name: "テスト", issuedAt: 1, seenRankTier: 1 }));
        localStorage.setItem("dwordle2.playerId", JSON.stringify("0123ABCD"));
        document.cookie = "_ga=smoke; Path=/; SameSite=Lax";
      });
      await page.getByRole("button", { name: "全データ削除" }).click();
      const deleteDialog = page.getByRole("dialog", { name: "全データ削除" });
      await deleteDialog.getByText("旧作 DWORDle / DWORDlie のデータは削除されません。").waitFor();
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load" }),
        deleteDialog.getByRole("button", { name: "OK" }).click(),
      ]);
      assert.match(page.url(), /#\/$/, "Deleting all data should reload at the title route");
      await passGate(page);
      await page.locator("#screen-title.active").waitFor();
      const deleted = await page.evaluate(() => ({
        card: localStorage.getItem("dwordle2.playerCard"),
        playerId: localStorage.getItem("dwordle2.playerId"),
        analyticsConsent: localStorage.getItem("dwordle2.analyticsConsent"),
        cookie: document.cookie,
      }));
      assert.deepEqual([deleted.card, deleted.playerId, deleted.analyticsConsent], [null, null, null], "Deleting all data must remove player-card data and the analytics choice");
      assert.equal(deleted.cookie.includes("_ga="), false, "Deleting all data must remove the GA cookie");
    },
  },
  {
    // 同意バナーで選んだら、開いたままの設定画面がその場で追随する（リロード不要）。
    // 計測は本番ホストでしか有効にならないので、名前解決だけ本番ドメインへ向けたブラウザを別に立てる。
    name: "production-live-update",
    page: false,
    async run({ port }) {
      const browser = await launchBrowser({ args: [`--host-resolver-rules=MAP ${PRODUCTION_HOST} 127.0.0.1`] });
      try {
        const { page, context, errors } = await openPage(browser, { axe: false });
        // GA 本体は読みに行かない（外部ネットワークに出ない）
        await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.fulfill({ body: "", contentType: "text/javascript" }));
        await page.goto(`http://${PRODUCTION_HOST}:${port}/`, { waitUntil: "load" });
        await passGate(page);
        await goHash(page, "#/settings");
        await page.getByRole("tab", { name: "データ" }).click();
        await page.getByText("現在: 未選択（同意するまで送信しません）", { exact: true }).waitFor();

        await page.evaluate(async () => (await import("./js/ui/consent-banner.js?v=20260806-a")).showConsentBanner());
        await page.getByRole("region", { name: "Cookie の設定" }).getByRole("button", { name: "同意する" }).click();
        await page.getByText("現在: 許可（いつでも停止できます）", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "計測を許可" }).isDisabled(), true, "allowing from the banner should update the settings without a reload");
        assert.equal(await page.getByRole("button", { name: "計測を停止" }).isDisabled(), false);
        await page.getByRole("button", { name: "計測を停止" }).click();
        await page.getByText("現在: 停止", { exact: true }).waitFor();
        assert.deepEqual(errors, [], `Runtime errors:\n${errors.join("\n")}`);
      } finally {
        await browser.close();
      }
    },
  },
];
