// 設定画面: タブ構成・隠しテーマ・ズーム固定・言語
import assert from "node:assert/strict";
import { ACHIEVEMENTS } from "../../js/core/achievements.js?v=20260806-a";
import { assertNoSeriousA11yViolations, openApp, settings, waitForColorSettle } from "./harness.mjs";

const allUnlocked = Object.fromEntries(ACHIEVEMENTS.map((achievement) => [achievement.id, 1]));

export default [
  {
    name: "tabs",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "設定" }).click();
      await page.waitForURL(/#\/settings$/);
      const tabs = page.getByRole("tab");
      await tabs.first().waitFor();
      assert.deepEqual(await tabs.allTextContents(), ["表示", "ゲーム", "サウンド", "データ"]);
      assert.equal(await page.getByRole("tab", { name: "表示" }).getAttribute("aria-selected"), "true");
      for (const label of ["ハイコントラスト配色", "判定マーク", "キーボードヒント", "演出を軽くする", "ズーム固定"]) {
        await page.getByRole("switch", { name: label }).waitFor();
      }
      await page.getByRole("tab", { name: "ゲーム" }).click();
      await page.getByRole("switch", { name: "EXTRA SHOT" }).waitFor();
      await page.getByRole("tab", { name: "サウンド" }).click();
      for (const label of ["効果音", "BGM"]) await page.getByRole("switch", { name: label }).waitFor();
      await page.getByRole("tab", { name: "データ" }).click();
      await page.getByRole("button", { name: "履歴をインポート（移行）" }).waitFor();
      assert.equal(await page.getByRole("tabpanel").count(), 1, "Only the selected settings category should be exposed");
      await assertNoSeriousA11yViolations(page, "Settings screen");
      // カテゴリ（タブ）は覚えない: 開き直すと「表示」から始まる
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await page.getByRole("button", { name: "設定" }).click();
      await page.waitForURL(/#\/settings$/);
      assert.equal(await page.getByRole("tab", { name: "表示" }).getAttribute("aria-selected"), "true", "the settings category must reset to Display");
    },
  },
  {
    // 隠しテーマ「ポップ」: 実績解放済みなら選べ、DWORDlie でも配色が成立する（a11y で確認）
    name: "pop-theme",
    storage: { "dwordle2.achievements": allUnlocked },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/settings" });
      await page.getByRole("radio", { name: "ポップ", exact: true }).click();
      await page.locator("body.theme-pop").waitFor();
      await page.evaluate(async () => (await import("./js/ui/app.js?v=20260806-a")).setAppMode("uso"));
      await page.locator("body.theme-pop.mode-uso").waitFor();
      await page.getByRole("tab", { name: "サウンド" }).click();
      await page.getByRole("switch", { name: "BGM" }).waitFor();
      await waitForColorSettle(page, "#settings-tab-display");
      await assertNoSeriousA11yViolations(page, "Pop DWORDlie settings");
    },
  },
  {
    // ズームは既定で許可し、設定「ズーム固定」を ON にしたときだけ封じる
    name: "zoom-lock",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const read = () => page.evaluate(() => ({
        viewport: document.querySelector('meta[name="viewport"]').getAttribute("content"),
        touchAction: getComputedStyle(document.body).touchAction,
        locked: document.body.classList.contains("zoom-locked"),
      }));
      const setLock = (on) => page.evaluate(async (value) => {
        (await import("./js/core/settings.js?v=20260806-a")).setSetting("lockZoom", value);
      }, on);
      const initial = await read();
      assert.equal(initial.viewport.includes("user-scalable=no"), false, "Zoom must be allowed by default");
      assert.equal(initial.touchAction, "manipulation");
      await setLock(true);
      const locked = await read();
      assert.ok(locked.viewport.includes("user-scalable=no") && locked.locked, `Lock zoom must add the no-zoom viewport: ${locked.viewport}`);
      assert.equal(locked.touchAction, "pan-x pan-y", "Lock zoom must block pinch zoom");
      await setLock(false);
      assert.deepEqual(await read(), initial, "Turning the lock off must restore the defaults");
    },
  },
  {
    // 言語 3 択のラベルは言語設定にかかわらず固定。English で UI が切り替わる
    name: "language",
    storage: { "dwordle2.settings": settings({ language: "en" }) },
    page: { locale: "en-US" },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl, { hash: "#/settings" });
      const languageSeg = page.getByRole("radiogroup", { name: "Language" });
      await languageSeg.waitFor();
      assert.deepEqual(await languageSeg.getByRole("radio").allTextContents(), ["日本語", "English", "System"]);
      await languageSeg.getByRole("radio", { name: "日本語" }).click();
      await page.getByRole("radiogroup", { name: "テーマ" }).waitFor();
    },
  },
];
