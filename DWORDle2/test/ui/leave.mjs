// 進行中のゲームで戻ると、中断（保存を残す）か破棄（履歴へ残して終了）かを選ばせる
import assert from "node:assert/strict";
import { openApp, settings, typeGuess } from "./harness.mjs";

export default [
  {
    name: "pause-or-discard",
    storage: { "dwordle2.settings": settings({ theme: "cyber", extraShot: false }) },
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      const savedGame = () => page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.current.normal") || "null"));
      const startDaily = async () => {
        await page.getByRole("button", { name: "本日の問題", exact: true }).click();
        await page.waitForURL(/#\/game$/);
        await page.locator("#screen-game.active .row").last().waitFor();
      };
      // 0 手ならダイアログを出さずに戻る（失うものがない）
      await startDaily();
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await page.waitForURL(/#\/$/);
      assert.equal(await page.getByRole("dialog", { name: "タイトルへ戻る" }).count(), 0, "leaving an untouched board must not ask anything");

      await startDaily();
      await typeGuess(page, "crane");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("dwordle2.current.normal") || "null")?.guessWord.length === 1);
      await page.waitForTimeout(1600); // 判定オープンの演出
      const leaveDialog = page.getByRole("dialog", { name: "タイトルへ戻る" });
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await leaveDialog.waitFor();
      assert.deepEqual(await leaveDialog.locator(".modal-actions button").allTextContents(), ["キャンセル", "破棄", "中断"]);
      // キャンセルはゲームに残る
      await leaveDialog.getByRole("button", { name: "キャンセル" }).click();
      await leaveDialog.waitFor({ state: "detached" });
      assert.match(page.url(), /#\/game$/, "cancel must keep the player in the game");
      // 中断は保存を残してタイトルへ（「つづきから」で再開できる）
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await leaveDialog.getByRole("button", { name: "中断" }).click();
      await page.waitForURL(/#\/$/);
      assert.equal((await savedGame())?.guessWord.length, 1, "pausing must keep the game in progress");
      await page.getByRole("button", { name: /つづきから/ }).click();
      await page.waitForURL(/#\/game$/);
      // 破棄は進行中保存を消す一方、途中経過と破棄状態を履歴へ残す
      await page.getByRole("button", { name: "タイトルへ戻る" }).click();
      await leaveDialog.getByRole("button", { name: "破棄" }).click();
      await page.waitForURL(/#\/$/);
      assert.equal(await savedGame(), null, "discarding must drop the in-progress game");
      assert.equal(await page.getByRole("button", { name: /つづきから/ }).count(), 0, "the Continue button must disappear after discarding");
      const history = await page.evaluate(() => JSON.parse(localStorage.getItem("dwordle2.history") || "[]"));
      assert.equal(history.length, 1, "a discarded game must be recorded in history");
      assert.equal(history[0].discarded, true);
      assert.equal(history[0].clear, false);
      assert.deepEqual(history[0].guessWord, ["crane"], "the partial Guess history must be preserved");

      await page.getByRole("button", { name: "プレイ履歴" }).click();
      await page.waitForURL(/#\/history$/);
      const discardedItem = page.getByRole("button", { name: /破棄、1 手/ });
      await discardedItem.click();
      await page.waitForURL(/#\/result\/normal\//);
      await page.getByText("DISCARDED", { exact: true }).waitFor();
      // 同日の再挑戦前にも、すべての実績が対象外になることを明示する
      await page.getByRole("button", { name: "もう一度" }).click();
      const replayDialog = page.getByRole("dialog", { name: "本日破棄した問題" });
      await replayDialog.getByText("すべての実績の対象外", { exact: false }).waitFor();
      await replayDialog.getByRole("button", { name: "キャンセル" }).click();
      // 破棄結果の分析は閲覧できるが、「アナリスト」実績は解除しない
      await page.getByRole("button", { name: "分析" }).click();
      await page.waitForURL(/#\/analysis\/normal\//);
      assert.equal(
        await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("dwordle2.achievements") || "{}").analyst)),
        false,
        "analyzing a discarded game must not unlock the Analyst achievement"
      );
    },
  },
];
