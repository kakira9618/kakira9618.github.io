// 小さい・狭い画面での崩れ（過去に起きた回帰の検知）
import assert from "node:assert/strict";
import { openApp, settings, startPuzzle } from "./harness.mjs";

const cyber = settings({ theme: "cyber" });

export default [
  {
    // 320x460（iPhone SE 世代、アドレスバーぶんを引いた高さ）で「つづきから」が並ぶと、
    // 中央寄せでロゴが画面外へ押し出され、スクロールしても戻ってこられなくなっていた
    name: "tiny-title",
    page: { viewport: { width: 320, height: 460 } },
    storage: {
      "dwordle2.settings": cyber,
      "dwordle2.current.normal": { version: 1, gameMode: "normal", problemID: 20260722, startTime: 1700000000, guessWord: ["crane", "blood"], usoResults: [] },
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.locator(".logo").waitFor();
      const metrics = await page.evaluate(() => {
        const screen = document.getElementById("screen-title");
        screen.scrollTop = 0;
        const logoBox = document.querySelector(".logo").getBoundingClientRect();
        return { logoTop: Math.round(logoBox.top - screen.getBoundingClientRect().top) };
      });
      assert.ok(metrics.logoTop >= 0, `the title logo must stay reachable at 320x460: ${JSON.stringify(metrics)}`);
      // 下端（設定ボタン）まで実際にスクロールで届く
      await page.getByRole("button", { name: "設定" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "設定" }).waitFor();
    },
  },
  {
    // 375px（iPhone SE2 / 8 世代）のゲーム画面ヘッダー。詰めのメディアクエリが 374px までしか効かず
    // "DWORD..." に省略されていた。EXTRA SHOT 中のカウンタ（いちばん幅を食う）でも収まること
    name: "narrow-header",
    page: { viewport: { width: 375, height: 844 } },
    storage: { "dwordle2.settings": cyber },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      for (const mode of ["normal", "uso"]) {
        if (mode === "uso") await page.getByRole("button", { name: "裏モードへ" }).click();
        await page.getByRole("button", { name: "本日の問題", exact: true }).click();
        await page.waitForURL(/#\/game$/);
        await page.locator("#screen-game.active .row").last().waitFor();
        const metrics = await page.evaluate(() => {
          const measure = () => {
            const title = document.querySelector("#screen-game.active .header .title");
            const header = title.closest(".header");
            return { truncated: title.scrollWidth > title.clientWidth + 0.5, overflow: Math.round((header.scrollWidth - header.clientWidth) * 10) / 10 };
          };
          const normal = measure();
          const counter = document.querySelector("#screen-game .header span.sub");
          counter.classList.add("fa-counter");
          counter.replaceChildren(
            Object.assign(document.createElement("span"), { textContent: "EXTRA" }),
            Object.assign(document.createElement("span"), { textContent: "SHOT" })
          );
          return { normal, extraShot: measure() };
        });
        for (const [label, m] of Object.entries(metrics)) {
          assert.ok(!m.truncated && m.overflow <= 0, `the game header must not be ellipsized at 375px (${mode}, ${label}): ${JSON.stringify(metrics)}`);
        }
        await page.getByRole("button", { name: "タイトルへ戻る" }).click();
        await page.waitForURL(/#\/$/);
      }
    },
  },
  {
    // Pixel 3 相当の低いビューポートでもタイトルとゲーム画面が収まる
    name: "short-game",
    page: { viewport: { width: 393, height: 559 } },
    storage: { "dwordle2.settings": cyber },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const logoBox = await page.locator(".logo").boundingBox();
      assert.ok(logoBox && logoBox.y >= 0, "Title logo should remain visible on a short viewport");
      await page.getByRole("button", { name: "設定" }).scrollIntoViewIfNeeded();
      await startPuzzle(page, 1);
      const metrics = await page.evaluate(() => ({
        appHeight: document.getElementById("app").getBoundingClientRect().height,
        gameHeight: document.getElementById("screen-game").getBoundingClientRect().height,
        innerHeight,
      }));
      assert.ok(
        Math.abs(metrics.appHeight - metrics.innerHeight) <= 1 && Math.abs(metrics.gameHeight - metrics.innerHeight) <= 1,
        `the game screen should fill the visible viewport: ${JSON.stringify(metrics)}`
      );
    },
  },
];
