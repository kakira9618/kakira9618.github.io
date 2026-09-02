// タイトル画面: メニュー・つづきから・公開メタデータ・ハイコントラスト
import assert from "node:assert/strict";
import { openApp } from "./harness.mjs";

export default [
  {
    name: "menu",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "本日の問題", exact: true }).waitFor();
      await page.getByRole("button", { name: "ランダム（難しさを選択）", exact: true }).click();
      const randomDialog = page.getByRole("dialog", { name: "ランダム（難しさを選択）" });
      await randomDialog.locator(".random-level-option").first().waitFor();
      await randomDialog.getByRole("button", { name: "閉じる" }).click();
      await randomDialog.waitFor({ state: "detached" });

      // OGP・manifest・アイコンが配信されていること（PWA インストールに 192 / 512 が必須）
      const meta = await page.evaluate(async () => {
        const manifest = await (await fetch("manifest.webmanifest")).json();
        const icons = manifest.icons ?? [];
        const urls = ["favicon.png", "og.jpg", "og-square.png", ...icons.map((icon) => icon.src)];
        const statuses = await Promise.all(urls.map(async (url) => (await fetch(new URL(url, location.href))).status));
        return {
          title: document.title,
          ogImage: document.querySelector('meta[property="og:image"]')?.content,
          twitterImage: document.querySelector('meta[name="twitter:image"]')?.content,
          iconSizes: icons.flatMap((icon) => String(icon.sizes ?? "").split(/\s+/)),
          statuses,
        };
      });
      assert.equal(meta.title, "DWORDle 2 | 新感覚ワードパズル");
      assert.equal(meta.ogImage, "https://kakira9618.github.io/DWORDle2/og.jpg");
      assert.equal(meta.twitterImage, "https://kakira9618.github.io/DWORDle2/og-square.png");
      assert.ok(meta.iconSizes.includes("192x192") && meta.iconSizes.includes("512x512"), "manifest needs 192 and 512 icons");
      assert.ok(meta.statuses.length >= 5 && meta.statuses.every((status) => status === 200), `public assets should be served: ${meta.statuses}`);
    },
  },
  {
    name: "continue",
    storage: {
      "dwordle2.current.normal": { startTime: 1_700_000_000, gameMode: "normal", problemID: 20260722, guessWord: ["about", "other", "pouch"] },
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: /つづきから.*Daily 2026-07-22・3手/ }).waitFor();
    },
  },
  {
    // ハイコントラスト配色: 設定 ON で判定色が置き換わり、OFF で戻る
    name: "high-contrast",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const tileCorrect = () => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--tile-correct").trim());
      const setHighContrast = (on) => page.evaluate(async (value) => {
        (await import("./js/core/settings.js?v=20260806-a")).setSetting("highContrast", value);
      }, on);
      const normal = await tileCorrect();
      await setHighContrast(true);
      assert.ok(await page.evaluate(() => document.body.classList.contains("high-contrast")), "enabling high contrast should add the body class");
      assert.notEqual(await tileCorrect(), normal, "high contrast should replace the correct-tile color");
      await setHighContrast(false);
      assert.equal(await tileCorrect(), normal, "disabling high contrast should restore the theme colors");
    },
  },
];
