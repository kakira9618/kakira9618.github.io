// 問題一覧: Daily カレンダー・別モードの当日プレイ・レベル帯と出題セット
import assert from "node:assert/strict";
import { Logic } from "../../js/core/logic.js?v=20260806-a";
import { pidLabel, todayPID } from "../../js/core/problems.js?v=20260806-a";
import { assertNoSeriousA11yViolations, goHash, openApp, toast } from "./harness.mjs";

const historicalDate = new Date();
historicalDate.setDate(15);
historicalDate.setMonth(historicalDate.getMonth() - 1);
const historicalPid = historicalDate.getFullYear() * 10000 + (historicalDate.getMonth() + 1) * 100 + historicalDate.getDate();
const historicalLabel = `${historicalDate.getFullYear()}年${historicalDate.getMonth() + 1}月${historicalDate.getDate()}日`;
const now = Math.floor(Date.now() / 1000);

const clearedRecord = (pid, startTime, mode = "normal") => ({
  version: "2.0.0", startTime, endTime: startTime + 60, gameMode: mode, problemID: pid, guessWord: [new Logic(pid).ans1], clear: true, usoResults: [],
});

export default [
  {
    name: "daily",
    storage: { "dwordle2.history": [clearedRecord(historicalPid, now - 86400 * 40)] },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await goHash(page, "#/problems");
      const levelTabs = page.locator(".problem-level-tabs");
      const calendar = page.locator(".daily-calendar-card");
      await calendar.waitFor();
      assert.deepEqual(await levelTabs.getByRole("button").allTextContents(), ["Daily", "やさしい", "ふつう", "やや難", "難しい", "マニア", "極"]);
      assert.equal(await levelTabs.locator("button.active").innerText(), "Daily", "Daily should be selected by default");
      const today = page.locator("button.daily-calendar-day.today");
      assert.match(await today.getAttribute("aria-label"), /今日、未プレイ$/);

      // 過去の日付: カレンダー直下に内容が開き、結果は見られるがプレイはできない
      await page.getByRole("button", { name: "前の月" }).click();
      await page.getByText(`${historicalDate.getFullYear()}年${historicalDate.getMonth() + 1}月`, { exact: true }).waitFor();
      await page.getByRole("button", { name: `${historicalLabel}、クリア済み` }).click();
      const detail = page.locator("#screen-problems .daily-detail");
      await detail.getByText(historicalLabel, { exact: true }).waitFor();
      await detail.getByText("クリア済み", { exact: true }).waitFor();
      assert.equal(await page.locator('[role="dialog"]').count(), 0, "selecting a Daily date must not open a dialog");
      assert.equal(await detail.getByRole("button", { name: "この問題をプレイ" }).count(), 0, "past Daily history must not offer replay");
      assert.equal(await detail.getByRole("button", { name: /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} のプレイ$/ }).count(), 1, "past Daily results should remain viewable");
      assert.equal(
        await page.evaluate(async ({ pid }) => (await import("./js/ui/game-screen.js?v=20260806-a")).confirmAndStart(pid, "normal"), { pid: historicalPid }),
        false,
        "the shared game-start entry point must reject past Daily puzzles"
      );
      await toast(page, "過去・未来のDaily問題はプレイできません").waitFor();

      // 未来の日付も選んで眺められる（プレイはできない）
      await page.getByRole("button", { name: "次の月" }).click();
      await page.getByRole("button", { name: "次の月" }).click();
      const futureDays = page.locator(".daily-calendar-day.future");
      assert.ok(await futureDays.count() > 0, "next month should be all future dates");
      await futureDays.first().click();
      await detail.getByText("この日の問題は、その日になったらプレイできます").waitFor();
      assert.equal(await detail.getByRole("button", { name: "この問題をプレイ" }).count(), 0, "a future Daily date must not offer a play button");
      await page.getByRole("button", { name: "前の月" }).click();
      await today.click();
      await detail.getByRole("button", { name: "この問題をプレイ" }).waitFor();
    },
  },
  {
    // 今日の Daily を DWORDle だけでプレイ済みなら、DWORDlie 側は「未プレイ」のまま。
    // 開始時は矛盾した「プレイ済み」ではなく、別モードでの当日プレイだと明示する。
    name: "cross-mode-daily",
    storage: { "dwordle2.mode": "uso", "dwordle2.history": [clearedRecord(todayPID(), now - 30)] },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await goHash(page, "#/problems");
      const today = page.locator("button.daily-calendar-day.today");
      assert.match(await today.getAttribute("aria-label"), /今日、未プレイ$/, "Daily status should be mode-specific");
      await today.click();
      const detail = page.locator("#screen-problems .daily-detail");
      await detail.getByText("未プレイ", { exact: true }).waitFor();
      await detail.getByRole("button", { name: "この問題をプレイ" }).click();
      const dialog = page.getByRole("dialog", { name: "別モードで本日プレイ済み" });
      await dialog.getByText(`${pidLabel(todayPID())} は本日 DWORDle でプレイ済みですが、DWORDlie ではまだプレイしていません。`, { exact: false }).waitFor();
      await dialog.getByRole("button", { name: "キャンセル" }).click();
    },
  },
  {
    name: "levels",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await goHash(page, "#/problems");
      // 右上のボタンでタイトル画面と同じように DWORDle / DWORDlie を切り替えられる
      const header = page.locator("#screen-problems .header");
      await header.getByRole("button", { name: "裏モードへ" }).click();
      await page.locator("body.mode-uso").waitFor();
      await header.getByRole("button", { name: "表モードへ" }).click();
      await page.locator("body.mode-normal").waitFor();

      await page.locator(".problem-level-tabs").getByRole("button", { name: "やさしい", exact: true }).click();
      await page.getByText("No.1 - No.9999", { exact: true }).waitFor();
      // 出題セットの切り替え: 既定は新出題で、Classic を選ぶと Cls. 表記と実績対象外の注意が出る
      const setTabs = page.locator(".problem-set-tabs");
      assert.match(await setTabs.locator("button.active").first().textContent(), /新出題/, "the New puzzle set should be selected by default");
      await setTabs.getByRole("button", { name: /旧出題/ }).click();
      await page.getByText("Cls.1 - Cls.9999", { exact: true }).waitFor();
      await page.getByText("2026-08-01 以降のプレイは実績の対象になりません", { exact: false }).first().waitFor();
      await setTabs.getByRole("button", { name: /新出題/ }).click();
      await page.getByText("No.1 - No.9999", { exact: true }).waitFor();

      const block = page.locator("button.block-cell").first();
      await block.waitFor();
      await assertNoSeriousA11yViolations(page, "Problems screen");
      await page.locator("#screen-problems").getByRole("button", { name: "番号へジャンプ" }).click();
      const jumpDialog = page.getByRole("dialog", { name: "番号へジャンプ" });
      await jumpDialog.getByRole("spinbutton", { name: "問題番号" }).waitFor();
      await assertNoSeriousA11yViolations(page, "Jump-to-puzzle dialog");
      await jumpDialog.getByRole("button", { name: "キャンセル" }).click();
      await block.focus();
      await page.keyboard.press("Enter");
      await page.locator("button.num-cell").first().waitFor();

      // カテゴリとドリルダウンは覚えない: 戻ると必ず Daily から始まる
      await goHash(page, "#/");
      await goHash(page, "#/problems");
      assert.equal(await page.locator(".problem-level-tabs button.active").innerText(), "Daily", "the puzzle category must reset to Daily");
      assert.equal(await page.locator("button.num-cell").count(), 0, "the drilled-down puzzle block must not be restored");
    },
  },
];
