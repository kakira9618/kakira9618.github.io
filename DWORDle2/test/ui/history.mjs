// プレイ履歴: モード切り替え・絞り込み・入力欄の保持（iOS の日付ピッカー対策）
import assert from "node:assert/strict";
import { Logic } from "../../js/core/logic.js?v=20260806-a";
import { pidForNumber } from "../../js/core/problems.js?v=20260806-a";
import { assertNoSeriousA11yViolations, goHash, openApp } from "./harness.mjs";

const doublePid = pidForNumber(2);
const doubleLogic = new Logic(doublePid);
const ordinaryPid = pidForNumber(3);

export default [
  {
    name: "history",
    storage: {
      "dwordle2.history": [
        { version: "2.0.0", startTime: 1_750_000_000, endTime: 1_750_000_020, gameMode: "normal", problemID: ordinaryPid, guessWord: [new Logic(ordinaryPid).ans1], clear: true, usoResults: [] },
        { version: "2.0.0", startTime: 1_750_100_000, endTime: 1_750_100_020, gameMode: "normal", problemID: doublePid, guessWord: [doubleLogic.ans1], clear: true, usoResults: [], extraShot: { word: doubleLogic.ans2, success: true } },
      ],
    },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await goHash(page, "#/history");
      const modeTabs = page.locator("#screen-history > .seg");
      for (const label of ["すべて", "DWORDle", "DWORDlie"]) {
        await modeTabs.getByRole("button", { name: label, exact: true }).click();
        await page.locator("#screen-history .history-controls-summary").waitFor();
      }
      // カテゴリ（モード）は覚えない: 一度画面を離れて戻ると必ず「すべて」から始まる
      await goHash(page, "#/");
      await goHash(page, "#/history");
      assert.equal(await modeTabs.locator("button.active").innerText(), "すべて", "the history category must reset to All");

      await page.locator("#screen-history .history-controls-summary").click();
      const resultFilter = page.getByLabel("結果", { exact: true });
      await resultFilter.selectOption("double");
      const items = page.locator("#screen-history .history-item");
      await items.first().waitFor();
      assert.equal(await items.count(), 1, "DOUBLE CLEAR should isolate successful EXTRA SHOT records");
      assert.match(await items.first().getAttribute("aria-label"), /ダブルクリア/);
      await resultFilter.selectOption("all");

      // 条件を変えても入力欄は作り直さない。作り直すと iOS Safari の日付ピッカーが一瞬で閉じる
      const kept = await page.evaluate(async () => {
        const dateInput = document.querySelector("#history-date-from");
        dateInput.focus();
        dateInput.value = "2099-01-01"; // 未来からの絞り込みなので該当は必ず 0 件
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        const result = {
          sameInput: document.querySelector("#history-date-from") === dateInput,
          stillFocused: document.activeElement === dateInput,
          matchCount: document.querySelector(".history-match-count")?.textContent,
        };
        document.querySelector(".history-reset").click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        return result;
      });
      assert.ok(kept.sameInput && kept.stillFocused, `changing a filter must keep the filter inputs alive: ${JSON.stringify(kept)}`);
      assert.match(kept.matchCount, /該当 0 件/, "the match count should update in place");

      const item = page.locator("button.history-item").first();
      await item.waitFor();
      await assertNoSeriousA11yViolations(page, "History screen");
      await item.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(/#\/result\/normal\/\d+$/);
    },
  },
];
