// ゲーム画面: 1 局のクリアと結果画面・シェア、先行入力、判定マーク
import assert from "node:assert/strict";
import { Logic } from "../../js/core/logic.js?v=20260806-a";
import { pidForNumber } from "../../js/core/problems.js?v=20260806-a";
import { assertNoSeriousA11yViolations, currentGame, openApp, settings, startPuzzle, typeGuess } from "./harness.mjs";

export default [
  {
    name: "clear",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await startPuzzle(page, 1);
      await assertNoSeriousA11yViolations(page, "Game screen");

      // キーボード折りたたみ: トグルで畳まれ、再度押すと展開する
      const collapsed = () => page.evaluate(() => document.getElementById("screen-game").classList.contains("kbd-collapsed"));
      await page.locator("#kbd-toggle").click();
      assert.equal(await collapsed(), true, "the toggle should collapse the keyboard");
      await page.locator("#kbd-toggle").click();
      assert.equal(await collapsed(), false, "the toggle should expand the keyboard again");

      await typeGuess(page, new Logic(pidForNumber(1)).ans1);
      await page.waitForURL(/#\/result\/normal\/\d+$/, { timeout: 15000 });
      // 判定結果はライブリージョンで自動読み上げされる
      assert.match(await page.locator("#sr-announcer").textContent(), /の判定：/, "Guess feedback should be announced via the live region");
      await page.getByText("GAME CLEAR").waitFor();
      assert.equal(await page.locator(".answer-row:has(.guess-flag)").count(), 1, "The guessed answer should carry a flag");
      await assertNoSeriousA11yViolations(page, "Result screen");

      await page.getByRole("button", { name: "もう一度", exact: true }).click();
      const replayDialog = page.getByRole("dialog", { name: "プレイ済みの問題" });
      await replayDialog.getByText("カウント系実績に加算されず", { exact: false }).waitFor();
      await replayDialog.getByRole("button", { name: "キャンセル" }).click();

      // シェアは navigator.share に text だけを渡す。url を別に添えると、共有先アプリが
      // URL だけを拾って結果のマス目が落ちることがある。
      await page.evaluate(() => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          writable: true,
          value: (data) => {
            window.__sharedData = data;
            return Promise.resolve();
          },
        });
        navigator.clipboard.writeText = (text) => {
          window.__copiedShareText = text;
          return Promise.resolve();
        };
      });
      await page.getByRole("button", { name: "シェア", exact: true }).click();
      const shared = await page.evaluate(() => window.__sharedData);
      assert.ok(shared, "the share button should call navigator.share");
      assert.equal(shared.url, undefined, "navigator.share must not receive a separate url field");
      assert.ok(/[🟩🟨⬜]/u.test(shared.text ?? ""), `shared text should contain the result grid: ${shared.text}`);
      assert.ok((shared.text ?? "").includes("https://kakira9618.github.io/DWORDle2/"), `shared text should end with the site URL: ${shared.text}`);

      // ハイコントラスト配色ではシェア文字列の絵文字も 🟧 / 🟦 になる
      await page.evaluate(async () => (await import("./js/core/settings.js?v=20260806-a")).setSetting("highContrast", true));
      await page.getByRole("button", { name: "コピー", exact: true }).click();
      const hcText = await page.evaluate(() => window.__copiedShareText);
      assert.ok(hcText.includes("🟧") && !hcText.includes("🟩"), `high-contrast share text should use the orange emoji: ${hcText}`);
    },
  },
  {
    // 判定オープン中の先行入力: 次の 1 行分をバッファし、オープン完了後に自動で確定する
    name: "buffered-input",
    async run({ page, baseUrl }) {
      await openApp(page, baseUrl);
      await startPuzzle(page, 2);
      const logic = new Logic(pidForNumber(2));
      const words = ["about", "cigar", "point"].filter((word) => !logic.isGameClear(word)).slice(0, 2);
      await typeGuess(page, words[0]);
      await typeGuess(page, words[1]); // 1 行目の判定オープン中に 2 行目を打つ
      await page.waitForFunction(() => document.querySelectorAll('#board .tile[class*="state-"]').length === 10, { timeout: 15000 });
      assert.match(await page.locator("#screen-game .header .sub").first().textContent(), /3 \/ 10/, "Buffered keys should submit the second Guess automatically");
    },
  },
  {
    // 設定「判定マーク」: 判定済みタイルの右下に 正解=● / 位置違い=△ / 不使用=× が付く（WCAG 1.4.1）
    name: "state-symbols",
    storage: {
      "dwordle2.settings": settings({ stateSymbols: true }),
      "dwordle2.mode": "normal",
      "dwordle2.current.normal": currentGame(1, { startTime: 1_800_000_400 }),
      "dwordle2.history": [],
      "dwordle2.achievements": {},
    },
    async run({ page, baseUrl }) {
      // 問題 1 の答えは point / touch。crane は 位置違い/不使用/不使用/正解/不使用 と 3 種すべて出る
      assert.deepEqual(new Logic(1).queryWord("crane"), ["used", "unused", "unused", "correct", "unused"]);
      await openApp(page, baseUrl, { hash: "#/game" });
      await page.locator("#screen-game.active .row").last().waitFor();
      assert.equal(await page.evaluate(() => document.body.classList.contains("state-symbols")), true);
      await typeGuess(page, "crane");
      await page.waitForFunction(
        () => document.querySelectorAll('#screen-game.active #board .row:first-child .tile[class*="state-"]').length === 5,
        null,
        { timeout: 8000 }
      );
      const marks = () => page.evaluate(() =>
        [...document.querySelectorAll("#screen-game.active #board .row:first-child .tile")].map((tile) => getComputedStyle(tile, "::after").content)
      );
      assert.deepEqual(await marks(), ['"△"', '"×"', '"×"', '"●"', '"×"'], "revealed tiles should carry the symbol matching their state");
      await page.evaluate(() => document.body.classList.remove("state-symbols"));
      assert.deepEqual(await marks(), Array(5).fill("none"), "symbols should disappear when the setting is off");
    },
  },
];
