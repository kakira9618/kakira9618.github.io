// エントリーゲート（扉絵）と基本ルールのチュートリアル、モード切り替え
import assert from "node:assert/strict";
import { assertNoSeriousA11yViolations, openApp, passGate, settings } from "./harness.mjs";

const soundSettings = (page) => page.evaluate(async () => {
  const s = (await import("./js/core/settings.js?v=20260806-a")).getSettings();
  return { bgm: s.bgm, sfx: s.sfx };
});

export default [
  {
    name: "gate-and-tutorial",
    // 基本ルールは未読の状態から（扉絵の直後に出る）
    storage: { "dwordle2.tutorialSeen": null, "dwordle2.tutorialSeenUso": null },
    async run({ page, baseUrl }) {
      await page.goto(baseUrl, { waitUntil: "load" });
      await page.locator("#entry-gate .entry-gate-start").waitFor();
      await page.locator("#entry-gate .entry-gate-muted").waitFor();
      await assertNoSeriousA11yViolations(page, "Entry gate");
      // 扉絵の間はボタン以外をタップしても音声は解錠されない
      await page.mouse.click(30, 200);
      assert.equal(
        await page.evaluate(async () => (await import("./js/audio/sound.js?v=20260806-a")).audioNeedsRecovery()),
        true,
        "audio must stay locked while the entry gate is open"
      );
      await passGate(page);
      // 「開始」は音オフ設定からでも音を復帰する
      assert.deepEqual(await soundSettings(page), { bgm: true, sfx: true }, "Start should restore sound");

      const tutorial = page.getByRole("dialog", { name: "基本ルール | DWORDle" });
      await tutorial.waitFor();
      assert.equal(await tutorial.evaluate((node) => node.contains(document.activeElement)), true, "Tutorial should receive focus");
      await tutorial.getByRole("button", { name: "わかった" }).click();
      await page.getByRole("button", { name: "裏モードへ" }).click();
      const usoTutorial = page.getByRole("dialog", { name: "基本ルール | DWORDlie" });
      await usoTutorial.waitFor();
      await usoTutorial.getByRole("button", { name: "わかった" }).click();
      await page.getByText("う そ ぴ ょ ん", { exact: true }).waitFor();
      await page.getByRole("button", { name: "表モードへ" }).click();
      await page.getByRole("button", { name: "本日の問題", exact: true }).waitFor();
      await assertNoSeriousA11yViolations(page, "Title screen");
    },
  },
  {
    // 「音無しで開始」は音オン設定でも音を止めたまま入る
    name: "muted-start",
    storage: { "dwordle2.settings": settings({ sfx: true, bgm: true }) },
    async run({ page, baseUrl }) {
      await page.goto(baseUrl, { waitUntil: "load" });
      await page.locator("#entry-gate .entry-gate-muted").click();
      await page.locator("#entry-gate").waitFor({ state: "detached" });
      assert.deepEqual(await soundSettings(page), { bgm: false, sfx: false }, "Start muted should mute all sounds");
    },
  },
  {
    // 扉絵は前回選択していたモードのテーマで表示し、「開始」でそのモードへ直行する
    name: "uso-gate",
    storage: {
      "dwordle2.settings": settings({ theme: "cyber" }),
      "dwordle2.mode": "uso",
      "dwordle2.lastPlayedMode": "normal", // 旧仕様の保存値より選択を優先する
    },
    async run({ page, baseUrl }) {
      await page.goto(baseUrl, { waitUntil: "load" });
      await page.locator("#entry-gate .entry-gate-start").waitFor();
      assert.equal(await page.evaluate(() => document.body.classList.contains("mode-uso")), true, "the gate should use the DWORDlie theme");
      await passGate(page);
      await page.locator("#screen-title.active").waitFor();
      assert.match(await page.locator("#screen-title .logo").textContent(), /DWORDlie/, "starting from the gate should land in DWORDlie");
    },
  },
  {
    // 言語のシステム連動: 設定が未保存なら navigator.language に従う
    name: "system-language",
    page: false,
    async run({ open, baseUrl }) {
      const ja = await open({ fresh: true, locale: "ja-JP", axe: false });
      await ja.page.goto(baseUrl, { waitUntil: "load" });
      await ja.page.getByRole("button", { name: "開始", exact: true }).waitFor();
      assert.equal(await ja.page.evaluate(() => document.documentElement.lang), "ja");
      const en = await open({ fresh: true, locale: "en-US", axe: false });
      await en.page.goto(baseUrl, { waitUntil: "load" });
      await en.page.getByRole("button", { name: "Start", exact: true }).waitFor();
      assert.equal(await en.page.evaluate(() => document.documentElement.lang), "en");
    },
  },
];
