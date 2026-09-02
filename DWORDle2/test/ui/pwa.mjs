// PWA: Service Worker が全資産を事前キャッシュし、オフラインでも起動・遷移できる
import assert from "node:assert/strict";
import { settings } from "./harness.mjs";

export default [
  {
    name: "offline",
    storage: { "dwordle2.settings": settings({ theme: "cyber" }) },
    async run({ page, context, baseUrl }) {
      // localhost では ?sw=1 のときだけ登録する（通常のテストページに SW が入り込まないように）
      await page.goto(`${baseUrl}?sw=1`, { waitUntil: "load" });
      await page.evaluate(() => navigator.serviceWorker.ready); // install（事前キャッシュ）完了まで待つ
      await context.setOffline(true);
      await page.reload({ waitUntil: "load" });
      await page.locator("#entry-gate .entry-gate-start").click();
      await page.locator("#entry-gate").waitFor({ state: "detached" });
      await page.locator("#screen-title.active .logo").waitFor();
      assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, "the offline page should be controlled by the service worker");
      await page.getByRole("button", { name: "設定" }).click();
      await page.waitForURL(/#\/settings$/);
      await page.getByRole("tab", { name: "サウンド" }).click();
      await page.getByRole("switch", { name: "BGM" }).waitFor();
      // プライバシーポリシーと About も事前キャッシュされ、オフラインのまま読める
      await page.goto(`${baseUrl}privacy.html`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "プライバシーポリシー", exact: true }).waitFor();
      await page.goto(`${baseUrl}about.html`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "このゲームについて・クレジット", exact: true }).waitFor();
      await context.setOffline(false);
    },
  },
];
