// 解放カード（BGM・実績）: 直列に 1 枚ずつ出し、複数はまとめる
import assert from "node:assert/strict";
import { openApp, waitForDialogFocus } from "./harness.mjs";

export default [
  {
    name: "bgm-unlock-queue",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.evaluate(async () => {
        const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260806-a");
        bgmUnlockCelebration([{ id: "queue-test-a", name: "Queue Test A", desc: "First unlock" }]);
        bgmUnlockCelebration([{ id: "queue-test-b", name: "Queue Test B", desc: "Second unlock" }]);
      });
      const first = page.getByRole("dialog", { name: "Queue Test A" });
      await first.waitFor({ timeout: 1600 });
      assert.equal(await page.locator(".bgm-unlock").count(), 1, "Unlock dialogs should be serialized");
      await waitForDialogFocus(page, ".bgm-unlock");
      assert.equal(await first.evaluate((node) => node.contains(document.activeElement)), true, "The unlock dialog should receive focus");
      await first.getByRole("button", { name: "あとで" }).click();
      const second = page.getByRole("dialog", { name: "Queue Test B" });
      await second.waitFor({ timeout: 1600 });
      assert.equal(await page.locator(".bgm-unlock").count(), 1, "Only one queued unlock dialog should be visible");
      await second.getByRole("button", { name: "あとで" }).click();
      await page.locator(".bgm-unlock").waitFor({ state: "detached" });

      // 2 曲以上の同時解放（履歴インポート等）は 1 枚のまとめカードで報告する
      await page.evaluate(async () => {
        const { bgmUnlockCelebration } = await import("./js/ui/toast.js?v=20260806-a");
        bgmUnlockCelebration([
          { id: "multi-a", name: "Multi Track A", desc: "" },
          { id: "multi-b", name: "Multi Track B", desc: "" },
          { id: "multi-c", name: "Multi Track C", desc: "" },
        ]);
      });
      const multi = page.getByRole("dialog", { name: "BGM を 3 曲解放！" });
      await multi.waitFor({ timeout: 1600 });
      assert.equal(await page.locator(".bgm-unlock").count(), 1, "Multiple BGM unlocks should merge into one card");
      await multi.getByText("Multi Track C").waitFor();
      await multi.getByRole("button", { name: "OK" }).click();
      await page.locator(".bgm-unlock").waitFor({ state: "detached" });
    },
  },
  {
    // 実績解放セレブレーション: 単発は大型カード、3 個以上は 1 枚にまとめる
    name: "achievement-cards",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await page.evaluate(async () => {
        const { achievementCelebration } = await import("./js/ui/toast.js?v=20260806-a");
        achievementCelebration([{ id: "smoke-single", icon: "trophy", color: "#ffd166", name: "スモーク実績", desc: "テスト用の実績です" }]);
      });
      const single = page.getByRole("dialog", { name: "スモーク実績" });
      await single.waitFor({ timeout: 1600 });
      assert.equal(await page.locator(".ach-unlock").count(), 1);
      await waitForDialogFocus(page, ".ach-unlock");
      assert.equal(await single.evaluate((node) => node.contains(document.activeElement)), true, "The achievement celebration should receive focus");
      await single.getByRole("button", { name: "OK" }).click();
      await page.locator(".ach-unlock").waitFor({ state: "detached" });

      await page.evaluate(async () => {
        const { achievementCelebration } = await import("./js/ui/toast.js?v=20260806-a");
        achievementCelebration([
          { id: "smoke-a", icon: "star", color: "#ffd166", name: "実績A", desc: "" },
          { id: "smoke-b", icon: "gem", color: "#7ee8ff", name: "実績B", desc: "" },
          { id: "smoke-c", icon: "flame", color: "#ff9a5c", name: "実績C", desc: "" },
        ]);
      });
      const multi = page.getByRole("dialog", { name: /実績を 3 個解除/ });
      await multi.waitFor({ timeout: 1600 });
      assert.equal(await multi.locator(".ach-unlock-mini").count(), 3, "The combined celebration should list all achievements");
      await multi.getByRole("button", { name: "OK" }).click();
      await page.locator(".ach-unlock").waitFor({ state: "detached" });
    },
  },
];
