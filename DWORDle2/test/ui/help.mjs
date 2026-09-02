// 遊び方ダイアログ: 右上の × で閉じられ、開き直すと必ず先頭から
import assert from "node:assert/strict";
import { openApp } from "./harness.mjs";

export default [
  {
    name: "help",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.getByRole("button", { name: "遊び方" }).click();
      const help = page.getByRole("dialog", { name: "DWORDle 遊び方" });
      await help.waitFor();
      await help.getByText(/ルールはほぼ Wordle と同じですが/).waitFor();
      assert.equal(await help.locator(".modal-close").count(), 1, "help dialog should have a top-right close button");
      // 高さを縮めて下端までスクロールした状態でも × は追従して見えている（sticky）
      await help.evaluate((dialog) => {
        dialog.style.height = "120px";
        dialog.style.maxHeight = "120px";
      });
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"][aria-labelledby]');
        return dialog && dialog.scrollHeight > dialog.clientHeight + 8;
      });
      await help.evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
      await help.locator(".modal-close").click();
      await help.waitFor({ state: "detached" });

      await page.getByRole("button", { name: "遊び方" }).click();
      const reopened = page.getByRole("dialog", { name: "DWORDle 遊び方" });
      await reopened.waitFor();
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"][aria-labelledby]');
        return dialog?.textContent.includes("DWORDle 遊び方") && document.activeElement === dialog;
      });
      assert.equal(await reopened.evaluate((dialog) => dialog.scrollTop), 0, "reopened help dialog should start at the top");
      await reopened.locator(".modal-actions").getByRole("button", { name: "閉じる" }).click();
      await reopened.waitFor({ state: "detached" });
    },
  },
];
