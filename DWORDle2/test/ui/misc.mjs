// 環境差への対応: Three.js の読み込み失敗・reduced motion・Android のフォント・モード配色と行動ログ
import assert from "node:assert/strict";
import { openApp, settings, startPuzzle } from "./harness.mjs";

const cyber = settings({ theme: "cyber" });

export default [
  {
    // Three.js が読めなくてもタイトルとゲームは動く（背景演出だけ諦める）
    name: "three-fallback",
    allowErrors: true,
    storage: { "dwordle2.settings": cyber },
    async run({ page, baseUrl }) {
      await page.route("**/vendor/three.module.min.js", (route) => route.abort("failed"));
      await openApp(page, baseUrl);
      await page.locator("#screen-title.active .logo").waitFor();
      await startPuzzle(page, 1);
    },
  },
  {
    name: "reduced-motion",
    page: { reducedMotion: "reduce" },
    storage: { "dwordle2.settings": settings({ theme: "cyber", reduceFx: false }) },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.locator("body.reduce-motion").waitFor();
      await startPuzzle(page, 1);
      assert.equal(
        await page.evaluate(async () => (await import("./js/fx/effects.js?v=20260806-a")).activeTileFlightCount()),
        0,
        "Reduced motion should suppress tile gather flights"
      );
    },
  },
  {
    // Android は Roboto 細字へのフォールバックを避け、sans-serif-medium へ寄せる
    name: "android-font",
    page: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" },
    async run({ page, baseUrl }) {
      await page.goto(baseUrl, { waitUntil: "load" });
      await page.locator("#entry-gate .entry-gate-start").waitFor();
      assert.equal(await page.evaluate(() => document.body.classList.contains("android-font")), true, "Android should get the android-font body class");
      assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /sans-serif-medium/);
    },
  },
  {
    // 履歴から別モードの記録を開いたときは、その記録のモードの配色で表示し、離れたら戻す。
    // あわせて行動ログ（画面滞在・クリック・テーマ使用時間）が記録される
    name: "mode-color-and-activity",
    storage: {
      "dwordle2.settings": cyber,
      "dwordle2.mode": "normal",
      "dwordle2.history": [{ gameMode: "uso", problemID: 300, startTime: 1750000000, endTime: 1750000300, guessWord: ["about", "crane"], clear: true }],
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      assert.equal(await page.evaluate(() => document.body.classList.contains("mode-normal")), true, "the app should start in DWORDle mode");
      await page.evaluate(() => { location.hash = "#/result/uso/1750000000"; });
      await page.waitForFunction(() => document.body.classList.contains("mode-uso"));
      await page.evaluate(() => { location.hash = "#/history"; });
      await page.waitForFunction(() => document.body.classList.contains("mode-normal") && !document.body.classList.contains("mode-uso"));

      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await page.waitForURL(/#\/$/);
      const activity = await page.evaluate(() => {
        window.dispatchEvent(new Event("pagehide")); // 保留中のログを書き出させる
        return JSON.parse(localStorage.getItem("dwordle2.activity"));
      });
      assert.ok(activity?.screens?.history?.visits >= 1, "screen visits should be tracked");
      assert.ok(Object.keys(activity.counters).some((key) => key.startsWith("click:")), "button clicks should be tracked");
      assert.ok(activity.usage?.themes?.cyber > 0, `theme usage time should be tracked (usage: ${JSON.stringify(activity.usage)})`);
      assert.equal(await page.evaluate(async () => (await import("./js/core/activity.js?v=20260806-a")).favoriteThemeId()), "cyber");
    },
  },
];
