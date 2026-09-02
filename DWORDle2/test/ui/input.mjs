// タッチのキー入力: iOS は指を離したあと遅れて合成 click を配る。
// 直前の 1 キーだけを覚える抑止だと、P → O と速く打つと P の click が O の後に届いて
// "POP" のように増えていた。キーごとに 1 件ずつ打ち消す。
import assert from "node:assert/strict";
import { openApp } from "./harness.mjs";

export default [
  {
    name: "touch-dedupe",
    page: { hasTouch: true },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "本日の問題", exact: true }).click();
      await page.waitForURL(/#\/game$/);
      await page.locator("#screen-game.active .row").last().waitFor();
      const typedRow = () => page.evaluate(() =>
        [...document.querySelectorAll("#board .row")]
          .map((row) => [...row.querySelectorAll(".tile")].map((tile) => tile.textContent).join(""))
          .find((text) => text.trim() !== "") ?? ""
      );
      const touchKey = (key) => page.evaluate(([k]) => {
        const button = document.querySelector(`#keyboard [data-key="${k}"]`);
        const box = button.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
        button.dispatchEvent(new PointerEvent("pointerdown", init));
        button.dispatchEvent(new PointerEvent("pointerup", init));
      }, [key]);
      const lateClick = (key) => page.evaluate(([k]) => {
        document.querySelector(`#keyboard [data-key="${k}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }, [key]);
      const clearRow = async () => {
        for (let i = 0; i < 5; i++) await page.locator('#keyboard [data-key="backspace"]').click();
      };

      await touchKey("p");
      await touchKey("o");
      await lateClick("p"); // 指を離した P の合成 click が O のあとに届く
      assert.equal(await typedRow(), "PO", "a late synthetic click must not repeat an earlier key");
      await clearRow();
      await touchKey("s");
      await lateClick("s");
      await lateClick("s");
      assert.equal(await typedRow(), "S", "multiple synthetic clicks from one touch must not repeat the key");
      await clearRow();
      await touchKey("s");
      await touchKey("s");
      await lateClick("s");
      await lateClick("s");
      assert.equal(await typedRow(), "SS", "two real touches should still type two letters");
      await clearRow();
      for (const key of ["b", "l", "o", "o", "d"]) await touchKey(key);
      assert.equal(await typedRow(), "BLOOD", "touch input alone must still type (no synthetic click on Android)");
    },
  },
];
